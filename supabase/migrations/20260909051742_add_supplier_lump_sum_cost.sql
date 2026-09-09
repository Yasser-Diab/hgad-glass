-- Optional supplier invoice total. A null value deliberately means that the
-- order continues to use the calculated sum of supplier row costs.
alter table public.glass_orders
  add column if not exists supplier_lump_sum_cost numeric;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'glass_orders_supplier_lump_sum_cost_nonnegative'
      and conrelid = 'public.glass_orders'::regclass
  ) then
    alter table public.glass_orders
      add constraint glass_orders_supplier_lump_sum_cost_nonnegative
      check (supplier_lump_sum_cost is null or supplier_lump_sum_cost >= 0);
  end if;
end
$$;

-- The existing row-cost trigger also protects the header-level invoice amount.
-- Older clients omit this field, so their current saved invoice remains intact.
create or replace function app_private.protect_glass_order_costs()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  old_supplier_cost jsonb;
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  if not (select app_private.current_user_is_active()) then
    raise exception 'Active authenticated user required.'
      using errcode = '42501';
  end if;
  if (select app_private.current_user_can_view_costs()) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'Creating a new order requires supplier-cost permission.'
      using errcode = '42501';
  end if;
  old_supplier_cost := coalesce(
    old.totals -> 'supplierCost',
    old.totals -> 'supplier_cost',
    '0'::jsonb
  );
  new.totals := (
    coalesce(new.totals, '{}'::jsonb)
      - 'supplierCost'
      - 'supplier_cost'
      - 'calculatedSupplierCost'
      - 'calculated_supplier_cost'
      - 'supplierLumpSumCost'
      - 'supplier_lump_sum_cost'
      - 'supplierCostSource'
      - 'supplier_cost_source'
  ) || jsonb_build_object(
    'supplierCost', old_supplier_cost,
    'supplier_cost', old_supplier_cost
  );
  new.supplier_lump_sum_cost := old.supplier_lump_sum_cost;
  return new;
end;
$$;

revoke all on function app_private.protect_glass_order_costs()
  from public, anon, authenticated;

-- Keep both paged and legacy startup loaders safe for users who cannot view
-- supplier costs. The redacted copy includes neither the override nor its
-- calculated source fields.
create or replace function public.load_glass_orders_page(
  p_offset integer default 0,
  p_limit integer default 1000
)
returns setof public.glass_orders
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  can_view_costs boolean;
  safe_offset integer := greatest(coalesce(p_offset, 0), 0);
  safe_limit integer := least(greatest(coalesce(p_limit, 1000), 1), 1000);
  order_record public.glass_orders%rowtype;
begin
  if not (select app_private.current_user_is_active()) then
    raise exception 'Authenticated active application user required'
      using errcode = '42501';
  end if;

  can_view_costs := (select app_private.current_user_can_view_costs());
  if can_view_costs then
    return query
    select order_source.*
    from public.glass_orders as order_source
    order by order_source.order_date desc, order_source.order_no desc, order_source.id
    offset safe_offset
    limit safe_limit;
    return;
  end if;

  for order_record in
    select order_source.*
    from public.glass_orders as order_source
    order by order_source.order_date desc, order_source.order_no desc, order_source.id
    offset safe_offset
    limit safe_limit
  loop
    order_record.totals := (
      coalesce(order_record.totals, '{}'::jsonb)
        - 'supplierCost'
        - 'supplier_cost'
        - 'calculatedSupplierCost'
        - 'calculated_supplier_cost'
        - 'supplierLumpSumCost'
        - 'supplier_lump_sum_cost'
        - 'supplierCostSource'
        - 'supplier_cost_source'
    ) || jsonb_build_object('supplierCost', 0, 'supplier_cost', 0);
    order_record.supplier_lump_sum_cost := null;
    return next order_record;
  end loop;
end;
$$;

create or replace function public.load_glass_orders()
returns setof public.glass_orders
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  can_view_costs boolean;
  order_record public.glass_orders%rowtype;
begin
  if not (select app_private.current_user_is_active()) then
    raise exception 'Authenticated active application user required'
      using errcode = '42501';
  end if;

  can_view_costs := (select app_private.current_user_can_view_costs());
  if can_view_costs then
    return query
    select order_source.*
    from public.glass_orders as order_source
    order by order_source.order_date desc, order_source.order_no desc, order_source.id;
    return;
  end if;

  for order_record in
    select order_source.*
    from public.glass_orders as order_source
    order by order_source.order_date desc, order_source.order_no desc, order_source.id
  loop
    order_record.totals := (
      coalesce(order_record.totals, '{}'::jsonb)
        - 'supplierCost'
        - 'supplier_cost'
        - 'calculatedSupplierCost'
        - 'calculated_supplier_cost'
        - 'supplierLumpSumCost'
        - 'supplier_lump_sum_cost'
        - 'supplierCostSource'
        - 'supplier_cost_source'
    ) || jsonb_build_object('supplierCost', 0, 'supplier_cost', 0);
    order_record.supplier_lump_sum_cost := null;
    return next order_record;
  end loop;
end;
$$;

revoke all on function public.load_glass_orders_page(integer, integer),
  public.load_glass_orders()
  from public, anon;
grant execute on function public.load_glass_orders_page(integer, integer),
  public.load_glass_orders()
  to authenticated;

