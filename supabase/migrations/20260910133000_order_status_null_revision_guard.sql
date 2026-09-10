-- A nullable client type must not bypass the status-revision conflict guard.
-- This is forward-only: it replaces the secured RPC without touching orders.
create or replace function public.update_order_status(
  p_order_id text,
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
  expected_status_revision bigint;
  current_status_revision bigint;
  saved_status_revision bigint;
  safe_client_type text;
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
  if coalesce(p_client_type, '') !~ '^(web|android|ios|telegram_bot)\\|status_revision=[0-9]+$' then
    raise exception 'ORDER_STATUS_CLIENT_UPGRADE_REQUIRED'
      using errcode = 'P0001',
            detail = jsonb_build_object(
              'message', 'Install the current Y.D Glass Manager update before changing order status.'
            )::text;
  end if;

  expected_status_revision := split_part(split_part(p_client_type, '|', 2), '=', 2)::bigint;
  safe_client_type := split_part(p_client_type, '|', 1);

  select status_revision
  into current_status_revision
  from public.glass_orders
  where id = p_order_id
  for update;
  if not found then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;
  if current_status_revision <> expected_status_revision then
    raise exception 'ORDER_STATUS_CONFLICT'
      using errcode = 'P0001',
            detail = jsonb_build_object(
              'message', 'This order status was changed from another device. Refresh and review the current status.',
              'expectedStatusRevision', expected_status_revision,
              'actualStatusRevision', current_status_revision
            )::text;
  end if;

  revision_number := app_private.capture_order_snapshot(
    p_order_id, 'status_update', p_app_version, safe_client_type
  );
  update public.glass_orders
  set document_id = nullif(trim(coalesce(p_document_id, '')), ''),
      status = p_status,
      status_revision = status_revision + 1,
      updated_at = now()
  where id = p_order_id
  returning status_revision into saved_status_revision;

  return jsonb_build_object(
    'id', p_order_id,
    'status', p_status,
    'status_revision', saved_status_revision,
    'revision_number', revision_number,
    'updated_rows', 0
  );
end;
$$;

revoke all on function public.update_order_status(text, text, text, text, text)
  from public, anon;
grant execute on function public.update_order_status(text, text, text, text, text)
  to authenticated;

notify pgrst, 'reload schema';
