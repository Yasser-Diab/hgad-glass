-- Forward-only repair for deployments whose established order identifiers are
-- text rather than UUID. The functions derive their identifier types directly
-- from the deployed tables, preserving every existing order and row ID while
-- keeping indexed comparisons type-correct. This migration also removes the
-- obsolete receipt overload before PostgREST reloads its function cache.

-- Atomically persist order status and selected receipt-row changes.
-- Depends on 20260729151648_harden_auth_rls_and_cost_access.sql.
drop function if exists public.apply_order_receipt_status(uuid, text, text, numeric, jsonb);
drop function if exists public.apply_order_receipt_status(text, text, text, numeric, jsonb);

create or replace function public.apply_order_receipt_status(
  p_order_id public.glass_orders.id%type,
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
        item ->> 'id' as id,
        (item ->> 'received_quantity')::numeric as received_quantity,
        item -> 'receipt_history' as receipt_history
      from jsonb_array_elements(p_rows) as source(item)
    )
    update public.glass_order_rows as target
    set received_quantity = incoming.received_quantity,
        receipt_history = incoming.receipt_history,
        updated_at = now()
    from incoming
    where target.id::text = incoming.id
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

revoke all on function public.apply_order_receipt_status(public.glass_orders.id%type, text, text, numeric, jsonb)
  from public, anon;
grant execute on function public.apply_order_receipt_status(public.glass_orders.id%type, text, text, numeric, jsonb)
  to authenticated;

-- Persist an order header, all of its rows, and row pruning in one database
-- transaction. This migration intentionally follows the hidden-cost triggers:
-- existing records are updated (so protected costs are retained), while new
-- records are inserted (so the existing cost-permission rules still apply).

