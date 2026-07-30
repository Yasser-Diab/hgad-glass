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
  order_id_value uuid;
  order_no_value text;
  existing_row_order_id uuid;
  row_value jsonb;
  row_id_value uuid;
  saved_row_ids uuid[] := '{}'::uuid[];
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
    order_id_value := coalesce(
      nullif(trim(coalesce(p_order ->> 'id', '')), '')::uuid,
      gen_random_uuid()
    );
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
        customer_id = nullif(trim(coalesce(p_order ->> 'customer_id', '')), '')::uuid,
        supplier_id = nullif(trim(coalesce(p_order ->> 'supplier_id', '')), '')::uuid,
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
      nullif(trim(coalesce(p_order ->> 'customer_id', '')), '')::uuid,
      nullif(trim(coalesce(p_order ->> 'supplier_id', '')), '')::uuid,
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
      row_id_value := nullif(trim(coalesce(row_value ->> 'id', '')), '')::uuid;
    exception
      when invalid_text_representation then
        raise exception 'Each order row ID must be a valid UUID.'
          using errcode = '22023';
    end;
    if row_id_value is null then
      raise exception 'Each order row requires an ID.'
        using errcode = '22023';
    end if;
    if row_id_value = any(saved_row_ids) then
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

    saved_row_ids := array_append(saved_row_ids, row_id_value);
    saved_row_count := saved_row_count + 1;
  end loop;

  delete from public.glass_order_rows
  where order_id = order_id_value
    and not (id = any(saved_row_ids));
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
