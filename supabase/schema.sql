create extension if not exists pgcrypto;

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  email text unique,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  display_name text not null,
  role text not null default 'user',
  can_view_costs boolean not null default false,
  is_active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  address text,
  tax_no text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  address text,
  notes text,
  opening_balance numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.supplier_payments (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  supplier_name text,
  paid_at date not null default current_date,
  amount numeric not null default 0,
  method text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.glass_orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null,
  document_id text,
  order_date date not null default current_date,
  entry_at timestamptz,
  status text not null default 'draft',
  entry_mode text not null default 'normal',
  customer_id uuid references public.customers(id) on delete set null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  customer_name text,
  supplier_name text,
  project text,
  code text,
  notes text,
  totals jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.glass_order_rows (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.glass_orders(id) on delete cascade,
  line_no integer not null default 1,
  glass_mode text not null default 'single',
  code text,
  description text,
  quantity numeric not null default 1,
  unit_price numeric not null default 0,
  supplier_unit_price numeric not null default 0,
  material_unit_price numeric not null default 0,
  supplier_material_unit_price numeric not null default 0,
  double_gap text,
  triplex_pvb text,
  extra_direction text,
  notes text,
  received_quantity numeric,
  receipt_history jsonb not null default '[]'::jsonb,
  layer_offset jsonb not null default '{}'::jsonb,
  layers jsonb not null default '[]'::jsonb,
  drawing jsonb not null default '{}'::jsonb,
  area_m2 numeric not null default 0,
  cost numeric not null default 0,
  supplier_cost numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.learned_options (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  value text not null,
  created_at timestamptz not null default now(),
  unique(kind, value)
);

create index if not exists idx_glass_orders_customer on public.glass_orders(customer_id);
create index if not exists idx_glass_orders_supplier on public.glass_orders(supplier_id);
create index if not exists idx_glass_orders_document on public.glass_orders(document_id);
create unique index if not exists idx_glass_orders_order_no_unique on public.glass_orders(order_no);
create index if not exists idx_glass_order_rows_order on public.glass_order_rows(order_id);

alter table public.supplier_payments add column if not exists supplier_name text;
alter table public.glass_orders add column if not exists entry_at timestamptz;
alter table public.glass_orders add column if not exists collected_pieces numeric not null default 0;
alter table public.glass_order_rows add column if not exists notes text;
alter table public.glass_order_rows add column if not exists code text;
alter table public.glass_order_rows add column if not exists received_quantity numeric;
alter table public.glass_order_rows add column if not exists receipt_history jsonb not null default '[]'::jsonb;
alter table public.users add column if not exists email text;
alter table public.users add column if not exists auth_user_id uuid;
alter table public.users add column if not exists can_view_costs boolean not null default false;
create unique index if not exists idx_users_email_unique on public.users (lower(email)) where email is not null and email <> '';
create unique index if not exists idx_users_auth_user_id_unique on public.users (auth_user_id) where auth_user_id is not null;

insert into public.app_settings (key, value) values
  ('company', '{"nameEn":"EL HANDASIA GROUP FOR ARCHITECTURAL DESIGNS","nameAr":"المجموعة الهندسية للتصميمات المعمارية","shortName":"HGAD","website":"https://hgad-eg.com"}'::jsonb),
  ('branding', '{"theme":"gold-black-silver","reportLogo":"icons/in-app-logo.png"}'::jsonb)
on conflict (key) do nothing;

-- Supabase Auth is the active password authority. Existing legacy password
-- material is retained for recovery and rollback until a separately reviewed,
-- backup-backed cleanup migration is explicitly approved.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_auth_user_id_fkey'
      and conrelid = 'public.users'::regclass
      and confrelid = 'auth.users'::regclass
      and confdeltype = 'n'
  ) then
    alter table public.users
      drop constraint if exists users_auth_user_id_fkey;
    alter table public.users
      add constraint users_auth_user_id_fkey
      foreign key (auth_user_id) references auth.users(id) on delete set null;
  end if;
end
$$;

create schema if not exists app_private;
revoke all on schema app_private from public, anon;

create or replace function app_private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Deployed legacy profiles can use opaque text primary keys. Keep this as
  -- text so the Auth insert trigger links them without a UUID cast failure.
  linked_profile_id text;
  requested_username text;
  requested_display_name text;
begin
  if new.email is not null then
    update public.users
    set auth_user_id = new.id,
        email = lower(new.email)
    where auth_user_id is null
      and email is not null
      and lower(email) = lower(new.email)
    returning id::text into linked_profile_id;
  end if;

  if linked_profile_id is null then
    requested_username := coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'username'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'user'
    );
    requested_display_name := coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      requested_username
    );
    insert into public.users (
      username,
      email,
      auth_user_id,
      display_name,
      role,
      is_active
    ) values (
      requested_username || '-' || substr(new.id::text, 1, 8),
      lower(new.email),
      new.id,
      requested_display_name,
      'user',
      false
    );
  end if;
  return new;