create or replace function public.save_glass_order_atomic(
  p_order jsonb,
  p_rows jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_exists boolean := false;
  row_exists boolean := false;
  order_id_value public.glass_orders.id%type;
  order_no_value text;
  customer_id_value public.glass_orders.customer_id%type;
  supplier_id_value public.glass_orders.supplier_id%type;
  existing_row_order_id public.glass_order_rows.order_id%type;
  row_value jsonb;
  row_id_value public.glass_order_rows.id%type;
  saved_row_ids text[] := '{}'::text[];
  saved_row_count integer := 0;
  pruned_row_count integer := 0;
begin
  if not (select app_private.current_user_is_active()) then
    raise exception 'Active authenticated user required.'
      using errcode = '42501';
  end if;
  if p_order is null or jsonb_typeof(p_order) <> 'object' then
    raise exception 'Order payload must be a JSON object.'
      using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Order rows must be a JSON array.'
      using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_order -> 'totals', '{}'::jsonb)) <> 'object' then
    raise exception 'Order totals must be a JSON object.'
      using errcode = '22023';
  end if;

  begin
    order_id_value := nullif(trim(coalesce(p_order ->> 'id', '')), '');
    if order_id_value is null then
      order_id_value := gen_random_uuid()::text;
    end if;
  exception
    when invalid_text_representation then
      raise exception 'Order ID must be a valid UUID.'
        using errcode = '22023';
  end;

  order_no_value := nullif(trim(coalesce(p_order ->> 'order_no', '')), '');
  if order_no_value is null then
    raise exception 'Order number is required.'
      using errcode = '22023';
  end if;
  if nullif(trim(coalesce(p_order ->> 'order_date', '')), '') is null then
    raise exception 'Order date is required.'
      using errcode = '22023';
  end if;
  begin
    customer_id_value := nullif(trim(coalesce(p_order ->> 'customer_id', '')), '');
    supplier_id_value := nullif(trim(coalesce(p_order ->> 'supplier_id', '')), '');
  exception
    when invalid_text_representation then
      raise exception 'Customer and supplier IDs must match their database identifier types.'
        using errcode = '22023';
  end;
  if p_order ? 'collected_pieces'
    and jsonb_typeof(p_order -> 'collected_pieces') is distinct from 'number'
  then
    raise exception 'Collected quantity must be numeric.'
      using errcode = '22023';
  end if;

  perform 1
  from public.glass_orders
  where id = order_id_value
  for update;
  order_exists := found;

  if order_exists then
    update public.glass_orders
    set order_no = order_no_value,
        document_id = nullif(trim(coalesce(p_order ->> 'document_id', '')), ''),
        order_date = (p_order ->> 'order_date')::date,
        entry_at = nullif(trim(coalesce(p_order ->> 'entry_at', '')), '')::timestamptz,
        status = coalesce(nullif(p_order ->> 'status', ''), 'draft'),
        collected_pieces = coalesce((p_order ->> 'collected_pieces')::numeric, 0),
        entry_mode = coalesce(nullif(p_order ->> 'entry_mode', ''), 'normal'),
        customer_id = customer_id_value,
        supplier_id = supplier_id_value,
        customer_name = p_order ->> 'customer_name',
        supplier_name = p_order ->> 'supplier_name',
        project = p_order ->> 'project',
        code = p_order ->> 'code',
        notes = p_order ->> 'notes',
        totals = coalesce(p_order -> 'totals', '{}'::jsonb),
        updated_at = now()
    where id = order_id_value;
  else
    insert into public.glass_orders (
      id,
      order_no,
      document_id,
      order_date,
      entry_at,
      status,
      collected_pieces,
      entry_mode,
      customer_id,
      supplier_id,
      customer_name,
      supplier_name,
      project,
      code,
      notes,
      totals
    )
    values (
      order_id_value,
      order_no_value,
      nullif(trim(coalesce(p_order ->> 'document_id', '')), ''),
      (p_order ->> 'order_date')::date,
      nullif(trim(coalesce(p_order ->> 'entry_at', '')), '')::timestamptz,
      coalesce(nullif(p_order ->> 'status', ''), 'draft'),
      coalesce((p_order ->> 'collected_pieces')::numeric, 0),
      coalesce(nullif(p_order ->> 'entry_mode', ''), 'normal'),
      customer_id_value,
      supplier_id_value,
      p_order ->> 'customer_name',
      p_order ->> 'supplier_name',
      p_order ->> 'project',
      p_order ->> 'code',
      p_order ->> 'notes',
      coalesce(p_order -> 'totals', '{}'::jsonb)
    );
  end if;

  -- Serialize row replacement for this order after the header lock.
  perform 1
  from public.glass_order_rows
  where order_id = order_id_value
  for update;

  for row_value in
    select incoming.value
    from jsonb_array_elements(p_rows) as incoming(value)
  loop
    if jsonb_typeof(row_value) <> 'object' then
      raise exception 'Each order row must be a JSON object.'
        using errcode = '22023';
    end if;
    begin
      row_id_value := nullif(trim(coalesce(row_value ->> 'id', '')), '');
    exception
      when invalid_text_representation then
        raise exception 'Each order row ID must be a valid UUID.'
          using errcode = '22023';
    end;
    if row_id_value is null then
      raise exception 'Each order row requires an ID.'
        using errcode = '22023';
    end if;
    if row_id_value::text = any(saved_row_ids) then
      raise exception 'Order rows contain a duplicate row ID.'
        using errcode = '22023';
    end if;

    if jsonb_typeof(row_value -> 'line_no') is distinct from 'number'
      or jsonb_typeof(row_value -> 'quantity') is distinct from 'number'
      or jsonb_typeof(row_value -> 'unit_price') is distinct from 'number'
      or jsonb_typeof(row_value -> 'supplier_unit_price') is distinct from 'number'
      or jsonb_typeof(row_value -> 'material_unit_price') is distinct from 'number'
      or jsonb_typeof(row_value -> 'supplier_material_unit_price') is distinct from 'number'
      or jsonb_typeof(row_value -> 'area_m2') is distinct from 'number'
      or jsonb_typeof(row_value -> 'cost') is distinct from 'number'
      or jsonb_typeof(row_value -> 'supplier_cost') is distinct from 'number'
    then
      raise exception 'Order row quantities and prices must be numeric.'
        using errcode = '22023';
    end if;
    if row_value ? 'received_quantity'
      and jsonb_typeof(row_value -> 'received_quantity') not in ('number', 'null')
    then
      raise exception 'Order row received quantity must be numeric or null.'
        using errcode = '22023';
    end if;
    if jsonb_typeof(row_value -> 'receipt_history') is distinct from 'array'
      or jsonb_typeof(row_value -> 'layers') is distinct from 'array'
      or jsonb_typeof(row_value -> 'drawing') is distinct from 'object'
    then
      raise exception 'Order row history, layers, or drawing has an invalid shape.'
        using errcode = '22023';
    end if;

    existing_row_order_id := null;
    select order_id
    into existing_row_order_id
    from public.glass_order_rows
    where id = row_id_value
    for update;
    row_exists := found;
    if row_exists and existing_row_order_id <> order_id_value then
      raise exception 'An order row belongs to another order.'
        using errcode = '42501';
    end if;

    if row_exists then
      update public.glass_order_rows
      set line_no = (row_value ->> 'line_no')::integer,
          glass_mode = coalesce(nullif(row_value ->> 'glass_mode', ''), 'single'),
          code = row_value ->> 'code',
          description = row_value ->> 'description',
          quantity = (row_value ->> 'quantity')::numeric,
          unit_price = (row_value ->> 'unit_price')::numeric,
          supplier_unit_price = (row_value ->> 'supplier_unit_price')::numeric,
          material_unit_price = (row_value ->> 'material_unit_price')::numeric,
          supplier_material_unit_price = (row_value ->> 'supplier_material_unit_price')::numeric,
          double_gap = row_value ->> 'double_gap',
          triplex_pvb = row_value ->> 'triplex_pvb',
          extra_direction = row_value ->> 'extra_direction',
          notes = row_value ->> 'notes',
          received_quantity = nullif(row_value ->> 'received_quantity', '')::numeric,
          receipt_history = row_value -> 'receipt_history',
          layers = row_value -> 'layers',
          drawing = row_value -> 'drawing',
          area_m2 = (row_value ->> 'area_m2')::numeric,
          cost = (row_value ->> 'cost')::numeric,
          supplier_cost = (row_value ->> 'supplier_cost')::numeric,
          updated_at = now()
      where id = row_id_value
        and order_id = order_id_value;
    else
      insert into public.glass_order_rows (
        id,
        order_id,
        line_no,
        glass_mode,
        code,
        description,
        quantity,
        unit_price,
        supplier_unit_price,
        material_unit_price,
        supplier_material_unit_price,
        double_gap,
        triplex_pvb,
        extra_direction,
        notes,
        received_quantity,
        receipt_history,
        layers,
        drawing,
        area_m2,
        cost,
        supplier_cost
      )
      values (
        row_id_value,
        order_id_value,
        (row_value ->> 'line_no')::integer,
        coalesce(nullif(row_value ->> 'glass_mode', ''), 'single'),
        row_value ->> 'code',
        row_value ->> 'description',
        (row_value ->> 'quantity')::numeric,
        (row_value ->> 'unit_price')::numeric,
        (row_value ->> 'supplier_unit_price')::numeric,
        (row_value ->> 'material_unit_price')::numeric,
        (row_value ->> 'supplier_material_unit_price')::numeric,
        row_value ->> 'double_gap',
        row_value ->> 'triplex_pvb',
        row_value ->> 'extra_direction',
        row_value ->> 'notes',
        nullif(row_value ->> 'received_quantity', '')::numeric,
        row_value -> 'receipt_history',
        row_value -> 'layers',
        row_value -> 'drawing',
        (row_value ->> 'area_m2')::numeric,
        (row_value ->> 'cost')::numeric,
        (row_value ->> 'supplier_cost')::numeric
      );
    end if;

    saved_row_ids := array_append(saved_row_ids, row_id_value::text);
    saved_row_count := saved_row_count + 1;
  end loop;

  delete from public.glass_order_rows
  where order_id = order_id_value
    and not (id::text = any(saved_row_ids));
  get diagnostics pruned_row_count = row_count;

  return jsonb_build_object(
    'id', order_id_value,
    'order_no', order_no_value,
    'updated_rows', saved_row_count,
    'pruned_rows', pruned_row_count
  );
end;
$$;

revoke all on function public.save_glass_order_atomic(jsonb, jsonb)
  from public, anon;
grant execute on function public.save_glass_order_atomic(jsonb, jsonb)
  to authenticated;

notify pgrst, 'reload schema';
