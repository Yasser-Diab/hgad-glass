-- Emergency order-integrity hotfix for the 0.1.10 release.
--
-- Root cause protected here:
--   * PostgREST caps set-returning RPC responses. Loading unpaged order rows,
--     previously ordered only by line_no, made many multi-row orders appear as
--     a single first line.
--   * Older full-order saves physically removed rows omitted from a payload.
--
-- This migration is additive, snapshots every current order before changing
-- persistence entry points, and fails if the active row count decreases.

alter table public.glass_order_rows
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id) on delete set null;

create index if not exists idx_glass_order_rows_active_order
  on public.glass_order_rows(order_id, line_no, id)
  where deleted_at is null;
create index if not exists idx_glass_orders_load_order
  on public.glass_orders(order_date desc, order_no desc, id);

create table if not exists public.order_revisions (
  id uuid primary key default gen_random_uuid(),
  order_id text not null,
  revision_number integer not null,
  snapshot jsonb not null,
  changed_by uuid references auth.users(id) on delete set null,
  change_type text not null,
  app_version text not null default '0.1.10',
  client_type text not null default 'supabase',
  created_at timestamptz not null default now(),
  unique(order_id, revision_number)
);

create table if not exists public.order_row_audit (
  id uuid primary key default gen_random_uuid(),
  order_id text not null,
  row_id text not null,
  action text not null,
  previous_value jsonb,
  new_value jsonb,
  changed_by uuid references auth.users(id) on delete set null,
  app_version text not null default '0.1.10',
  client_type text not null default 'supabase',
  created_at timestamptz not null default now()
);

create table if not exists public.order_item_recovery_staging (
  recovery_id uuid primary key default gen_random_uuid(),
  order_id text,
  order_number text,
  source_type text not null,
  source_reference text,
  line_number integer,
  recovered_payload jsonb not null,
  reviewed boolean not null default false,
  applied boolean not null default false,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.order_integrity_migration_runs (
  id uuid primary key default gen_random_uuid(),
  migration_name text not null unique,
  before_order_count bigint not null,
  before_row_count bigint not null,
  before_rows_by_order jsonb not null,
  after_order_count bigint,
  after_row_count bigint,
  after_rows_by_order jsonb,
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  verified_at timestamptz
);

create index if not exists idx_order_revisions_order
  on public.order_revisions(order_id, revision_number desc);
create index if not exists idx_order_row_audit_order
  on public.order_row_audit(order_id, created_at desc);
create index if not exists idx_order_row_audit_row
  on public.order_row_audit(row_id, created_at desc);
create index if not exists idx_order_recovery_staging_order
  on public.order_item_recovery_staging(order_id, line_number);

alter table public.order_revisions enable row level security;
alter table public.order_row_audit enable row level security;
alter table public.order_item_recovery_staging enable row level security;
alter table public.order_integrity_migration_runs enable row level security;

drop policy if exists order_revisions_admin_read on public.order_revisions;
create policy order_revisions_admin_read
  on public.order_revisions for select to authenticated
  using ((select app_private.current_user_is_admin()));

drop policy if exists order_row_audit_admin_read on public.order_row_audit;
create policy order_row_audit_admin_read
  on public.order_row_audit for select to authenticated
  using ((select app_private.current_user_is_admin()));

drop policy if exists recovery_staging_admin_all on public.order_item_recovery_staging;
create policy recovery_staging_admin_all
  on public.order_item_recovery_staging for all to authenticated
  using ((select app_private.current_user_is_admin()))
  with check ((select app_private.current_user_is_admin()));

drop policy if exists integrity_runs_admin_read on public.order_integrity_migration_runs;
create policy integrity_runs_admin_read
  on public.order_integrity_migration_runs for select to authenticated
  using ((select app_private.current_user_is_admin()));

revoke all on public.order_revisions, public.order_row_audit,
  public.order_item_recovery_staging, public.order_integrity_migration_runs
  from public, anon, authenticated;
grant select on public.order_revisions, public.order_row_audit,
  public.order_integrity_migration_runs to authenticated;
grant select, insert, update on public.order_item_recovery_staging to authenticated;

insert into public.order_integrity_migration_runs (
  migration_name,
  before_order_count,
  before_row_count,
  before_rows_by_order
)
select
  '20260801194244_emergency_order_integrity_hotfix',
  (select count(*) from public.glass_orders),
  (select count(*) from public.glass_order_rows where deleted_at is null),
  coalesce((
    select jsonb_object_agg(counts.order_id::text, counts.item_count)
    from (
      select order_id, count(*) as item_count
      from public.glass_order_rows
      where deleted_at is null
      group by order_id
    ) as counts
  ), '{}'::jsonb)
on conflict (migration_name) do nothing;

create or replace function app_private.capture_order_snapshot(
  p_order_id public.glass_orders.id%type,
  p_change_type text,
  p_app_version text default '0.1.10',
  p_client_type text default 'supabase'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_revision integer;
  order_snapshot jsonb;
begin
  select jsonb_build_object(
    'order', to_jsonb(order_record),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(row_record) order by row_record.line_no, row_record.id)
      from public.glass_order_rows as row_record
      where row_record.order_id = p_order_id
        and row_record.deleted_at is null
    ), '[]'::jsonb)
  )
  into order_snapshot
  from public.glass_orders as order_record
  where order_record.id = p_order_id;

  if order_snapshot is null then
    return null;
  end if;

  select coalesce(max(revision_number), 0) + 1
  into next_revision
  from public.order_revisions
  where order_id = p_order_id::text;

  insert into public.order_revisions (
    order_id, revision_number, snapshot, changed_by, change_type,
    app_version, client_type
  ) values (
    p_order_id::text,
    next_revision,
    order_snapshot,
    (select auth.uid()),
    coalesce(nullif(trim(p_change_type), ''), 'order_update'),
    coalesce(nullif(trim(p_app_version), ''), '0.1.10'),
    coalesce(nullif(trim(p_client_type), ''), 'supabase')
  );

  return next_revision;
