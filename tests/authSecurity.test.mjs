import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const appSource = readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");
const edgeSource = readFileSync(new URL("../supabase/functions/glass-auth/index.ts", import.meta.url), "utf8");
const edgeConfig = readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8");
const initialMigration = readFileSync(
  new URL("../supabase/migrations/20260729150000_initial_schema.sql", import.meta.url),
  "utf8"
);
const hardeningMigration = readFileSync(
  new URL("../supabase/migrations/20260729151648_harden_auth_rls_and_cost_access.sql", import.meta.url),
  "utf8"
);
const authMigration = readFileSync(
  new URL("../supabase/migrations/20260730113000_secure_auth_provisioning.sql", import.meta.url),
  "utf8"
);
const triggerRepairMigration = readFileSync(
  new URL("../supabase/migrations/20260730120000_repair_auth_profile_link_text_id.sql", import.meta.url),
  "utf8"
);
const authProfileFkRepairMigration = readFileSync(
  new URL("../supabase/migrations/20260730123000_preserve_profile_on_auth_delete.sql", import.meta.url),
  "utf8"
);
const schemaSource = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");

test("Supabase login remains username-first and establishes the returned Auth session", () => {
  assert.match(appSource, /اسم المستخدم أو البريد الإلكتروني/);
  assert.match(appSource, /invokeGlassAuth\("login",\s*\{[\s\S]*identity,[\s\S]*password/);
  assert.match(appSource, /client\.auth\.setSession\(\{\s*access_token:\s*session\.access_token,\s*refresh_token:\s*session\.refresh_token/);
  assert.match(appSource, /if \(identity\.includes\("@"\)\)[\s\S]*client\.auth\.signInWithPassword[\s\S]*client\.rpc\("glass_auth_record_login"\)/);
  assert.match(appSource, /restoreSupabaseSessionUser[\s\S]*client\.auth\.getSession\(\)[\s\S]*supabaseProfileForAuthUser/);
  assert.doesNotMatch(appSource, /\{supabaseMode && \(\s*<Field label="البريد المسجل">/);
});

test("password reset uses the server resolver and never claims unconditional delivery", () => {
  assert.match(appSource, /invokeGlassAuth\("reset-password"/);
  assert.match(appSource, /إذا كان الحساب مرتبطاً ببريد Supabase صالح/);
  assert.doesNotMatch(appSource, /تم إرسال رابط إعادة تعيين كلمة المرور إلى البريد المسجل لهذا المستخدم/);
  assert.match(edgeSource, /const generic = \{\s*accepted:\s*true/);
  assert.match(edgeSource, /if \(!profile\?\.auth_user_id \|\| !profile\.email/);
});

test("admin user creation and password updates are routed through the secured function", () => {
  assert.match(appSource, /invokeGlassAuth\("admin-create-user"/);
  assert.match(appSource, /invokeGlassAuth\("admin-update-user"/);
  assert.match(appSource, /غير مرتبط — أدخل كلمة مرور ثم احفظ/);
  assert.match(appSource, /required=\{supabaseEnabled\(\) && !user\.auth_user_id\}/);
  assert.match(edgeSource, /async function requireActiveAdmin/);
  assert.match(edgeSource, /profile\.is_active === false \|\| profile\.role !== "admin"/);
  assert.match(edgeSource, /admin\.auth\.admin\.createUser/);
  assert.match(edgeSource, /admin\.auth\.admin\.updateUserById/);
  assert.match(edgeSource, /update\(\{ last_login_at: new Date\(\)\.toISOString\(\) \}\)/);
});

test("the service-role credential stays server-side and public actions do normal password auth", () => {
  assert.match(edgeSource, /Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)/);
  assert.match(edgeSource, /authClient\.auth\.signInWithPassword/);
  assert.match(edgeSource, /"Cache-Control": "no-store"/);
  assert.match(edgeSource, /export default \{\s*fetch: handleRequest\s*\}/);
  assert.doesNotMatch(edgeSource, /Deno\.serve/);
  assert.doesNotMatch(appSource, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(edgeConfig, /\[functions\.glass-auth\][\s\S]*verify_jwt\s*=\s*false/);
  assert.match(edgeSource, /if \(action === "admin-create-user"\)[\s\S]*adminCreateUser\(request, admin, body\)/);
});

test("hardening keeps the migration chain open without dropping legacy passwords", () => {
  assert.match(hardeningMigration, /Do not halt the chronological migration chain/);
  assert.doesNotMatch(hardeningMigration, /raise exception[\s\S]*active application profiles must be linked/i);
  assert.match(hardeningMigration, /deliberately preserve any existing public\.users\.password/);
  assert.doesNotMatch(hardeningMigration, /alter\s+table\s+public\.users\s+drop\s+column[\s\S]*password/i);
  assert.doesNotMatch(schemaSource, /alter\s+table\s+public\.users\s+drop\s+column[\s\S]*password/i);
});

test("forward auth migration is additive, private, and represented in schema.sql", () => {
  assert.doesNotMatch(authMigration, /\bdrop\s+column\b/i);
  assert.doesNotMatch(authMigration, /\bdelete\s+from\s+public\.users\b/i);
  assert.equal(
    [...authMigration.matchAll(/\bupdate\s+public\.users\b/gi)].length,
    1,
    "the only existing-profile mutation is the authenticated caller's login timestamp"
  );
  assert.match(authMigration, /update public\.users\s+set last_login_at = recorded_at[\s\S]*auth_user_id = \(select auth\.uid\(\)\)/);
  assert.match(authMigration, /glass_auth_resolve_profile/);
  assert.match(authMigration, /returns table \(\s*id text,/);
  assert.match(authMigration, /profile\.id::text/);
  assert.match(authMigration, /to_regprocedure\('app_private\.current_user_is_admin\(\)'\) is null/);
  assert.match(authMigration, /glass_auth_record_login/);
  assert.match(authMigration, /revoke all on function public\.glass_auth_resolve_profile\(text, boolean\)[\s\S]*from public, anon, authenticated/);
  assert.match(authMigration, /grant execute on function public\.glass_auth_resolve_profile\(text, boolean\)[\s\S]*to service_role/);
  assert.match(authMigration, /glass_auth_preflight/);
  assert.match(authMigration, /glass_auth_admin_audit/);
  assert.match(authMigration, /target_profile_id text/);
  assert.doesNotMatch(authMigration, /target_profile_id uuid references public\.users/);
  assert.match(authMigration, /updated_id text[\s\S]*returning id::text into updated_id/);
  assert.match(authMigration, /idx_users_username_case_insensitive_unique[\s\S]*lower\(username\)/);
  assert.doesNotMatch(authMigration, /actor_auth_user_id uuid not null references auth\.users/);
  assert.match(schemaSource, /glass_auth_resolve_profile/);
  assert.match(schemaSource, /glass_auth_preflight/);
  assert.match(schemaSource, /glass_auth_admin_audit/);
});

test("trigger repair is forward-only, keeps the trigger in place, and matches schema.sql", () => {
  assert.doesNotMatch(triggerRepairMigration, /\bdrop\s+(?:trigger|column|table)\b/i);
  assert.doesNotMatch(triggerRepairMigration, /\bdelete\s+from\b/i);
  assert.doesNotMatch(triggerRepairMigration, /\bpassword\b/i);
  assert.match(
    triggerRepairMigration,
    /create or replace function app_private\.handle_new_auth_user\(\)[\s\S]*linked_profile_id text;[\s\S]*returning id::text into linked_profile_id/
  );
  assert.match(
    triggerRepairMigration,
    /revoke all on function app_private\.handle_new_auth_user\(\)\s+from public, anon, authenticated/
  );
  assert.match(
    schemaSource,
    /create or replace function app_private\.handle_new_auth_user\(\)[\s\S]*linked_profile_id text;[\s\S]*returning id::text into linked_profile_id/
  );
});

test("deleting an Auth identity unlinks but never deletes its application profile", async () => {
  assert.match(initialMigration, /auth_user_id uuid unique references auth\.users\(id\) on delete set null/);
  assert.doesNotMatch(initialMigration, /auth_user_id uuid unique references auth\.users\(id\) on delete cascade/);
  assert.match(hardeningMigration, /confdeltype = 'n'/);
  assert.match(authProfileFkRepairMigration, /on delete set null/);
  assert.doesNotMatch(authProfileFkRepairMigration, /\bdelete\s+from\s+public\.users\b/i);
  assert.match(schemaSource, /auth_user_id uuid unique references auth\.users\(id\) on delete set null/);

  const db = new PGlite();
  try {
    await db.exec(`
      create schema auth;
      create table auth.users (id uuid primary key);
      create table public.users (
        id text primary key,
        username text not null unique,
        auth_user_id uuid,
        display_name text not null,
        constraint users_auth_user_id_fkey
          foreign key (auth_user_id) references auth.users(id) on delete cascade
      );
      insert into auth.users (id)
      values ('44444444-4444-4444-4444-444444444444');
      insert into public.users (id, username, auth_user_id, display_name)
      values (
        'usr_profile_must_survive',
        'profile-must-survive',
        '44444444-4444-4444-4444-444444444444',
        'Profile Must Survive'
      );
    `);

    await db.exec(authProfileFkRepairMigration);
    await db.exec(`
      delete from auth.users
      where id = '44444444-4444-4444-4444-444444444444'
    `);

    const result = await db.query(`
      select id, username, auth_user_id
      from public.users
      where id = 'usr_profile_must_survive'
    `);
    assert.deepEqual(result.rows, [{
      id: "usr_profile_must_survive",
      username: "profile-must-survive",
      auth_user_id: null
    }]);
  } finally {
    await db.close();
  }
});

test("trigger repair replaces a buggy installed function and links a legacy text-ID profile", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema auth;
      create schema app_private;
      create role anon;
      create role authenticated;
      create table auth.users (
        id uuid primary key,
        email text,
        raw_user_meta_data jsonb not null default '{}'::jsonb
      );
      create table public.users (
        id text primary key,
        username text not null unique,
        email text,
        auth_user_id uuid,
        display_name text not null,
        role text not null default 'user',
        is_active boolean not null default true
      );
      insert into public.users (
        id,
        username,
        email,
        display_name,
        role,
        is_active
      ) values (
        'usr_legacy_text_profile',
        'legacy-profile',
        'legacy.profile@example.test',
        'Legacy Profile',
        'user',
        true
      );

      create or replace function app_private.handle_new_auth_user()
      returns trigger
      language plpgsql
      security definer
      set search_path = ''
      as $buggy$
      declare
        linked_profile_id uuid;
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
          returning id into linked_profile_id;
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
      $buggy$;

      revoke all on function app_private.handle_new_auth_user()
        from public, anon, authenticated;
      create trigger on_auth_user_created_create_app_profile
      after insert on auth.users
      for each row execute function app_private.handle_new_auth_user();
    `);

    const installedTrigger = await db.query(`
      select
        trigger_row.oid::text as trigger_oid,
        trigger_row.tgfoid::text as function_oid
      from pg_trigger as trigger_row
      where trigger_row.tgname = 'on_auth_user_created_create_app_profile'
        and not trigger_row.tgisinternal
    `);
    assert.equal(installedTrigger.rows.length, 1);

    await db.exec(triggerRepairMigration);

    const repairedTrigger = await db.query(`
      select
        trigger_row.oid::text as trigger_oid,
        trigger_row.tgfoid::text as function_oid
      from pg_trigger as trigger_row
      where trigger_row.tgname = 'on_auth_user_created_create_app_profile'
        and not trigger_row.tgisinternal
    `);
    assert.deepEqual(
      repairedTrigger.rows,
      installedTrigger.rows,
      "the repair must preserve both the trigger and function identities"
    );

    await db.exec(`
      insert into auth.users (id, email, raw_user_meta_data)
      values (
        '33333333-3333-3333-3333-333333333333',
        'LEGACY.PROFILE@example.test',
        '{"username":"ignored-because-profile-exists"}'::jsonb
      )
    `);

    const linkedProfiles = await db.query(`
      select
        id,
        username,
        email,
        auth_user_id::text as auth_user_id,
        is_active
      from public.users
      order by id
    `);
    assert.deepEqual(linkedProfiles.rows, [{
      id: "usr_legacy_text_profile",
      username: "legacy-profile",
      email: "legacy.profile@example.test",
      auth_user_id: "33333333-3333-3333-3333-333333333333",
      is_active: true
    }]);

    const repairedFunction = await db.query(`
      select
        procedure.prosecdef as security_definer,
        procedure.proconfig,
        procedure.prosrc
      from pg_proc as procedure
      join pg_namespace as namespace
        on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'app_private'
        and procedure.proname = 'handle_new_auth_user'
    `);
    assert.equal(repairedFunction.rows.length, 1);
    assert.equal(repairedFunction.rows[0].security_definer, true);
    assert.deepEqual(repairedFunction.rows[0].proconfig, ["search_path=\"\""]);
    assert.match(repairedFunction.rows[0].prosrc, /linked_profile_id text;/);
    assert.match(repairedFunction.rows[0].prosrc, /returning id::text into linked_profile_id/);

    const executePrivileges = await db.query(`
      select
        has_function_privilege(
          'anon',
          'app_private.handle_new_auth_user()',
          'execute'
        ) as anon_execute,
        has_function_privilege(
          'authenticated',
          'app_private.handle_new_auth_user()',
          'execute'
        ) as authenticated_execute
    `);
    assert.deepEqual(executePrivileges.rows, [{
      anon_execute: false,
      authenticated_execute: false
    }]);
  } finally {
    await db.close();
  }
});

test("forward auth migration preserves an active unlinked profile and its legacy password", async () => {
  const db = new PGlite();
  await db.exec(`
    create schema auth;
    create schema app_private;
    create role anon;
    create role authenticated;
    create role service_role;
    create table auth.users (id uuid primary key);
    create function auth.uid()
    returns uuid language sql stable as 'select null::uuid';
    create table public.users (
      id text primary key,
      username text not null unique,
      email text,
      auth_user_id uuid,
      display_name text not null,
      role text not null default 'user',
      can_view_costs boolean not null default false,
      password text not null default '',
      is_active boolean not null default true,
      last_login_at timestamptz,
      created_at timestamptz not null default now()
    );
    insert into public.users (id, username, email, display_name, password, is_active)
    values ('usr_legacy_text_id', 'unlinked-user', 'unlinked@example.test', 'Unlinked User', 'legacy-secret', true);
  `);
  await db.exec(authMigration);
  const result = await db.query(`
    select username, password, auth_user_id, is_active
    from public.users
    where username = 'unlinked-user'
  `);
  assert.deepEqual(result.rows, [{
    username: "unlinked-user",
    password: "legacy-secret",
    auth_user_id: null,
    is_active: true
  }]);
  const resolverResult = await db.query(`
    select id
    from public.glass_auth_resolve_profile('unlinked-user', true)
  `);
  assert.deepEqual(resolverResult.rows, [{ id: "usr_legacy_text_id" }]);
  const helperResult = await db.query(`
    select
      to_regprocedure('app_private.current_user_is_admin()') is not null as has_admin_helper,
      to_regprocedure('public.glass_auth_record_login()') is not null as has_login_recorder
  `);
  assert.deepEqual(helperResult.rows, [{
    has_admin_helper: true,
    has_login_recorder: true
  }]);
  await db.close();
});

test("the whole auth migration chain links legacy text profile IDs without removing passwords", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema auth;
      create role anon;
      create role authenticated;
      create role service_role;
      create table auth.users (
        id uuid primary key,
        email text,
        raw_user_meta_data jsonb not null default '{}'::jsonb
      );
      create function auth.uid()
      returns uuid language sql stable as 'select null::uuid';
      create table public.users (
        id text primary key,
        username text not null unique,
        email text,
        auth_user_id uuid,
        display_name text not null,
        role text not null default 'user',
        can_view_costs boolean not null default false,
        password text not null default '',
        is_active boolean not null default true,
        last_login_at timestamptz,
        created_at timestamptz not null default now()
      );
      insert into auth.users (id, email)
      values ('11111111-1111-1111-1111-111111111111', 'admin@example.test');
      insert into public.users (
        id,
        username,
        email,
        display_name,
        role,
        password,
        is_active
      ) values
        (
          'usr_legacy_admin',
          'legacy-admin',
          'admin@example.test',
          'Legacy Admin',
          'admin',
          'admin-secret',
          true
        ),
        (
          'usr_legacy_target',
          'legacy-target',
          'target@example.test',
          'Legacy Target',
          'user',
          'target-secret',
          true
        );
    `);

    // PGlite provides gen_random_uuid() but does not ship the pgcrypto
    // extension control file used by hosted Postgres.
    const pgliteInitialMigration = initialMigration.replace(
      /^create extension if not exists pgcrypto;\s*$/m,
      ""
    );
    await db.exec(pgliteInitialMigration);
    await db.exec(hardeningMigration);
    await db.exec(authMigration);

    // This insert fires app_private.handle_new_auth_user() and exercises the
    // legacy text-ID profile-linking path that previously cast the ID to UUID.
    await db.exec(`
      insert into auth.users (id, email, raw_user_meta_data)
      values (
        '22222222-2222-2222-2222-222222222222',
        'target@example.test',
        '{"username":"legacy-target"}'::jsonb
      )
    `);

    const usersResult = await db.query(`
      select
        id,
        username,
        password,
        auth_user_id::text as auth_user_id,
        is_active
      from public.users
      order by username
    `);
    assert.deepEqual(usersResult.rows, [
      {
        id: "usr_legacy_admin",
        username: "legacy-admin",
        password: "admin-secret",
        auth_user_id: "11111111-1111-1111-1111-111111111111",
        is_active: true
      },
      {
        id: "usr_legacy_target",
        username: "legacy-target",
        password: "target-secret",
        auth_user_id: "22222222-2222-2222-2222-222222222222",
        is_active: true
      }
    ]);

    const columnsResult = await db.query(`
      select column_name, data_type
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'users'
        and column_name in ('id', 'password')
      order by column_name
    `);
    assert.deepEqual(columnsResult.rows, [
      { column_name: "id", data_type: "text" },
      { column_name: "password", data_type: "text" }
    ]);

    const resolverResult = await db.query(`
      select id
      from public.glass_auth_resolve_profile('legacy-target', true)
    `);
    assert.deepEqual(resolverResult.rows, [{ id: "usr_legacy_target" }]);
  } finally {
    await db.close();
  }
});
