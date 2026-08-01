import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const validationMigration = readFileSync(
  new URL("../supabase/migrations/20260801180000_restore_order_save_validation.sql", import.meta.url),
  "utf8"
);
const integrityMigration = readFileSync(
  new URL("../supabase/migrations/20260801194244_emergency_order_integrity_hotfix.sql", import.meta.url),
  "utf8"
);
const optimizedLoadersMigration = readFileSync(
  new URL("../supabase/migrations/20260801220500_optimize_startup_loaders.sql", import.meta.url),
  "utf8"
);

const ORDER_ID = "00000000-0000-4000-8000-000000001289";
const CUSTOMER_ID = "30000000-0000-4000-8000-000000000001";
const SUPPLIER_ID = "40000000-0000-4000-8000-000000000001";

function orderPayload(expectedItemCount, overrides = {}) {
  return {
    id: ORDER_ID,
    order_no: "GO-001289",
    document_id: "GO-001289",
    order_date: "2026-07-28",
    entry_at: null,
    status: "ready",
    collected_pieces: 0,
    entry_mode: "normal",
    customer_id: CUSTOMER_ID,
    supplier_id: SUPPLIER_ID,
    customer_name: "نيو جيرسي",
    supplier_name: "العالميه للزجاج",
    project: "جورا",
    code: "",
    notes: "",
    deleted_row_ids: [],
    expected_item_count: expectedItemCount,
    app_version: "0.1.10",
    client_type: "test",
    totals: { pieces: 53, area: 22.26315, supplierCost: 0 },
    ...overrides
  };
}

function rowPayload(index, quantity) {
  return {
    id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    order_id: ORDER_ID,
    line_no: index,
    glass_mode: "single",
    code: `R-${index}`,
    description: `Glass row ${index}`,
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
    layers: [{ glassType: "Clear", thickness: "6mm", width: 100 + index, height: 80 + index }],
    drawing: { shapes: [], paths: [], panels: [] },
    area_m2: 1,
    cost: 10,
    supplier_cost: 7
  };
}