end;
$$;

revoke all on function app_private.capture_order_snapshot(
  public.glass_orders.id%type, text, text, text
) from public, anon, authenticated;

-- Preserve a complete server-side baseline before replacing any persistence
-- entry point. Revision zero is immutable incident evidence.
insert into public.order_revisions (
  order_id, revision_number, snapshot, changed_by, change_type,
  app_version, client_type
)
select
  order_record.id::text,
  0,
  jsonb_build_object(
    'order', to_jsonb(order_record),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(row_record) order by row_record.line_no, row_record.id)
      from public.glass_order_rows as row_record
      where row_record.order_id = order_record.id
        and row_record.deleted_at is null
    ), '[]'::jsonb)
  ),
  null,
  'integrity_baseline',
  '0.1.10',
  'migration'
from public.glass_orders as order_record
on conflict (order_id, revision_number) do nothing;

create or replace function app_private.audit_glass_order_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  audit_action text;
  audit_order_id text;
  audit_row_id text;
begin
  if tg_op = 'UPDATE' and to_jsonb(old) = to_jsonb(new) then
    return new;
  end if;

  if tg_op = 'DELETE' then
    audit_order_id := old.order_id::text;
    audit_row_id := old.id::text;
  else
    audit_order_id := new.order_id::text;
    audit_row_id := new.id::text;
  end if;
  audit_action := case
    when tg_op = 'INSERT' then 'row_created'
    when tg_op = 'DELETE' then 'row_explicitly_deleted'
    when old.deleted_at is null and new.deleted_at is not null then 'row_explicitly_deleted'
    when old.deleted_at is not null and new.deleted_at is null then 'row_restored'
    else 'row_edited'
  end;

  insert into public.order_row_audit (
    order_id, row_id, action, previous_value, new_value, changed_by,
    app_version, client_type
  ) values (
    audit_order_id,
    audit_row_id,
    audit_action,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end,
    (select auth.uid()),
    '0.1.10',
    'supabase'
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function app_private.audit_glass_order_row_change()
  from public, anon, authenticated;
drop trigger if exists audit_glass_order_row_change on public.glass_order_rows;
create trigger audit_glass_order_row_change
after insert or update or delete on public.glass_order_rows
for each row execute function app_private.audit_glass_order_row_change();

-- Deterministic, explicitly paged loaders. The client verifies these results
-- against load_glass_data_counts before replacing any local data.
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
begin
  if not (select app_private.current_user_is_active()) then
    raise exception 'Authenticated active application user required'
      using errcode = '42501';
  end if;
  can_view_costs := (select app_private.current_user_can_view_costs());
  return query
  select (
    jsonb_populate_record(
      null::public.glass_orders,
      case
        when can_view_costs then to_jsonb(order_record)
        else to_jsonb(order_record) || jsonb_build_object(
          'totals',
          (coalesce(order_record.totals, '{}'::jsonb) - 'supplierCost' - 'supplier_cost')
            || jsonb_build_object('supplierCost', 0, 'supplier_cost', 0)
        )
      end
    )
  ).*
  from public.glass_orders as order_record
  order by order_record.order_date desc, order_record.order_no desc, order_record.id
  offset safe_offset
  limit safe_limit;
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
begin
  if not (select app_private.current_user_is_active()) then
    raise exception 'Authenticated active application user required'
      using errcode = '42501';
  end if;
  can_view_costs := (select app_private.current_user_can_view_costs());
  return query
  select (
    jsonb_populate_record(
      null::public.glass_order_rows,
      case
        when can_view_costs then to_jsonb(row_record)
        else to_jsonb(row_record) || jsonb_build_object(
          'supplier_unit_price', 0,
          'supplier_material_unit_price', 0,
          'supplier_cost', 0,
          'layers', coalesce((
            select jsonb_agg(
              (layer_value - 'supplierUnitPrice' - 'supplier_unit_price')
                || jsonb_build_object('supplierUnitPrice', 0, 'supplier_unit_price', 0)
            )
            from jsonb_array_elements(coalesce(row_record.layers, '[]'::jsonb))
              as layer_items(layer_value)
          ), '[]'::jsonb)
        )
      end
    )
  ).*
  from public.glass_order_rows as row_record
  where row_record.deleted_at is null
  order by row_record.order_id, row_record.line_no, row_record.id
  offset safe_offset
  limit safe_limit;
end;
$$;

create or replace function public.load_glass_data_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select app_private.current_user_is_active()) then
    raise exception 'Authenticated active application user required'
      using errcode = '42501';
  end if;
  return jsonb_build_object(
    'order_count', (select count(*) from public.glass_orders),
    'row_count', (select count(*) from public.glass_order_rows where deleted_at is null),
    'orders_without_rows', (
      select count(*)
      from public.glass_orders as order_record
      where not exists (
        select 1
        from public.glass_order_rows as row_record
        where row_record.order_id = order_record.id
          and row_record.deleted_at is null
      )
    )
  );
