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
const apply = process.env.APPLY === "1";

function qi(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`;
}

function tableKey(row) {
  return `${row.table_name}.${row.column_name}`;
}

function toSqlType(col) {
  const dataType = col.data_type;
  const udtName = col.udt_name;

  if (dataType === "ARRAY") {
    if (udtName?.startsWith("_")) {
      return `${udtName.slice(1)}[]`;
    }
    return "text[]";
  }

  if (dataType === "USER-DEFINED") {
    return udtName;
  }

  if (dataType === "character varying") {
    return col.character_maximum_length
      ? `varchar(${col.character_maximum_length})`
      : "varchar";
  }

  if (dataType === "character") {
    return col.character_maximum_length
      ? `char(${col.character_maximum_length})`
      : "char";
  }

  if (dataType === "numeric") {
    if (col.numeric_precision && col.numeric_scale !== null) {
      return `numeric(${col.numeric_precision},${col.numeric_scale})`;
    }

    return "numeric";
  }

  if (dataType === "timestamp with time zone") {
    return "timestamptz";
  }

  if (dataType === "timestamp without time zone") {
    return "timestamp";
  }

  if (dataType === "time with time zone") {
    return "timetz";
  }

  if (dataType === "time without time zone") {
    return "time";
  }

  if (dataType === "double precision") {
    return "double precision";
  }

  if (dataType === "integer") {
    return "integer";
  }

  if (dataType === "bigint") {
    return "bigint";
  }

  if (dataType === "smallint") {
    return "smallint";
  }

  if (dataType === "boolean") {
    return "boolean";
  }

  if (dataType === "date") {
    return "date";
  }

  if (dataType === "json") {
    return "json";
  }

  if (dataType === "jsonb") {
    return "jsonb";
  }

  if (dataType === "uuid") {
    return "uuid";
  }

  if (dataType === "text") {
    return "text";
  }

  return dataType;
}

async function getColumns(db, isRemote = false) {
  const sql = `
    SELECT
      table_name,
      column_name,
      data_type,
      udt_name,
      character_maximum_length,
      numeric_precision,
      numeric_scale,
      datetime_precision,
      is_nullable,
      ordinal_position
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `;

  const result = await db.query(sql);
  return result.rows;
}

async function main() {
  if (!fs.existsSync(pgliteDataDir)) {
    throw new Error(`PGlite folder does not exist: ${pgliteDataDir}`);
  }

  if (!supabaseDbUrl) {
    throw new Error("Missing SUPABASE_DB_URL environment variable.");
  }

  const local = new PGlite(pgliteDataDir);

  const remote = new Client({
    connectionString: supabaseDbUrl,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  await remote.connect();

  try {
    const localColumns = await getColumns(local);
    const remoteColumns = await getColumns(remote, true);

    const remoteSet = new Set(remoteColumns.map(tableKey));

    const remoteTables = new Set(remoteColumns.map((col) => col.table_name));

    const missing = localColumns.filter((col) => {
      if (!remoteTables.has(col.table_name)) return false;
      return !remoteSet.has(tableKey(col));
    });

    if (missing.length === 0) {
      console.log("No missing columns found. Remote schema has all local columns.");
      return;
    }

    console.log("Missing columns found:\n");

    const alterStatements = missing.map((col) => {
      const sqlType = toSqlType(col);

      return `ALTER TABLE public.${qi(col.table_name)} ADD COLUMN ${qi(col.column_name)} ${sqlType};`;
    });

    for (const statement of alterStatements) {
      console.log(statement);
    }

    if (!apply) {
      console.log("\nPreview only. Nothing changed.");
      console.log("Run again with:");
      console.log('$env:APPLY = "1"');
      return;
    }

    console.log("\nApplying missing columns...");

    await remote.query("BEGIN");

    for (const statement of alterStatements) {
      await remote.query(statement);
      console.log(`Applied: ${statement}`);
    }

    await remote.query("COMMIT");

    console.log("\nDone. Missing columns added to Supabase.");
  } catch (error) {
    try {
      await remote.query("ROLLBACK");
    } catch {}

    throw error;
  } finally {
    await local.close();
    await remote.end();
  }
}

main().catch((error) => {
  console.error("\nSchema sync failed:");
  console.error(error);
  process.exit(1);
});
