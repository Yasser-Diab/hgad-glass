-- Keep workflow status authoritative. Normal order saves may update the order
-- header and rows, but they must never silently restore a stale status value.
alter table public.glass_orders
  add column if not exists status_revision bigint not null default 0;

update public.glass_orders
set status_revision = 0
where status_revision is null;

create or replace function public.update_order_status(
  p_order_id text,
  p_document_id text,
  p_status text,
  p_app_version text default '0.1.10',
  p_client_type text default 'supabase'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  revision_number integer;
  expected_status_revision bigint;
  current_status_revision bigint;
  saved_status_revision bigint;
  safe_client_type text;
begin
  if not (select app_private.current_user_is_active()) then
    raise exception 'Active authenticated user required.' using errcode = '42501';
  end if;
  if p_status is null or p_status not in (
    'ordered', 'fabrication', 'ready', 'partial', 'collected',
    'pricing', 'cancelled', 'draft'
  ) then
    raise exception 'Invalid order status.' using errcode = '22023';
  end if;
  if coalesce(p_client_type, '') !~ '^(web|android|ios|telegram_bot)\\|status_revision=[0-9]+$' then
    raise exception 'ORDER_STATUS_CLIENT_UPGRADE_REQUIRED'
      using errcode = 'P0001',
            detail = jsonb_build_object(
              'message', 'Install the current Y.D Glass Manager update before changing order status.'
            )::text;
  end if;

  expected_status_revision := split_part(split_part(p_client_type, '|', 2), '=', 2)::bigint;
  safe_client_type := split_part(p_client_type, '|', 1);

  select status_revision
  into current_status_revision
  from public.glass_orders
  where id = p_order_id
  for update;
  if not found then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;
  if current_status_revision <> expected_status_revision then
    raise exception 'ORDER_STATUS_CONFLICT'
      using errcode = 'P0001',
            detail = jsonb_build_object(
              'message', 'This order status was changed from another device. Refresh and review the current status.',
              'expectedStatusRevision', expected_status_revision,
              'actualStatusRevision', current_status_revision
            )::text;
  end if;

  revision_number := app_private.capture_order_snapshot(
    p_order_id, 'status_update', p_app_version, safe_client_type
  );
  update public.glass_orders
  set document_id = nullif(trim(coalesce(p_document_id, '')), ''),
      status = p_status,
      status_revision = status_revision + 1,
      updated_at = now()
  where id = p_order_id
  returning status_revision into saved_status_revision;

  return jsonb_build_object(
    'id', p_order_id,
    'status', p_status,
    'status_revision', saved_status_revision,
    'revision_number', revision_number,
    'updated_rows', 0
  );
end;
$$;

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
  current_status text;
  current_status_revision bigint;
  effective_order jsonb := p_order;
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

  select id, status, status_revision
  into existing_order_id, current_status, current_status_revision
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
      coalesce(p_order ->> 'app_version', '0.1.14'),
      coalesce(p_order ->> 'client_type', 'supabase')
    );
    effective_order := jsonb_set(p_order, '{status}', to_jsonb(current_status), true);
  end if;

  saved_result := app_private.save_glass_order_atomic_v010(effective_order, p_rows);
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
      coalesce(p_order ->> 'app_version', '0.1.14'),
      coalesce(p_order ->> 'client_type', 'supabase')
    );
  end if;

  select status, status_revision
  into current_status, current_status_revision
  from public.glass_orders
  where id = saved_order_id;

  return saved_result || jsonb_build_object(
    'status', current_status,
    'status_revision', current_status_revision,
    'persisted_rows', persisted_item_count,
    'persisted_row_ids', to_jsonb(persisted_row_ids),
    'revision_number', revision_number
  );
end;
$$;

revoke all on function public.update_order_status(text, text, text, text, text)
  from public, anon;
grant execute on function public.update_order_status(text, text, text, text, text)
  to authenticated;
revoke all on function public.save_glass_order_atomic(jsonb, jsonb)
  from public, anon;
grant execute on function public.save_glass_order_atomic(jsonb, jsonb)
  to authenticated;

-- Publish only a revision counter. Order and price data remain behind the
-- existing authenticated RPC loaders and are never exposed through Realtime.
create table if not exists public.glass_sync_state (
  id boolean primary key default true check (id),
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);

insert into public.glass_sync_state (id, revision, updated_at)
values (true, 0, now())
on conflict (id) do nothing;

alter table public.glass_sync_state enable row level security;
drop policy if exists glass_sync_state_active_users_read on public.glass_sync_state;
create policy glass_sync_state_active_users_read
  on public.glass_sync_state
  for select
  to authenticated
  using ((select app_private.current_user_is_active()));

revoke all on table public.glass_sync_state from public, anon;
grant select on table public.glass_sync_state to authenticated;

create or replace function app_private.bump_glass_sync_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.glass_sync_state
  set revision = revision + 1,
      updated_at = now()
  where id = true;
  return null;
end;
$$;

revoke all on function app_private.bump_glass_sync_state() from public, anon, authenticated;

drop trigger if exists glass_sync_state_after_orders on public.glass_orders;
create trigger glass_sync_state_after_orders
after insert or update or delete on public.glass_orders
for each statement execute function app_private.bump_glass_sync_state();

drop trigger if exists glass_sync_state_after_order_rows on public.glass_order_rows;
create trigger glass_sync_state_after_order_rows
after insert or update or delete on public.glass_order_rows
for each statement execute function app_private.bump_glass_sync_state();

drop trigger if exists glass_sync_state_after_customers on public.customers;
create trigger glass_sync_state_after_customers
after insert or update or delete on public.customers
for each statement execute function app_private.bump_glass_sync_state();

drop trigger if exists glass_sync_state_after_suppliers on public.suppliers;
create trigger glass_sync_state_after_suppliers
after insert or update or delete on public.suppliers
for each statement execute function app_private.bump_glass_sync_state();

drop trigger if exists glass_sync_state_after_supplier_payments on public.supplier_payments;
create trigger glass_sync_state_after_supplier_payments
after insert or update or delete on public.supplier_payments
for each statement execute function app_private.bump_glass_sync_state();

drop trigger if exists glass_sync_state_after_learned_options on public.learned_options;
create trigger glass_sync_state_after_learned_options
after insert or update or delete on public.learned_options
for each statement execute function app_private.bump_glass_sync_state();

drop trigger if exists glass_sync_state_after_app_settings on public.app_settings;
create trigger glass_sync_state_after_app_settings
after insert or update or delete on public.app_settings
for each statement execute function app_private.bump_glass_sync_state();

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'glass_sync_state'
  ) then
    execute 'alter publication supabase_realtime add table public.glass_sync_state';
  end if;
end;
$$;

notify pgrst, 'reload schema';
