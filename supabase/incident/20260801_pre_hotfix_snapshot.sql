-- Immutable in-database incident snapshot for the 2026-08-01 order-integrity hotfix.
-- Run this as postgres BEFORE the hotfix migration. It intentionally aborts
-- when the snapshot schema already exists so evidence cannot be overwritten.

begin;

do $$
begin
  if exists (
    select 1 from pg_namespace
    where nspname = 'incident_backup_20260801_pre_hotfix'
  ) then
    raise exception 'INCIDENT_SNAPSHOT_ALREADY_EXISTS';
  end if;
end
$$;

create schema incident_backup_20260801_pre_hotfix;
revoke all on schema incident_backup_20260801_pre_hotfix from public;

create table incident_backup_20260801_pre_hotfix.snapshot_manifest (
  snapshot_at timestamptz not null,
  database_name text not null,
  database_user text not null,
  transaction_id bigint not null,
  source_schemas text[] not null,
  application_version text not null,
  incident text not null
);

insert into incident_backup_20260801_pre_hotfix.snapshot_manifest
values (
  clock_timestamp(),
  current_database(),
  current_user,
  txid_current(),
  array['public', 'auth', 'storage', 'supabase_migrations'],
  '0.1.10-pre-hotfix',
  'Order rows appeared truncated by an unpaged client load; preserve evidence before repair.'
);

create table incident_backup_20260801_pre_hotfix.source_table_counts (
  source_schema text not null,
  source_table text not null,
  row_count bigint not null,
  primary key (source_schema, source_table)
);

-- Copy every ordinary/partitioned table in the application, authentication,
-- storage-metadata, and migration-history schemas. Storage object bytes remain
-- in object storage; the database metadata rows are copied here.
do $$
declare
  source_record record;
  backup_table_name text;
  copied_count bigint;
begin
  for source_record in
    select n.nspname as schema_name, c.relname as table_name
    from pg_class as c
    join pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = any(array['public', 'auth', 'storage', 'supabase_migrations'])
      and c.relkind in ('r', 'p')
    order by n.nspname, c.relname
  loop
    backup_table_name := source_record.schema_name || '__' || source_record.table_name;
    execute format(
      'create table incident_backup_20260801_pre_hotfix.%I as table %I.%I',
      backup_table_name,
      source_record.schema_name,
      source_record.table_name
    );
    execute format(
      'select count(*) from incident_backup_20260801_pre_hotfix.%I',
      backup_table_name
    ) into copied_count;
    insert into incident_backup_20260801_pre_hotfix.source_table_counts
      (source_schema, source_table, row_count)
    values (source_record.schema_name, source_record.table_name, copied_count);
  end loop;
end
$$;

create table incident_backup_20260801_pre_hotfix.catalog_functions as
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_get_functiondef(p.oid) as definition
from pg_proc as p
join pg_namespace as n on n.oid = p.pronamespace
where n.nspname = any(array['public', 'app_private']);

create table incident_backup_20260801_pre_hotfix.catalog_constraints as
select
  n.nspname as schema_name,
  c.relname as table_name,
  con.conname as constraint_name,
  con.contype as constraint_type,
  pg_get_constraintdef(con.oid, true) as definition
from pg_constraint as con
join pg_class as c on c.oid = con.conrelid
join pg_namespace as n on n.oid = c.relnamespace
where n.nspname = 'public';

create table incident_backup_20260801_pre_hotfix.catalog_indexes as
select schemaname, tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public';

create table incident_backup_20260801_pre_hotfix.catalog_triggers as
select
  n.nspname as schema_name,
  c.relname as table_name,
  t.tgname as trigger_name,
  pg_get_triggerdef(t.oid, true) as definition
from pg_trigger as t
join pg_class as c on c.oid = t.tgrelid
join pg_namespace as n on n.oid = c.relnamespace
where n.nspname = 'public'
  and not t.tgisinternal;

create table incident_backup_20260801_pre_hotfix.catalog_policies as
select * from pg_policies where schemaname = 'public';

create table incident_backup_20260801_pre_hotfix.catalog_views as
select schemaname, viewname, definition
from pg_views
where schemaname = any(array['public', 'app_private']);

create table incident_backup_20260801_pre_hotfix.order_row_counts as
select
  order_record.id::text as order_id,
  order_record.order_no,
  count(row_record.id) as row_count,
  coalesce(sum(row_record.quantity), 0) as total_pieces,
  coalesce(sum(row_record.area_m2), 0) as total_area_m2
from public.glass_orders as order_record
left join public.glass_order_rows as row_record
  on row_record.order_id = order_record.id
group by order_record.id, order_record.order_no;

revoke all on all tables in schema incident_backup_20260801_pre_hotfix from public;

-- The fixture must be present in the evidence snapshot before continuing.
do $$
declare
  fixture_record record;
begin
  select * into fixture_record
  from incident_backup_20260801_pre_hotfix.order_row_counts
  where order_no = 'GO-001289';

  if not found
    or fixture_record.row_count <> 13
    or fixture_record.total_pieces <> 53
    or abs(fixture_record.total_area_m2 - 22.26315) > 0.000001
  then
    raise exception 'GO_001289_SNAPSHOT_VERIFICATION_FAILED'
      using detail = coalesce(to_jsonb(fixture_record)::text, 'fixture missing');
  end if;
end
$$;

commit;

select
  snapshot_at,
  database_name,
  application_version,
  incident
from incident_backup_20260801_pre_hotfix.snapshot_manifest;
