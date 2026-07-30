-- Idempotent baseline for new and existing Y.D Glass Manager projects.
-- Later migrations add authentication, RLS, cost masking, and transactional RPCs.
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

create unique index if not exists idx_users_email_unique
  on public.users (lower(email))
  where email is not null and email <> '';
create unique index if not exists idx_users_auth_user_id_unique
  on public.users (auth_user_id)
  where auth_user_id is not null;

insert into public.app_settings (key, value) values
  ('company', '{"nameEn":"EL HANDASIA GROUP FOR ARCHITECTURAL DESIGNS","nameAr":"المجموعة الهندسية للتصميمات المعمارية","shortName":"HGAD","website":"https://hgad-eg.com"}'::jsonb),
  ('branding', '{"theme":"gold-black-silver","reportLogo":"icons/in-app-logo.png"}'::jsonb)
on conflict (key) do nothing;
