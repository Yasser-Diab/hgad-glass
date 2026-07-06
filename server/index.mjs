import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import XLSX from "xlsx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dataDir = process.env.GLASS_ORDERS_DATA_DIR || path.join(root, "data", "local-pg");
const workbookPath = process.env.GLASS_ORDERS_WORKBOOK_PATH || path.join(root, "طلب شراء زجاج.xlsm");
const port = Number(process.env.GLASS_ORDERS_PORT || 4197);
const orderPrefix = "GO-";
const orderSequenceWidth = 6;
fs.mkdirSync(dataDir, { recursive: true });
const db = new PGlite(dataDir);
const app = express();
let telegramBotProcess = null;
const telegramBotLogs = [];

app.use(cors({ origin: true }));
app.use(express.json({ limit: "25mb" }));

const gid = (prefix = "id") => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
const clean = (value) => String(value ?? "").trim();
const num = (value, fallback = 0) => {
  const n = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
};

function displayOrderNo(value) {
  const match = String(value || "").match(/GO-\s*(\d+)/i) || String(value || "").match(/^(\d+)$/);
  const sequence = match ? Number(match[1]) : null;
  if (!Number.isFinite(sequence)) return `${orderPrefix}${String(1).padStart(orderSequenceWidth, "0")}`;
  return `${orderPrefix}${String(sequence).padStart(orderSequenceWidth, "0")}`;
}

function pushBotLog(line) {
  const text = String(line || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd();
  if (!text) return;
  for (const part of text.split("\n")) {
    telegramBotLogs.push(`[${new Date().toLocaleTimeString()}] ${part}`);
  }
  if (telegramBotLogs.length > 500) telegramBotLogs.shift();
}

function telegramBotStatus() {
  return {
    running: !!(telegramBotProcess && !telegramBotProcess.killed),
    pid: telegramBotProcess?.pid || null,
    logs: telegramBotLogs
  };
}

function startTelegramBot(options = {}) {
  if (telegramBotProcess && !telegramBotProcess.killed) return telegramBotStatus();
  const script = path.join(root, "server", "telegramBot.mjs");
  const runtime = process.execPath;
  const unpackedRoot = root.endsWith("app.asar") ? root.replace(/app\.asar$/, "app.asar.unpacked") : root;
  const botDir = process.env.GLASS_ORDERS_BOT_DIR || path.join(unpackedRoot, "telegram_excel_bot");
  pushBotLog(`Starting Telegram bot: ${script}`);
  pushBotLog(`Using helper runtime ${runtime}`);
  if (!fs.existsSync(script)) {
    pushBotLog(`Telegram bot script was not found: ${script}`);
    return telegramBotStatus();
  }
  if (!fs.existsSync(botDir)) {
    pushBotLog(`Telegram bot assets folder was not found: ${botDir}`);
    return telegramBotStatus();
  }
  try {
    telegramBotProcess = spawn(runtime, [script], {
      cwd: path.dirname(runtime),
      windowsHide: true,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        GLASS_ORDERS_BOT_DIR: botDir,
        GLASS_ORDERS_WORKBOOK_PATH: process.env.GLASS_ORDERS_WORKBOOK_PATH || workbookPath,
        EXCEL_FILE: process.env.EXCEL_FILE || workbookPath,
        VITE_SUPABASE_URL: options.supabaseUrl || process.env.VITE_SUPABASE_URL || "",
        VITE_SUPABASE_ANON_KEY: options.supabaseKey || process.env.VITE_SUPABASE_ANON_KEY || ""
      }
    });
  } catch (error) {
    pushBotLog(`Telegram bot failed to start: ${error.message}`);
    telegramBotProcess = null;
    return telegramBotStatus();
  }
  telegramBotProcess.stdout.on("data", (data) => pushBotLog(data));
  telegramBotProcess.stderr.on("data", (data) => pushBotLog(data));
  telegramBotProcess.on("error", (error) => {
    pushBotLog(`Telegram bot failed to start: ${error.message}`);
    telegramBotProcess = null;
  });
  telegramBotProcess.on("exit", (code) => {
    pushBotLog(`Telegram bot stopped with code ${code}`);
    telegramBotProcess = null;
  });
  return telegramBotStatus();
}