end;
$$;

-- Keep the legacy loaders deterministic for older clients that paginate the
-- RPC result with PostgREST range headers. New clients use explicit pages.
create or replace function public.load_glass_orders()
returns setof public.glass_orders
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  can_view_costs boolean;
begin
  if not (select app_private.current_user_is_active()) then
    raise exception 'Authenticated active application user required'
      using errcode = '42501';
  end if;
  can_view_costs := (select app_private.current_user_can_view_costs());
  return query
  select (
    jsonb_populate_record(
      null::public.glass_orders,
      case
        when can_view_costs then to_jsonb(order_record)
        else to_jsonb(order_record) || jsonb_build_object(
          'totals',
          (coalesce(order_record.totals, '{}'::jsonb) - 'supplierCost' - 'supplier_cost')
            || jsonb_build_object('supplierCost', 0, 'supplier_cost', 0)
        )
      end
    )
  ).*
  from public.glass_orders as order_record
  order by order_record.order_date desc, order_record.order_no desc, order_record.id;
end;
$$;

create or replace function public.load_glass_order_rows()
returns setof public.glass_order_rows
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  can_view_costs boolean;
begin
  if not (select app_private.current_user_is_active()) then
    raise exception 'Authenticated active application user required'
      using errcode = '42501';
  end if;
  can_view_costs := (select app_private.current_user_can_view_costs());
  return query
  select (
    jsonb_populate_record(
      null::public.glass_order_rows,
      case
        when can_view_costs then to_jsonb(row_record)
        else to_jsonb(row_record) || jsonb_build_object(
          'supplier_unit_price', 0,
          'supplier_material_unit_price', 0,
          'supplier_cost', 0,
          'layers', coalesce((
            select jsonb_agg(
              (layer_value - 'supplierUnitPrice' - 'supplier_unit_price')
                || jsonb_build_object('supplierUnitPrice', 0, 'supplier_unit_price', 0)
            )
            from jsonb_array_elements(coalesce(row_record.layers, '[]'::jsonb))
              as layer_items(layer_value)
          ), '[]'::jsonb)
        )
      end
    )
  ).*
  from public.glass_order_rows as row_record
  where row_record.deleted_at is null
  order by row_record.order_id, row_record.line_no, row_record.id;
