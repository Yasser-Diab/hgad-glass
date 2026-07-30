-- Forward-only repair for deployments where handle_new_auth_user() was
-- installed with a UUID local variable while public.users.id is a legacy
-- opaque text identifier. Replacing the function in place preserves the
-- existing auth.users trigger and does not mutate or remove profile data.

create or replace function app_private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
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

-- CREATE OR REPLACE preserves existing function privileges. Reassert the
-- intended private access without dropping or recreating the trigger.
revoke all on function app_private.handle_new_auth_user()
  from public, anon, authenticated;
