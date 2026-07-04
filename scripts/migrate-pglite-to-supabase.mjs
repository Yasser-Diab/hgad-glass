import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";

const { Client } = pg;

const rootDir = process.cwd();

const pgliteDataDir =
  process.env.PGLITE_DATA_DIR ||
  path.join(rootDir, "_db-migration", "local-pg-copy");

const supabaseDbUrl = process.env.SUPABASE_DB_URL;
const dryRun = process.env.DRY_RUN === "1";

const excludedTables = new Set(
  (process.env.EXCLUDE_TABLES || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean),
);

const onlyTables = new Set(
  (process.env.ONLY_TABLES || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean),
);

function qi(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`;
}

function fullTableName(schema, table) {
  return `${qi(schema)}.${qi(table)}`;
}

function fullSequenceRegclass(schema, sequence) {
  return `${qi(schema)}.${qi(sequence)}`;
}

function chunkArray(items, size) {
  const chunks = [];

  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }

  return chunks;
}

function topoSortTables(tables, foreignKeys) {
  const tableSet = new Set(tables);
  const deps = new Map();

  for (const table of tables) {
    deps.set(table, new Set());
  }

  for (const fk of foreignKeys) {
    const child = fk.child_table;
    const parent = fk.parent_table;

    if (!tableSet.has(child) || !tableSet.has(parent)) continue;
    if (child === parent) continue;

    deps.get(child).add(parent);
  }

  const result = [];
  const temporary = new Set();
  const permanent = new Set();

  function visit(table) {
    if (permanent.has(table)) return;
    if (temporary.has(table)) return;

    temporary.add(table);

    for (const dep of deps.get(table) || []) {
      visit(dep);
    }

    temporary.delete(table);
    permanent.add(table);
    result.push(table);
  }

  for (const table of tables) {
    visit(table);
  }

  return result;
}

async function getLocalTables(local) {
  const result = await local.query(`
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);

  return result.rows
    .filter((row) => !excludedTables.has(row.table_name))
    .filter((row) => onlyTables.size === 0 || onlyTables.has(row.table_name));
}

async function getLocalColumns(local, tableName) {
  const result = await local.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = $1
    ORDER BY ordinal_position
    `,
    [tableName],
  );

  return result.rows.map((row) => row.column_name);
}

async function getLocalForeignKeys(local) {
  try {
    const result = await local.query(`
      SELECT
        tc.table_name AS child_table,
        ccu.table_name AS parent_table
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
       AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
    `);

    return result.rows;
  } catch {
    return [];
  }
}

async function getLocalRows(local, tableName, columns) {
  const sql = `
    SELECT ${columns.map(qi).join(", ")}
    FROM ${fullTableName("public", tableName)}
  `;

  const result = await local.query(sql);
  return result.rows;
}

async function insertRows(remote, tableName, columns, rows) {
  if (rows.length === 0) return;

  const batchSize = 500;
  const batches = chunkArray(rows, batchSize);

  for (const batch of batches) {
    const values = [];
    const placeholders = [];

    let paramIndex = 1;

    for (const row of batch) {
      const rowPlaceholders = [];

      for (const column of columns) {
        rowPlaceholders.push(`$${paramIndex}`);
        values.push(row[column]);
        paramIndex++;
      }

      placeholders.push(`(${rowPlaceholders.join(", ")})`);
    }

    const sql = `
      INSERT INTO ${fullTableName("public", tableName)}
        (${columns.map(qi).join(", ")})
      VALUES
        ${placeholders.join(",\n")}
      ON CONFLICT DO NOTHING
    `;

    await remote.query(sql, values);
  }
}

async function fixSequences(remote) {
  const result = await remote.query(`
    SELECT
      ns.nspname AS schema_name,
      tbl.relname AS table_name,
      col.attname AS column_name,
      seq.relname AS sequence_name
    FROM pg_class seq
    JOIN pg_namespace ns
      ON ns.oid = seq.relnamespace
    JOIN pg_depend dep
      ON dep.objid = seq.oid
    JOIN pg_class tbl
      ON tbl.oid = dep.refobjid
    JOIN pg_attribute col
      ON col.attrelid = tbl.oid
     AND col.attnum = dep.refobjsubid
    WHERE seq.relkind = 'S'
      AND ns.nspname = 'public'
  `);

  for (const row of result.rows) {
    const maxResult = await remote.query(`
      SELECT COALESCE(MAX(${qi(row.column_name)}), 0)::bigint AS max_value
      FROM ${fullTableName(row.schema_name, row.table_name)}
    `);

    const maxValue = Number(maxResult.rows[0].max_value || 0);
    const sequenceName = fullSequenceRegclass(
      row.schema_name,
      row.sequence_name,
    );

    await remote.query(
      `SELECT setval($1::regclass, GREATEST($2::bigint, 1), true)`,
      [sequenceName, maxValue],
    );

    console.log(
      `Sequence fixed: ${row.sequence_name} → ${Math.max(maxValue, 1)}`,
    );
  }
}

async function main() {
  console.log("PGlite data dir:", pgliteDataDir);

  if (!fs.existsSync(pgliteDataDir)) {
    throw new Error(`PGlite data folder does not exist: ${pgliteDataDir}`);
  }

  if (!dryRun && !supabaseDbUrl) {
    throw new Error("Missing SUPABASE_DB_URL environment variable.");
  }

  const local = new PGlite(pgliteDataDir);

  const remote = dryRun
    ? null
    : new Client({
        connectionString: supabaseDbUrl,
        ssl: {
          rejectUnauthorized: false,
        },
      });

  if (remote) {
    await remote.connect();
  }

  try {
    const tableRows = await getLocalTables(local);
    const tables = tableRows.map((row) => row.table_name);

    if (tables.length === 0) {
      console.log("No public tables found in local PGlite database.");
      return;
    }

    const preferredOrder = [
      "users",
      "customers",
      "suppliers",
      "glass_orders",
      "glass_order_rows",
      "learned_options",
      "supplier_payments",
    ];

    const orderedTables = [
      ...preferredOrder.filter((table) => tables.includes(table)),
      ...tables.filter((table) => !preferredOrder.includes(table)),
    ];

    console.log("\nTables found:");
    for (const table of orderedTables) {
      console.log(`- ${table}`);
    }

    console.log("");

    for (const table of orderedTables) {
      const columns = await getLocalColumns(local, table);
      const rows = await getLocalRows(local, table, columns);

      console.log(`${table}: ${rows.length} rows`);

      if (!dryRun) {
        await insertRows(remote, table, columns, rows);
        console.log(`Imported: ${table}`);
      }
    }

    if (!dryRun) {
      console.log("\nFixing sequences...");
      await fixSequences(remote);

      console.log("\nRunning VACUUM ANALYZE...");
      await remote.query("VACUUM ANALYZE");

      console.log("\nDone. Local PGlite data migrated to Supabase.");
    } else {
      console.log("\nDry run only. Nothing was imported.");
    }
  } finally {
    await local.close();

    if (remote) {
      await remote.end();
    }
  }
}

main().catch((error) => {
  console.error("\nMigration failed:");
  console.error(error);
  process.exit(1);
});
