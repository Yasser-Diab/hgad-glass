-- Keep hidden supplier-cost data intact when operational editors do not have
-- can_view_costs. This depends on the auth/RLS and receipt migrations.

create or replace function app_private.merge_protected_layer_costs(
  p_new_layers jsonb,
  p_old_layers jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  new_layers jsonb := coalesce(p_new_layers, '[]'::jsonb);
  old_layers jsonb := coalesce(p_old_layers, '[]'::jsonb);
  merged_layers jsonb;
begin
  if jsonb_typeof(new_layers) <> 'array' or jsonb_typeof(old_layers) <> 'array' then
    raise exception 'Glass layers must be JSON arrays.'
      using errcode = '22023';
  end if;
  if jsonb_array_length(new_layers) <> jsonb_array_length(old_layers) then
    raise exception 'Changing glass layer composition requires cost permission.'
      using errcode = '42501';
  end if;
  select coalesce(
    jsonb_agg(
      (new_layer_value - 'supplierUnitPrice' - 'supplier_unit_price')
        || jsonb_build_object(
          'supplierUnitPrice',
          coalesce(old_layer_value -> 'supplierUnitPrice', old_layer_value -> 'supplier_unit_price', '0'::jsonb),
          'supplier_unit_price',
          coalesce(old_layer_value -> 'supplier_unit_price', old_layer_value -> 'supplierUnitPrice', '0'::jsonb)
        )
      order by new_layer_index
    ),
    '[]'::jsonb
  )
  into merged_layers
  from jsonb_array_elements(new_layers) with ordinality
    as new_layer(new_layer_value, new_layer_index)
  join jsonb_array_elements(old_layers) with ordinality
    as old_layer(old_layer_value, old_layer_index)
    on old_layer_index = new_layer_index;
  return merged_layers;
end;
$$;

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
  new.totals := (coalesce(new.totals, '{}'::jsonb) - 'supplierCost' - 'supplier_cost')
    || jsonb_build_object(
      'supplierCost', old_supplier_cost,
      'supplier_cost', old_supplier_cost
    );
  return new;
end;
$$;

create or replace function app_private.protect_glass_order_row_costs()
returns trigger
language plpgsql
set search_path = ''
as $$
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
    raise exception 'Adding a new order row requires supplier-cost permission.'
      using errcode = '42501';
  end if;
  new.supplier_unit_price := old.supplier_unit_price;
  new.supplier_material_unit_price := old.supplier_material_unit_price;
  new.supplier_cost := old.supplier_cost;
  new.layers := app_private.merge_protected_layer_costs(new.layers, old.layers);
  return new;
end;
$$;

revoke all on function app_private.merge_protected_layer_costs(jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function app_private.protect_glass_order_costs()
  from public, anon, authenticated;
revoke all on function app_private.protect_glass_order_row_costs()
  from public, anon, authenticated;

drop trigger if exists protect_hidden_costs_on_glass_orders on public.glass_orders;
create trigger protect_hidden_costs_on_glass_orders
before insert or update on public.glass_orders
for each row execute function app_private.protect_glass_order_costs();

drop trigger if exists protect_hidden_costs_on_glass_order_rows on public.glass_order_rows;
create trigger protect_hidden_costs_on_glass_order_rows
before insert or update on public.glass_order_rows
for each row execute function app_private.protect_glass_order_row_costs();