end;
$$;

revoke all on function public.load_glass_orders_page(integer, integer),
  public.load_glass_order_rows_page(integer, integer),
  public.load_glass_data_counts()
  from public, anon;
grant execute on function public.load_glass_orders_page(integer, integer),
  public.load_glass_order_rows_page(integer, integer),
  public.load_glass_data_counts()
  to authenticated;

-- Preserve the already validated 0.1.10 implementation as a private inner
-- transaction, then wrap it with before/after count and ID verification.
do $$
begin
  if to_regprocedure('app_private.save_glass_order_atomic_v010(jsonb,jsonb)') is null then
    if to_regprocedure('public.save_glass_order_atomic(jsonb,jsonb)') is null then
      raise exception 'Required save_glass_order_atomic(jsonb,jsonb) function is missing.';
    end if;
    execute 'alter function public.save_glass_order_atomic(jsonb, jsonb) rename to save_glass_order_atomic_v010';
    execute 'alter function public.save_glass_order_atomic_v010(jsonb, jsonb) set schema app_private';
  end if;
end
$$;

revoke all on function app_private.save_glass_order_atomic_v010(jsonb, jsonb)
  from public, anon, authenticated;

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
      coalesce(p_order ->> 'app_version', '0.1.10'),
      coalesce(p_order ->> 'client_type', 'supabase')
    );
  end if;

  saved_result := app_private.save_glass_order_atomic_v010(p_order, p_rows);
  saved_order_id := saved_result ->> 'id';

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
      coalesce(p_order ->> 'app_version', '0.1.10'),
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

create or replace function public.restore_order_revision(
  p_revision_id uuid,
  p_app_version text default '0.1.10',
  p_client_type text default 'supabase'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  revision_record public.order_revisions%rowtype;
  snapshot_order jsonb;
  snapshot_rows jsonb;
  explicitly_deleted_ids jsonb;
begin
  if not (select app_private.current_user_is_admin()) then
    raise exception 'Administrator permission required.' using errcode = '42501';
  end if;
  select * into revision_record
  from public.order_revisions
  where id = p_revision_id;
  if not found then
    raise exception 'Order revision not found.' using errcode = 'P0002';
  end if;

  snapshot_order := revision_record.snapshot -> 'order';
  snapshot_rows := coalesce(revision_record.snapshot -> 'rows', '[]'::jsonb);
  if jsonb_typeof(snapshot_order) <> 'object' or jsonb_typeof(snapshot_rows) <> 'array' then
    raise exception 'Stored order revision is invalid.' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(to_jsonb(current_row.id::text)), '[]'::jsonb)
  into explicitly_deleted_ids
  from public.glass_order_rows as current_row
  where current_row.order_id::text = revision_record.order_id
    and current_row.deleted_at is null
    and not exists (
      select 1
      from jsonb_array_elements(snapshot_rows) as snapshot_row(item)
      where snapshot_row.item ->> 'id' = current_row.id::text
    );

  snapshot_order := snapshot_order || jsonb_build_object(
    'deleted_row_ids', explicitly_deleted_ids,
    'expected_item_count', jsonb_array_length(snapshot_rows),
    'app_version', coalesce(nullif(trim(p_app_version), ''), '0.1.10'),
    'client_type', coalesce(nullif(trim(p_client_type), ''), 'supabase_restore')
  );
  return public.save_glass_order_atomic(snapshot_order, snapshot_rows);