async function createFixtureDatabase(identifierType = "uuid") {
  assert.ok(["uuid", "text"].includes(identifierType));
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as 'select null::uuid';
    create schema app_private;
    create function app_private.current_user_is_active()
      returns boolean language sql stable as 'select true';
    create function app_private.current_user_is_admin()
      returns boolean language sql stable as 'select true';
    create function app_private.current_user_can_view_costs()
      returns boolean language sql stable as 'select true';

    create table public.customers (id ${identifierType} primary key, name text not null unique);
    create table public.suppliers (id ${identifierType} primary key, name text not null unique);
    create table public.glass_orders (
      id ${identifierType} primary key,
      order_no text not null unique,
      document_id text,
      order_date date not null,
      entry_at timestamptz,
      status text not null,
      collected_pieces numeric not null default 0,
      entry_mode text not null,
      customer_id ${identifierType},
      supplier_id ${identifierType},
      customer_name text,
      supplier_name text,
      project text,
      code text,
      notes text,
      totals jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table public.glass_order_rows (
      id ${identifierType} primary key,
      order_id ${identifierType} not null references public.glass_orders(id) on delete cascade,
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
  await db.exec(validationMigration);
  await db.exec(integrityMigration);
  await db.exec(optimizedLoadersMigration);
  await db.query("insert into customers (id, name) values ($1, $2)", [CUSTOMER_ID, "نيو جيرسي"]);
  await db.query("insert into suppliers (id, name) values ($1, $2)", [SUPPLIER_ID, "العالميه للزجاج"]);
  return db;
}

test("integrity migration preserves 13 rows and separates manual status from receipt progress", async () => {
  const db = await createFixtureDatabase();
  const quantities = [1, 1, 2, 4, 4, 2, 5, 22, 3, 2, 2, 1, 4];
  const rows = quantities.map((quantity, index) => rowPayload(index + 1, quantity));
  try {
    const saved = await db.query(
      "select public.save_glass_order_atomic($1::jsonb, $2::jsonb) as result",
      [JSON.stringify(orderPayload(13)), JSON.stringify(rows)]
    );
    assert.equal(saved.rows[0].result.persisted_rows, 13);
    assert.equal(saved.rows[0].result.persisted_row_ids.length, 13);

    await assert.rejects(
      db.query(
        "select public.save_glass_order_atomic($1::jsonb, $2::jsonb)",
        [JSON.stringify(orderPayload(1)), JSON.stringify([rows[0]])]
      ),
      /ORDER_VALIDATION_FAILED/
    );
    const afterRejectedSave = await db.query(
      "select count(*)::integer as count, sum(quantity)::integer as pieces from glass_order_rows where order_id = $1",
      [ORDER_ID]
    );
    assert.deepEqual(afterRejectedSave.rows[0], { count: 13, pieces: 53 });

    await db.query(
      "select public.update_order_status($1, $2, $3, $4, $5)",
      [ORDER_ID, "GO-001289", "collected", "0.1.10", "test"]
    );
    const statusOnly = await db.query(
      "select status, collected_pieces, (select count(*) from glass_order_rows where order_id = glass_orders.id)::integer as row_count from glass_orders where id = $1",
      [ORDER_ID]
    );
    assert.equal(statusOnly.rows[0].status, "collected");
    assert.equal(Number(statusOnly.rows[0].collected_pieces), 0);
    assert.equal(statusOnly.rows[0].row_count, 13);

    await db.query(
      "select public.apply_order_receipts($1, $2, $3::jsonb, $4, $5)",
      [ORDER_ID, 1, JSON.stringify([{ id: rows[0].id, received_quantity: 1, receipt_history: [{ operationId: "receipt-1" }] }]), "0.1.10", "test"]
    );
    const afterReceipt = await db.query(
      "select status, collected_pieces from glass_orders where id = $1",
      [ORDER_ID]
    );
    assert.equal(afterReceipt.rows[0].status, "collected", "receipt progress must not overwrite manual status");
    assert.equal(Number(afterReceipt.rows[0].collected_pieces), 1);

    const statusRevision = await db.query(
      "select id from order_revisions where order_id = $1 and change_type = 'status_update' order by revision_number desc limit 1",
      [ORDER_ID]
    );
    await db.query(
      "select public.restore_order_revision($1, $2, $3)",
      [statusRevision.rows[0].id, "0.1.10", "test"]
    );
    const restored = await db.query(
      "select status, collected_pieces, (select count(*) from glass_order_rows where order_id = glass_orders.id)::integer as row_count from glass_orders where id = $1",
      [ORDER_ID]
    );
    assert.equal(restored.rows[0].status, "ready");
    assert.equal(Number(restored.rows[0].collected_pieces), 0);
    assert.equal(restored.rows[0].row_count, 13);

    const auditCounts = await db.query(`
      select
        (select count(*)::integer from order_revisions where order_id = $1) as revisions,
        (select count(*)::integer from order_row_audit where order_id = $1) as row_audits
    `, [ORDER_ID]);
    assert.ok(auditCounts.rows[0].revisions >= 3);
    assert.ok(auditCounts.rows[0].row_audits >= 14);
  } finally {
    await db.close();
  }
});

test("integrity migration remains compatible with deployed text identifiers", async () => {
  const db = await createFixtureDatabase("text");
  const rows = Array.from({ length: 13 }, (_, index) => rowPayload(index + 1, index === 7 ? 22 : 1));
  try {
    const saved = await db.query(
      "select public.save_glass_order_atomic($1::jsonb, $2::jsonb) as result",
      [JSON.stringify(orderPayload(13)), JSON.stringify(rows)]
    );
    assert.equal(saved.rows[0].result.persisted_rows, 13);
    const loaded = await db.query("select count(*)::integer as count from glass_order_rows where order_id = $1", [ORDER_ID]);
    assert.equal(loaded.rows[0].count, 13);
  } finally {
    await db.close();
  }
});
