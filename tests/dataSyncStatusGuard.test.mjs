import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "src", "main.jsx"), "utf8");
const migration = fs.readFileSync(
  path.join(root, "supabase", "migrations", "20260910093325_glass_data_sync_signal.sql"),
  "utf8"
);

function sourceSection(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${startMarker} should exist`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `${endMarker} should exist after ${startMarker}`);
  return source.slice(start, end);
}

test("status writes use a server revision and ordinary saves preserve current status", () => {
  assert.match(migration, /add column if not exists status_revision bigint not null default 0/i);
  assert.match(migration, /ORDER_STATUS_CLIENT_UPGRADE_REQUIRED/);
  assert.match(migration, /ORDER_STATUS_CONFLICT/);
  assert.match(migration, /coalesce\(p_client_type, ''\)\s*!~\s*'\^\(web\|android\|ios\|telegram_bot\)/);
  assert.match(migration, /expected_status_revision := split_part/);
  assert.match(migration, /status_revision = status_revision \+ 1/);
  assert.match(migration, /effective_order := jsonb_set\(p_order, '\{status\}', to_jsonb\(current_status\), true\)/);
  assert.match(migration, /'status_revision', current_status_revision/);
  assert.doesNotMatch(migration, /drop\s+table\s+(?:if exists\s+)?public\.(?:glass_orders|glass_order_rows|customers|suppliers|supplier_payments)/i);
});

test("cross-user refresh publishes only a revision signal", () => {
  const syncHook = sourceSection("function useSupabaseDataSync(", "async function saveOrderToStore(");

  assert.match(migration, /create table if not exists public\.glass_sync_state/i);
  assert.match(migration, /glass_sync_state_active_users_read/);
  assert.match(migration, /revoke all on function app_private\.bump_glass_sync_state\(\)/i);
  assert.match(migration, /alter publication supabase_realtime add table public\.glass_sync_state/i);
  for (const table of ["glass_orders", "glass_order_rows", "customers", "suppliers", "supplier_payments", "learned_options", "app_settings"]) {
    assert.match(migration, new RegExp(`after insert or update or delete on public\\.${table}`, "i"));
  }

  assert.match(source, /statusRevision: order\.status_revision/);
  assert.match(source, /statusClientTypeWithRevision\(Capacitor\.getPlatform\(\), order\.statusRevision\)/);
  assert.match(syncHook, /table: GLASS_SYNC_STATE_TABLE/);
  assert.match(syncHook, /postgres_changes/);
  assert.match(syncHook, /GLASS_SYNC_POLL_INTERVAL_MS/);
  assert.match(syncHook, /client\.removeChannel\(channel\)/);
  assert.doesNotMatch(syncHook, /table:\s*["']glass_orders["']/);
  assert.doesNotMatch(syncHook, /table:\s*["']glass_order_rows["']/);
  assert.match(source, /useSupabaseDataSync\(currentUser, async \(\) => \{/);
});

test("status conflicts refresh canonical data instead of rolling back to stale state", () => {
  const updateOrderStatus = sourceSection("async function updateOrderStatus(", "async function updateSupplierLumpSumCost(");

  assert.match(updateOrderStatus, /isOrderStatusConflict\(error\)/);
  assert.match(updateOrderStatus, /const refreshed = await loadData\(\)/);
  assert.match(updateOrderStatus, /تم تعديل حالة الطلب من جهاز آخر/);
  assert.match(source, /Discarded a stale offline order-status update/);
});
