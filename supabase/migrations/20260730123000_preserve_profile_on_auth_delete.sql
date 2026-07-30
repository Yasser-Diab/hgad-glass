-- Forward-only repair for deployments that installed the application-profile
-- foreign key with ON DELETE CASCADE. Removing or recreating a Supabase Auth
-- identity must unlink the application profile, never delete that profile.

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
