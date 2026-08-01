import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const snapshotSql = readFileSync(
  new URL("../supabase/incident/20260801_pre_hotfix_snapshot.sql", import.meta.url),
  "utf8"
);

test("pre-hotfix incident snapshot is complete, private, and immutable", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema auth;
      create table auth.users (id uuid primary key, email text);
      create schema storage;
      create table storage.objects (id uuid primary key, name text);
      create schema supabase_migrations;
      create table supabase_migrations.schema_migrations (version text primary key);
      create schema app_private;
      create function app_private.fixture() returns boolean language sql as 'select true';

      create table public.glass_orders (
        id text primary key,
        order_no text not null unique,
        customer_name text,
        supplier_name text,
        project text,
        order_date date,
        updated_at timestamptz default now()
      );
      create table public.glass_order_rows (
        id text primary key,
        order_id text not null references public.glass_orders(id),
        line_no integer not null,
        quantity numeric not null,
        area_m2 numeric not null
      );
      insert into public.glass_orders (
        id, order_no, customer_name, supplier_name, project, order_date
      ) values (
        'order-1289', 'GO-001289', 'نيو جيرسي', 'العالميه للزجاج', 'جورا', '2026-07-28'
      );
      insert into public.glass_order_rows (id, order_id, line_no, quantity, area_m2)
      select
        'row-' || source.line_no,
        'order-1289',
        source.line_no,
        source.quantity,
        case when source.line_no = 13 then 22.26315 else 0 end
      from unnest(array[1,1,2,4,4,2,5,22,3,2,2,1,4])
        with ordinality as source(quantity, line_no);
    `);

    await db.exec(snapshotSql);

    const fixture = await db.query(`
      select row_count::integer as row_count, total_pieces::integer as total_pieces,
        total_area_m2::numeric as total_area_m2
      from incident_backup_20260801_pre_hotfix.order_row_counts
      where order_no = 'GO-001289'
    `);
    assert.equal(fixture.rows[0].row_count, 13);
    assert.equal(fixture.rows[0].total_pieces, 53);
    assert.equal(Number(fixture.rows[0].total_area_m2), 22.26315);

    const copied = await db.query(`
      select row_count::integer as row_count
      from incident_backup_20260801_pre_hotfix.source_table_counts
      where source_schema = 'public' and source_table = 'glass_order_rows'
    `);
    assert.equal(copied.rows[0].row_count, 13);

    await assert.rejects(db.exec(snapshotSql), /INCIDENT_SNAPSHOT_ALREADY_EXISTS/);
  } finally {
    await db.close();
  }
});