function stopTelegramBot() {
  if (telegramBotProcess && !telegramBotProcess.killed) {
    pushBotLog("Stopping Telegram bot...");
    telegramBotProcess.kill();
  }
  return telegramBotStatus();
}
const statusAliases = {
  open: "fabrication",
  pending: "ordered",
  received: "collected",
  closed: "collected",
  done: "collected",
  cancelled: "cancelled",
  canceled: "cancelled",
  quote: "pricing",
  priced: "pricing"
};

function normalizeOrderStatus(value) {
  const raw = clean(value || "ordered").toLowerCase();
  const allowed = ["ordered", "fabrication", "ready", "partial", "collected", "pricing", "cancelled", "draft"];
  return allowed.includes(raw) ? raw : (statusAliases[raw] || "ordered");
}

function isoDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  const date = new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString().slice(0, 10) : date.toISOString().slice(0, 10);
}

function glassParts(value = "") {
  const text = clean(value);
  const thickness = text.match(/(\d+(?:\.\d+)?)\s*مم/)?.[0]?.replace(/\s+/g, "") || "6مم";
  const secure = /سيكوريت/.test(text);
  let glassType = "شفاف";
  for (const candidate of ["عاكس رمادي", "عاكس ازرق", "عاكس أزرق", "بيرسول جراي", "فاميه بني", "أزرق", "ازرق", "أخضر", "اخضر", "برونز", "شفاف"]) {
    if (text.includes(candidate)) {
      glassType = candidate.replace("ازرق", "أزرق").replace("اخضر", "أخضر");
      break;
    }
  }
  return { thickness, secure, glassType };
}

function normExcelStatus(typeText = "", value = "") {
  const type = clean(typeText);
  if (/تسعير|price|quote/i.test(type)) return "pricing";
  if (value === false || String(value).toLowerCase() === "false" || value === 0 || String(value) === "0") return "fabrication";
  if (value === true || String(value).toLowerCase() === "true" || value === 1 || String(value) === "1") return "collected";
  return "ordered";
}

function rowArea(row) {
  const widest = Math.max(0, ...(row.layers || []).map((layer) => num(layer.width)));
  const tallest = Math.max(0, ...(row.layers || []).map((layer) => num(layer.height)));
  return (widest * tallest * num(row.quantity, 1)) / 10000;
}

function layerArea(layer, quantity = 1) {
  return (num(layer.width) * num(layer.height) * num(quantity, 1)) / 10000;
}

function layerPerimeter(layer, quantity = 1) {
  return ((num(layer.width) + num(layer.height)) * 2 * num(quantity, 1)) / 100;
}

function rowTotals(row) {
  const area = rowArea(row);
  const quantity = num(row.quantity, 1);
  const layerSale = (row.layers || []).reduce((sum, layer) => sum + layerArea(layer, quantity) * num(layer.unitPrice, num(row.unitPrice)), 0);
  const layerCost = (row.layers || []).reduce((sum, layer) => sum + layerArea(layer, quantity) * num(layer.supplierUnitPrice, num(row.supplierUnitPrice)), 0);
  const materialBase = row.glassMode === "double" ? layerPerimeter(row.layers?.[0] || {}, quantity) : row.glassMode === "triplex" ? area : 0;
  return {
    area,
    total: layerSale + materialBase * num(row.materialUnitPrice),
    supplierCost: layerCost + materialBase * num(row.supplierMaterialUnitPrice)
  };
}

function publicUser(row) {
  if (!row) return null;
  const { password, ...user } = row;
  return user;
}

