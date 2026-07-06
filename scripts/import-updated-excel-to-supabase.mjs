import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";

const root = process.cwd();
const defaultFile = path.join(root, "updated data", "updated-data.xlsm");
const excelFile = process.argv[2] || process.env.UPDATED_EXCEL_FILE || defaultFile;
const dryRun = process.env.DRY_RUN === "1";

function readEnvFile(filePath) {
  try {
    return Object.fromEntries(
      fs.readFileSync(filePath, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map((line) => {
          const index = line.indexOf("=");
          return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "")];
        })
    );
  } catch {
    return {};
  }
}

const env = { ...readEnvFile(path.join(root, ".env.local")), ...process.env };
const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY;

const ORDER_PREFIX = "GO-";
const ORDER_SEQUENCE_WIDTH = 6;
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

function clean(value) {
  return String(value ?? "").trim();
}

function num(value, fallback = 0) {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function orderSequence(value) {
  const match = String(value || "").match(/GO-\s*(\d+)/i) || String(value || "").match(/^(\d+)$/);
  if (!match) return null;
  const sequence = Number(match[1]);
  return Number.isFinite(sequence) ? sequence : null;
}

function displayOrderNo(value) {
  const sequence = orderSequence(value);
  if (sequence == null) return value || `${ORDER_PREFIX}${"0".repeat(ORDER_SEQUENCE_WIDTH - 1)}1`;
  return `${ORDER_PREFIX}${String(sequence).padStart(ORDER_SEQUENCE_WIDTH, "0")}`;
}

function appendUniqueText(current, next) {
  const value = clean(next);
  if (!value) return current || "";
  const parts = clean(current).split(/\s+\/\s+/).map(clean).filter(Boolean);
  if (!parts.includes(value)) parts.push(value);
  return parts.join(" / ");
}

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

function orderTotals(order) {
  return (order.rows || []).reduce((sum, row) => {
    const totals = rowTotals(row);
    sum.area += totals.area;
    sum.pieces += num(row.quantity, 1);
    sum.total += totals.total;
    sum.supplierCost += totals.supplierCost;
    return sum;
  }, { area: 0, pieces: 0, total: 0, supplierCost: 0 });
}

function rowDescription(row) {
  const layer = row.layers?.[0] || {};
  const secure = layer.secure ? " سيكوريت" : "";
  return `زجاج سنجل ${layer.glassType || "شفاف"} ${layer.thickness || "6مم"}${secure}${row.notes ? ` (${row.notes})` : ""}`;
}

function drawingHasContent(drawing = {}) {
  return (drawing.shapes || []).length > 0 ||
    (drawing.paths || []).length > 0 ||
    (drawing.outline?.points || []).length >= 4 ||
    Object.values(drawing.edges || {}).some((value) => num(value) !== 0);
}

function parseWorkbook(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Updated Excel file was not found: ${filePath}`);
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
    const sourceOrderNo = clean(source["رقم الطلب"]);
    if (!sourceOrderNo) continue;
    const orderNo = displayOrderNo(sourceOrderNo);
    const date = isoDate(source["التاريخ"]);
    const documentId = clean(source["رقم الاذن"]);
    const key = orderNo;
    const typeText = clean(source["نوع الطلب"]);
    const excelStatus = source["حالة الاوردرات"];
    const importedStatus = normExcelStatus(typeText, excelStatus);
    if (!grouped.has(key)) {
      grouped.set(key, {
        orderNo,
        documentId,
        documentIds: new Set(documentId ? [documentId] : []),
        date,
        entryAt: "",
        status: importedStatus,
        collectedPieces: 0,
        entryMode: /رسم/.test(typeText) ? "drawings" : "normal",
        customerName,
        supplierName,
        project: clean(source["المشروع"]),
        code: clean(source["الكود"]),
        notes: "Imported from updated Excel",
        rows: []
      });
    }
    const order = grouped.get(key);
    if (documentId) {
      order.documentIds.add(documentId);
      order.documentId = [...order.documentIds].join(" / ");
    }
    order.customerName = appendUniqueText(order.customerName, customerName);
    order.supplierName = appendUniqueText(order.supplierName, supplierName);
    order.project = appendUniqueText(order.project, clean(source["المشروع"]));
    order.code = appendUniqueText(order.code, clean(source["الكود"]));
    if (/رسم/.test(typeText)) order.entryMode = "drawings";
    if (order.status === "ordered" && importedStatus !== "ordered") order.status = importedStatus;
    order.collectedPieces += num(source["عدد الاستلام"], 0);
    const glass = glassParts(glassText);
    const price = num(source["سعر المتر"]);
    const area = num(source["المساحة"]);
    const cost = num(source["التكلفة"]);
    const notes = clean(source["ملاحظات"] || source["ملحوظات"] || source["Notes"]);
    order.rows.push({
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
  for (const order of grouped.values()) {
    delete order.documentIds;
    const totals = orderTotals(order);
    if (order.collectedPieces >= totals.pieces && totals.pieces > 0) order.status = "collected";
    else if (order.collectedPieces > 0) order.status = "partial";
  }
  return [...grouped.values()];
}

async function ensureParty(client, table, name) {
  if (!name) return null;
  const existing = await client.from(table).select("*").eq("name", name).limit(1).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data;
  if (dryRun) return { id: null, name };
  const inserted = await client.from(table).insert({ name }).select("*").single();
  if (inserted.error) throw inserted.error;
  return inserted.data;
}

function chunkArray(items, size = 500) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function selectAll(client, table, columns = "*", apply = (query) => query) {
  const rows = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const query = apply(client.from(table).select(columns).range(from, from + size - 1));
    const result = await query;
    if (result.error) throw result.error;
    rows.push(...(result.data || []));
    if (!result.data || result.data.length < size) break;
  }
  return rows;
}

async function ensureParties(client, table, names) {
  const uniqueNames = [...new Set(names.map(clean).filter(Boolean))];
  const existingRows = await selectAll(client, table, "*");
  const byName = new Map();
  for (const row of existingRows) {
    if (row.name && !byName.has(row.name)) byName.set(row.name, row);
  }
  const missing = uniqueNames.filter((name) => !byName.has(name));
  if (missing.length && !dryRun) {
    for (const batch of chunkArray(missing, 300)) {
      const inserted = await client.from(table).insert(batch.map((name) => ({ name }))).select("*");
      if (inserted.error) throw inserted.error;
      for (const row of inserted.data || []) {
        if (row.name && !byName.has(row.name)) byName.set(row.name, row);
      }
    }
  }
  if (dryRun) {
    for (const name of missing) byName.set(name, { id: null, name });
  }
  return byName;
}

function orderPayload(order, customer, supplier) {
  return {
    order_no: order.orderNo,
    document_id: order.documentId || null,
    order_date: order.date,
    entry_at: order.entryAt || null,
    status: normalizeOrderStatus(order.status),
    collected_pieces: num(order.collectedPieces),
    entry_mode: order.entryMode,
    customer_id: customer?.id || null,
    supplier_id: supplier?.id || null,
    customer_name: order.customerName,
    supplier_name: order.supplierName,
    project: order.project,
    code: order.code,
    notes: order.notes,
    totals: orderTotals(order),
    updated_at: new Date().toISOString()
  };
}

function orderRowPayload(orderId, row, index, drawing) {
  const totals = rowTotals(row);
  return {
    order_id: orderId,
    line_no: index + 1,
    glass_mode: row.glassMode,
    description: rowDescription(row),
    quantity: num(row.quantity, 1),
    unit_price: num(row.unitPrice),
    supplier_unit_price: num(row.supplierUnitPrice),
    material_unit_price: num(row.materialUnitPrice),
    supplier_material_unit_price: num(row.supplierMaterialUnitPrice),
    double_gap: row.doubleGap || null,
    triplex_pvb: row.triplexPvb || null,
    extra_direction: row.extraDirection || null,
    notes: row.notes || "",
    layers: row.layers,
    drawing,
    area_m2: totals.area,
    cost: totals.total,
    supplier_cost: totals.supplierCost
  };
}

async function cleanupStaleImportedOrders(client, validOrderNos) {
  const valid = new Set(validOrderNos);
  const importedOrders = await selectAll(client, "glass_orders", "id,order_no,notes", (query) => query.eq("notes", "Imported from updated Excel"));
  const stale = importedOrders.filter((order) => !valid.has(order.order_no));
  if (!stale.length) {
    console.log("No stale generated import orders to remove.");
    return 0;
  }
  let removed = 0;
  for (const batch of chunkArray(stale.map((order) => order.id), 300)) {
    const deleted = await client.from("glass_orders").delete().in("id", batch);
    if (deleted.error) throw deleted.error;
    removed += batch.length;
  }
  console.log(`Removed stale generated import orders: ${removed}`);
  return removed;
}

async function importOrdersBulk(client, orders) {
  console.log("Ensuring customers and suppliers...");
  const [customers, suppliers] = await Promise.all([
    ensureParties(client, "customers", orders.map((order) => order.customerName)),
    ensureParties(client, "suppliers", orders.map((order) => order.supplierName))
  ]);

  console.log("Saving orders...");
  const orderIdByNo = new Map();
  let savedOrders = 0;
  for (const batch of chunkArray(orders, 150)) {
    const payloads = batch.map((order) => orderPayload(order, customers.get(order.customerName), suppliers.get(order.supplierName)));
    const saved = await client.from("glass_orders").upsert(payloads, { onConflict: "order_no" }).select("id,order_no");
    if (saved.error) throw saved.error;
    for (const row of saved.data || []) orderIdByNo.set(row.order_no, row.id);
    savedOrders += batch.length;
    console.log(`Saved ${savedOrders}/${orders.length} orders...`);
  }

  const ordersWithIds = orders.map((order) => ({ order, id: orderIdByNo.get(order.orderNo) }));
  const missingIds = ordersWithIds.filter((item) => !item.id);
  if (missingIds.length) throw new Error(`Could not resolve ids for ${missingIds.length} saved orders.`);

  console.log("Loading existing drawings...");
  const drawingsByOrderLine = new Map();
  for (const batch of chunkArray(ordersWithIds.map((item) => item.id), 300)) {
    const result = await client.from("glass_order_rows").select("order_id,line_no,drawing").in("order_id", batch);
    if (result.error) throw result.error;
    for (const row of result.data || []) {
      drawingsByOrderLine.set(`${row.order_id}|${Number(row.line_no)}`, row.drawing);
    }
  }

  console.log("Replacing order rows...");
  let deletedOrderRows = 0;
  for (const batch of chunkArray(ordersWithIds.map((item) => item.id), 150)) {
    const deleted = await client.from("glass_order_rows").delete().in("order_id", batch);
    if (deleted.error) throw deleted.error;
    const remaining = await client.from("glass_order_rows").select("order_id").in("order_id", batch).limit(1000);
    if (remaining.error) throw remaining.error;
    const remainingIds = [...new Set((remaining.data || []).map((row) => row.order_id).filter(Boolean))];
    for (const id of remainingIds) {
      const fallbackDelete = await client.from("glass_order_rows").delete().eq("order_id", id);
      if (fallbackDelete.error) throw fallbackDelete.error;
    }
    if (remainingIds.length) {
      const recheck = await client.from("glass_order_rows").select("id", { count: "exact", head: true }).in("order_id", remainingIds);
      if (recheck.error) throw recheck.error;
      if (recheck.count) throw new Error(`Could not clear ${recheck.count} old rows before import.`);
      console.log(`Individually cleared rows for ${remainingIds.length} orders missed by batch delete.`);
    }
    deletedOrderRows += batch.length;
    console.log(`Cleared rows for ${deletedOrderRows}/${orders.length} orders...`);
  }

  let importedRows = 0;
  let rowBatch = [];
  async function flushRows() {
    if (!rowBatch.length) return;
    const inserted = await client.from("glass_order_rows").insert(rowBatch);
    if (inserted.error) throw inserted.error;
    importedRows += rowBatch.length;
    console.log(`Inserted ${importedRows} rows...`);
    rowBatch = [];
  }

  for (const item of ordersWithIds) {
    item.order.rows.forEach((row, index) => {
      const previousDrawing = drawingsByOrderLine.get(`${item.id}|${index + 1}`);
      const drawing = drawingHasContent(previousDrawing) ? previousDrawing : row.drawing;
      rowBatch.push(orderRowPayload(item.id, row, index, drawing));
    });
    if (rowBatch.length >= 500) await flushRows();
  }
  await flushRows();

  await cleanupStaleImportedOrders(client, orders.map((order) => order.orderNo));

  return { importedOrders: orders.length, importedRows };
}

async function upsertOrder(client, order) {
  const existing = await client.from("glass_orders").select("id").eq("order_no", order.orderNo).maybeSingle();
  if (existing.error) throw existing.error;
  const customer = await ensureParty(client, "customers", order.customerName);
  const supplier = await ensureParty(client, "suppliers", order.supplierName);
  const payload = {
    order_no: order.orderNo,
    document_id: order.documentId || null,
    order_date: order.date,
    entry_at: order.entryAt || null,
    status: normalizeOrderStatus(order.status),
    collected_pieces: num(order.collectedPieces),
    entry_mode: order.entryMode,
    customer_id: customer?.id || null,
    supplier_id: supplier?.id || null,
    customer_name: order.customerName,
    supplier_name: order.supplierName,
    project: order.project,
    code: order.code,
    notes: order.notes,
    totals: orderTotals(order),
    updated_at: new Date().toISOString()
  };
  if (dryRun) return { id: existing.data?.id || "dry-run" };
  const saved = existing.data
    ? await client.from("glass_orders").update(payload).eq("id", existing.data.id).select("id").single()
    : await client.from("glass_orders").insert(payload).select("id").single();
  if (saved.error) throw saved.error;
  const orderId = saved.data.id;
  const existingRows = await client.from("glass_order_rows").select("line_no,drawing").eq("order_id", orderId).order("line_no");
  if (existingRows.error) throw existingRows.error;
  const drawingsByLine = new Map((existingRows.data || []).map((row) => [Number(row.line_no), row.drawing]));
  const deleteRows = await client.from("glass_order_rows").delete().eq("order_id", orderId);
  if (deleteRows.error) throw deleteRows.error;
  const rows = order.rows.map((row, index) => {
    const totals = rowTotals(row);
    const previousDrawing = drawingsByLine.get(index + 1);
    const drawing = drawingHasContent(previousDrawing) ? previousDrawing : row.drawing;
    return {
      order_id: orderId,
      line_no: index + 1,
      glass_mode: row.glassMode,
      description: rowDescription(row),
      quantity: num(row.quantity, 1),
      unit_price: num(row.unitPrice),
      supplier_unit_price: num(row.supplierUnitPrice),
      material_unit_price: num(row.materialUnitPrice),
      supplier_material_unit_price: num(row.supplierMaterialUnitPrice),
      double_gap: row.doubleGap || null,
      triplex_pvb: row.triplexPvb || null,
      extra_direction: row.extraDirection || null,
      notes: row.notes || "",
      layers: row.layers,
      drawing,
      area_m2: totals.area,
      cost: totals.total,
      supplier_cost: totals.supplierCost
    };
  });
  if (rows.length) {
    const insertedRows = await client.from("glass_order_rows").insert(rows);
    if (insertedRows.error) throw insertedRows.error;
  }
  return { id: orderId };
}

async function main() {
  if (!supabaseUrl || !supabaseKey) throw new Error("Missing Supabase URL/key. Check .env.local.");
  const orders = parseWorkbook(excelFile);
  const rowCount = orders.reduce((sum, order) => sum + order.rows.length, 0);
  const duplicateOrderNos = orders.reduce((counts, order) => {
    counts.set(order.orderNo, (counts.get(order.orderNo) || 0) + 1);
    return counts;
  }, new Map());
  const duplicates = [...duplicateOrderNos.entries()].filter(([, count]) => count > 1);
  console.log(`Excel file: ${excelFile}`);
  console.log(`Parsed orders: ${orders.length}`);
  console.log(`Parsed rows: ${rowCount}`);
  if (duplicates.length) {
    throw new Error(`Duplicate order numbers in parsed workbook: ${duplicates.slice(0, 10).map(([orderNo, count]) => `${orderNo} (${count})`).join(", ")}`);
  }
  if (dryRun) {
    console.log("Dry run only. Nothing will be written.");
    return;
  }
  const client = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { importedOrders, importedRows } = await importOrdersBulk(client, orders);
  console.log(`Imported orders: ${importedOrders}`);
  console.log(`Imported rows: ${importedRows}`);
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] || "")).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { importOrdersBulk, parseWorkbook };