end;
$$;

revoke all on function app_private.handle_new_auth_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created_create_app_profile on auth.users;
create trigger on_auth_user_created_create_app_profile
after insert on auth.users
for each row execute function app_private.handle_new_auth_user();

-- Link profiles created before this schema was applied. Roles remain unchanged.
update public.users as profile
set auth_user_id = auth_user.id
from auth.users as auth_user
where profile.auth_user_id is null
  and profile.email is not null
  and auth_user.email is not null
  and lower(profile.email) = lower(auth_user.email);

-- Keep the schema forward-applicable while active profiles are still awaiting
-- Supabase Auth provisioning. The private resolver, audit, and preflight below
-- provide the safe completion path; auth_user_id-based RLS continues to deny
-- unlinked profiles, and no legacy credential material is removed.

-- Recovery policy: deliberately preserve any existing public.users.password
-- column and values. Removing legacy credentials is irreversible and must be a
-- separate, explicitly approved migration after backup and live login checks.

insert into public.users (username, email, auth_user_id, display_name, role, is_active)
select
  coalesce(nullif(split_part(auth_user.email, '@', 1), ''), 'user') || '-' || substr(auth_user.id::text, 1, 8),
  lower(auth_user.email),
  auth_user.id,
  coalesce(nullif(trim(auth_user.raw_user_meta_data ->> 'display_name'), ''), nullif(split_part(auth_user.email, '@', 1), ''), 'User'),
  'user',
  false
from auth.users as auth_user
where not exists (
  select 1 from public.users as profile where profile.auth_user_id = auth_user.id
);

create or replace function app_private.current_user_is_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users
    where auth_user_id = (select auth.uid())
      and is_active = true
  );
$$;

create or replace function app_private.current_user_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users
    where auth_user_id = (select auth.uid())
      and is_active = true
      and role = 'admin'
  );
$$;

create or replace function app_private.current_user_can_view_costs()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users
    where auth_user_id = (select auth.uid())
      and is_active = true
      and (role = 'admin' or can_view_costs = true)
  );
$$;

revoke all on function app_private.current_user_is_active() from public, anon;
revoke all on function app_private.current_user_is_admin() from public, anon;
revoke all on function app_private.current_user_can_view_costs() from public, anon;
grant usage on schema app_private to authenticated;
grant execute on function app_private.current_user_is_active() to authenticated;
grant execute on function app_private.current_user_is_admin() to authenticated;
grant execute on function app_private.current_user_can_view_costs() to authenticated;

-- Security-definer loaders are the only read path that can touch supplier-cost
-- columns. They validate the authenticated profile before applying masking.
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
        when can_view_costs then to_jsonb(order_row)
        else to_jsonb(order_row) || jsonb_build_object(
          'totals',
          (coalesce(order_row.totals, '{}'::jsonb) - 'supplierCost' - 'supplier_cost')
            || jsonb_build_object('supplierCost', 0, 'supplier_cost', 0)
        )
      end
    )
  ).*
  from public.glass_orders as order_row
  order by order_row.order_date desc, order_row.order_no desc;
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
        when can_view_costs then to_jsonb(order_row)
        else to_jsonb(order_row) || jsonb_build_object(
          'supplier_unit_price', 0,
          'supplier_material_unit_price', 0,
          'supplier_cost', 0,
          'layers', coalesce((
            select jsonb_agg(
              (layer_value - 'supplierUnitPrice' - 'supplier_unit_price')
                || jsonb_build_object('supplierUnitPrice', 0, 'supplier_unit_price', 0)
            )
            from jsonb_array_elements(coalesce(order_row.layers, '[]'::jsonb))
              as layer_items(layer_value)
          ), '[]'::jsonb)
        )
      end
    )
  ).*
  from public.glass_order_rows as order_row
  order by order_row.line_no;
end;
$$;

revoke all on function public.load_glass_orders() from public, anon;
revoke all on function public.load_glass_order_rows() from public, anon;
grant execute on function public.load_glass_orders() to authenticated;
grant execute on function public.load_glass_order_rows() to authenticated;

