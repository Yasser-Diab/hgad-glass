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

-- The following incident-safety overlay is kept in the authoritative schema
-- as well as its timestamped migration so fresh databases receive identical
-- paging, audit, revision, and row-count protections.
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

-- 20260801220500_optimize_startup_loaders.sql
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
