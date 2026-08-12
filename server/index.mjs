import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import XLSX from "xlsx";
import { validateLocalOrderStatusPatch } from "./orderStatusValidation.mjs";
import { mergeProtectedLocalOrderRows } from "./protectedCostMerge.mjs";
import { validateOrderForSave } from "../src/orderSaveValidation.js";

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
let httpServer = null;
let shuttingDown = false;
let localAdminSetupInProgress = false;
const telegramBotLogs = [];
const localSessions = new Map();
const LOCAL_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

app.use(cors({
  origin(origin, callback) {
    if (!origin || origin === "null" || /^file:\/\//i.test(origin) || /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error("Origin is not allowed by the local API."));
  }
}));
app.use(express.json({ limit: "25mb" }));

const gid = (prefix = "id") => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
const clean = (value) => String(value ?? "").trim();
const normalizedUsername = (value) => clean(value).toLocaleLowerCase();
const httpError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const num = (value, fallback = 0) => {
  if (value === "" || value === null || value === undefined) return fallback;
  const n = Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(n)) throw new Error("قيمة رقمية غير صالحة. راجع الأرقام المدخلة قبل الحفظ.");
  return n;
};
const parseJson = (value, fallback) => {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(value || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
};

function validateLocalPassword(password) {
  const value = String(password || "");
  if (value.length < 10) throw new Error("يجب ألا تقل كلمة المرور عن 10 أحرف.");
  if (value.length > 1024) throw new Error("كلمة المرور أطول من الحد المسموح.");
  return value;
}

function scrypt(password, salt, keyLength = 64, options = {}) {
  return new Promise((resolve, reject) => {
    nodeScrypt(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

async function hashLocalPassword(password) {
  const safePassword = validateLocalPassword(password);
  const salt = randomBytes(16);
  const options = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
  const derivedKey = await scrypt(safePassword, salt, 64, options);
  return `scrypt$${options.N}$${options.r}$${options.p}$${salt.toString("base64")}$${derivedKey.toString("base64")}`;
}

async function verifyLocalPassword(password, encodedHash) {
  try {
    const [algorithm, nText, rText, pText, saltText, hashText] = String(encodedHash || "").split("$");
    if (algorithm !== "scrypt" || !saltText || !hashText) return false;
    const expected = Buffer.from(hashText, "base64");
    if (!expected.length) return false;
    const actual = await scrypt(String(password || ""), Buffer.from(saltText, "base64"), expected.length, {
      N: Number(nText),
      r: Number(rText),
      p: Number(pText),
      maxmem: 64 * 1024 * 1024
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function createLocalSession(user) {
  const token = randomBytes(32).toString("base64url");
  localSessions.set(token, {
    userId: user.id,
    role: user.role,
    canViewCosts: user.role === "admin" || user.can_view_costs === true,
    expiresAt: Date.now() + LOCAL_SESSION_TTL_MS
  });
  return token;
}

function localBearerToken(req) {
  return String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i)?.[1] || "";
}

function authenticatedLocalSession(req) {
  const token = localBearerToken(req);
  const session = token ? localSessions.get(token) : null;
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    localSessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + LOCAL_SESSION_TTL_MS;
  return { token, ...session };
}

function updateLocalSessionsForUser(user) {
  for (const [token, session] of localSessions.entries()) {
    if (session.userId !== user.id) continue;
    if (user.is_active === false) {
      localSessions.delete(token);
      continue;
    }
    session.role = user.role;
    session.canViewCosts = user.role === "admin" || user.can_view_costs === true;
  }
}

function requireLocalAdmin(req, res) {
  if (req.localSession?.role === "admin") return true;
  res.status(403).json({ error: "هذه العملية متاحة لمدير النظام فقط." });
  return false;
}

app.use("/api", (req, res, next) => {
  if (req.path === "/health" || req.path === "/auth/login" || req.path === "/auth/setup") {
    next();
    return;
  }
  const session = authenticatedLocalSession(req);
  if (!session) {
    res.status(401).json({ error: "انتهت جلسة الخادم المحلي. سجّل الدخول مرة أخرى." });
    return;
  }
  req.localSession = session;
  next();
});

function displayOrderNo(value) {
  const match = String(value || "").match(/GO-\s*(\d+)/i) || String(value || "").match(/^(\d+)$/);
  const sequence = match ? Number(match[1]) : null;
  if (!Number.isFinite(sequence)) return `${orderPrefix}${String(1).padStart(orderSequenceWidth, "0")}`;
  return `${orderPrefix}${String(sequence).padStart(orderSequenceWidth, "0")}`;
}

function orderSequence(value) {
  const match = String(value || "").match(/GO-\s*(\d+)/i) || String(value || "").match(/^(\d+)$/);
  const sequence = match ? Number(match[1]) : NaN;
  return Number.isFinite(sequence) ? sequence : NaN;
}

function duplicateOrderNoError(error) {
  return /duplicate key value|unique|order_no|23505/i.test(String(error?.message || error || ""));
}

async function nextOrderNoAfter(value) {
  const sequence = orderSequence(value);
  if (Number.isFinite(sequence)) return displayOrderNo(sequence + 1);
  const result = await db.query("select order_no from glass_orders");
  const maxSequence = result.rows.reduce((max, row) => {
    const next = orderSequence(row.order_no);
    return Number.isFinite(next) ? Math.max(max, next) : max;
  }, 0);
  return displayOrderNo(maxSequence + 1);
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

function terminateChildTree(child, label = "helper") {
  if (!child) return;
  const pid = child.pid;
  try {
    if (!child.killed) child.kill();
  } catch (error) {
    pushBotLog(`Failed to stop ${label}: ${error.message}`);
  }
  if (process.platform === "win32" && pid) {
    try {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true
      });
      killer.once("exit", () => pushBotLog(`${label} process tree ${pid} stopped.`));
      killer.once("error", (error) => pushBotLog(`Failed to taskkill ${label}: ${error.message}`));
    } catch (error) {
      pushBotLog(`Failed to force-stop ${label}: ${error.message}`);
    }
  }
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
        VITE_SUPABASE_ANON_KEY: options.supabaseKey || process.env.VITE_SUPABASE_ANON_KEY || "",
        TELEGRAM_SUPABASE_ACCESS_TOKEN: options.accessToken || "",
        TELEGRAM_SUPABASE_REFRESH_TOKEN: options.refreshToken || ""
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
    terminateChildTree(telegramBotProcess, "Telegram bot");
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
  if ((row.glassMode || "single") === "single" && Array.isArray(row.drawing?.panels) && row.drawing.panels.length) {
    return row.drawing.panels.reduce((sum, panel) => sum + (Math.max(0, num(panel.width)) * Math.max(0, num(panel.height))) / 1000000, 0);
  }
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
  if ((row.glassMode || "single") === "single" && Array.isArray(row.drawing?.panels) && row.drawing.panels.length) {
    const layer = row.layers?.[0] || {};
    const layerSale = area * num(layer.unitPrice, num(row.unitPrice));
    const layerCost = area * num(layer.supplierUnitPrice, num(row.supplierUnitPrice));
    return {
      area,
      total: layerSale,
      supplierCost: layerCost
    };
  }
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

function rowPhysicalQuantity(row) {
  if ((row.glassMode || "single") === "single" && Array.isArray(row.drawing?.panels) && row.drawing.panels.length) {
    return row.drawing.panels.length;
  }
  return num(row.quantity, 1);
}

function publicUser(row) {
  if (!row) return null;
  const { password, password_hash: _passwordHash, ...user } = row;
  return user;
}

async function migrateLegacyLocalPasswords() {
  const columns = await db.query(
    "select column_name from information_schema.columns where table_name = 'users' and column_name in ('password', 'password_hash')"
  );
  const names = new Set(columns.rows.map((row) => row.column_name));
  if (!names.has("password")) return;
  const legacyUsers = await db.query(
    "select id, username, email, auth_user_id, display_name, role, password, password_hash from users"
  );
  for (const user of legacyUsers.rows) {
    const legacyPassword = String(user.password || "");
    const isKnownInsecureSeed = normalizedUsername(user.username) === "admin"
      && user.display_name === "Admin User"
      && user.role === "admin"
      && !clean(user.email)
      && !clean(user.auth_user_id);
    if (isKnownInsecureSeed) {
      await db.query("delete from users where id = $1", [user.id]);
      continue;
    }
    if (!user.password_hash && legacyPassword) {
      const passwordHash = await hashLocalPassword(legacyPassword);
      await db.query("update users set password_hash = $1, password = '' where id = $2", [passwordHash, user.id]);
    }
  }
  await db.exec("alter table users drop column if exists password;");
}

async function bootstrapLocalAdminFromEnvironment() {
  const result = await db.query("select count(*)::integer as count from users");
  if (Number(result.rows[0]?.count || 0) > 0) return;
  const username = clean(process.env.GLASS_ORDERS_ADMIN_USERNAME);
  const password = String(process.env.GLASS_ORDERS_ADMIN_PASSWORD || "");
  if (!username && !password) return;
  if (!username || !password) {
    throw new Error("Set both GLASS_ORDERS_ADMIN_USERNAME and GLASS_ORDERS_ADMIN_PASSWORD for first-run local setup.");
  }
  const passwordHash = await hashLocalPassword(password);
  await db.query(
    "insert into users (id, username, email, display_name, role, password_hash, is_active) values ($1,$2,$3,$4,'admin',$5,true)",
    [
      gid("usr"),
      username,
      clean(process.env.GLASS_ORDERS_ADMIN_EMAIL).toLocaleLowerCase() || null,
      clean(process.env.GLASS_ORDERS_ADMIN_DISPLAY_NAME) || username,
      passwordHash
    ]
  );
}

async function migrate() {
  await db.exec(`
    create table if not exists users (id text primary key, username text not null unique, email text unique, auth_user_id text unique, display_name text not null, role text not null default 'user', can_view_costs boolean not null default false, password_hash text not null default '', is_active boolean not null default true, last_login_at text, created_at text not null default current_timestamp);
    create table if not exists customers (id text primary key, name text not null unique, phone text, email text, address text, tax_no text, notes text, created_at text not null default current_timestamp);
    create table if not exists suppliers (id text primary key, name text not null unique, phone text, email text, address text, notes text, opening_balance real not null default 0, created_at text not null default current_timestamp);
    create table if not exists supplier_payments (id text primary key, supplier_id text, supplier_name text, paid_at text not null, amount real not null default 0, method text, notes text, created_at text not null default current_timestamp);
    create table if not exists glass_orders (id text primary key, order_no text not null unique, document_id text, order_date text not null, entry_at text, status text not null default 'draft', entry_mode text not null default 'normal', collected_pieces real not null default 0, customer_id text, supplier_id text, customer_name text, supplier_name text, project text, code text, notes text, created_at text not null default current_timestamp, updated_at text not null default current_timestamp);
    create table if not exists glass_order_rows (id text primary key, order_id text not null, line_no integer not null default 1, glass_mode text not null default 'single', code text, quantity real not null default 1, unit_price real not null default 0, supplier_unit_price real not null default 0, material_unit_price real not null default 0, supplier_material_unit_price real not null default 0, double_gap text, triplex_pvb text, extra_direction text, notes text, received_quantity real, receipt_history text not null default '[]', layers text not null, drawing text not null, area_m2 real not null default 0, cost real not null default 0, supplier_cost real not null default 0, created_at text not null default current_timestamp);
    create table if not exists learned_options (id text primary key, kind text not null, value text not null, unique(kind, value));
    create table if not exists order_revisions (id text primary key, order_id text not null, revision_number integer not null, snapshot jsonb not null, changed_by text, change_type text not null, app_version text not null default '0.1.12', client_type text not null default 'local-server', created_at text not null default current_timestamp, unique(order_id, revision_number));
    create table if not exists order_row_audit (id text primary key, order_id text not null, row_id text not null, action text not null, previous_value jsonb, new_value jsonb, changed_by text, app_version text not null default '0.1.12', client_type text not null default 'local-server', created_at text not null default current_timestamp);
    create table if not exists order_item_recovery_staging (recovery_id text primary key, order_id text, order_number text, source_type text not null, source_reference text, line_number integer, recovered_payload jsonb not null, reviewed boolean not null default false, applied boolean not null default false, created_at text not null default current_timestamp);
    alter table glass_order_rows add column if not exists material_unit_price real not null default 0;
    alter table glass_order_rows add column if not exists supplier_material_unit_price real not null default 0;
    alter table glass_order_rows add column if not exists notes text;
    alter table glass_order_rows add column if not exists code text;
    alter table glass_order_rows add column if not exists received_quantity real;
    alter table glass_order_rows add column if not exists receipt_history text not null default '[]';
    alter table glass_orders add column if not exists entry_at text;
    alter table glass_orders add column if not exists collected_pieces real not null default 0;
    alter table glass_orders add column if not exists customer_id text;
    alter table glass_orders add column if not exists supplier_id text;
    alter table users add column if not exists email text;
    alter table users add column if not exists auth_user_id text;
    alter table users add column if not exists can_view_costs boolean not null default false;
    alter table users add column if not exists password_hash text not null default '';
  `);
  await migrateLegacyLocalPasswords();
  await bootstrapLocalAdminFromEnvironment();
}

async function captureLocalOrderRevision(orderId, changeType, changedBy = null) {
  if (!orderId) return null;
  const [orderResult, rowsResult, revisionResult] = await Promise.all([
    db.query("select * from glass_orders where id = $1 limit 1", [orderId]),
    db.query("select * from glass_order_rows where order_id = $1 order by line_no, id", [orderId]),
    db.query("select coalesce(max(revision_number), 0)::integer + 1 as next_revision from order_revisions where order_id = $1", [orderId])
  ]);
  const order = orderResult.rows[0];
  if (!order) return null;
  const revisionNumber = Number(revisionResult.rows[0]?.next_revision || 1);
  await db.query(
    `insert into order_revisions (id, order_id, revision_number, snapshot, changed_by, change_type, app_version, client_type)
     values ($1,$2,$3,$4::jsonb,$5,$6,'0.1.12','local-server')`,
    [gid("rev"), orderId, revisionNumber, JSON.stringify({ order, rows: rowsResult.rows }), changedBy, changeType]
  );
  return revisionNumber;
}

async function auditLocalOrderRow(orderId, rowId, action, previousValue, newValue, changedBy = null) {
  if (previousValue && newValue && JSON.stringify(previousValue) === JSON.stringify(newValue)) return;
  await db.query(
    `insert into order_row_audit (id, order_id, row_id, action, previous_value, new_value, changed_by, app_version, client_type)
     values ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,'0.1.12','local-server')`,
    [
      gid("audit"),
      orderId,
      rowId,
      action,
      previousValue == null ? null : JSON.stringify(previousValue),
      newValue == null ? null : JSON.stringify(newValue),
      changedBy
    ]
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

function sanitizeLocalLayers(layers, canViewCosts) {
  const normalized = parseJson(layers, []);
  if (canViewCosts) return normalized;
  return normalized.map((layer) => ({
    ...layer,
    supplierUnitPrice: 0,
    supplier_unit_price: 0
  }));
}

async function bootstrap({ canViewCosts = true } = {}) {
  const [customers, suppliers, payments, users, orders, rows, options] = await Promise.all([
    db.query("select * from customers order by name"),
    db.query("select * from suppliers order by name"),
    db.query("select * from supplier_payments order by paid_at desc"),
    db.query("select id, username, email, auth_user_id, display_name, role, can_view_costs, is_active, last_login_at, created_at from users order by created_at, username"),
    db.query("select * from glass_orders order by order_date desc, order_no desc"),
    db.query("select * from glass_order_rows order by order_id, line_no, id"),
    db.query("select * from learned_options where kind = 'double_gap'")
  ]);
  const byOrder = new Map();
  for (const row of rows.rows) {
    const item = {
      id: row.id,
      code: row.code || "",
      glassMode: row.glass_mode,
      quantity: row.quantity,
      unitPrice: row.unit_price,
      supplierUnitPrice: canViewCosts ? row.supplier_unit_price : 0,
      materialUnitPrice: row.material_unit_price,
      supplierMaterialUnitPrice: canViewCosts ? row.supplier_material_unit_price : 0,
      doubleGap: row.double_gap || "فراغ 6مم",
      triplexPvb: row.triplex_pvb || "0.76 PVB",
      extraDirection: row.extra_direction || "في المنتصف تماماً",
      notes: row.notes || "",
      receivedQuantity: row.received_quantity,
      receiptHistory: parseJson(row.receipt_history, []),
      layers: sanitizeLocalLayers(row.layers, canViewCosts),
      drawing: parseJson(row.drawing, { shapes: [], paths: [] })
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
      customerId: order.customer_id || "",
      customerName: order.customer_name || "",
      supplierId: order.supplier_id || "",
      supplierName: order.supplier_name || "",
      project: order.project || "",
      code: order.code || "",
      notes: order.notes || "",
      rows: byOrder.get(order.id) || []
    }))
  };
}

async function ensureOrderPartyForSave(table, selectedId, selectedName) {
  const name = clean(selectedName);
  if (!name) {
    const error = httpError(table === "customers" ? "يجب اختيار العميل قبل حفظ الطلب." : "يجب اختيار المورد قبل حفظ الطلب.", 422);
    error.code = "ORDER_VALIDATION_FAILED";
    throw error;
  }
  const id = clean(selectedId);
  if (id) {
    const selected = await db.query(`select id, name from ${table} where id = $1 and lower(name) = lower($2) limit 1`, [id, name]);
    if (selected.rows[0]?.id) return selected.rows[0];
  }
  const byName = await db.query(`select id, name from ${table} where lower(name) = lower($1) limit 1`, [name]);
  if (byName.rows[0]?.id) return byName.rows[0];
  const newId = gid(table === "customers" ? "cus" : "sup");
  if (table === "suppliers") {
    await db.query("insert into suppliers (id, name, opening_balance) values ($1, $2, 0)", [newId, name]);
  } else {
    await db.query("insert into customers (id, name) values ($1, $2)", [newId, name]);
  }
  return { id: newId, name };
}

async function saveOrder(order, shouldBootstrap = true, options = {}) {
  const validation = validateOrderForSave(order);
  if (!validation.isValid) {
    const error = httpError("تعذر حفظ الطلب لوجود بيانات مطلوبة غير مكتملة.", 422);
    error.code = "ORDER_VALIDATION_FAILED";
    error.fields = validation.errors;
    throw error;
  }
  const customerName = clean(order.customerName);
  const supplierName = clean(order.supplierName);
  let customerId = clean(order.customerId);
  let supplierId = clean(order.supplierId);
  const entryAt = order.entryAt === "" ? null : (order.entryAt || new Date().toISOString());
  const status = normalizeOrderStatus(order.status);
  const saveAsExisting = order._existingOrder === true;
  const managesTransaction = options.externalTransaction !== true;
  let candidateOrderNo = order.orderNo ? displayOrderNo(order.orderNo) : await nextOrderNoAfter("");
  for (let attempt = 0; attempt < 8; attempt += 1) {
    let savedId = clean(order.id);
    try {
      if (managesTransaction) await db.exec("begin");
      const selectedCustomer = await ensureOrderPartyForSave("customers", customerId, customerName);
      const selectedSupplier = await ensureOrderPartyForSave("suppliers", supplierId, supplierName);
      customerId = selectedCustomer.id;
      supplierId = selectedSupplier.id;
      if (savedId) {
        const byId = await db.query("select id from glass_orders where id = $1 limit 1", [savedId]);
        savedId = byId.rows[0]?.id || "";
      }
      if (!savedId && saveAsExisting && candidateOrderNo) {
        const byOrderNo = await db.query("select id from glass_orders where order_no = $1 limit 1", [candidateOrderNo]);
        savedId = byOrderNo.rows[0]?.id || "";
      }
      if (saveAsExisting && !savedId) {
        if (managesTransaction) await db.exec("rollback");
        throw new Error("تعذر تحديث الطلب لأن السجل الأصلي غير موجود في قاعدة البيانات. لم يتم إنشاء طلب جديد.");
      }
      const duplicate = await db.query("select id from glass_orders where order_no = $1 limit 1", [candidateOrderNo]);
      const duplicateId = duplicate.rows[0]?.id || "";
      if (duplicateId && duplicateId !== savedId) {
        if (!savedId && !saveAsExisting) {
          const rowCheck = await db.query("select id from glass_order_rows where order_id = $1 limit 1", [duplicateId]);
          if (!rowCheck.rows[0]?.id) {
            savedId = duplicateId;
          } else {
            if (managesTransaction) await db.exec("rollback");
            candidateOrderNo = await nextOrderNoAfter(candidateOrderNo);
            continue;
          }
        } else {
          if (managesTransaction) await db.exec("rollback");
          throw new Error("رقم الطلب مستخدم بالفعل في طلب آخر. يرجى اختيار رقم مختلف.");
        }
      }
      let rowsForSave = validation.payloadRows;
      const expectedItemCount = Number(order.expectedItemCount);
      if (!Number.isInteger(expectedItemCount) || expectedItemCount !== rowsForSave.length) {
        const error = httpError("أُلغي حفظ الطلب لأن عدد البنود المرسل غير مكتمل.", 422);
        error.code = "ORDER_ITEM_COUNT_MISMATCH";
        throw error;
      }
      let protectedSupplierCosts = new Map();
      if (options.preserveSupplierCosts === true) {
        if (!savedId) {
          if (managesTransaction) await db.exec("rollback");
          throw new Error("إنشاء طلب جديد يتطلب مستخدماً لديه صلاحية عرض وتسجيل تكلفة المورد.");
        }
        const storedRows = await db.query(
          "select id, supplier_unit_price, supplier_material_unit_price, supplier_cost, layers from glass_order_rows where order_id = $1 for update",
          [savedId]
        );
        const protectedRows = mergeProtectedLocalOrderRows(rowsForSave, storedRows.rows);
        rowsForSave = protectedRows.rows;
        protectedSupplierCosts = protectedRows.protectedSupplierCosts;
      }
      const incomingRowIds = rowsForSave.map((row) => clean(row.id)).filter(Boolean);
      if (incomingRowIds.length !== new Set(incomingRowIds).size) {
        const error = httpError("تعذر حفظ الطلب لأن أحد بنود الزجاج مكرر.", 422);
        error.code = "ORDER_VALIDATION_FAILED";
        throw error;
      }
      const explicitlyDeletedRowIds = [...new Set((order.deletedRowIds || []).map(clean).filter(Boolean))];
      const existingRows = savedId
        ? await db.query("select * from glass_order_rows where order_id = $1 for update", [savedId])
        : { rows: [] };
      const existingRowIds = new Set(existingRows.rows.map((row) => clean(row.id)));
      const incomingRowIdSet = new Set(incomingRowIds);
      const explicitlyDeletedRowIdSet = new Set(explicitlyDeletedRowIds);
      const implicitlyMissingRows = [...existingRowIds].filter((rowId) => !incomingRowIdSet.has(rowId) && !explicitlyDeletedRowIdSet.has(rowId));
      const foreignDeletion = explicitlyDeletedRowIds.find((rowId) => !existingRowIds.has(rowId));
      if (implicitlyMissingRows.length || foreignDeletion) {
        const error = httpError("تعذر حفظ الطلب لأن حذف البنود يجب أن يتم من زر حذف الصف فقط.", 422);
        error.code = "ORDER_VALIDATION_FAILED";
        error.fields = implicitlyMissingRows.map((rowId) => ({ scope: "row", rowId, field: "row", message: "يوجد بند محفوظ غير موجود في الطلب الحالي ولم يتم حذفه صراحة." }));
        throw error;
      }
      const wasExistingOrder = !!savedId;
      if (wasExistingOrder) {
        await captureLocalOrderRevision(savedId, "order_update", options.changedBy || null);
      }
      const existingRowsById = new Map(existingRows.rows.map((row) => [clean(row.id), row]));
      const params = [
        candidateOrderNo,
        order.documentId || null,
        order.date,
        entryAt,
        status,
        order.entryMode || "normal",
        num(order.collectedPieces),
        customerId,
        supplierId,
        customerName,
        supplierName,
        order.project || "",
        order.code || "",
        order.notes || ""
      ];
      if (savedId) {
        await db.query(
          `update glass_orders set order_no=$1, document_id=$2, order_date=$3, entry_at=coalesce(entry_at, $4), status=$5, entry_mode=$6, collected_pieces=$7, customer_id=$8, supplier_id=$9, customer_name=$10, supplier_name=$11, project=$12, code=$13, notes=$14, updated_at=current_timestamp where id=$15`,
          [...params, savedId]
        );
      } else {
        const insertId = order.id || gid("ord");
        await db.query(
          `insert into glass_orders (id, order_no, document_id, order_date, entry_at, status, entry_mode, collected_pieces, customer_id, supplier_id, customer_name, supplier_name, project, code, notes, updated_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,current_timestamp)`,
          [insertId, ...params]
        );
        savedId = insertId;
      }
      const savedRowIds = [];
      for (const [index, row] of rowsForSave.entries()) {
        const totals = rowTotals(row);
        const unitPrice = num(row.unitPrice);
        const supplierUnitPrice = num(row.supplierUnitPrice);
        const materialUnitPrice = num(row.materialUnitPrice);
        const supplierMaterialUnitPrice = num(row.supplierMaterialUnitPrice);
        const rowId = row.id || gid("row");
        row.id = rowId;
        savedRowIds.push(rowId);
        await db.query(
          `insert into glass_order_rows (id, order_id, line_no, glass_mode, code, quantity, unit_price, supplier_unit_price, material_unit_price, supplier_material_unit_price, double_gap, triplex_pvb, extra_direction, notes, received_quantity, receipt_history, layers, drawing, area_m2, cost, supplier_cost)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
           on conflict (id) do update set
             order_id=excluded.order_id, line_no=excluded.line_no, glass_mode=excluded.glass_mode, code=excluded.code,
             quantity=excluded.quantity, unit_price=excluded.unit_price, supplier_unit_price=excluded.supplier_unit_price,
             material_unit_price=excluded.material_unit_price, supplier_material_unit_price=excluded.supplier_material_unit_price,
             double_gap=excluded.double_gap, triplex_pvb=excluded.triplex_pvb, extra_direction=excluded.extra_direction,
             notes=excluded.notes, received_quantity=excluded.received_quantity, receipt_history=excluded.receipt_history,
             layers=excluded.layers, drawing=excluded.drawing, area_m2=excluded.area_m2, cost=excluded.cost,
             supplier_cost=excluded.supplier_cost`,
          [rowId, savedId, index + 1, row.glassMode || "single", row.code || "", rowPhysicalQuantity(row), unitPrice, supplierUnitPrice, materialUnitPrice, supplierMaterialUnitPrice, row.doubleGap || null, row.triplexPvb || null, row.extraDirection || null, row.notes || "", row.receivedQuantity == null || row.receivedQuantity === "" ? null : num(row.receivedQuantity), JSON.stringify(Array.isArray(row.receiptHistory) ? row.receiptHistory : []), JSON.stringify(row.layers || []), JSON.stringify(row.drawing || { shapes: [], paths: [], edges: { top: 0, right: 0, bottom: 0, left: 0 }, panels: [] }), totals.area, totals.total, protectedSupplierCosts.has(rowId) ? protectedSupplierCosts.get(rowId) : totals.supplierCost]
        );
        const persistedRow = await db.query("select * from glass_order_rows where id = $1 limit 1", [rowId]);
        await auditLocalOrderRow(
          savedId,
          rowId,
          existingRowsById.has(rowId) ? "row_edited" : "row_created",
          existingRowsById.get(rowId) || null,
          persistedRow.rows[0] || null,
          options.changedBy || null
        );
      }
      if (explicitlyDeletedRowIds.length) {
        for (const rowId of explicitlyDeletedRowIds) {
          await auditLocalOrderRow(
            savedId,
            rowId,
            "row_explicitly_deleted",
            existingRowsById.get(rowId) || null,
            null,
            options.changedBy || null
          );
        }
        const placeholders = explicitlyDeletedRowIds.map((_, index) => `$${index + 2}`).join(",");
        await db.query(`delete from glass_order_rows where order_id = $1 and id in (${placeholders})`, [savedId, ...explicitlyDeletedRowIds]);
      }
      const persistedRows = await db.query(
        "select id from glass_order_rows where order_id = $1 order by line_no, id",
        [savedId]
      );
      const persistedRowIds = persistedRows.rows.map((row) => clean(row.id));
      const persistedRowIdSet = new Set(persistedRowIds);
      const missingSavedRowIds = savedRowIds.filter((rowId) => !persistedRowIdSet.has(clean(rowId)));
      if (
        persistedRowIds.length !== expectedItemCount
        || persistedRowIdSet.size !== expectedItemCount
        || missingSavedRowIds.length
      ) {
        const error = httpError("أُلغي تحديث الطلب لأن قاعدة البيانات لم تؤكد حفظ جميع البنود.", 409);
        error.code = "ORDER_ITEM_COUNT_MISMATCH";
        throw error;
      }
      if (!wasExistingOrder) {
        await captureLocalOrderRevision(savedId, "order_created", options.changedBy || null);
      }
      if (managesTransaction) await db.exec("commit");
      order.orderNo = candidateOrderNo;
      order.id = savedId;
      order.rows = rowsForSave;
      order.originalRowIds = savedRowIds.map(String);
      order.deletedRowIds = [];
      order._persistenceIntegrity = {
        persisted_rows: persistedRowIds.length,
        persisted_row_ids: persistedRowIds
      };
      return shouldBootstrap ? bootstrap() : order;
    } catch (error) {
      if (managesTransaction) {
        try { await db.exec("rollback"); } catch { /* Transaction may already be closed. */ }
      }
      if (!managesTransaction) throw error;
      if (!duplicateOrderNoError(error) || saveAsExisting) throw error;
      candidateOrderNo = await nextOrderNoAfter(candidateOrderNo);
    }
  }
  throw new Error("تعذر إنشاء رقم فريد للطلب، ولم يتم فقد أي من البيانات المدخلة. يرجى إعادة المحاولة.");
}

async function patchOrderStatus(identifier, patch = {}, options = {}) {
  const key = clean(identifier || patch.id || patch.orderNo);
  if (!key) throw httpError("لا يوجد رقم طلب صالح للتحديث.");
  try {
    await db.exec("begin");
    const existing = await db.query(
      "select id from glass_orders where id = $1 or order_no = $1 limit 1 for update",
      [key]
    );
    const orderId = existing.rows[0]?.id;
    if (!orderId) throw httpError("الطلب غير موجود.", 404);
    const receiptOperation = patch.operation === "receipt" || Object.prototype.hasOwnProperty.call(patch, "rows");
    const storedRows = receiptOperation
      ? await db.query(
        "select * from glass_order_rows where order_id = $1 for update",
        [orderId]
      )
      : { rows: [] };
    const incomingIds = Array.isArray(patch.rows)
      ? [...new Set(patch.rows.map((row) => clean(row?.id)).filter(Boolean))]
      : [];
    let knownRowOwners = [];
    if (incomingIds.length) {
      const placeholders = incomingIds.map((_, index) => `$${index + 1}`).join(",");
      const ownerRows = await db.query(
        `select id, order_id from glass_order_rows where id in (${placeholders})`,
        incomingIds
      );
      knownRowOwners = ownerRows.rows;
    }
    const validated = validateLocalOrderStatusPatch({
      orderId,
      patch,
      storedRows: storedRows.rows,
      knownRowOwners
    });
    await captureLocalOrderRevision(
      orderId,
      validated.operation === "receipt" ? "receipt_update" : "status_update",
      options.changedBy || null
    );
    if (validated.operation === "receipt" && validated.rows.length) {
      const storedRowsById = new Map(storedRows.rows.map((row) => [clean(row.id), row]));
      const values = [];
      const params = [];
      for (const [index, row] of validated.rows.entries()) {
        const offset = index * 3;
        values.push(`($${offset + 1}::text,$${offset + 2}::real,$${offset + 3}::text)`);
        params.push(
          row.id,
          row.receivedQuantity,
          JSON.stringify(row.receiptHistory)
        );
      }
      params.push(orderId);
      await db.query(
        `update glass_order_rows as target
         set received_quantity=source.received_quantity, receipt_history=source.receipt_history
         from (values ${values.join(",")}) as source(id, received_quantity, receipt_history)
         where target.id=source.id and target.order_id=$${params.length}`,
        params
      );
      for (const row of validated.rows) {
        const persistedRow = await db.query(
          "select * from glass_order_rows where id = $1 and order_id = $2 limit 1",
          [row.id, orderId]
        );
        await auditLocalOrderRow(
          orderId,
          row.id,
          "receipt_updated",
          storedRowsById.get(row.id) || null,
          persistedRow.rows[0] || null,
          options.changedBy || null
        );
      }
    }
    if (validated.operation === "receipt") {
      await db.query(
        "update glass_orders set collected_pieces=$1, updated_at=current_timestamp where id=$2",
        [validated.persistedCollected, orderId]
      );
    } else {
      await db.query(
        "update glass_orders set document_id=$1, status=$2, updated_at=current_timestamp where id=$3",
        [patch.documentId || null, validated.status, orderId]
      );
    }
    await db.exec("commit");
    return {
      order: {
        ...patch,
        id: orderId,
        ...(validated.operation === "receipt"
          ? { collectedPieces: validated.persistedCollected, receiptStatus: validated.receiptStatus }
          : { status: validated.status })
      }
    };
  } catch (error) {
    try { await db.exec("rollback"); } catch { /* Transaction may already be closed. */ }
    throw error;
  }
}

async function deleteOrder(identifier, shouldBootstrap = true, options = {}) {
  const key = clean(identifier);
  if (!key) throw new Error("لا يوجد رقم طلب صالح للحذف.");
  const existing = await db.query("select id from glass_orders where id = $1 or order_no = $1 limit 1", [key]);
  const orderId = existing.rows[0]?.id;
  if (!orderId) throw new Error("الطلب غير موجود.");
  try {
    await db.exec("begin");
    await captureLocalOrderRevision(orderId, "order_deleted", options.changedBy || null);
    const storedRows = await db.query("select * from glass_order_rows where order_id = $1 order by line_no, id", [orderId]);
    for (const row of storedRows.rows) {
      await auditLocalOrderRow(
        orderId,
        row.id,
        "row_explicitly_deleted",
        row,
        null,
        options.changedBy || null
      );
    }
    await db.query("delete from glass_order_rows where order_id = $1", [orderId]);
    await db.query("delete from glass_orders where id = $1", [orderId]);
    await db.exec("commit");
    return shouldBootstrap ? bootstrap() : { deleted: true, id: orderId };
  } catch (error) {
    try { await db.exec("rollback"); } catch { /* Transaction may already be closed. */ }
    throw error;
  }
}

async function importExcel(filePath = workbookPath) {
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
      code: clean(source["الكود"]),
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
  if (!grouped.size) {
    throw new Error("لم يتم العثور على طلبات صالحة للاستيراد. لم تتغير البيانات الحالية.");
  }
  let importedOrders = 0;
  let importedRows = 0;
  try {
    await db.exec("begin");
    await db.exec("delete from glass_order_rows; delete from glass_orders; delete from customers; delete from suppliers;");
    for (const order of grouped.values()) {
      const customer = await ensureParty("customers", clean(order.customerName));
      const supplier = await ensureParty("suppliers", clean(order.supplierName));
      order.customerId = customer?.id || "";
      order.supplierId = supplier?.id || "";
      await saveOrder(order, false, { externalTransaction: true });
      importedOrders += 1;
      importedRows += order.rows.length;
    }
    await db.exec("commit");
  } catch (error) {
    try { await db.exec("rollback"); } catch { /* Transaction may already be closed. */ }
    throw error;
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
      "Y.D Glass Manager local database",
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
app.post("/api/auth/setup", async (req, res) => {
  if (localAdminSetupInProgress) {
    res.status(409).json({ error: "إعداد المسؤول الأول قيد التنفيذ." });
    return;
  }
  localAdminSetupInProgress = true;
  try {
    const count = await db.query("select count(*)::integer as count from users");
    if (Number(count.rows[0]?.count || 0) > 0) {
      res.status(409).json({ error: "تم إعداد مستخدمي الخادم المحلي بالفعل." });
      return;
    }
    const username = clean(req.body?.username);
    const password = validateLocalPassword(req.body?.password);
    const displayName = clean(req.body?.display_name) || username;
    const email = clean(req.body?.email).toLocaleLowerCase() || null;
    if (!username) {
      res.status(400).json({ error: "اكتب اسم دخول المسؤول الأول." });
      return;
    }
    const id = gid("usr");
    const passwordHash = await hashLocalPassword(password);
    await db.query(
      "insert into users (id, username, email, display_name, role, password_hash, is_active) values ($1,$2,$3,$4,'admin',$5,true)",
      [id, username, email, displayName, passwordHash]
    );
    const saved = await db.query(
      "select id, username, email, auth_user_id, display_name, role, can_view_costs, is_active, last_login_at, created_at from users where id = $1",
      [id]
    );
    res.status(201).json({ user: saved.rows[0] });
  } catch (error) {
    res.status(400).json({ error: error.message });
  } finally {
    localAdminSetupInProgress = false;
  }
});
app.post("/api/auth/login", async (req, res) => {
  try {
    const username = clean(req.body?.username);
    const password = String(req.body?.password || "");
    const count = await db.query("select count(*)::integer as count from users");
    if (Number(count.rows[0]?.count || 0) === 0) {
      res.status(428).json({ error: "يلزم إعداد المسؤول الأول قبل تسجيل الدخول.", code: "LOCAL_SETUP_REQUIRED" });
      return;
    }
    const result = await db.query("select id, username, email, auth_user_id, display_name, role, can_view_costs, password_hash, is_active from users where lower(username) = lower($1) limit 1", [username]);
    const user = result.rows[0];
    const passwordMatches = user ? await verifyLocalPassword(password, user.password_hash) : false;
    if (!user || !passwordMatches || user.is_active === false) return res.status(401).json({ error: "بيانات الدخول غير صحيحة." });
    await db.query("update users set last_login_at = current_timestamp where id = $1", [user.id]);
    const token = createLocalSession(user);
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email || "",
        auth_user_id: user.auth_user_id || "",
        display_name: user.display_name,
        role: user.role,
        can_view_costs: user.role === "admin" || user.can_view_costs === true
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.post("/api/auth/logout", (req, res) => {
  if (req.localSession?.token) localSessions.delete(req.localSession.token);
  res.json({ ok: true });
});
app.get("/api/auth/session", async (req, res) => {
  try {
    const result = await db.query(
      "select id, username, email, auth_user_id, display_name, role, can_view_costs, is_active from users where id = $1 limit 1",
      [req.localSession.userId]
    );
    const user = result.rows[0];
    if (!user || user.is_active === false) {
      if (req.localSession?.token) localSessions.delete(req.localSession.token);
      res.status(401).json({ error: "الجلسة المحلية غير صالحة." });
      return;
    }
    res.json({ user: publicUser(user) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.get("/api/bootstrap", async (req, res) => {
  try { res.json(await bootstrap({ canViewCosts: req.localSession.canViewCosts })); } catch (error) { res.status(500).json({ error: error.message }); }
});
app.get("/api/users", async (req, res) => {
  try {
    if (!requireLocalAdmin(req, res)) return;
    const result = await db.query("select id, username, email, auth_user_id, display_name, role, can_view_costs, is_active, last_login_at, created_at from users order by created_at, username");
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});
app.post("/api/users", async (req, res) => {
  try {
    if (!requireLocalAdmin(req, res)) return;
    const user = req.body || {};
    const username = clean(user.username);
    const displayName = clean(user.display_name);
    const email = clean(user.email).toLowerCase();
    const password = validateLocalPassword(user.password);
    if (!username || !displayName) return res.status(400).json({ error: "اكتب اسم الدخول والاسم وكلمة المرور." });
    const passwordHash = await hashLocalPassword(password);
    const id = gid("usr");
    await db.query(
      "insert into users (id, username, email, display_name, role, can_view_costs, password_hash, is_active) values ($1,$2,$3,$4,$5,$6,$7,$8)",
      [id, username, email || null, displayName, user.role === "admin" ? "admin" : "user", user.can_view_costs === true, passwordHash, user.is_active === false ? false : true]
    );
    const saved = await db.query("select id, username, email, auth_user_id, display_name, role, can_view_costs, is_active, last_login_at, created_at from users where id = $1", [id]);
    res.json(saved.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});
app.put("/api/users/:id", async (req, res) => {
  try {
    if (!requireLocalAdmin(req, res)) return;
    const existing = await db.query("select * from users where id = $1 limit 1", [req.params.id]);
    if (!existing.rows[0]) return res.status(404).json({ error: "المستخدم غير موجود." });
    const body = req.body || {};
    const next = {
      username: clean(body.username || existing.rows[0].username),
      email: clean(body.email || existing.rows[0].email).toLowerCase() || null,
      auth_user_id: clean(body.auth_user_id || existing.rows[0].auth_user_id) || null,
      display_name: clean(body.display_name || existing.rows[0].display_name),
      role: body.role === "admin" ? "admin" : "user",
      can_view_costs: body.can_view_costs === undefined ? existing.rows[0].can_view_costs === true : body.can_view_costs === true,
      password_hash: body.password ? await hashLocalPassword(body.password) : existing.rows[0].password_hash,
      is_active: body.is_active === undefined ? existing.rows[0].is_active !== false : !!body.is_active
    };
    await db.query(
      "update users set username=$1, email=$2, auth_user_id=$3, display_name=$4, role=$5, can_view_costs=$6, password_hash=$7, is_active=$8 where id=$9",
      [next.username, next.email, next.auth_user_id, next.display_name, next.role, next.can_view_costs, next.password_hash, next.is_active, req.params.id]
    );
    const saved = await db.query("select id, username, email, auth_user_id, display_name, role, can_view_costs, is_active, last_login_at, created_at from users where id = $1", [req.params.id]);
    updateLocalSessionsForUser(saved.rows[0]);
    res.json(saved.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});
app.delete("/api/users/:id/hard", async (req, res) => {
  try {
    if (!requireLocalAdmin(req, res)) return;
    if (req.localSession?.userId === req.params.id) return res.status(400).json({ error: "لا يمكن حذف المستخدم الحالي." });
    await db.query("delete from users where id = $1", [req.params.id]);
    updateLocalSessionsForUser({ id: req.params.id, is_active: false });
    res.json({ ok: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});
app.delete("/api/users/:id", async (req, res) => {
  try {
    if (!requireLocalAdmin(req, res)) return;
    if (req.localSession?.userId === req.params.id) return res.status(400).json({ error: "لا يمكن إيقاف المستخدم الحالي." });
    await db.query("update users set is_active = false where id = $1", [req.params.id]);
    updateLocalSessionsForUser({ id: req.params.id, is_active: false });
    res.json({ ok: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});
app.put("/api/users/:id/password", async (req, res) => {
  try {
    if (req.localSession?.userId !== req.params.id) return res.status(403).json({ error: "يمكنك تغيير كلمة مرور حسابك فقط." });
    const currentPassword = String(req.body?.current_password || "");
    const newPassword = validateLocalPassword(req.body?.new_password);
    const result = await db.query("select * from users where id = $1 limit 1", [req.params.id]);
    const user = result.rows[0];
    if (!user || !(await verifyLocalPassword(currentPassword, user.password_hash))) return res.status(401).json({ error: "كلمة المرور الحالية غير صحيحة." });
    const passwordHash = await hashLocalPassword(newPassword);
    await db.query("update users set password_hash = $1 where id = $2", [passwordHash, req.params.id]);
    res.json({ ok: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});
app.post("/api/orders", async (req, res) => {
  try {
    const order = req.body || {};
    const savedOrder = await saveOrder(order, false, {
      preserveSupplierCosts: !req.localSession.canViewCosts,
      changedBy: req.localSession.userId
    });
    const persistence = savedOrder._persistenceIntegrity;
    delete savedOrder._persistenceIntegrity;
    res.json({ order: savedOrder, persistence });
  } catch (error) {
    const message = duplicateOrderNoError(error)
      ? "تعذر إنشاء رقم فريد للطلب، ولم يتم فقد أي من البيانات المدخلة. يرجى إعادة المحاولة."
      : error.message;
    const statusCode = error.statusCode || error.httpStatus || (/صلاحية.*تكلفة|supplier-cost permission|cost permission/i.test(message) ? 403 : 500);
    res.status(statusCode).json({
      error: message,
      ...(error.code ? { code: error.code } : {}),
      ...(Array.isArray(error.fields) ? { fields: error.fields } : {})
    });
  }
});
app.patch("/api/orders/:id/status", async (req, res) => {
  try {
    res.json(await patchOrderStatus(req.params.id, req.body || {}, { changedBy: req.localSession.userId }));
  } catch (error) {
    res.status(error.statusCode || error.httpStatus || 500).json({
      error: error.message,
      ...(error.code ? { code: error.code } : {})
    });
  }
});
app.delete("/api/orders/:id", async (req, res) => {
  try { res.json(await deleteOrder(req.params.id, false, { changedBy: req.localSession.userId })); } catch (error) { res.status(500).json({ error: error.message }); }
});
app.post("/api/payments", async (req, res) => {
  try {
    const p = req.body || {};
    await db.query("insert into supplier_payments (id, supplier_id, supplier_name, paid_at, amount, method, notes) values ($1,$2,$3,$4,$5,$6,$7)", [gid("pay"), p.supplier_id || null, p.supplier_name || null, p.paid_at || new Date().toISOString().slice(0, 10), num(p.amount), p.method || "", p.notes || ""]);
    res.json(await bootstrap({ canViewCosts: req.localSession.canViewCosts }));
  } catch (error) { res.status(500).json({ error: error.message }); }
});
app.put("/api/payments/:id", async (req, res) => {
  try {
    const p = req.body || {};
    await db.query(
      "update supplier_payments set supplier_id=$1, supplier_name=$2, paid_at=$3, amount=$4, method=$5, notes=$6 where id=$7",
      [p.supplier_id || null, p.supplier_name || null, p.paid_at || new Date().toISOString().slice(0, 10), num(p.amount), p.method || "", p.notes || "", req.params.id]
    );
    res.json(await bootstrap({ canViewCosts: req.localSession.canViewCosts }));
  } catch (error) { res.status(500).json({ error: error.message }); }
});
app.delete("/api/payments/:id", async (req, res) => {
  try {
    await db.query("delete from supplier_payments where id = $1", [req.params.id]);
    res.json(await bootstrap({ canViewCosts: req.localSession.canViewCosts }));
  } catch (error) { res.status(500).json({ error: error.message }); }
});
app.get("/api/telegram-bot/status", (_req, res) => {
  res.json(telegramBotStatus());
});
app.post("/api/telegram-bot/start", (req, res) => {
  try {
    if (!requireLocalAdmin(req, res)) return;
    res.json(startTelegramBot(req.body || {}));
  } catch (error) { res.status(500).json({ error: error.message, logs: telegramBotLogs }); }
});
app.post("/api/telegram-bot/stop", (req, res) => {
  try {
    if (!requireLocalAdmin(req, res)) return;
    res.json(stopTelegramBot());
  } catch (error) { res.status(500).json({ error: error.message, logs: telegramBotLogs }); }
});
app.post("/api/import/excel", async (req, res) => {
  try {
    if (!requireLocalAdmin(req, res)) return;
    res.json(await importExcel(req.body?.filePath || workbookPath));
  } catch (error) { res.status(500).json({ error: error.message }); }
});

async function shutdownLocalServer(signal = "shutdown") {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Shutdown] Local server received ${signal}`);
  try {
    stopTelegramBot();
    console.log("[Shutdown] Telegram helper stopped");
  } catch (error) {
    console.warn(`[Shutdown] Telegram helper stop failed: ${error.message}`);
  }
  if (httpServer) {
    await new Promise((resolve) => {
      httpServer.close((error) => {
        if (error) console.warn(`[Shutdown] HTTP server close failed: ${error.message}`);
        else console.log("[Shutdown] HTTP server closed");
        resolve();
      });
      setTimeout(resolve, 2500).unref?.();
    });
  }
  try {
    await db.close?.();
    console.log("[Shutdown] Database closed");
  } catch (error) {
    console.warn(`[Shutdown] Database close failed: ${error.message}`);
  }
}

process.once("SIGTERM", () => {
  shutdownLocalServer("SIGTERM").finally(() => process.exit(0));
});

process.once("SIGINT", () => {
  shutdownLocalServer("SIGINT").finally(() => process.exit(0));
});

process.on("exit", () => {
  if (telegramBotProcess && !telegramBotProcess.killed) telegramBotProcess.kill();
});

httpServer = app.listen(port, "127.0.0.1", () => console.log(`Y.D Glass Manager local server: http://127.0.0.1:${port}`));