alter table public.app_settings enable row level security;
alter table public.users enable row level security;
alter table public.customers enable row level security;
alter table public.suppliers enable row level security;
alter table public.supplier_payments enable row level security;
alter table public.glass_orders enable row level security;
alter table public.glass_order_rows enable row level security;
alter table public.learned_options enable row level security;

-- This file is the authoritative policy set for the application tables.
do $$
declare
  policy_record record;
begin
  for policy_record in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = any(array[
        'app_settings',
        'users',
        'customers',
        'suppliers',
        'supplier_payments',
        'glass_orders',
        'glass_order_rows',
        'learned_options'
      ])
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_record.policyname,
      policy_record.schemaname,
      policy_record.tablename
    );
  end loop;
end
$$;

create policy users_select_own_or_admin
on public.users for select
to authenticated
using (
  auth_user_id = (select auth.uid())
  or (select app_private.current_user_is_admin())
);

create policy users_insert_admin
on public.users for insert
to authenticated
with check ((select app_private.current_user_is_admin()));

create policy users_update_admin
on public.users for update
to authenticated
using ((select app_private.current_user_is_admin()))
with check ((select app_private.current_user_is_admin()));

create policy users_delete_admin
on public.users for delete
to authenticated
using ((select app_private.current_user_is_admin()));

create policy app_settings_select_active
on public.app_settings for select
to authenticated
using ((select app_private.current_user_is_active()));

create policy app_settings_insert_admin
on public.app_settings for insert
to authenticated
with check ((select app_private.current_user_is_admin()));

create policy app_settings_update_admin
on public.app_settings for update
to authenticated
using ((select app_private.current_user_is_admin()))
with check ((select app_private.current_user_is_admin()));

create policy app_settings_delete_admin
on public.app_settings for delete
to authenticated
using ((select app_private.current_user_is_admin()));

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'customers',
    'suppliers',
    'supplier_payments',
    'glass_orders',
    'glass_order_rows',
    'learned_options'
  ]
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select app_private.current_user_is_active()))',
      table_name || '_select_active',
      table_name
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select app_private.current_user_is_active()))',
      table_name || '_insert_active',
      table_name
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select app_private.current_user_is_active())) with check ((select app_private.current_user_is_active()))',
      table_name || '_update_active',
      table_name
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select app_private.current_user_is_active()))',
      table_name || '_delete_active',
      table_name
    );
  end loop;
end
$$;

revoke all on table public.app_settings, public.users, public.customers,
  public.suppliers, public.supplier_payments, public.glass_orders,
  public.glass_order_rows, public.learned_options from anon;

grant select on table public.app_settings to authenticated;
grant select, insert, update, delete on table public.users to authenticated;
grant select, insert, update, delete on table public.customers, public.suppliers,
  public.supplier_payments, public.learned_options to authenticated;
grant insert, update, delete on table public.glass_orders, public.glass_order_rows
  to authenticated;

revoke select on table public.glass_orders, public.glass_order_rows from authenticated;
grant select (
  id, order_no, document_id, order_date, entry_at, status, entry_mode,
  customer_id, supplier_id, customer_name, supplier_name, project, code,
  notes, collected_pieces, created_at, updated_at
) on public.glass_orders to authenticated;
grant select (
  id, order_id, line_no, glass_mode, code, description, quantity, unit_price,
  material_unit_price, double_gap, triplex_pvb, extra_direction, notes,
  received_quantity, receipt_history, layer_offset, drawing, area_m2, cost,
  created_at, updated_at
) on public.glass_order_rows to authenticated;

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke execute on functions from public, anon;

-- Atomically persist an order status/document change together with the exact
-- receipt rows changed by a multi-type receipt or receipt correction. The
-- function locks the order and validates row ownership, quantities, history
-- shape, collected total, and receipt-derived status before changing anything.
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

-- Preserve hidden supplier pricing when a user may edit operational fields but
-- is not permitted to view costs. New cost-bearing records require a
-- cost-authorized user because there is no trusted existing price to preserve.
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

-- Persist an order header, all of its rows, and row pruning in one database
-- transaction. This intentionally follows the hidden-cost triggers: existing
-- records are updated while new records are inserted.
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

-- Secure server-side username resolution and Auth administration support.
-- These objects are additive and never mutate or password-drop existing users.
do $$
begin
  if exists (
    select 1
    from public.users
    group by lower(username)
    having count(*) > 1
  ) then
    raise exception 'Duplicate case-insensitive usernames must be resolved before secure auth provisioning';
  end if;
end
$$;

