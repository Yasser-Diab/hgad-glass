-- Keep the complete-data safety checks while making ordinary startup fast enough
-- for the production data set. Cost-authorized users receive table rows directly;
-- other users receive a field-level redacted copy without converting every record
-- to JSON and back.

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
    order_record.totals :=
      (coalesce(order_record.totals, '{}'::jsonb) - 'supplierCost' - 'supplier_cost')
      || jsonb_build_object('supplierCost', 0, 'supplier_cost', 0);
    return next order_record;
  end loop;
end;
$$;

create or replace function public.load_glass_order_rows_page(
  p_offset integer default 0,
  p_limit integer default 1000
)
returns setof public.glass_order_rows
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  can_view_costs boolean;
  safe_offset integer := greatest(coalesce(p_offset, 0), 0);
  safe_limit integer := least(greatest(coalesce(p_limit, 1000), 1), 1000);
  row_record public.glass_order_rows%rowtype;
begin
  if not (select app_private.current_user_is_active()) then
    raise exception 'Authenticated active application user required'
      using errcode = '42501';
  end if;

  can_view_costs := (select app_private.current_user_can_view_costs());
  if can_view_costs then
    return query
    select row_source.*
    from public.glass_order_rows as row_source
    where row_source.deleted_at is null
    order by row_source.order_id, row_source.line_no, row_source.id
    offset safe_offset
    limit safe_limit;
    return;
  end if;

  for row_record in
    select row_source.*
    from public.glass_order_rows as row_source
    where row_source.deleted_at is null
    order by row_source.order_id, row_source.line_no, row_source.id
    offset safe_offset
    limit safe_limit
  loop
    row_record.supplier_unit_price := 0;
    row_record.supplier_material_unit_price := 0;
    row_record.supplier_cost := 0;
    select coalesce(
      jsonb_agg(
        (layer_value - 'supplierUnitPrice' - 'supplier_unit_price')
        || jsonb_build_object('supplierUnitPrice', 0, 'supplier_unit_price', 0)
        order by layer_position
      ),
      '[]'::jsonb
    )
    into row_record.layers
    from jsonb_array_elements(coalesce(row_record.layers, '[]'::jsonb))
      with ordinality as layer_items(layer_value, layer_position);
    return next row_record;
  end loop;
end;
$$;

revoke all on function public.load_glass_orders_page(integer, integer),
  public.load_glass_order_rows_page(integer, integer)
  from public, anon;
grant execute on function public.load_glass_orders_page(integer, integer),
  public.load_glass_order_rows_page(integer, integer)
  to authenticated;
