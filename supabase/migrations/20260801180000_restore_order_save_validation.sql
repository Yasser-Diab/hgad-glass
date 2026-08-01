-- Restore the order-save safety boundary. The complete payload is validated
-- before commit, incomplete rows are rejected, and stored rows can be removed
-- only when their IDs are explicitly listed by the row-delete action.

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
  layer_value jsonb;
  panel_value jsonb;
  row_id_value public.glass_order_rows.id%type;
  row_mode text;
  row_has_panels boolean := false;
  required_layer_count integer := 1;
  layer_index integer := 0;
  panel_index integer := 0;
  saved_row_ids text[] := '{}'::text[];
  deleted_row_ids text[] := '{}'::text[];
  existing_row_ids text[] := '{}'::text[];
  missing_row_ids text[] := '{}'::text[];
  saved_row_count integer := 0;
  pruned_row_count integer := 0;
begin
  if not (select app_private.current_user_is_active()) then
    raise exception 'Active authenticated user required.'
      using errcode = '42501';
  end if;
  if p_order is null or jsonb_typeof(p_order) <> 'object' then
    raise exception 'ORDER_VALIDATION_FAILED'
      using errcode = '22023',
            detail = '{"scope":"order","field":"order","message":"Order payload must be an object."}';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'ORDER_VALIDATION_FAILED'
      using errcode = '22023',
            detail = '{"scope":"row","field":"rows","message":"Order rows must be an array."}';
  end if;
  if jsonb_array_length(p_rows) = 0 then
    raise exception 'ORDER_VALIDATION_FAILED'
      using errcode = '22023',
            detail = '{"scope":"row","field":"rows","message":"At least one complete order row is required."}';
  end if;
  if jsonb_typeof(coalesce(p_order -> 'totals', '{}'::jsonb)) <> 'object' then
    raise exception 'ORDER_VALIDATION_FAILED'
      using errcode = '22023',
            detail = '{"scope":"order","field":"totals","message":"Order totals must be an object."}';
  end if;
  if p_order ? 'deleted_row_ids'
    and jsonb_typeof(p_order -> 'deleted_row_ids') is distinct from 'array'
  then
    raise exception 'ORDER_VALIDATION_FAILED'
      using errcode = '22023',
            detail = '{"scope":"row","field":"deletedRowIds","message":"Explicitly deleted row IDs must be an array."}';
  end if;

  begin
    order_id_value := nullif(trim(coalesce(p_order ->> 'id', '')), '');
    if order_id_value is null then
      order_id_value := gen_random_uuid()::text;
    end if;
  exception
    when invalid_text_representation then
      raise exception 'ORDER_VALIDATION_FAILED'
        using errcode = '22023',
              detail = '{"scope":"order","field":"id","message":"Order ID is invalid."}';
  end;

  order_no_value := nullif(trim(coalesce(p_order ->> 'order_no', '')), '');
  if order_no_value is null then
    raise exception 'ORDER_VALIDATION_FAILED'
      using errcode = '22023',
            detail = '{"scope":"order","field":"orderNo","message":"Order number is required."}';
  end if;
  if nullif(trim(coalesce(p_order ->> 'order_date', '')), '') is null then
    raise exception 'ORDER_VALIDATION_FAILED'
      using errcode = '22023',
            detail = '{"scope":"order","field":"date","message":"Order date is required."}';
  end if;

  begin
    customer_id_value := nullif(trim(coalesce(p_order ->> 'customer_id', '')), '');
    supplier_id_value := nullif(trim(coalesce(p_order ->> 'supplier_id', '')), '');
  exception
    when invalid_text_representation then
      raise exception 'ORDER_VALIDATION_FAILED'
        using errcode = '22023',
              detail = '{"scope":"order","field":"partyIds","message":"Customer and supplier identifiers are invalid."}';
  end;
  if customer_id_value is null then
    raise exception 'ORDER_VALIDATION_FAILED'
      using errcode = '22023',
            detail = '{"scope":"order","field":"customerId","message":"A selected customer is required."}';
  end if;
  if supplier_id_value is null then
    raise exception 'ORDER_VALIDATION_FAILED'
      using errcode = '22023',
            detail = '{"scope":"order","field":"supplierId","message":"A selected supplier is required."}';
  end if;
  if nullif(trim(coalesce(p_order ->> 'customer_name', '')), '') is null then
    raise exception 'ORDER_VALIDATION_FAILED'
      using errcode = '22023',
            detail = '{"scope":"order","field":"customerName","message":"Customer name is required."}';
  end if;
  if nullif(trim(coalesce(p_order ->> 'supplier_name', '')), '') is null then
    raise exception 'ORDER_VALIDATION_FAILED'
      using errcode = '22023',
            detail = '{"scope":"order","field":"supplierName","message":"Supplier name is required."}';
  end if;
  if not exists (
    select 1 from public.customers
    where id = customer_id_value
      and lower(trim(name)) = lower(trim(p_order ->> 'customer_name'))
  ) then
    raise exception 'ORDER_VALIDATION_FAILED'
      using errcode = '22023',
            detail = '{"scope":"order","field":"customerId","message":"Selected customer does not exist or does not match its name."}';
  end if;
  if not exists (
    select 1 from public.suppliers
    where id = supplier_id_value
      and lower(trim(name)) = lower(trim(p_order ->> 'supplier_name'))
  ) then
    raise exception 'ORDER_VALIDATION_FAILED'
      using errcode = '22023',
            detail = '{"scope":"order","field":"supplierId","message":"Selected supplier does not exist or does not match its name."}';
  end if;
  if p_order ? 'collected_pieces'
    and jsonb_typeof(p_order -> 'collected_pieces') is distinct from 'number'
  then
    raise exception 'ORDER_VALIDATION_FAILED'
      using errcode = '22023',
            detail = '{"scope":"order","field":"collectedPieces","message":"Collected quantity must be numeric."}';
  end if;

  select coalesce(array_agg(value), '{}'::text[])
  into deleted_row_ids
  from (
    select trim(item #>> '{}') as value
    from jsonb_array_elements(coalesce(p_order -> 'deleted_row_ids', '[]'::jsonb)) as deleted(item)
  ) as normalized
  where value <> '';
  if cardinality(deleted_row_ids) <> cardinality(array(select distinct unnest(deleted_row_ids))) then
    raise exception 'ORDER_VALIDATION_FAILED'
      using errcode = '22023',
            detail = '{"scope":"row","field":"deletedRowIds","message":"Deleted row IDs contain duplicates."}';
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
      id, order_no, document_id, order_date, entry_at, status,
      collected_pieces, entry_mode, customer_id, supplier_id,
      customer_name, supplier_name, project, code, notes, totals
    ) values (
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

  perform 1
  from public.glass_order_rows
  where order_id = order_id_value
  for update;
  select coalesce(array_agg(id::text), '{}'::text[])
  into existing_row_ids
  from public.glass_order_rows
  where order_id = order_id_value;

  for row_value in
    select incoming.value
    from jsonb_array_elements(p_rows) as incoming(value)
  loop
    if jsonb_typeof(row_value) <> 'object' then
      raise exception 'ORDER_VALIDATION_FAILED'
        using errcode = '22023',
              detail = '{"scope":"row","field":"row","message":"Each order row must be an object."}';
    end if;
    begin
      row_id_value := nullif(trim(coalesce(row_value ->> 'id', '')), '');
    exception
      when invalid_text_representation then
        raise exception 'ORDER_VALIDATION_FAILED'
          using errcode = '22023',
                detail = jsonb_build_object('scope', 'row', 'field', 'id', 'message', 'Order row ID is invalid.')::text;
    end;
    if row_id_value is null then
      raise exception 'ORDER_VALIDATION_FAILED'
        using errcode = '22023',
              detail = '{"scope":"row","field":"id","message":"Each order row requires an ID."}';
    end if;
    if row_id_value::text = any(saved_row_ids) then
      raise exception 'ORDER_VALIDATION_FAILED'
        using errcode = '22023',
              detail = jsonb_build_object('scope', 'row', 'rowId', row_id_value::text, 'field', 'id', 'message', 'Order row IDs must be unique.')::text;
    end if;
    if row_id_value::text = any(deleted_row_ids) then
      raise exception 'ORDER_VALIDATION_FAILED'
        using errcode = '22023',
              detail = jsonb_build_object('scope', 'row', 'rowId', row_id_value::text, 'field', 'id', 'message', 'A row cannot be saved and explicitly deleted in the same operation.')::text;
    end if;
    if nullif(trim(coalesce(row_value ->> 'order_id', '')), '') is not null
      and trim(row_value ->> 'order_id') <> order_id_value::text
    then
      raise exception 'ORDER_VALIDATION_FAILED'
        using errcode = '22023',
              detail = jsonb_build_object('scope', 'row', 'rowId', row_id_value::text, 'field', 'orderId', 'message', 'Order row belongs to another order.')::text;
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
      raise exception 'ORDER_VALIDATION_FAILED'
        using errcode = '22023',
              detail = jsonb_build_object('scope', 'row', 'rowId', row_id_value::text, 'field', 'quantity', 'message', 'Row quantities and prices must be numeric.')::text;
    end if;
    if (row_value ->> 'line_no')::integer <= 0 or (row_value ->> 'quantity')::numeric <= 0 then
      raise exception 'ORDER_VALIDATION_FAILED'
        using errcode = '22023',
              detail = jsonb_build_object('scope', 'row', 'rowId', row_id_value::text, 'field', 'quantity', 'message', 'Row number and quantity must be greater than zero.')::text;
    end if;
    if (row_value ->> 'area_m2')::numeric < 0
      or (row_value ->> 'cost')::numeric < 0
      or (row_value ->> 'supplier_cost')::numeric < 0
    then
      raise exception 'ORDER_VALIDATION_FAILED'
        using errcode = '22023',
              detail = jsonb_build_object('scope', 'row', 'rowId', row_id_value::text, 'field', 'totals', 'message', 'Row totals cannot be negative.')::text;
    end if;
    if row_value ? 'received_quantity'
      and jsonb_typeof(row_value -> 'received_quantity') not in ('number', 'null')
    then
      raise exception 'ORDER_VALIDATION_FAILED'
        using errcode = '22023',
              detail = jsonb_build_object('scope', 'row', 'rowId', row_id_value::text, 'field', 'receivedQuantity', 'message', 'Received quantity must be numeric or null.')::text;
    end if;
    if jsonb_typeof(row_value -> 'receipt_history') is distinct from 'array'
      or jsonb_typeof(row_value -> 'layers') is distinct from 'array'
      or jsonb_typeof(row_value -> 'drawing') is distinct from 'object'
    then
      raise exception 'ORDER_VALIDATION_FAILED'
        using errcode = '22023',
              detail = jsonb_build_object('scope', 'row', 'rowId', row_id_value::text, 'field', 'row', 'message', 'Row history, layers, or drawing has an invalid shape.')::text;
    end if;

    row_mode := lower(trim(coalesce(row_value ->> 'glass_mode', 'single')));
    if row_mode not in ('single', 'double', 'triplex') then
      raise exception 'ORDER_VALIDATION_FAILED'
        using errcode = '22023',
              detail = jsonb_build_object('scope', 'row', 'rowId', row_id_value::text, 'field', 'mode', 'message', 'Glass mode is invalid.')::text;
    end if;
    required_layer_count := case when row_mode = 'single' then 1 else 2 end;
    if jsonb_array_length(row_value -> 'layers') < required_layer_count then
      raise exception 'ORDER_VALIDATION_FAILED'
        using errcode = '22023',
              detail = jsonb_build_object('scope', 'row', 'rowId', row_id_value::text, 'field', 'layers', 'message', 'Glass composition is incomplete.')::text;
    end if;
    row_has_panels := row_mode = 'single'
      and jsonb_typeof(row_value #> '{drawing,panels}') = 'array'
      and jsonb_array_length(row_value #> '{drawing,panels}') > 0;

    for layer_index in 0..required_layer_count - 1 loop
      layer_value := row_value -> 'layers' -> layer_index;
      if jsonb_typeof(layer_value) <> 'object'
        or nullif(trim(coalesce(layer_value ->> 'glassType', '')), '') is null
      then
        raise exception 'ORDER_VALIDATION_FAILED'
          using errcode = '22023',
                detail = jsonb_build_object('scope', 'row', 'rowId', row_id_value::text, 'field', format('layer%s-glassType', layer_index), 'message', 'Glass type is required for every layer.')::text;
      end if;
      if nullif(trim(coalesce(layer_value ->> 'thickness', '')), '') is null then
        raise exception 'ORDER_VALIDATION_FAILED'
          using errcode = '22023',
                detail = jsonb_build_object('scope', 'row', 'rowId', row_id_value::text, 'field', format('layer%s-thickness', layer_index), 'message', 'Thickness is required for every layer.')::text;
      end if;
      if not row_has_panels then
        if replace(trim(coalesce(layer_value ->> 'width', '')), ',', '.') !~ '^[+]?[0-9]+([.][0-9]+)?$'
          or replace(trim(layer_value ->> 'width'), ',', '.')::numeric <= 0
        then
          raise exception 'ORDER_VALIDATION_FAILED'
            using errcode = '22023',
                  detail = jsonb_build_object('scope', 'row', 'rowId', row_id_value::text, 'field', format('layer%s-width', layer_index), 'message', 'Width must be greater than zero.')::text;
        end if;
        if replace(trim(coalesce(layer_value ->> 'height', '')), ',', '.') !~ '^[+]?[0-9]+([.][0-9]+)?$'
          or replace(trim(layer_value ->> 'height'), ',', '.')::numeric <= 0
        then
          raise exception 'ORDER_VALIDATION_FAILED'
            using errcode = '22023',
                  detail = jsonb_build_object('scope', 'row', 'rowId', row_id_value::text, 'field', format('layer%s-height', layer_index), 'message', 'Height must be greater than zero.')::text;
        end if;
      end if;
    end loop;

    if row_mode = 'double' and nullif(trim(coalesce(row_value ->> 'double_gap', '')), '') is null then
      raise exception 'ORDER_VALIDATION_FAILED'
        using errcode = '22023',
              detail = jsonb_build_object('scope', 'row', 'rowId', row_id_value::text, 'field', 'doubleGap', 'message', 'Double-glass spacer is required.')::text;
    end if;
    if row_mode = 'triplex' and nullif(trim(coalesce(row_value ->> 'triplex_pvb', '')), '') is null then
      raise exception 'ORDER_VALIDATION_FAILED'
        using errcode = '22023',
              detail = jsonb_build_object('scope', 'row', 'rowId', row_id_value::text, 'field', 'triplexPvb', 'message', 'Triplex PVB is required.')::text;
    end if;
    if row_has_panels then
      panel_index := 0;
      for panel_value in
        select panel.value from jsonb_array_elements(row_value #> '{drawing,panels}') as panel(value)
      loop
        if replace(trim(coalesce(panel_value ->> 'width', '')), ',', '.') !~ '^[+]?[0-9]+([.][0-9]+)?$'
          or replace(trim(panel_value ->> 'width'), ',', '.')::numeric <= 0
          or replace(trim(coalesce(panel_value ->> 'height', '')), ',', '.') !~ '^[+]?[0-9]+([.][0-9]+)?$'
          or replace(trim(panel_value ->> 'height'), ',', '.')::numeric <= 0
        then
          raise exception 'ORDER_VALIDATION_FAILED'
            using errcode = '22023',
                  detail = jsonb_build_object('scope', 'row', 'rowId', row_id_value::text, 'field', 'drawing', 'panelIndex', panel_index, 'message', 'Panel dimensions must be greater than zero.')::text;
        end if;
        panel_index := panel_index + 1;
      end loop;
    end if;

    existing_row_order_id := null;
    select order_id into existing_row_order_id
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
          glass_mode = row_mode,
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
      where id = row_id_value and order_id = order_id_value;
    else
      insert into public.glass_order_rows (
        id, order_id, line_no, glass_mode, code, description, quantity,
        unit_price, supplier_unit_price, material_unit_price,
        supplier_material_unit_price, double_gap, triplex_pvb,
        extra_direction, notes, received_quantity, receipt_history,
        layers, drawing, area_m2, cost, supplier_cost
      ) values (
        row_id_value,
        order_id_value,
        (row_value ->> 'line_no')::integer,
        row_mode,
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

  select coalesce(array_agg(existing_id), '{}'::text[])
  into missing_row_ids
  from unnest(existing_row_ids) as existing(existing_id)
  where not (existing_id = any(saved_row_ids))
    and not (existing_id = any(deleted_row_ids));
  if cardinality(missing_row_ids) > 0 then
    raise exception 'ORDER_VALIDATION_FAILED'
      using errcode = '22023',
            detail = jsonb_build_object('scope', 'row', 'field', 'deletedRowIds', 'rowIds', missing_row_ids, 'message', 'Stored rows may be removed only by the explicit Delete Row action.')::text;
  end if;
  if exists (
    select 1 from unnest(deleted_row_ids) as deleted(id)
    where not (deleted.id = any(existing_row_ids))
  ) then
    raise exception 'ORDER_VALIDATION_FAILED'
      using errcode = '22023',
            detail = '{"scope":"row","field":"deletedRowIds","message":"A deleted row ID does not belong to this order."}';
  end if;

  delete from public.glass_order_rows
  where order_id = order_id_value
    and id::text = any(deleted_row_ids);
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