async function migrate() {
  await db.exec(`
    create table if not exists users (id text primary key, username text not null unique, email text unique, auth_user_id text unique, display_name text not null, role text not null default 'user', password text not null default '', is_active boolean not null default true, last_login_at text, created_at text not null default current_timestamp);
    create table if not exists customers (id text primary key, name text not null unique, phone text, email text, address text, tax_no text, notes text, created_at text not null default current_timestamp);
    create table if not exists suppliers (id text primary key, name text not null unique, phone text, email text, address text, notes text, opening_balance real not null default 0, created_at text not null default current_timestamp);
    create table if not exists supplier_payments (id text primary key, supplier_id text, supplier_name text, paid_at text not null, amount real not null default 0, method text, notes text, created_at text not null default current_timestamp);
    create table if not exists glass_orders (id text primary key, order_no text not null unique, document_id text, order_date text not null, entry_at text, status text not null default 'draft', entry_mode text not null default 'normal', collected_pieces real not null default 0, customer_name text, supplier_name text, project text, code text, notes text, created_at text not null default current_timestamp, updated_at text not null default current_timestamp);
    create table if not exists glass_order_rows (id text primary key, order_id text not null, line_no integer not null default 1, glass_mode text not null default 'single', quantity real not null default 1, unit_price real not null default 0, supplier_unit_price real not null default 0, material_unit_price real not null default 0, supplier_material_unit_price real not null default 0, double_gap text, triplex_pvb text, extra_direction text, notes text, layers text not null, drawing text not null, area_m2 real not null default 0, cost real not null default 0, supplier_cost real not null default 0, created_at text not null default current_timestamp);
    create table if not exists learned_options (id text primary key, kind text not null, value text not null, unique(kind, value));
    alter table glass_order_rows add column if not exists material_unit_price real not null default 0;
    alter table glass_order_rows add column if not exists supplier_material_unit_price real not null default 0;
    alter table glass_order_rows add column if not exists notes text;
    alter table glass_orders add column if not exists entry_at text;
    alter table glass_orders add column if not exists collected_pieces real not null default 0;
    alter table users add column if not exists email text;
    alter table users add column if not exists auth_user_id text;
    alter table users alter column password set default '';
  `);
  await db.query(
    "insert into users (id, username, display_name, role, password) values ($1, 'admin', 'Yasser Diab', 'admin', '23320001') on conflict (username) do nothing",
    [gid("usr")]
  );
}

async function ensureParty(table, name) {
  if (!name) return null;
  const existing = await db.query(`select * from ${table} where name = $1 limit 1`, [name]);
  if (existing.rows[0]) return existing.rows[0];
  const row = { id: gid(table.slice(0, 3)), name };
  await db.query(`insert into ${table} (id, name) values ($1, $2) on conflict (name) do nothing`, [row.id, name]);
  return row;
}

