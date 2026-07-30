-- Forward-only authentication support for username login and server-side
-- Supabase Auth administration. This migration never changes, deletes, or
-- password-drops an existing application user.

do $$
begin
  if to_regclass('public.users') is null then
    raise exception 'public.users must exist before secure auth provisioning';
  end if;
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'users'
      and column_name = 'email'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'users'
      and column_name = 'auth_user_id'
  ) then
    raise exception 'public.users email and auth_user_id columns are required';
  end if;
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

-- Fresh baselines may apply this migration without the earlier hardening
-- migration. Preserve an existing implementation, otherwise install the
-- smallest equivalent active-admin predicate required by this migration.
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
  -- Legacy installations use text profile IDs while clean installations use
  -- UUIDs. Store the opaque profile identifier as text so this additive audit
  -- table works with both schemas without mutating public.users.
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

-- Only the service-role Edge Function may resolve an email from a username.
-- Keeping this RPC unavailable to anon/authenticated prevents account/email
-- enumeration from the browser.
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

-- Direct email sign-in is the break-glass path when the Edge Function is
-- unavailable. This authenticated RPC records only the caller's own successful
-- login and cannot be used to modify another profile.
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

-- Administrators can run this before provisioning or releasing. A non-zero
-- active_unlinked or active_missing_email count blocks any future legacy
-- password removal; this migration itself never removes password material.
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
