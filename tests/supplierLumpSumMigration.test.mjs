import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationSource = readFileSync(
  new URL("../supabase/migrations/20260909051742_add_supplier_lump_sum_cost.sql", import.meta.url),
  "utf8"
);
const schemaSource = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");

test("supplier invoice migration is additive and preserves customer order data", () => {
  assert.match(migrationSource, /alter table public\.glass_orders\s+add column if not exists supplier_lump_sum_cost numeric/i);
  assert.match(migrationSource, /supplier_lump_sum_cost is null or supplier_lump_sum_cost >= 0/i);
  assert.doesNotMatch(migrationSource, /delete\s+from\s+public\.glass_orders/i);
  assert.doesNotMatch(migrationSource, /truncate\s+(?:table\s+)?public\.glass_orders/i);
  assert.doesNotMatch(migrationSource, /drop\s+table\s+(?:if exists\s+)?public\.glass_orders/i);
  assert.match(schemaSource, /supplier_lump_sum_cost numeric/i);
  assert.doesNotMatch(schemaSource, /^\+--/m);
});

test("supplier invoice saves remain inside the existing atomic order contract", () => {
  assert.match(migrationSource, /app_private\.save_glass_order_atomic_v010\(p_order, p_rows\)/);
  assert.match(migrationSource, /if p_order \? 'supplier_lump_sum_cost' then[\s\S]*update public\.glass_orders/i);
  assert.match(migrationSource, /new\.supplier_lump_sum_cost := old\.supplier_lump_sum_cost/i);
  assert.match(migrationSource, /order_record\.supplier_lump_sum_cost := null/i);
  assert.match(mainSource, /supplier_lump_sum_cost: normalized\.supplierLumpSumCost/);
  assert.match(mainSource, /normalized\._canViewCosts !== false/);
});
