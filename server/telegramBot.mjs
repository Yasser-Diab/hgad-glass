import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const botDir = process.env.GLASS_ORDERS_BOT_DIR || path.join(root, "telegram_excel_bot");
const tempRoot = process.env.TEMP || process.env.TMP || botDir;
const outputDir = path.join(tempRoot, "glass-orders-bot-reports");
const rtlGhosts = /[\u200f\u200e\u202a\u202b\u202c\u202d\u202e\ufeff\u0640]/g;
const arabicDigits = new Map([
  ["٠", "0"], ["١", "1"], ["٢", "2"], ["٣", "3"], ["٤", "4"],
  ["٥", "5"], ["٦", "6"], ["٧", "7"], ["٨", "8"], ["٩", "9"],
  ["۰", "0"], ["۱", "1"], ["۲", "2"], ["۳", "3"], ["۴", "4"],
  ["۵", "5"], ["۶", "6"], ["۷", "7"], ["۸", "8"], ["۹", "9"]
]);
const selectedSupplierByChat = new Map();

let workbookRows = [];
let workbookColumns = [];
let suppliersCache = [];
let lastLoadedAt = "";
let dataSource = "Excel";
let stopRequested = false;

function readEnvFile(filePath) {
  try {
    return Object.fromEntries(
      fs.readFileSync(filePath, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map((line) => {
          const index = line.indexOf("=");
          const key = line.slice(0, index).trim();
          const raw = line.slice(index + 1).trim();
          const value = raw.replace(/^['"]|['"]$/g, "");
          return [key, value];
        })
    );
  } catch {
    return {};
  }
}

const env = { ...readEnvFile(path.join(root, ".env.local")), ...readEnvFile(path.join(botDir, ".env")), ...process.env };
const botToken = env.BOT_TOKEN || env.TELEGRAM_BOT_TOKEN || "";
const workbookPath = env.EXCEL_FILE || env.GLASS_ORDERS_WORKBOOK_PATH || path.join(botDir, "طلب شراء زجاج.xlsm");
const sheetName = env.SHEET_NAME || "الادخال";
const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL || "";
const supabaseKey = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || "";
const supabaseAccessToken = env.TELEGRAM_SUPABASE_ACCESS_TOKEN || "";
const supabaseRefreshToken = env.TELEGRAM_SUPABASE_REFRESH_TOKEN || "";
const telegramTopicName = env.TELEGRAM_TOPIC_NAME || "متابعة الكلف";
const configuredTopicThreadId = Number(env.TELEGRAM_TOPIC_ID || env.TELEGRAM_MESSAGE_THREAD_ID || 0) || 0;
const topicThreadByChat = new Map();
const orderStatusLabels = {
  ordered: "تم الطلب من المورد",
  fabrication: "قيد التصنيع",
  ready: "جاهز للاستلام",
  partial: "استلام جزئي",
  collected: "تم الاستلام",
  pricing: "تسعير فقط",
  cancelled: "ملغي"
};
const orderStatusAliases = {
  open: "fabrication",
  pending: "ordered",
  received: "collected",
  closed: "collected",
  done: "collected",
  canceled: "cancelled",
  quote: "pricing",
  priced: "pricing"
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(attempt) {
  const base = Math.min(120000, 3000 * (2 ** Math.max(0, attempt - 1)));
  const jitter = Math.floor(Math.random() * Math.min(5000, base * 0.25));
  return base + jitter;
}

function normalizeArabic(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(rtlGhosts, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .trim();
}

function toLatinDigits(value) {
  return String(value ?? "").replace(/[٠-٩۰-۹]/g, (digit) => arabicDigits.get(digit) || digit);
}

function cleanCode(value) {
  const digits = toLatinDigits(value)
    .toUpperCase()
    .replace(/GO\s*-?/g, "")
    .replace(/[^\d]/g, "");
  if (!digits) return "";
  return digits.replace(/^0+/, "") || "0";
}

function digitsOnlyMessage(value) {
  const text = toLatinDigits(value).trim();
  return /^\d+$/.test(text) ? text : "";
}

function codesMatch(value, query) {
  const cleanQuery = cleanCode(query);
  return !!cleanQuery && cleanCode(value) === cleanQuery;
}

function numberValue(value) {
  const text = toLatinDigits(value).replace(/[^\d.,-]/g, "").replace(",", ".");
  const n = Number(text);
  return Number.isFinite(n) ? n : 0;
}

function findColumn(aliases) {
  const normalizedAliases = aliases.map(normalizeArabic);
  return workbookColumns.find((column) => {
    const normalized = normalizeArabic(column);
    return normalizedAliases.some((alias) => normalized === alias || normalized.includes(alias));
  });
}

function findColumnByTokens(tokens) {
  const normalizedTokens = tokens.map(normalizeArabic);
  return workbookColumns.find((column) => {
    const normalized = normalizeArabic(column);
    return normalizedTokens.every((token) => normalized.includes(token));
  });
}

function cell(row, aliases, fallback = "") {
  const column = findColumn(aliases);
  return column ? row[column] ?? fallback : fallback;
}

function formatDate(value) {
  const text = String(value ?? "").trim();
  if (!text) return "-";
  const date = value instanceof Date ? value : new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return new Intl.DateTimeFormat("ar-EG", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function statusLabel(value) {
  const raw = String(value ?? "").trim();
  const normalized = raw.toLocaleLowerCase();
  const mapped = orderStatusLabels[normalized] || orderStatusLabels[orderStatusAliases[normalized]];
  return mapped || raw || "-";
}

function safeFileName(value) {
  return String(value || "report").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 80);
}

function chatThreadKey(chatId, threadId = 0) {
  return `${chatId}:${threadId || 0}`;
}

function rememberForumTopic(message) {
  const chatId = message?.chat?.id;
  const threadId = Number(message?.message_thread_id || 0);
  const createdName = message?.forum_topic_created?.name ||
    message?.forum_topic_edited?.name ||
    message?.reply_to_message?.forum_topic_created?.name ||
    message?.reply_to_message?.forum_topic_edited?.name ||
    "";
  if (!chatId || !threadId || !createdName) return;
  topicThreadByChat.set(chatThreadKey(chatId, normalizeArabic(createdName)), threadId);
}

function targetTopicThreadId(chatId) {
  if (configuredTopicThreadId) return configuredTopicThreadId;
  if (!chatId) return 0;
  return topicThreadByChat.get(chatThreadKey(chatId, normalizeArabic(telegramTopicName))) || 0;
}

function isAllowedTopicMessage(message) {
  const chatId = message?.chat?.id;
  const messageThreadId = Number(message?.message_thread_id || message?.reply_to_message?.message_thread_id || 0);
  if (!chatId || !messageThreadId) return false;
  const targetThreadId = targetTopicThreadId(chatId);
  return !!targetThreadId && messageThreadId === targetThreadId;
}

function threadExtra(threadId, extra = {}) {
  return threadId ? { message_thread_id: threadId, ...extra } : extra;
}

function loadWorkbook() {
  if (!fs.existsSync(workbookPath)) throw new Error(`Excel file was not found: ${workbookPath}`);
  const workbook = XLSX.readFile(workbookPath, { cellDates: true });
  const sheet = workbook.Sheets[sheetName] || workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error(`Sheet was not found: ${sheetName}`);
  workbookRows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
  workbookColumns = workbookRows.length ? Object.keys(workbookRows[0]) : [];
  suppliersCache = [];
  lastLoadedAt = new Date().toLocaleString("ar-EG");
  dataSource = "Excel";
  return workbookRows.length;
}

function displayOrderNo(value) {
  const text = String(value || "").trim().toUpperCase();
  if (text.startsWith("GO-")) return text;
  const digits = cleanCode(text);
  return digits ? `GO-${digits.padStart(6, "0")}` : text;
}

function rowGlassDescription(row) {
  const layers = Array.isArray(row.layers) ? row.layers : [];
  if (row.description) return row.description;
  if (!layers.length) return "زجاج";
  return layers
    .map((layer) => [layer.glassType, layer.company, layer.thickness].filter(Boolean).join(" "))
    .filter(Boolean)
    .join(" / ") || "زجاج";
}

async function loadSupabase() {
  if (!supabaseUrl || !supabaseKey || !supabaseAccessToken || !supabaseRefreshToken) {
    throw new Error("The signed-in Supabase session is unavailable. Sign in to Y.D Glass Manager before starting Telegram.");
  }
  const client = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: true,
      detectSessionInUrl: false
    }
  });
  const authResult = await client.auth.setSession({
    access_token: supabaseAccessToken,
    refresh_token: supabaseRefreshToken
  });
  if (authResult.error || !authResult.data?.user?.id) {
    throw authResult.error || new Error("The signed-in Supabase session could not be established for Telegram.");
  }
  client.auth.startAutoRefresh?.();
  const profileResult = await client
    .from("users")
    .select("role, can_view_costs, is_active")
    .eq("auth_user_id", authResult.data.user.id)
    .maybeSingle();
  if (profileResult.error) throw profileResult.error;
  const profile = profileResult.data;
  if (!profile?.is_active) throw new Error("Supabase bot profile is not active.");
  if (profile.role !== "admin" && profile.can_view_costs !== true) {
    throw new Error("Supabase bot profile does not have cost-view permission.");
  }
  const [orders, rows, countsResult] = await Promise.all([
    supabaseRpcAllCompat(client, "load_glass_orders_page", "load_glass_orders"),
    supabaseRpcAllCompat(client, "load_glass_order_rows_page", "load_glass_order_rows"),
    supabaseDataCountsCompat(client)
  ]);
  const expectedOrderCount = Number(countsResult?.order_count);
  const expectedRowCount = Number(countsResult?.row_count);
  if (orders.length !== expectedOrderCount || rows.length !== expectedRowCount) {
    throw new Error(`Order data is incomplete: expected ${expectedOrderCount}/${expectedRowCount}, loaded ${orders.length}/${rows.length}.`);
  }
  const byOrder = new Map();
  for (const row of rows || []) {
    if (!byOrder.has(row.order_id)) byOrder.set(row.order_id, []);
    byOrder.get(row.order_id).push(row);
  }
  workbookRows = [];
  for (const order of orders || []) {
    const orderRows = byOrder.get(order.id) || [{}];
    const hasAnyExplicitReceived = orderRows.some((row) => row.received_quantity !== undefined && row.received_quantity !== null && row.received_quantity !== "");
    let legacyReceivedRemaining = hasAnyExplicitReceived ? 0 : numberValue(order.collected_pieces);
    for (const row of orderRows) {
      const quantity = numberValue(row.quantity, 1);
      const explicitReceived = row.received_quantity !== undefined && row.received_quantity !== null && row.received_quantity !== "";
      const rowReceived = explicitReceived
        ? Math.max(0, Math.min(quantity, numberValue(row.received_quantity)))
        : Math.max(0, Math.min(quantity, legacyReceivedRemaining));
      if (!explicitReceived) legacyReceivedRemaining = Math.max(0, legacyReceivedRemaining - rowReceived);
      const rowRemaining = Math.max(0, quantity - rowReceived);
      workbookRows.push({
        "العميل": order.customer_name || "",
        "المشروع": order.project || "",
        "رقم الطلب": displayOrderNo(order.order_no),
        "رقم الاذن": order.document_id || displayOrderNo(order.order_no),
        "المورد": order.supplier_name || "",
        "التاريخ": order.order_date || "",
        "سعر الإذن": row.supplier_cost ?? order.totals?.supplierCost ?? 0,
        "العدد": quantity,
        "عدد الاستلام": rowReceived,
        "العدد المتبقي": rowRemaining,
        "المساحة": row.area_m2 ?? 0,
        "نوع الزجاج": rowGlassDescription(row),
        "حالة الاوردرات": statusLabel(order.status)
      });
    }
  }
  workbookColumns = workbookRows.length ? Object.keys(workbookRows[0]) : [];
  suppliersCache = [];
  lastLoadedAt = new Date().toLocaleString("ar-EG");
  dataSource = "Supabase";
  return workbookRows.length;
}

async function supabaseRpcAll(client, functionName, args = {}) {
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const result = await client.rpc(functionName, {
      ...args,
      p_offset: from,
      p_limit: pageSize
    });
    if (result.error) throw result.error;
    rows.push(...(result.data || []));
    if (!result.data || result.data.length < pageSize) break;
  }
  return rows;
}

function missingRpcFunction(error, functionName) {
  const code = String(error?.code || "").trim().toUpperCase();
  const message = [error?.message, error?.details, error?.hint].filter(Boolean).join(" ");
  return (code === "PGRST202" || /could not find the function|schema cache/i.test(message))
    && message.toLocaleLowerCase().includes(String(functionName).toLocaleLowerCase());
}

async function supabaseRpcAllCompat(client, pagedFunctionName, legacyFunctionName, args = {}) {
  try {
    return await supabaseRpcAll(client, pagedFunctionName, args);
  } catch (error) {
    if (!missingRpcFunction(error, pagedFunctionName)) throw error;
  }

  const pageSize = 1000;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const result = await client.rpc(legacyFunctionName, args).range(from, from + pageSize - 1);
    if (result.error) throw result.error;
    rows.push(...(result.data || []));
    if (!result.data || result.data.length < pageSize) break;
  }
  return rows;
}

async function supabaseDataCountsCompat(client) {
  const rpcResult = await client.rpc("load_glass_data_counts");
  if (!rpcResult.error) return rpcResult.data;
  if (!missingRpcFunction(rpcResult.error, "load_glass_data_counts")) throw rpcResult.error;
  const [ordersResult, rowsResult] = await Promise.all([
    client.from("glass_orders").select("id", { count: "exact", head: true }),
    client.from("glass_order_rows").select("id", { count: "exact", head: true })
  ]);
  if (ordersResult.error) throw ordersResult.error;
  if (rowsResult.error) throw rowsResult.error;
  return { order_count: Number(ordersResult.count), row_count: Number(rowsResult.count) };
}

async function loadDataSource() {
  const supabaseConfigured = !!(supabaseUrl || supabaseKey || supabaseAccessToken || supabaseRefreshToken);
  if (supabaseConfigured) return loadSupabase();
  return loadWorkbook();
}

async function refreshDataSourceForRequest() {
  const count = await loadDataSource();
  console.log(`Telegram bot refreshed ${count} rows from ${dataSource}.`);
  return count;
}

function suppliers() {
  if (suppliersCache.length) return suppliersCache;
  const supplierColumn = findColumn(["المورد"]);
  if (!supplierColumn) return [];
  suppliersCache = [...new Set(workbookRows.map((row) => String(row[supplierColumn] || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ar"));
  return suppliersCache;
}

function orderMatches(query) {
  const permitColumn = findColumn(["رقم الاذن", "رقم الإذن", "اذن", "إذن"]);
  const orderColumn = findColumn(["رقم الطلب", "كود الطلب", "رقم داخلي", "order", "go"]);
  const searchColumns = [permitColumn, orderColumn].filter(Boolean);
  if (!searchColumns.length) return [];
  return workbookRows.filter((row) => searchColumns.some((column) => codesMatch(row[column], query)));
}

function totalsForRows(rows) {
  const receivedColumn = findColumnByTokens(["استلام"]);
  const remainingColumn = findColumnByTokens(["متبقي"]);
  const quantityColumn = findColumnByTokens(["عدد"]);
  const received = receivedColumn ? rows.reduce((sum, row) => sum + numberValue(row[receivedColumn]), 0) : 0;
  const quantity = quantityColumn ? rows.reduce((sum, row) => sum + numberValue(row[quantityColumn]), 0) : 0;
  const remaining = remainingColumn
    ? rows.reduce((sum, row) => sum + numberValue(row[remainingColumn]), 0)
    : Math.max(0, quantity - received);
  return { received, remaining, quantity };
}

function searchReply(query, matches) {
  const first = matches[0] || {};
  const totals = totalsForRows(matches);
  const workflowStatus = statusLabel(cell(first, ["حالة الاوردرات", "حالة الأوردرات", "الحالة"], ""));
  const receiptStatus = totals.remaining > 0 ? "لم يتم الاستلام بالكامل" : "تم الاستلام من المورد";
  const details = [
    `تفاصيل رقم ${query}`,
    "------------------------",
    `العميل: ${cell(first, ["العميل"], "-") || "-"}`,
    `المشروع: ${cell(first, ["المشروع"], "-") || "-"}`,
    `رقم الطلب: ${cell(first, ["رقم الطلب", "كود الطلب", "رقم داخلي"], "-") || "-"}`,
    `رقم الإذن: ${cell(first, ["رقم الاذن", "رقم الإذن"], "-") || "-"}`,
    `المورد: ${cell(first, ["المورد"], "-") || "-"}`,
    `التاريخ: ${formatDate(cell(first, ["التاريخ", "تاريخ"], ""))}`,
    `سعر الإذن: ${cell(first, ["سعر الأذن", "سعر الاذن", "سعر الإذن"], "-") || "-"}`,
    "------------------------",
    `عدد الاستلام: ${Math.round(totals.received)}`,
    `العدد المتبقي: ${Math.round(totals.remaining)}`,
    `إجمالي العدد: ${Math.round(totals.quantity)}`,
    `حالة الطلب: ${workflowStatus}`,
    `حالة الاستلام: ${receiptStatus}`
  ];
  return details.join("\n");
}

function supplierReportRows(supplier) {
  const supplierColumn = findColumn(["المورد"]);
  if (!supplierColumn) return [];
  const remainingColumn = findColumnByTokens(["متبقي"]);
  return workbookRows.filter((row) => {
    const sameSupplier = String(row[supplierColumn] || "").trim() === supplier;
    if (!sameSupplier) return false;
    if (!remainingColumn) return true;
    return numberValue(row[remainingColumn]) > 0;
  });
}

function reportRecord(row) {
  return {
    "رقم الإذن": cell(row, ["رقم الاذن", "رقم الإذن"], ""),
    "العميل": cell(row, ["العميل"], ""),
    "نوع الزجاج": cell(row, ["نوع الزجاج", "البيان"], ""),
    "رقم الطلب": cell(row, ["رقم الطلب", "كود الطلب", "رقم داخلي"], ""),
    "العدد": cell(row, ["العدد"], ""),
    "عدد الاستلام": cell(row, ["عدد الاستلام", "استلام"], ""),
    "العدد المتبقي": cell(row, ["العدد المتبقي", "متبقي"], ""),
    "المساحة": cell(row, ["المساحة", "م2"], ""),
    "سعر الإذن": cell(row, ["سعر الأذن", "سعر الاذن", "سعر الإذن"], "")
  };
}

function createSupplierExcel(supplier, rows) {
  fs.mkdirSync(outputDir, { recursive: true });
  const filePath = path.join(outputDir, `orders_${safeFileName(supplier)}.xlsx`);
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows.map(reportRecord));
  XLSX.utils.book_append_sheet(workbook, sheet, "Orders");
  XLSX.writeFile(workbook, filePath);
  return filePath;
}

async function createSupplierPdf(supplier, rows) {
  const { jsPDF } = await import("jspdf");
  fs.mkdirSync(outputDir, { recursive: true });
  const filePath = path.join(outputDir, `orders_${safeFileName(supplier)}.pdf`);
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const fontPath = path.join(botDir, "Cairo-Regular.ttf");
  if (fs.existsSync(fontPath)) {
    doc.addFileToVFS("Cairo-Regular.ttf", fs.readFileSync(fontPath).toString("base64"));
    doc.addFont("Cairo-Regular.ttf", "Cairo", "normal");
    doc.setFont("Cairo", "normal");
  }
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 36;
  const columns = ["رقم الإذن", "العميل", "نوع الزجاج", "رقم الطلب", "العدد", "استلام", "متبقي", "المساحة", "السعر"];
  const xs = [pageWidth - 42, pageWidth - 115, pageWidth - 220, pageWidth - 400, pageWidth - 472, pageWidth - 528, pageWidth - 592, pageWidth - 662, pageWidth - 730];
  let y = 44;
  doc.setFontSize(15);
  doc.text(`تقرير أوامر المورد: ${supplier}`, pageWidth - margin, y, { align: "right" });
  y += 26;
  doc.setFontSize(9);
  doc.text(`تاريخ الإصدار: ${new Date().toLocaleString("ar-EG")}`, pageWidth - margin, y, { align: "right" });
  y += 28;
  doc.setFontSize(8.5);
  columns.forEach((column, index) => doc.text(column, xs[index], y, { align: "right" }));
  y += 14;
  doc.line(margin, y, pageWidth - margin, y);
  y += 15;
  rows.slice(0, 140).map(reportRecord).forEach((row) => {
    if (y > 555) {
      doc.addPage();
      y = 44;
      columns.forEach((column, index) => doc.text(column, xs[index], y, { align: "right" }));
      y += 24;
    }
    const values = [row["رقم الإذن"], row["العميل"], row["نوع الزجاج"], row["رقم الطلب"], row["العدد"], row["عدد الاستلام"], row["العدد المتبقي"], row["المساحة"], row["سعر الإذن"]];
    values.forEach((value, index) => doc.text(String(value || "-").slice(0, index === 2 ? 34 : 18), xs[index], y, { align: "right" }));
    y += 16;
  });
  doc.save(filePath);
  return filePath;
}

async function telegramJson(method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.description || `Telegram HTTP ${response.status}`);
  return data.result;
}

async function telegramForm(method, form) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    body: form
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.description || `Telegram HTTP ${response.status}`);
  return data.result;
}

function callbackButton(text, data) {
  return { text, callback_data: data };
}

async function sendMessage(chatId, text, extra = {}) {
  return telegramJson("sendMessage", {
    chat_id: chatId,
    text,
    ...extra
  });
}

async function sendDocument(chatId, filePath, caption, threadId = 0) {
  const bytes = fs.readFileSync(filePath);
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (threadId) form.append("message_thread_id", String(threadId));
  form.append("caption", caption);
  form.append("document", new Blob([bytes]), path.basename(filePath));
  return telegramForm("sendDocument", form);
}

async function handleMessage(message) {
  const chatId = message.chat?.id;
  rememberForumTopic(message);
  if (!isAllowedTopicMessage(message)) return;
  const threadId = targetTopicThreadId(chatId);
  const text = String(message.text || "").trim();
  const code = digitsOnlyMessage(text);
  if (!chatId || !code) return;
  await refreshDataSourceForRequest();
  const matches = orderMatches(code);
  await sendMessage(chatId, matches.length ? searchReply(code, matches) : "لا توجد بيانات لهذا الرقم.", threadExtra(threadId));
}

async function handleCallback(query) {
  return;
}

async function handleUpdate(update) {
  try {
    if (update.message) await handleMessage(update.message);
    if (update.callback_query) await handleCallback(update.callback_query);
  } catch (error) {
    console.error(`Update handling error: ${error.message}`);
  }
}

async function main() {
  const count = await loadDataSource();
  console.log(`Telegram bot helper loaded ${count} rows from ${dataSource}.`);
  if (process.env.GLASS_ORDERS_BOT_DRY_RUN === "1") return;
  if (!botToken) {
    console.error(`BOT_TOKEN is missing. Add it to ${path.join(botDir, ".env")}`);
    process.exitCode = 2;
    return;
  }
  await telegramJson("deleteWebhook", { drop_pending_updates: false }).catch((error) => {
    console.error(`deleteWebhook warning: ${error.message}`);
  });
  console.log("Telegram bot polling started.");
  console.log("BOT_STATUS:running");
  let offset = 0;
  let retryAttempt = 0;
  while (!stopRequested) {
    try {
      const updates = await telegramJson("getUpdates", {
        timeout: 25,
        offset,
        allowed_updates: ["message"]
      });
      if (retryAttempt > 0) {
        console.log("Telegram bot polling reconnected.");
        console.log("BOT_STATUS:running");
      }
      retryAttempt = 0;
      for (const update of updates || []) {
        offset = Math.max(offset, Number(update.update_id) + 1);
        await handleUpdate(update);
      }
    } catch (error) {
      retryAttempt += 1;
      const delay = retryDelayMs(retryAttempt);
      console.error(`Telegram polling error: ${error.message}. Reconnecting in ${Math.round(delay / 1000)}s.`);
      console.log("BOT_STATUS:reconnecting");
      await sleep(delay);
    }
  }
  console.log("BOT_STATUS:stopped");
  console.log("Telegram bot polling stopped.");
}

process.on("SIGTERM", () => { stopRequested = true; });
process.on("SIGINT", () => { stopRequested = true; });

await main().catch((error) => {
  console.error(`Telegram bot startup failed: ${error?.message || error}`);
  console.log("BOT_STATUS:failed");
  process.exitCode = 2;
});