async function bootstrap() {
  const [customers, suppliers, payments, users, orders, rows, options] = await Promise.all([
    db.query("select * from customers order by name"),
    db.query("select * from suppliers order by name"),
    db.query("select * from supplier_payments order by paid_at desc"),
    db.query("select id, username, email, auth_user_id, display_name, role, is_active, last_login_at, created_at from users order by created_at, username"),
    db.query("select * from glass_orders order by order_date desc, order_no desc"),
    db.query("select * from glass_order_rows order by line_no"),
    db.query("select * from learned_options where kind = 'double_gap'")
  ]);
  const byOrder = new Map();
  for (const row of rows.rows) {
    const item = {
      id: row.id,
      glassMode: row.glass_mode,
      quantity: row.quantity,
      unitPrice: row.unit_price,
      supplierUnitPrice: row.supplier_unit_price,
      materialUnitPrice: row.material_unit_price,
      supplierMaterialUnitPrice: row.supplier_material_unit_price,
      doubleGap: row.double_gap || "فراغ 6مم",
      triplexPvb: row.triplex_pvb || "0.76 PVB",
      extraDirection: row.extra_direction || "في المنتصف تماماً",
      notes: row.notes || "",
      layers: JSON.parse(row.layers || "[]"),
      drawing: JSON.parse(row.drawing || "{\"shapes\":[],\"paths\":[]}")
    };
    if (!byOrder.has(row.order_id)) byOrder.set(row.order_id, []);
    byOrder.get(row.order_id).push(item);
  }
  return {
    customers: customers.rows,
    suppliers: suppliers.rows,
    payments: payments.rows,
    users: users.rows,
    learnedOptions: [...new Set([...options.rows.map((item) => item.value), "فراغ 6مم", "فراغ 9مم", "فراغ 12مم", "فراغ 16مم", "فراغ 20مم"])],
    orders: orders.rows.map((order) => ({
      id: order.id,
      orderNo: order.order_no,
      documentId: order.document_id || "",
      date: order.order_date,
      entryAt: order.entry_at || "",
      status: normalizeOrderStatus(order.status),
      collectedPieces: num(order.collected_pieces),
      entryMode: order.entry_mode,
      customerName: order.customer_name || "",
      supplierName: order.supplier_name || "",
      project: order.project || "",
      code: order.code || "",
      notes: order.notes || "",
      rows: byOrder.get(order.id) || []
    }))
  };
}

