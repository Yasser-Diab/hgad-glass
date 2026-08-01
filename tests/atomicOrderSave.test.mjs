import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const mainSource = readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");
const schemaSource = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
const migrationSource = readFileSync(
  new URL("../supabase/migrations/20260801180000_restore_order_save_validation.sql", import.meta.url),
  "utf8"
);

function sourceFunction(name, nextName) {
  const start = mainSource.indexOf(`async function ${name}`);
  const end = mainSource.indexOf(`async function ${nextName}`, start + 1);
  assert.notEqual(start, -1, `${name} must exist`);
  assert.notEqual(end, -1, `${nextName} must follow ${name}`);
  return mainSource.slice(start, end);
}

function canonicalAtomicSql(source) {
  const start = source.lastIndexOf("create or replace function public.save_glass_order_atomic(");
  const grant = "grant execute on function public.save_glass_order_atomic(jsonb, jsonb)";
  const grantStart = source.indexOf(grant, start);
  const end = source.indexOf(";", grantStart) + 1;
  assert.notEqual(start, -1, "atomic order function must exist");
  assert.notEqual(grantStart, -1, "atomic order function grant must exist");
  return source
    .slice(start, end)
    .replace(/--.*$/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

test("full Supabase order save uses one RPC for header, rows, and pruning", () => {
  const saveSource = sourceFunction("saveOrderToSupabase", "deleteOrderFromSupabase");

  assert.equal(
    [...saveSource.matchAll(/client\.rpc\("save_glass_order_atomic"/g)].length,
    1
  );
  assert.doesNotMatch(saveSource, /\.from\("glass_orders"\)\.(?:insert|update|upsert|delete)\(/);
  assert.doesNotMatch(saveSource, /\.from\("glass_order_rows"\)\.(?:insert|update|upsert|delete)\(/);
  assert.match(saveSource, /p_order:\s*payload/);
  assert.match(saveSource, /p_rows:\s*rows/);
});

test("delete Undo restores through the same full-order save path", () => {
  const undoStart = mainSource.indexOf("async function applyPersistedHistoryEntry");
  const undoEnd = mainSource.indexOf("async function undoHistory", undoStart);
  const undoSource = mainSource.slice(undoStart, undoEnd);

  assert.match(undoSource, /persistence\.type === "order-delete"/);
  assert.match(undoSource, /direction === "undo"/);
  assert.match(undoSource, /saveOrderToStore\(restoreOrder,\s*currentData\)/);
  assert.match(mainSource, /saveOrderToSupabase\(client,\s*normalized\)/);
});

test("migration and authoritative schema expose the same secured validated transaction", () => {
  assert.equal(canonicalAtomicSql(schemaSource), canonicalAtomicSql(migrationSource));
  assert.match(migrationSource, /security definer/);
  assert.match(migrationSource, /app_private\.current_user_is_active\(\)/);
  assert.match(migrationSource, /if order_exists then[\s\S]*update public\.glass_orders[\s\S]*else[\s\S]*insert into public\.glass_orders/);
  assert.match(migrationSource, /if row_exists then[\s\S]*update public\.glass_order_rows[\s\S]*else[\s\S]*insert into public\.glass_order_rows/);
  assert.match(migrationSource, /existing_row_order_id <> order_id_value/);
  assert.match(migrationSource, /ORDER_VALIDATION_FAILED/);
  assert.match(migrationSource, /customer_id_value is null/);
  assert.match(migrationSource, /supplier_id_value is null/);
  assert.match(migrationSource, /jsonb_array_length\(p_rows\) = 0/);
  assert.match(migrationSource, /missing_row_ids/);
  assert.match(migrationSource, /id::text = any\(deleted_row_ids\)/);
  assert.doesNotMatch(migrationSource, /not \(id::text = any\(saved_row_ids\)\)/);
  assert.match(migrationSource, /order_id_value public\.glass_orders\.id%type/);
  assert.match(migrationSource, /row_id_value public\.glass_order_rows\.id%type/);
  assert.doesNotMatch(migrationSource, /on conflict/i);
  assert.match(migrationSource, /revoke all on function public\.save_glass_order_atomic\(jsonb, jsonb\)[\s\S]*from public, anon/);
  assert.match(migrationSource, /grant execute on function public\.save_glass_order_atomic\(jsonb, jsonb\)[\s\S]*to authenticated/);
});

test("atomic RPC updates, prunes, and rolls back a foreign-row save as one transaction", async () => {
  const db = new PGlite();
  await db.exec(`
    create schema app_private;
    create role anon;
    create role authenticated;
    create function app_private.current_user_is_active()
    returns boolean language sql stable as 'select true';

    create table public.glass_orders (
      id uuid primary key,
      order_no text not null unique,
      document_id text,
      order_date date not null,
      entry_at timestamptz,
      status text not null,
      collected_pieces numeric not null default 0,
      entry_mode text not null,
      customer_id uuid,
      supplier_id uuid,
      customer_name text,
      supplier_name text,
      project text,
      code text,
      notes text,
      totals jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table public.customers (id uuid primary key, name text not null unique);
    create table public.suppliers (id uuid primary key, name text not null unique);
    create table public.glass_order_rows (
      id uuid primary key,
      order_id uuid not null references public.glass_orders(id) on delete cascade,
      line_no integer not null,
      glass_mode text not null,
      code text,
      description text,
      quantity numeric not null,
      unit_price numeric not null,
      supplier_unit_price numeric not null,
      material_unit_price numeric not null,
      supplier_material_unit_price numeric not null,
      double_gap text,
      triplex_pvb text,
      extra_direction text,
      notes text,
      received_quantity numeric,
      receipt_history jsonb not null,
      layer_offset jsonb not null default '{}'::jsonb,
      layers jsonb not null,
      drawing jsonb not null,
      area_m2 numeric not null,
      cost numeric not null,
      supplier_cost numeric not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);
  await db.exec(migrationSource);

  const orderA = "00000000-0000-4000-8000-000000000001";
  const orderB = "00000000-0000-4000-8000-000000000002";
  const rowA1 = "10000000-0000-4000-8000-000000000001";
  const rowA2 = "10000000-0000-4000-8000-000000000002";
  const rowB1 = "20000000-0000-4000-8000-000000000001";
  const invalidOrder = "00000000-0000-4000-8000-000000000003";
  const invalidRow = "30000000-0000-4000-8000-000000000003";
  const customerId = "30000000-0000-4000-8000-000000000001";
  const supplierId = "40000000-0000-4000-8000-000000000001";
  const orderPayload = (id, orderNo, notes = "", deletedRowIds = []) => ({
    id,
    order_no: orderNo,
    document_id: null,
    order_date: "2026-07-29",
    entry_at: null,
    status: "ordered",
    collected_pieces: 0,
    entry_mode: "normal",
    customer_id: customerId,
    supplier_id: supplierId,
    customer_name: "Customer",
    supplier_name: "Supplier",
    project: "Project",
    code: "",
    notes,
    deleted_row_ids: deletedRowIds,
    totals: { total: 10, supplierCost: 7 }
  });
  const rowPayload = (id, orderId, quantity = 1) => ({
    id,
    order_id: orderId,
    line_no: 1,
    glass_mode: "single",
    code: "",
    description: "Clear 6mm",
    quantity,
    unit_price: 10,
    supplier_unit_price: 7,
    material_unit_price: 10,
    supplier_material_unit_price: 7,
    double_gap: null,
    triplex_pvb: null,
    extra_direction: null,
    notes: "",
    received_quantity: null,
    receipt_history: [],
    layers: [{ glassType: "Clear", thickness: "6mm", width: 100, height: 100 }],
    drawing: { shapes: [], paths: [], panels: [] },
    area_m2: 1,
    cost: 10,
    supplier_cost: 7
  });
  const save = (order, rows) => db.query(
    "select public.save_glass_order_atomic($1::jsonb, $2::jsonb) as result",
    [JSON.stringify(order), JSON.stringify(rows)]
  );

  try {
    await db.query("insert into customers (id, name) values ($1, $2)", [customerId, "Customer"]);
    await db.query("insert into suppliers (id, name) values ($1, $2)", [supplierId, "Supplier"]);
    await assert.rejects(
      save({ ...orderPayload(invalidOrder, "GO-INVALID"), customer_id: null }, [rowPayload(invalidRow, invalidOrder)]),
      /ORDER_VALIDATION_FAILED/
    );
    await assert.rejects(
      save(orderPayload(invalidOrder, "GO-INVALID"), [{
        ...rowPayload(invalidRow, invalidOrder),
        layers: [{ glassType: "Clear", thickness: "", width: 100, height: 100 }]
      }]),
      /ORDER_VALIDATION_FAILED/
    );
    const invalidOrderCount = await db.query("select count(*)::integer as count from glass_orders where id = $1", [invalidOrder]);
    assert.equal(invalidOrderCount.rows[0].count, 0, "server validation must roll back the complete invalid order");
    await save(orderPayload(orderA, "GO-000001"), [
      rowPayload(rowA1, orderA, 1),
      { ...rowPayload(rowA2, orderA, 2), line_no: 2 }
    ]);
    await assert.rejects(
      save(orderPayload(orderA, "GO-000001", "must not prune implicitly"), [
        rowPayload(rowA1, orderA, 3)
      ]),
      /ORDER_VALIDATION_FAILED/
    );
    await save(orderPayload(orderA, "GO-000001", "updated", [rowA2]), [
      rowPayload(rowA1, orderA, 3)
    ]);

    const afterPrune = await db.query(
      "select o.notes, r.id::text as row_id, r.quantity::text as quantity from glass_orders o join glass_order_rows r on r.order_id = o.id where o.id = $1",
      [orderA]
    );
    assert.deepEqual(afterPrune.rows, [{
      notes: "updated",
      row_id: rowA1,
      quantity: "3"
    }]);

    await save(orderPayload(orderB, "GO-000002"), [rowPayload(rowB1, orderB)]);
    await assert.rejects(
      save(orderPayload(orderA, "GO-000001", "must roll back"), [
        rowPayload(rowB1, orderA)
      ]),
      /belongs to another order/
    );

    const afterFailure = await db.query(
      "select notes from glass_orders where id = $1",
      [orderA]
    );
    assert.equal(afterFailure.rows[0].notes, "updated");
  } finally {
    await db.close();
  }
});
