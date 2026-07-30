-- Release security migration for existing Y.D Glass Manager deployments.
-- Supabase Auth becomes the active password authority. Existing legacy
-- password material is retained for recovery and rollback until a separately
-- reviewed, backup-backed cleanup migration is explicitly approved.

alter table public.users add column if not exists email text;
alter table public.users add column if not exists auth_user_id uuid;
alter table public.users add column if not exists can_view_costs boolean not null default false;

create unique index if not exists idx_users_email_unique
  on public.users (lower(email))
  where email is not null and email <> '';
create unique index if not exists idx_users_auth_user_id_unique
  on public.users (auth_user_id)
  where auth_user_id is not null;

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
  -- Existing installations may use opaque text profile IDs while fresh
  -- installations use UUIDs. Keep the application profile ID type-neutral.
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

-- Preserve existing profiles and roles by linking matching Auth emails first.
update public.users as profile
set auth_user_id = auth_user.id
from auth.users as auth_user
where profile.auth_user_id is null
  and profile.email is not null
  and auth_user.email is not null
  and lower(profile.email) = lower(auth_user.email);

-- Do not halt the chronological migration chain for active profiles that still
-- need provisioning. The following additive auth migration installs the
-- private resolver, admin audit, and preflight needed to finish that work.
-- Access remains protected by auth_user_id-based RLS, and legacy credentials
-- remain untouched for backup-backed recovery.

-- Recovery policy: deliberately preserve any existing public.users.password
-- column and values. Removing legacy credentials is irreversible and must be a
-- separate, explicitly approved migration after backup and live login checks.

-- Auth identities with no pre-provisioned profile are inactive until approved
-- by an existing application administrator.
insert into public.users (username, email, auth_user_id, display_name, role, is_active)
select
  coalesce(nullif(split_part(auth_user.email, '@', 1), ''), 'user') || '-' || substr(auth_user.id::text, 1, 8),
  lower(auth_user.email),
  auth_user.id,
  coalesce(
    nullif(trim(auth_user.raw_user_meta_data ->> 'display_name'), ''),
    nullif(split_part(auth_user.email, '@', 1), ''),
    'User'
  ),
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
