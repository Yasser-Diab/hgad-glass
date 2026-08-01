import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const repairMigration = readFileSync(
  new URL("../supabase/migrations/20260801143000_repair_order_identifier_type_alignment.sql", import.meta.url),
  "utf8"
);

function orderPayload(id, orderNo) {
  return {
    id,
    order_no: orderNo,
    document_id: null,
    order_date: "2026-08-01",
    entry_at: null,
    status: "ordered",
    collected_pieces: 0,
    entry_mode: "normal",
    customer_id: null,
    supplier_id: null,
    customer_name: "عميل اختبار",
    supplier_name: "مورد اختبار",
    project: "اختبار توافق المعرفات",
    code: "",
    notes: "بيانات عربية محفوظة بالكامل",
    totals: { total: 20, supplierCost: 10 }
  };
}

function rowPayload(id, orderId) {
  return {
    id,
    order_id: orderId,
    line_no: 1,
    glass_mode: "single",
    code: "LEGACY-ROW",
    description: "زجاج شفاف 6 مم",
    quantity: 2,
    unit_price: 10,
    supplier_unit_price: 5,
    material_unit_price: 0,
    supplier_material_unit_price: 0,
    double_gap: null,
    triplex_pvb: null,
    extra_direction: null,
    notes: "سطر بمعرف نصي قديم",
    received_quantity: 0,
    receipt_history: [],
    layers: [],
    drawing: {},
    area_m2: 1,
    cost: 20,
    supplier_cost: 10
  };
}

test("deployed text identifiers save and receive atomically without text = uuid", async () => {
  const db = new PGlite();
  await db.exec(`
    create schema app_private;
    create role anon;
    create role authenticated;
    create function app_private.current_user_is_active()
    returns boolean language sql stable as 'select true';

    create table public.glass_orders (
      id text primary key,
      order_no text not null unique,
      document_id text,
      order_date date not null,
      entry_at timestamptz,
      status text not null,
      collected_pieces numeric not null default 0,
      entry_mode text not null,
      customer_id text,
      supplier_id text,
      customer_name text,
      supplier_name text,
      project text,
      code text,
      notes text,
      totals jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table public.glass_order_rows (
      id text primary key,
      order_id text not null references public.glass_orders(id) on delete cascade,
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

  try {
    await db.exec(repairMigration);

    const signatures = await db.query(`
      select pg_get_function_identity_arguments(p.oid) as arguments
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'apply_order_receipt_status'
    `);
    assert.deepEqual(signatures.rows, [{
      arguments: "p_order_id text, p_document_id text, p_status text, p_collected_pieces numeric, p_rows jsonb"
    }]);

    const orderId = "legacy-order-1690123456789";
    const rowId = "legacy-row-1690123456789";
    const saveResult = await db.query(
      "select public.save_glass_order_atomic($1::jsonb, $2::jsonb) as result",
      [
        JSON.stringify(orderPayload(orderId, "GO-HOTFIX-001")),
        JSON.stringify([rowPayload(rowId, orderId)])
      ]
    );
    assert.equal(saveResult.rows[0].result.id, orderId);

    const receiptHistory = [{
      operationId: "receipt-hotfix-1",
      glassType: "زجاج شفاف 6 مم",
      quantityReceivedNow: 1,
      previousReceivedQuantity: 0,
      newReceivedQuantity: 1
    }];
    await db.query(
      "select public.apply_order_receipt_status($1, $2, $3, $4, $5::jsonb)",
      [
        orderId,
        "GO-HOTFIX-001",
        "partial",
        1,
        JSON.stringify([{ id: rowId, received_quantity: 1, receipt_history: receiptHistory }])
      ]
    );

    const persisted = await db.query(`
      select o.id, o.status, o.collected_pieces::text as collected,
             r.id as row_id, r.received_quantity::text as received,
             r.notes
      from public.glass_orders o
      join public.glass_order_rows r on r.order_id = o.id
      where o.id = $1
    `, [orderId]);
    assert.deepEqual(persisted.rows, [{
      id: orderId,
      status: "partial",
      collected: "1",
      row_id: rowId,
      received: "1",
      notes: "سطر بمعرف نصي قديم"
    }]);
  } finally {
    await db.close();
  }
});

test("repair migration derives identifier types and removes obsolete receipt overloads", () => {
  assert.match(repairMigration, /order_id_value public\.glass_orders\.id%type/);
  assert.match(repairMigration, /row_id_value public\.glass_order_rows\.id%type/);
  assert.match(repairMigration, /p_order_id public\.glass_orders\.id%type/);
  assert.match(repairMigration, /drop function if exists public\.apply_order_receipt_status\(uuid/);
  assert.match(repairMigration, /drop function if exists public\.apply_order_receipt_status\(text/);
  assert.doesNotMatch(repairMigration, /order_id_value uuid|row_id_value uuid/);
  assert.match(repairMigration, /notify pgrst, 'reload schema'/);
});