end;
$$;

revoke all on function public.restore_order_revision(uuid, text, text)
  from public, anon;
grant execute on function public.restore_order_revision(uuid, text, text)
  to authenticated;

create or replace function public.update_order_status(
  p_order_id public.glass_orders.id%type,
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
  perform 1 from public.glass_orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;

  revision_number := app_private.capture_order_snapshot(
    p_order_id, 'status_update', p_app_version, p_client_type
  );
  update public.glass_orders
  set document_id = nullif(trim(coalesce(p_document_id, '')), ''),
      status = p_status,
      updated_at = now()
  where id = p_order_id;

  return jsonb_build_object(
    'id', p_order_id,
    'status', p_status,
    'revision_number', revision_number,
    'updated_rows', 0
  );
end;
$$;

create or replace function public.apply_order_receipts(
  p_order_id public.glass_orders.id%type,
  p_collected_pieces numeric,
  p_rows jsonb default '[]'::jsonb,
  p_app_version text default '0.1.10',
  p_client_type text default 'supabase'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  incoming_count integer := 0;
  distinct_count integer := 0;
  owned_count integer := 0;
  updated_count integer := 0;
  total_ordered numeric := 0;
  total_received numeric := 0;
  receipt_progress text := 'not_received';
  revision_number integer;
begin
  if not (select app_private.current_user_is_active()) then
    raise exception 'Active authenticated user required.' using errcode = '42501';
  end if;
  perform 1 from public.glass_orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;
  perform 1
  from public.glass_order_rows
  where order_id = p_order_id and deleted_at is null
  for update;

  if p_collected_pieces is null or p_collected_pieces < 0 then
    raise exception 'Collected quantity must be non-negative.' using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Receipt rows must be a JSON array.' using errcode = '22023';
  end if;

  select count(*), count(distinct item ->> 'id')
  into incoming_count, distinct_count
  from jsonb_array_elements(p_rows) as incoming(item);
  if incoming_count <> distinct_count then
    raise exception 'Receipt rows contain a missing or duplicate row ID.' using errcode = '22023';
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
  where row_record.order_id = p_order_id
    and row_record.deleted_at is null;
  if owned_count <> incoming_count then
    raise exception 'A receipt row does not belong to this order.' using errcode = '42501';
  end if;
  if exists (
    select 1
    from public.glass_order_rows as row_record
    join jsonb_array_elements(p_rows) as incoming(item)
      on row_record.id::text = incoming.item ->> 'id'
    where row_record.order_id = p_order_id
      and row_record.deleted_at is null
      and (incoming.item ->> 'received_quantity')::numeric
        > greatest(coalesce(row_record.quantity, 0), 0)
  ) then
    raise exception 'A received quantity exceeds its ordered row quantity.' using errcode = '22023';
  end if;

  revision_number := app_private.capture_order_snapshot(
    p_order_id, 'receipt_update', p_app_version, p_client_type
  );
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
      and target.order_id = p_order_id
      and target.deleted_at is null;
    get diagnostics updated_count = row_count;
    if updated_count <> incoming_count then
      raise exception 'ORDER_ITEM_COUNT_MISMATCH'
        using errcode = 'P0001',
              detail = jsonb_build_object(
                'expected', incoming_count,
                'persisted', updated_count,
                'message', 'Not every receipt row was updated.'
              )::text;
    end if;
  end if;

  select
    coalesce(sum(greatest(coalesce(quantity, 0), 0)), 0),
    coalesce(sum(greatest(coalesce(received_quantity, 0), 0)), 0)
  into total_ordered, total_received
  from public.glass_order_rows
  where order_id = p_order_id and deleted_at is null;
  if total_received > total_ordered + 0.000000001 then
    raise exception 'Total received quantity exceeds the order quantity.' using errcode = '22023';
  end if;
  if abs(total_received - p_collected_pieces) > 0.000000001 then
    raise exception 'Collected total does not match the receipt rows.' using errcode = '22023';
  end if;

  receipt_progress := case
    when total_received <= 0.000000001 then 'not_received'
    when total_ordered > 0.000000001 and total_received >= total_ordered - 0.000000001
      then 'fully_received'
    else 'partial'
  end;
  update public.glass_orders
  set collected_pieces = total_received,
      updated_at = now()
  where id = p_order_id;

  return jsonb_build_object(
    'id', p_order_id,
    'collected_pieces', total_received,
    'receipt_status', receipt_progress,
    'updated_rows', updated_count,
    'revision_number', revision_number
  );
end;
$$;

revoke all on function public.update_order_status(
  public.glass_orders.id%type, text, text, text, text
), public.apply_order_receipts(
  public.glass_orders.id%type, numeric, jsonb, text, text
) from public, anon;
grant execute on function public.update_order_status(
  public.glass_orders.id%type, text, text, text, text
), public.apply_order_receipts(
  public.glass_orders.id%type, numeric, jsonb, text, text
) to authenticated;

-- Compatibility entry point for older installed clients. It no longer rejects
-- manual workflow status based on receipt quantities. New clients call the two
-- independent functions above.
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
  receipt_result jsonb := '{}'::jsonb;
  status_result jsonb;
begin
  if p_rows is not null and jsonb_typeof(p_rows) = 'array' and jsonb_array_length(p_rows) > 0 then
    receipt_result := public.apply_order_receipts(
      p_order_id, p_collected_pieces, p_rows, '0.1.10', 'legacy_client'
    );
  end if;
  status_result := public.update_order_status(
    p_order_id, p_document_id, p_status, '0.1.10', 'legacy_client'
  );
  return receipt_result || status_result;
end;
$$;

revoke all on function public.apply_order_receipt_status(
  public.glass_orders.id%type, text, text, numeric, jsonb
) from public, anon;
grant execute on function public.apply_order_receipt_status(
  public.glass_orders.id%type, text, text, numeric, jsonb
) to authenticated;

do $$
declare
  run_record public.order_integrity_migration_runs%rowtype;
  current_order_count bigint;
  current_row_count bigint;
  current_rows_by_order jsonb;
begin
  select * into run_record
  from public.order_integrity_migration_runs
  where migration_name = '20260801194244_emergency_order_integrity_hotfix'
  for update;

  select count(*) into current_order_count from public.glass_orders;
  select count(*) into current_row_count
  from public.glass_order_rows where deleted_at is null;
  select coalesce(jsonb_object_agg(counts.order_id::text, counts.item_count), '{}'::jsonb)
  into current_rows_by_order
  from (
    select order_id, count(*) as item_count
    from public.glass_order_rows
    where deleted_at is null
    group by order_id
  ) as counts;

  if current_order_count < run_record.before_order_count
    or current_row_count < run_record.before_row_count
  then
    raise exception 'ORDER_INTEGRITY_MIGRATION_COUNT_DECREASE'
      using errcode = 'P0001',
            detail = jsonb_build_object(
              'beforeOrders', run_record.before_order_count,
              'afterOrders', current_order_count,
              'beforeRows', run_record.before_row_count,
              'afterRows', current_row_count
            )::text;
  end if;

  update public.order_integrity_migration_runs
  set after_order_count = current_order_count,
      after_row_count = current_row_count,
      after_rows_by_order = current_rows_by_order,
      verified = true,
      verified_at = now()
  where id = run_record.id;
end
$$;

notify pgrst, 'reload schema';