-- Re-wrap the verified atomic saver so the optional header invoice is committed
-- in the same transaction as the order header and its rows.
create or replace function public.save_glass_order_atomic(
  p_order jsonb,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  expected_item_count integer;
  existing_order_id public.glass_orders.id%type;
  saved_order_id public.glass_orders.id%type;
  was_existing boolean := false;
  saved_result jsonb;
  persisted_item_count integer;
  persisted_row_ids text[] := '{}'::text[];
  submitted_row_ids text[] := '{}'::text[];
  revision_number integer;
begin
  if not (select app_private.current_user_is_active()) then
    raise exception 'Active authenticated user required.' using errcode = '42501';
  end if;
  if p_order is null or jsonb_typeof(p_order) <> 'object'
    or p_rows is null or jsonb_typeof(p_rows) <> 'array'
  then
    raise exception 'ORDER_VALIDATION_FAILED'
      using errcode = '22023',
            detail = '{"scope":"order","field":"rows","message":"Order and rows payloads are required."}';
  end if;
  if jsonb_typeof(p_order -> 'expected_item_count') is distinct from 'number' then
    raise exception 'ORDER_ITEM_COUNT_MISMATCH'
      using errcode = '22023',
            detail = '{"field":"expectedItemCount","message":"Expected order item count is required."}';
  end if;
  if p_order ? 'supplier_lump_sum_cost'
    and jsonb_typeof(p_order -> 'supplier_lump_sum_cost') not in ('number', 'null')
  then
    raise exception 'ORDER_VALIDATION_FAILED'
      using errcode = '22023',
            detail = '{"scope":"order","field":"supplierLumpSumCost","message":"Supplier invoice amount must be numeric or null."}';
  end if;
  if jsonb_typeof(p_order -> 'supplier_lump_sum_cost') = 'number'
    and (p_order ->> 'supplier_lump_sum_cost')::numeric < 0
  then
    raise exception 'ORDER_VALIDATION_FAILED'
      using errcode = '22023',
            detail = '{"scope":"order","field":"supplierLumpSumCost","message":"Supplier invoice amount cannot be negative."}';
  end if;

  expected_item_count := (p_order ->> 'expected_item_count')::integer;
  if expected_item_count <> jsonb_array_length(p_rows) then
    raise exception 'ORDER_ITEM_COUNT_MISMATCH'
      using errcode = '22023',
            detail = jsonb_build_object(
              'expected', expected_item_count,
              'submitted', jsonb_array_length(p_rows),
              'message', 'The submitted order row count does not match the expected count.'
            )::text;
  end if;

  select id
  into existing_order_id
  from public.glass_orders
  where id::text = nullif(trim(coalesce(p_order ->> 'id', '')), '')
     or order_no = nullif(trim(coalesce(p_order ->> 'order_no', '')), '')
  order by (id::text = nullif(trim(coalesce(p_order ->> 'id', '')), '')) desc
  limit 1
  for update;
  was_existing := found;
  if was_existing then
    revision_number := app_private.capture_order_snapshot(
      existing_order_id,
      'order_update',
      coalesce(p_order ->> 'app_version', '0.1.13'),
      coalesce(p_order ->> 'client_type', 'supabase')
    );
  end if;

  saved_result := app_private.save_glass_order_atomic_v010(p_order, p_rows);
  saved_order_id := saved_result ->> 'id';

  if p_order ? 'supplier_lump_sum_cost' then
    update public.glass_orders
    set supplier_lump_sum_cost = case
      when jsonb_typeof(p_order -> 'supplier_lump_sum_cost') = 'null' then null
      else (p_order ->> 'supplier_lump_sum_cost')::numeric
    end,
    updated_at = now()
    where id = saved_order_id;
  end if;

  select
    count(*),
    coalesce(array_agg(id::text order by line_no, id), '{}'::text[])
  into persisted_item_count, persisted_row_ids
  from public.glass_order_rows
  where order_id = saved_order_id
    and deleted_at is null;

  select coalesce(array_agg(item ->> 'id'), '{}'::text[])
  into submitted_row_ids
  from jsonb_array_elements(p_rows) as submitted(item);

  if persisted_item_count <> expected_item_count
    or cardinality(persisted_row_ids) <> expected_item_count
    or cardinality(array(select distinct unnest(persisted_row_ids))) <> expected_item_count
    or exists (
      select 1
      from unnest(submitted_row_ids) as submitted(id)
      where not (submitted.id = any(persisted_row_ids))
    )
  then
    raise exception 'ORDER_ITEM_COUNT_MISMATCH'
      using errcode = 'P0001',
            detail = jsonb_build_object(
              'expected', expected_item_count,
              'persisted', persisted_item_count,
              'submittedRowIds', submitted_row_ids,
              'persistedRowIds', persisted_row_ids,
              'message', 'The order update was cancelled because not all rows were saved.'
            )::text;
  end if;

  if not was_existing then
    revision_number := app_private.capture_order_snapshot(
      saved_order_id,
      'order_created',
      coalesce(p_order ->> 'app_version', '0.1.13'),
      coalesce(p_order ->> 'client_type', 'supabase')
    );
  end if;

  return saved_result || jsonb_build_object(
    'persisted_rows', persisted_item_count,
    'persisted_row_ids', to_jsonb(persisted_row_ids),
    'revision_number', revision_number
  );
end;
$$;

revoke all on function public.save_glass_order_atomic(jsonb, jsonb)
  from public, anon;
grant execute on function public.save_glass_order_atomic(jsonb, jsonb)
  to authenticated;

notify pgrst, 'reload schema';