create schema if not exists app_private;
revoke all on schema app_private from public, anon;
grant usage on schema app_private to authenticated;

do $outer$
begin
  if to_regprocedure('app_private.current_user_is_admin()') is null then
    execute $create$
      create function app_private.current_user_is_admin()
      returns boolean
      language sql
      stable
      security definer
      set search_path = ''
      as $body$
        select exists (
          select 1
          from public.users
          where auth_user_id = (select auth.uid())
            and is_active = true
            and role = 'admin'
        )
      $body$
    $create$;
  end if;
end
$outer$;

revoke all on function app_private.current_user_is_admin()
  from public, anon;
grant execute on function app_private.current_user_is_admin()
  to authenticated;

create unique index if not exists idx_users_username_case_insensitive_unique
  on public.users (lower(username));

create table if not exists public.glass_auth_admin_audit (
  id uuid primary key default gen_random_uuid(),
  actor_auth_user_id uuid not null,
  -- Profile IDs are opaque: legacy deployments use text while clean
  -- deployments use UUID. Text keeps the audit schema compatible with both.
  target_profile_id text,
  target_auth_user_id uuid,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_glass_auth_admin_audit_actor_created
  on public.glass_auth_admin_audit (actor_auth_user_id, created_at desc);
create index if not exists idx_glass_auth_admin_audit_target_profile
  on public.glass_auth_admin_audit (target_profile_id, created_at desc);

alter table public.glass_auth_admin_audit enable row level security;
drop policy if exists glass_auth_admin_audit_select_admin
  on public.glass_auth_admin_audit;
create policy glass_auth_admin_audit_select_admin
on public.glass_auth_admin_audit
for select
to authenticated
using ((select app_private.current_user_is_admin()));

revoke all on table public.glass_auth_admin_audit from public, anon, authenticated;
grant select on table public.glass_auth_admin_audit to authenticated;
grant select, insert on table public.glass_auth_admin_audit to service_role;

create or replace function public.glass_auth_resolve_profile(
  p_identity text,
  p_include_inactive boolean default false
)
returns table (
  id text,
  username text,
  email text,
  auth_user_id uuid,
  display_name text,
  role text,
  can_view_costs boolean,
  is_active boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with normalized as (
    select lower(trim(coalesce(p_identity, ''))) as value
  )
  select
    profile.id::text,
    profile.username,
    profile.email,
    profile.auth_user_id,
    profile.display_name,
    profile.role,
    profile.can_view_costs,
    profile.is_active
  from public.users as profile
  cross join normalized
  where normalized.value <> ''
    and (p_include_inactive or profile.is_active = true)
    and (
      lower(profile.username) = normalized.value
      or lower(coalesce(profile.email, '')) = normalized.value
    )
  order by
    case when lower(profile.username) = normalized.value then 0 else 1 end,
    profile.created_at,
    profile.id
  limit 1;
$$;

revoke all on function public.glass_auth_resolve_profile(text, boolean)
  from public, anon, authenticated;
grant execute on function public.glass_auth_resolve_profile(text, boolean)
  to service_role;

create or replace function public.glass_auth_record_login()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  recorded_at timestamptz := now();
  updated_id text;
begin
  update public.users
  set last_login_at = recorded_at
  where auth_user_id = (select auth.uid())
    and is_active = true
  returning id::text into updated_id;
  if updated_id is null then
    raise exception 'Active linked application profile required'
      using errcode = '42501';
  end if;
  return recorded_at;
end;
$$;

revoke all on function public.glass_auth_record_login()
  from public, anon;
grant execute on function public.glass_auth_record_login()
  to authenticated;

create or replace function public.glass_auth_preflight()
returns table (
  active_profiles bigint,
  active_linked bigint,
  active_unlinked bigint,
  active_missing_email bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select app_private.current_user_is_admin()) then
    raise exception 'Active application administrator required'
      using errcode = '42501';
  end if;
  return query
  select
    count(*) filter (where profile.is_active = true),
    count(*) filter (
      where profile.is_active = true
        and profile.auth_user_id is not null
    ),
    count(*) filter (
      where profile.is_active = true
        and profile.auth_user_id is null
    ),
    count(*) filter (
      where profile.is_active = true
        and nullif(trim(profile.email), '') is null
    )
  from public.users as profile;
end;
$$;

revoke all on function public.glass_auth_preflight()
  from public, anon;
grant execute on function public.glass_auth_preflight()
  to authenticated;

comment on function public.glass_auth_preflight() is
  'Read-only admin preflight. Never drops passwords or mutates user profiles.';