async function saveOrder(order, shouldBootstrap = true) {
  const orderId = order.id || gid("ord");
  const customerName = clean(order.customerName);
  const supplierName = clean(order.supplierName);
  const entryAt = order.entryAt === "" ? null : (order.entryAt || new Date().toISOString());
  const status = normalizeOrderStatus(order.status);
  await ensureParty("customers", customerName);
  await ensureParty("suppliers", supplierName);
  await db.query(
    `insert into glass_orders (id, order_no, document_id, order_date, entry_at, status, entry_mode, collected_pieces, customer_name, supplier_name, project, code, notes, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,current_timestamp)
     on conflict (order_no) do update set document_id=excluded.document_id, order_date=excluded.order_date, entry_at=coalesce(glass_orders.entry_at, excluded.entry_at), status=excluded.status, entry_mode=excluded.entry_mode, collected_pieces=excluded.collected_pieces, customer_name=excluded.customer_name, supplier_name=excluded.supplier_name, project=excluded.project, code=excluded.code, notes=excluded.notes, updated_at=current_timestamp`,
    [orderId, order.orderNo, order.documentId || null, order.date, entryAt, status, order.entryMode || "normal", num(order.collectedPieces), customerName, supplierName, order.project || "", order.code || "", order.notes || ""]
  );
  const saved = await db.query("select id from glass_orders where order_no = $1", [order.orderNo]);
  const savedId = saved.rows[0]?.id || orderId;
  await db.query("delete from glass_order_rows where order_id = $1", [savedId]);
  for (const [index, row] of (order.rows || []).entries()) {
    const totals = rowTotals(row);
    const unitPrice = num(row.unitPrice);
    const supplierUnitPrice = num(row.supplierUnitPrice);
    const materialUnitPrice = num(row.materialUnitPrice);
    const supplierMaterialUnitPrice = num(row.supplierMaterialUnitPrice);
    await db.query(
      `insert into glass_order_rows (id, order_id, line_no, glass_mode, quantity, unit_price, supplier_unit_price, material_unit_price, supplier_material_unit_price, double_gap, triplex_pvb, extra_direction, notes, layers, drawing, area_m2, cost, supplier_cost)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [row.id || gid("row"), savedId, index + 1, row.glassMode || "single", num(row.quantity, 1), unitPrice, supplierUnitPrice, materialUnitPrice, supplierMaterialUnitPrice, row.doubleGap || null, row.triplexPvb || null, row.extraDirection || null, row.notes || "", JSON.stringify(row.layers || []), JSON.stringify(row.drawing || { shapes: [], paths: [], edges: { top: 0, right: 0, bottom: 0, left: 0 } }), totals.area, totals.total, totals.supplierCost]
    );
  }
  return shouldBootstrap ? bootstrap() : null;
}

async function deleteOrder(identifier) {
  const key = clean(identifier);
  if (!key) throw new Error("لا يوجد رقم طلب صالح للحذف.");
  const existing = await db.query("select id from glass_orders where id = $1 or order_no = $1 limit 1", [key]);
  const orderId = existing.rows[0]?.id;
  if (!orderId) throw new Error("الطلب غير موجود.");
  await db.query("delete from glass_order_rows where order_id = $1", [orderId]);
  await db.query("delete from glass_orders where id = $1", [orderId]);
  return bootstrap();
}

async function importExcel(filePath = workbookPath) {
  await db.exec("delete from glass_order_rows; delete from glass_orders; delete from customers; delete from suppliers;");
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sheet = workbook.Sheets["الادخال"];
  if (!sheet) throw new Error("لم أجد شيت الادخال داخل ملف الإكسل.");
  const records = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  const grouped = new Map();
  for (const source of records) {
    const customerName = clean(source["العميل"]);
    const supplierName = clean(source["المورد"]);
    const glassText = clean(source["نوع الزجاج"]);
    const width = num(source["العرض"]);
    const height = num(source["الطول"]);
    const quantity = num(source["العدد"], 1);
    if (!customerName && !supplierName && !glassText) continue;
    if (!width || !height || !quantity) continue;
    const date = isoDate(source["التاريخ"]);
    const documentId = clean(source["رقم الاذن"]);
    const serial = clean(source["ر"]);
    const key = `${documentId || serial || "NOID"}|${customerName}|${supplierName}|${date}`;
    const typeText = clean(source["نوع الطلب"]);
    const excelStatus = source["حالة الاوردرات"];
    const importedStatus = normExcelStatus(typeText, excelStatus);
    if (!grouped.has(key)) {
      grouped.set(key, {
        orderNo: displayOrderNo(grouped.size + 1),
        documentId,
        date,
        entryAt: "",
        status: importedStatus,
        entryMode: "normal",
        customerName,
        supplierName,
        project: clean(source["المشروع"]),
        code: clean(source["الكود"]),
        notes: "Imported from Excel",
        rows: []
      });
    }
    const glass = glassParts(glassText);
    const price = num(source["سعر المتر"]);
    const area = num(source["المساحة"]);
    const cost = num(source["التكلفة"]);
    const notes = clean(source["ملاحظات"] || source["ملحوظات"] || source["Notes"]);
    grouped.get(key).rows.push({
      id: gid("row"),
      glassMode: "single",
      quantity,
      unitPrice: price,
      supplierUnitPrice: price || (cost && area ? cost / area : 0),
      materialUnitPrice: num(source["سعر التدبيل"]),
      supplierMaterialUnitPrice: 0,
      doubleGap: "فراغ 6مم",
      triplexPvb: "0.76 PVB",
      extraDirection: "في المنتصف تماماً",
      notes,
      layers: [{ width, height, glassType: glass.glassType, company: "Saint-Gobain®", thickness: glass.thickness, unitPrice: price, supplierUnitPrice: price || (cost && area ? cost / area : 0), secure: glass.secure, color: "#9fd3ff", mirror: false, offsetX: 0, offsetY: 0 }],
      drawing: { shapes: [], paths: [], edges: { top: 0, right: 0, bottom: 0, left: 0 } }
    });
  }
  let importedOrders = 0;
  let importedRows = 0;
  for (const order of grouped.values()) {
    await saveOrder(order, false);
    importedOrders += 1;
    importedRows += order.rows.length;
  }
  const snapshot = await bootstrap();
  const exportDir = path.dirname(dataDir);
  fs.mkdirSync(exportDir, { recursive: true });
  const snapshotPath = path.join(exportDir, "glass-orders-local-db.json");
  const manifestPath = path.join(exportDir, "LOCAL_DATABASE.txt");
  fs.writeFileSync(
    snapshotPath,
    JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        sourceExcel: filePath,
        databasePath: dataDir,
        importedOrders,
        importedRows,
        ...snapshot
      },
      null,
      2
    ),
    "utf8"
  );
  fs.writeFileSync(
    manifestPath,
    [
      "Glass Orders local database",
      `PGlite database folder: ${dataDir}`,
      `Readable imported-data snapshot: ${snapshotPath}`,
      `Source Excel file: ${filePath}`,
      `Imported orders: ${importedOrders}`,
      `Imported rows: ${importedRows}`,
      `Last import: ${new Date().toISOString()}`
    ].join("\n"),
    "utf8"
  );
  return { importedOrders, importedRows, filePath, databasePath: dataDir, snapshotPath, manifestPath };
}

await migrate();

app.get("/api/health", (_req, res) => res.json({ ok: true, port, database: dataDir, workbookPath }));
app.post("/api/auth/login", async (req, res) => {
  try {
    const username = clean(req.body?.username);
    const password = String(req.body?.password || "");
    const result = await db.query("select id, username, email, auth_user_id, display_name, role, password, is_active from users where username = $1 limit 1", [username]);
    const user = result.rows[0];
    if (!user || user.password !== password || user.is_active === false) return res.status(401).json({ error: "بيانات الدخول غير صحيحة." });
    await db.query("update users set last_login_at = current_timestamp where id = $1", [user.id]);
    res.json({ user: { id: user.id, username: user.username, email: user.email || "", auth_user_id: user.auth_user_id || "", display_name: user.display_name, role: user.role } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.get("/api/bootstrap", async (_req, res) => {
  try { res.json(await bootstrap()); } catch (error) { res.status(500).json({ error: error.message }); }
});
app.get("/api/users", async (_req, res) => {
  try {
    const result = await db.query("select id, username, email, auth_user_id, display_name, role, is_active, last_login_at, created_at from users order by created_at, username");
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});
app.post("/api/users", async (req, res) => {
  try {
    const user = req.body || {};
    const username = clean(user.username);
    const displayName = clean(user.display_name);
    const email = clean(user.email).toLowerCase();
    const password = String(user.password || "");
    if (!username || !displayName || !password) return res.status(400).json({ error: "اكتب اسم الدخول والاسم وكلمة المرور." });
    const id = gid("usr");
    await db.query(
      "insert into users (id, username, email, display_name, role, password, is_active) values ($1,$2,$3,$4,$5,$6,$7)",
      [id, username, email || null, displayName, user.role === "admin" ? "admin" : "user", password, user.is_active === false ? false : true]
    );
    const saved = await db.query("select id, username, email, auth_user_id, display_name, role, is_active, last_login_at, created_at from users where id = $1", [id]);
    res.json(saved.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});
app.put("/api/users/:id", async (req, res) => {
  try {
    const existing = await db.query("select * from users where id = $1 limit 1", [req.params.id]);
    if (!existing.rows[0]) return res.status(404).json({ error: "المستخدم غير موجود." });
    const body = req.body || {};
    const next = {
      username: clean(body.username || existing.rows[0].username),
      email: clean(body.email || existing.rows[0].email).toLowerCase() || null,
      auth_user_id: clean(body.auth_user_id || existing.rows[0].auth_user_id) || null,
      display_name: clean(body.display_name || existing.rows[0].display_name),
      role: body.role === "admin" ? "admin" : "user",
      password: body.password ? String(body.password) : existing.rows[0].password,
      is_active: body.is_active === undefined ? existing.rows[0].is_active !== false : !!body.is_active
    };
    await db.query(
      "update users set username=$1, email=$2, auth_user_id=$3, display_name=$4, role=$5, password=$6, is_active=$7 where id=$8",
      [next.username, next.email, next.auth_user_id, next.display_name, next.role, next.password, next.is_active, req.params.id]
    );
    const saved = await db.query("select id, username, email, auth_user_id, display_name, role, is_active, last_login_at, created_at from users where id = $1", [req.params.id]);
    res.json(saved.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});
app.delete("/api/users/:id/hard", async (req, res) => {
  try {
    await db.query("delete from users where id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});
app.delete("/api/users/:id", async (req, res) => {
  try {
    await db.query("update users set is_active = false where id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});
app.put("/api/users/:id/password", async (req, res) => {
  try {
    const currentPassword = String(req.body?.current_password || "");
    const newPassword = String(req.body?.new_password || "");
    const result = await db.query("select * from users where id = $1 limit 1", [req.params.id]);
    const user = result.rows[0];
    if (!user || user.password !== currentPassword) return res.status(401).json({ error: "كلمة المرور الحالية غير صحيحة." });
    if (!newPassword) return res.status(400).json({ error: "اكتب كلمة المرور الجديدة." });
    await db.query("update users set password = $1 where id = $2", [newPassword, req.params.id]);
    res.json({ ok: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});
app.post("/api/orders", async (req, res) => {
  try { res.json(await saveOrder(req.body)); } catch (error) { res.status(500).json({ error: error.message }); }
});
app.delete("/api/orders/:id", async (req, res) => {
  try { res.json(await deleteOrder(req.params.id)); } catch (error) { res.status(500).json({ error: error.message }); }
});
app.post("/api/payments", async (req, res) => {
  try {
    const p = req.body || {};
    await db.query("insert into supplier_payments (id, supplier_id, supplier_name, paid_at, amount, method, notes) values ($1,$2,$3,$4,$5,$6,$7)", [gid("pay"), p.supplier_id || null, p.supplier_name || null, p.paid_at || new Date().toISOString().slice(0, 10), num(p.amount), p.method || "", p.notes || ""]);
    res.json(await bootstrap());
  } catch (error) { res.status(500).json({ error: error.message }); }
});
app.put("/api/payments/:id", async (req, res) => {
  try {
    const p = req.body || {};
    await db.query(
      "update supplier_payments set supplier_id=$1, supplier_name=$2, paid_at=$3, amount=$4, method=$5, notes=$6 where id=$7",
      [p.supplier_id || null, p.supplier_name || null, p.paid_at || new Date().toISOString().slice(0, 10), num(p.amount), p.method || "", p.notes || "", req.params.id]
    );
    res.json(await bootstrap());
  } catch (error) { res.status(500).json({ error: error.message }); }
});
app.delete("/api/payments/:id", async (req, res) => {
  try {
    await db.query("delete from supplier_payments where id = $1", [req.params.id]);
    res.json(await bootstrap());
  } catch (error) { res.status(500).json({ error: error.message }); }
});
app.get("/api/telegram-bot/status", (_req, res) => {
  res.json(telegramBotStatus());
});
app.post("/api/telegram-bot/start", (req, res) => {
  try { res.json(startTelegramBot(req.body || {})); } catch (error) { res.status(500).json({ error: error.message, logs: telegramBotLogs }); }
});
app.post("/api/telegram-bot/stop", (_req, res) => {
  try { res.json(stopTelegramBot()); } catch (error) { res.status(500).json({ error: error.message, logs: telegramBotLogs }); }
});
app.post("/api/import/excel", async (req, res) => {
  try { res.json(await importExcel(req.body?.filePath || workbookPath)); } catch (error) { res.status(500).json({ error: error.message }); }
});

process.on("exit", () => {
  if (telegramBotProcess && !telegramBotProcess.killed) telegramBotProcess.kill();
});

app.listen(port, "127.0.0.1", () => console.log(`Glass Orders local server: http://127.0.0.1:${port}`));
