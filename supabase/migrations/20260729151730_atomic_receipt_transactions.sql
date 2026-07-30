-- Atomically persist order status and selected receipt-row changes.
-- Depends on 20260729151648_harden_auth_rls_and_cost_access.sql.
create or replace function public.apply_order_receipt_status(
  p_order_id uuid,
  p_document_id text,
  p_status text,
  p_collected_pieces numeric,
  p_rows jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  incoming_count integer := 0;
  owned_count integer := 0;
  total_ordered numeric := 0;
  total_received numeric := 0;
  persisted_collected numeric := 0;
  receipt_derived_status text := 'ordered';
begin
  if not (select app_private.current_user_is_active()) then
    raise exception 'Active authenticated user required.'
      using errcode = '42501';
  end if;

  perform 1
  from public.glass_orders
  where id = p_order_id
  for update;
  if not found then
    raise exception 'Order not found.'
      using errcode = 'P0002';
  end if;
  perform 1
  from public.glass_order_rows
  where order_id = p_order_id
  for update;

  if p_status is null or p_status not in (
    'ordered', 'fabrication', 'ready', 'partial', 'collected',
    'pricing', 'cancelled', 'draft'
  ) then
    raise exception 'Invalid order status.'
      using errcode = '22023';
  end if;
  if p_collected_pieces is null or p_collected_pieces < 0 then
    raise exception 'Collected quantity must be non-negative.'
      using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Receipt rows must be a JSON array.'
      using errcode = '22023';
  end if;

  select count(*), count(distinct item ->> 'id')
  into incoming_count, owned_count
  from jsonb_array_elements(p_rows) as incoming(item);
  if incoming_count <> owned_count then
    raise exception 'Receipt rows contain a missing or duplicate row ID.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) as incoming(item)
    where jsonb_typeof(item -> 'received_quantity') is distinct from 'number'
      or (item ->> 'received_quantity')::numeric < 0
      or jsonb_typeof(item -> 'receipt_history') is distinct from 'array'
  ) then
    raise exception 'Each receipt row requires a non-negative numeric quantity and history array.'
      using errcode = '22023';
  end if;

  select count(*)
  into owned_count
  from public.glass_order_rows as row_record
  join jsonb_array_elements(p_rows) as incoming(item)
    on row_record.id::text = incoming.item ->> 'id'
  where row_record.order_id = p_order_id;
  if owned_count <> incoming_count then
    raise exception 'A receipt row does not belong to this order.'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.glass_order_rows as row_record
    join jsonb_array_elements(p_rows) as incoming(item)
      on row_record.id::text = incoming.item ->> 'id'
    where row_record.order_id = p_order_id
      and (incoming.item ->> 'received_quantity')::numeric
        > greatest(coalesce(row_record.quantity, 0), 0)
  ) then
    raise exception 'A received quantity exceeds its ordered row quantity.'
      using errcode = '22023';
  end if;

  if incoming_count > 0 then
    with incoming as (
      select
        (item ->> 'id')::uuid as id,
        (item ->> 'received_quantity')::numeric as received_quantity,
        item -> 'receipt_history' as receipt_history
      from jsonb_array_elements(p_rows) as source(item)
    )
    update public.glass_order_rows as target
    set received_quantity = incoming.received_quantity,
        receipt_history = incoming.receipt_history,
        updated_at = now()
    from incoming
    where target.id = incoming.id
      and target.order_id = p_order_id;
  end if;

  select
    coalesce(sum(greatest(coalesce(quantity, 0), 0)), 0),
    coalesce(sum(greatest(coalesce(received_quantity, 0), 0)), 0)
  into total_ordered, total_received
  from public.glass_order_rows
  where order_id = p_order_id;

  if total_received > total_ordered + 0.000000001 then
    raise exception 'Total received quantity exceeds the order quantity.'
      using errcode = '22023';
  end if;
  if incoming_count > 0
    and abs(total_received - p_collected_pieces) > 0.000000001
  then
    raise exception 'Collected total does not match the receipt rows.'
      using errcode = '22023';
  end if;
  persisted_collected := case
    when incoming_count > 0 then total_received
    else p_collected_pieces
  end;
  if persisted_collected > total_ordered + 0.000000001 then
    raise exception 'Collected total exceeds the order quantity.'
      using errcode = '22023';
  end if;

  receipt_derived_status := case
    when persisted_collected <= 0.000000001 then 'ordered'
    when total_ordered > 0.000000001
      and persisted_collected >= total_ordered - 0.000000001 then 'collected'
    else 'partial'
  end;
  if p_status not in ('pricing', 'cancelled', 'draft')
    and (
      (receipt_derived_status in ('partial', 'collected') and p_status <> receipt_derived_status)
      or (receipt_derived_status = 'ordered' and p_status in ('partial', 'collected'))
    )
  then
    raise exception 'Order status does not match its receipt quantities.'
      using errcode = '22023';
  end if;

  update public.glass_orders
  set document_id = nullif(trim(coalesce(p_document_id, '')), ''),
      status = p_status,
      collected_pieces = persisted_collected,
      updated_at = now()
  where id = p_order_id;

  return jsonb_build_object(
    'id', p_order_id,
    'status', p_status,
    'collected_pieces', persisted_collected,
    'updated_rows', incoming_count
  );
end;
$$;

revoke all on function public.apply_order_receipt_status(uuid, text, text, numeric, jsonb)
  from public, anon;
grant execute on function public.apply_order_receipt_status(uuid, text, text, numeric, jsonb)
  to authenticated;
