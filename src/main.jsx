import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import * as XLSX from "xlsx";
import {
  BadgeDollarSign,
  BarChart3,
  Bot,
  Building2,
  CheckCircle2,
  ClipboardList,
  Circle,
  CloudOff,
  CloudUpload,
  Copy,
  Database,
  Download,
  Eye,
  Factory,
  FileDown,
  FileSpreadsheet,
  FileText,
  ImagePlus,
  KeyRound,
  Layers,
  Loader2,
  LogOut,
  Mail,
  Maximize2,
  Minimize2,
  Monitor,
  Moon,
  PackageCheck,
  Palette,
  Pencil,
  PieChart,
  Plus,
  Power,
  PowerOff,
  RectangleHorizontal,
  RefreshCw,
  Save,
  Search,
  Server,
  Settings,
  Sparkles,
  Sun,
  Trash2,
  UserPlus,
  UsersRound,
  WifiOff,
  XCircle
} from "lucide-react";
import appLogo from "../app_logo.png";
import hgadReportLogo from "../icons/HGAD-Dark_sticker.png";
import "./styles.css";

const VERSION = "0.1.0";
const APP_NAME = "Glass Orders";
const SUB_NAME = "Glass Orders, Suppliers management And Glass Cost";
const BYLINE = "G.O By Y.D";
const COMPANY = {
  nameEn: "EL HANDASIA GROUP FOR ARCHITECTURAL DESIGNS",
  nameAr: "المجموعة الهندسية للتصميمات المعمارية",
  shortName: "HGAD",
  website: "https://hgad-eg.com"
};
const DEFAULT_LOCAL_API = "http://127.0.0.1:4197";
const DATA_SOURCE_KEY = "glassOrdersDataSource";
const DATA_SOURCE_MODES = ["local", "supabase", "browser"];
const OFFLINE_QUEUE_KEY = "glassOrdersOfflineQueue";
const OFFLINE_SNAPSHOT_KEY = "glassOrdersOfflineSnapshot";
const ORDER_PREFIX = "GO-";
const ORDER_SEQUENCE_WIDTH = 6;

const ORDER_STATUS_DEFS = [
  { value: "ordered", label: "تم الطلب من المورد", tone: "info", payable: true, pending: true },
  { value: "fabrication", label: "قيد التصنيع", tone: "warning", payable: true, pending: true },
  { value: "ready", label: "جاهز للاستلام", tone: "success", payable: true, pending: true },
  { value: "partial", label: "استلام جزئي", tone: "warning", payable: true, pending: true },
  { value: "collected", label: "تم الاستلام", tone: "done", payable: true, pending: false },
  { value: "pricing", label: "تسعير فقط", tone: "neutral", payable: false, pending: false },
  { value: "cancelled", label: "ملغي", tone: "danger", payable: false, pending: false },
  { value: "draft", label: "مسودة غير مرسلة", tone: "neutral", payable: false, pending: false }
];

const ORDER_STATUS_ALIASES = {
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

const THEME_PRESETS = {
  gold: {
    name: "ذهبي",
    icon: Sun,
    values: {
      bodyFontFamily: "Segoe UI, Tahoma, Arial, sans-serif",
      headingFontFamily: "Georgia, Times New Roman, serif",
      tableBodyFontFamily: "Segoe UI, Tahoma, Arial, sans-serif",
      tableHeadingFontFamily: "Segoe UI, Tahoma, Arial, sans-serif",
      bodyFontColor: "#f7efe0",
      headingFontColor: "#ffe29a",
      tableHeaderBg: "#1b1306",
      tableHeaderColor: "#fff3c6",
      tableLineColor: "#b18a36"
    }
  },
  light: {
    name: "فاتح",
    icon: Sparkles,
    values: {
      bodyFontFamily: "Segoe UI, Tahoma, Arial, sans-serif",
      headingFontFamily: "Georgia, Times New Roman, serif",
      tableBodyFontFamily: "Segoe UI, Tahoma, Arial, sans-serif",
      tableHeadingFontFamily: "Segoe UI, Tahoma, Arial, sans-serif",
      bodyFontColor: "#17202a",
      headingFontColor: "#7a5315",
      tableHeaderBg: "#101820",
      tableHeaderColor: "#fff5d6",
      tableLineColor: "#d6c08a"
    }
  },
  dark: {
    name: "داكن",
    icon: Moon,
    values: {
      bodyFontFamily: "Segoe UI, Tahoma, Arial, sans-serif",
      headingFontFamily: "Georgia, Times New Roman, serif",
      tableBodyFontFamily: "Segoe UI, Tahoma, Arial, sans-serif",
      tableHeadingFontFamily: "Segoe UI, Tahoma, Arial, sans-serif",
      bodyFontColor: "#edf3f8",
      headingFontColor: "#f7d77c",
      tableHeaderBg: "#06131d",
      tableHeaderColor: "#f8d886",
      tableLineColor: "#2f4a5d"
    }
  }
};

const DEFAULT_APPEARANCE = {
  theme: "gold",
  reportLogoDataUrl: "",
  ...THEME_PRESETS.gold.values
};

const FONT_OPTIONS = [
  "Segoe UI, Tahoma, Arial, sans-serif",
  "Arial, sans-serif",
  "Tahoma, Arial, sans-serif",
  "Calibri, Arial, sans-serif",
  "Cambria, Georgia, serif",
  "Candara, Segoe UI, sans-serif",
  "Century Gothic, Arial, sans-serif",
  "Consolas, monospace",
  "Courier New, monospace",
  "Georgia, Times New Roman, serif",
  "Gill Sans, Segoe UI, sans-serif",
  "Helvetica, Arial, sans-serif",
  "Lucida Sans Unicode, Arial, sans-serif",
  "Microsoft Sans Serif, Arial, sans-serif",
  "Segoe UI Semibold, Segoe UI, Tahoma, Arial, sans-serif",
  "Times New Roman, Times, serif",
  "Trebuchet MS, Arial, sans-serif",
  "Verdana, Geneva, sans-serif",
  "Cairo, Segoe UI, Tahoma, Arial, sans-serif",
  "Noto Sans Arabic, Segoe UI, Tahoma, Arial, sans-serif",
  "Amiri, Georgia, Times New Roman, serif"
];

const GLASS_TYPES = ["شفاف", "أزرق", "أخضر", "برونز", "عاكس رمادي", "عاكس أزرق", "بيرسول جراي", "فاميه بني"];
const COMPANIES = ["Saint-Gobain®", "Sphinx®", "Guardian℗"];
const THICKNESSES = Array.from({ length: 25 }, (_, index) => `${index + 1}مم`);
const GAP_DEFAULTS = ["فراغ 6مم", "فراغ 9مم", "فراغ 12مم", "فراغ 16مم", "فراغ 20مم"];
const PVB = ["0.38mm PVB", "0.76 PVB", "1.14 PVB", "1.52 PVB"];
const EXTRA_DIRECTIONS = [
  "الزيادة باتجاه الزاوية",
  "في المنتصف تماماً",
  "الي اليمين",
  "الي اليسار",
  "الي الاعلي",
  "الي الاسفل"
];
const TABS = [
  ["dashboard", "لوحة المتابعة", BarChart3],
  ["entry", "إدخال الطلبات", Layers],
  ["orders", "حالة الطلبات", ClipboardList],
  ["customers", "العملاء", UsersRound],
  ["suppliers", "الموردين", Building2],
  ["statements", "تقارير الزجاج", FileSpreadsheet],
  ["settings", "الإعدادات", Settings]
];

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function numberValue(value, fallback = 0) {
  const n = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

function cmToMm(value, fallback = 0) {
  return numberValue(value, fallback) * 10;
}

function thicknessToMm(value, fallback = 6) {
  const match = String(value || "").match(/\d+(?:\.\d+)?/);
  return match ? numberValue(match[0], fallback) : fallback;
}

function layerAreaM2(layer, quantity = 1) {
  return (numberValue(layer.width) * numberValue(layer.height) * numberValue(quantity, 1)) / 10000;
}

function layerPerimeterM(layer, quantity = 1) {
  return ((numberValue(layer.width) + numberValue(layer.height)) * 2 * numberValue(quantity, 1)) / 100;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function clockText(timeZone) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date());
}

function reportClockText(value, timeZone) {
  const raw = value || today();
  const source = value instanceof Date ? value : new Date(String(raw).includes("T") ? raw : `${raw}T00:00:00`);
  const date = Number.isNaN(source.getTime()) ? new Date() : source;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

function reportDateOnly(value = today()) {
  const [year, month, day] = String(value || today()).slice(0, 10).split("-");
  if (!year || !month || !day) return String(value || "");
  return `${day}/${month}/${year}`;
}

function formatStatusDate(value = today()) {
  const [year, month, day] = String(value || today()).slice(0, 10).split("-");
  if (!year || !month || !day) return String(value || "");
  return `${day}/${month}/${year}`;
}

function reportDateTimePair(value, hasExactTime = true) {
  if (!hasExactTime) return { cairo: reportDateOnly(value), utc: reportDateOnly(value), exact: false };
  return {
    cairo: reportClockText(value, "Africa/Cairo"),
    utc: reportClockText(value, "UTC"),
    exact: true
  };
}

function arabicDateTimeLabel(value, hasExactTime = true) {
  const pair = reportDateTimePair(value, hasExactTime);
  return `${pair.cairo} القاهرة | ${pair.utc} UTC`;
}

function ReportTiming({ items = [] }) {
  return (
    <div className="report-timing">
      {items.map((item) => {
        const pair = reportDateTimePair(item.value, item.exact);
        return (
          <div className="report-date-card" key={item.label}>
            <strong>{item.label}</strong>
            <span><bdi dir="ltr">{pair.cairo}</bdi><small>القاهرة</small></span>
            <span><bdi dir="ltr">{pair.utc}</bdi><small>UTC</small></span>
          </div>
        );
      })}
    </div>
  );
}

function compactDate(value = today()) {
  return String(value || today()).replaceAll("-", "");
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

function orderDocumentId(order) {
  const raw = cleanName(order?.documentId);
  return raw && raw !== "طلب جديد" ? raw : displayOrderNo(order?.orderNo);
}

function generateOrderNo(orders = [], date = today()) {
  const maxSequence = orders.reduce((max, order) => {
    const sequence = orderSequence(order.orderNo);
    return Number.isFinite(sequence) ? Math.max(max, sequence) : max;
  }, 0);
  return displayOrderNo(maxSequence + 1);
}

function cleanName(value) {
  return String(value || "").trim();
}

function matchesQuery(query, ...values) {
  const needle = cleanName(query).toLocaleLowerCase();
  if (!needle) return true;
  return values.some((value) => String(value || "").toLocaleLowerCase().includes(needle));
}

function uniqueValues(values = []) {
  return [...new Set(values.map((value) => cleanName(value)).filter(Boolean))];
}

function normalizeOrderStatus(value) {
  const raw = cleanName(value || "ordered").toLocaleLowerCase();
  return ORDER_STATUS_DEFS.some((status) => status.value === raw)
    ? raw
    : (ORDER_STATUS_ALIASES[raw] || "ordered");
}

function orderStatusDef(value) {
  const normalized = normalizeOrderStatus(value);
  return ORDER_STATUS_DEFS.find((status) => status.value === normalized) || ORDER_STATUS_DEFS[0];
}

function isOrderPayableForSupplier(order) {
  return orderStatusDef(order?.status).payable;
}

function isOrderPendingCollection(order) {
  return orderStatusDef(order?.status).pending && orderRemainingPieces(order) > 0;
}

function orderCollectedPieces(order) {
  const totalPieces = orderTotals(order || { rows: [] }).pieces;
  return Math.max(0, Math.min(totalPieces, numberValue(order?.collectedPieces)));
}

function orderRemainingPieces(order) {
  const status = normalizeOrderStatus(order?.status);
  const totalPieces = orderTotals(order || { rows: [] }).pieces;
  if (!orderStatusDef(status).payable || status === "collected") return 0;
  if (status === "partial") return Math.max(0, totalPieces - orderCollectedPieces(order));
  return totalPieces;
}

function orderRemainingRatio(order) {
  const totalPieces = orderTotals(order || { rows: [] }).pieces;
  return totalPieces > 0 ? Math.max(0, Math.min(1, orderRemainingPieces(order) / totalPieces)) : 0;
}

function statusLabel(value) {
  return orderStatusDef(value).label;
}

function statusClassName(value) {
  return `status-chip ${orderStatusDef(value).tone}`;
}

function readAppearanceSettings() {
  try {
    return { ...DEFAULT_APPEARANCE, ...(JSON.parse(localStorage.getItem("glassOrdersAppearance") || "{}")) };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

function persistAppearanceSettings(settings) {
  localStorage.setItem("glassOrdersAppearance", JSON.stringify(settings));
}

function applyAppearanceSettings(settings = DEFAULT_APPEARANCE) {
  const root = document.documentElement;
  const merged = { ...DEFAULT_APPEARANCE, ...settings };
  root.dataset.theme = merged.theme || "gold";
  root.style.setProperty("--app-font", merged.bodyFontFamily);
  root.style.setProperty("--heading-font", merged.headingFontFamily);
  root.style.setProperty("--table-font", merged.tableBodyFontFamily);
  root.style.setProperty("--table-heading-font", merged.tableHeadingFontFamily);
  root.style.setProperty("--body-font-color", merged.bodyFontColor);
  root.style.setProperty("--heading-font-color", merged.headingFontColor);
  root.style.setProperty("--table-head-bg", merged.tableHeaderBg);
  root.style.setProperty("--table-head-color", merged.tableHeaderColor);
  root.style.setProperty("--table-line", merged.tableLineColor);
}

function appearanceWithTheme(theme, current = DEFAULT_APPEARANCE) {
  const preset = THEME_PRESETS[theme] || THEME_PRESETS.gold;
  return { ...current, theme, ...preset.values };
}

function latestTimestamp(order) {
  const stamp = Date.parse(order?.entryAt || order?.date || "");
  return Number.isFinite(stamp) ? stamp : 0;
}

function buildSmartOptions(data) {
  const orders = data.orders || [];
  const layers = orders.flatMap((order) => (order.rows || []).flatMap((row) => row.layers || []));
  const rows = orders.flatMap((order) => order.rows || []);
  return {
    glassTypes: uniqueValues([...GLASS_TYPES, ...layers.map((layer) => layer.glassType)]),
    companies: uniqueValues([...COMPANIES, ...layers.map((layer) => layer.company)]),
    thicknesses: uniqueValues([...THICKNESSES, ...layers.map((layer) => layer.thickness)]),
    gaps: uniqueValues([...GAP_DEFAULTS, ...(data.learnedOptions || []), ...rows.map((row) => row.doubleGap)]),
    pvb: uniqueValues(PVB)
  };
}

function buildPriceHistory(orders = []) {
  return [...orders]
    .sort((a, b) => latestTimestamp(b) - latestTimestamp(a))
    .flatMap((order) => (order.rows || []).flatMap((row) => {
      const layerEntries = (row.layers || []).map((layer) => ({
        kind: "layer",
        supplierName: order.supplierName || "",
        date: order.date || "",
        glassType: layer.glassType || "",
        company: layer.company || "",
        thickness: layer.thickness || "",
        secure: !!layer.secure,
        unitPrice: layer.unitPrice,
        supplierUnitPrice: layer.supplierUnitPrice
      }));
      const materialValue = row.glassMode === "double" ? row.doubleGap : row.glassMode === "triplex" ? row.triplexPvb : "";
      const materialEntry = materialValue ? [{
        kind: "material",
        mode: row.glassMode,
        value: materialValue,
        supplierName: order.supplierName || "",
        date: order.date || "",
        materialUnitPrice: row.materialUnitPrice,
        supplierMaterialUnitPrice: row.supplierMaterialUnitPrice
      }] : [];
      return [...layerEntries, ...materialEntry];
    }));
}

function findLatestLayerPrice(history, supplierName, layer) {
  const matches = history.filter((item) =>
    item.kind === "layer" &&
    cleanName(item.glassType) === cleanName(layer.glassType) &&
    cleanName(item.company) === cleanName(layer.company) &&
    cleanName(item.thickness) === cleanName(layer.thickness) &&
    !!item.secure === !!layer.secure &&
    (numberValue(item.unitPrice) || numberValue(item.supplierUnitPrice))
  );
  return matches.find((item) => cleanName(item.supplierName) === cleanName(supplierName)) || matches[0] || null;
}

function findLatestMaterialPrice(history, supplierName, mode, value) {
  const matches = history.filter((item) =>
    item.kind === "material" &&
    item.mode === mode &&
    cleanName(item.value) === cleanName(value) &&
    (numberValue(item.materialUnitPrice) || numberValue(item.supplierMaterialUnitPrice))
  );
  return matches.find((item) => cleanName(item.supplierName) === cleanName(supplierName)) || matches[0] || null;
}

function makeLayer(overrides = {}) {
  return {
    width: overrides.width ?? 100,
    height: overrides.height ?? 100,
    glassType: overrides.glassType || "شفاف",
    company: overrides.company || "Saint-Gobain®",
    thickness: overrides.thickness || "6مم",
    unitPrice: overrides.unitPrice ?? 0,
    supplierUnitPrice: overrides.supplierUnitPrice ?? 0,
    secure: !!overrides.secure,
    color: overrides.color || "#9fd3ff",
    alpha: overrides.alpha ?? 45,
    mirror: !!overrides.mirror,
    offsetX: overrides.offsetX ?? 0,
    offsetY: overrides.offsetY ?? 0
  };
}

function makeRow(overrides = {}) {
  const mode = overrides.glassMode || "single";
  const layers = normalizeLayers(mode, overrides.layers || [makeLayer()]).map((layer) => ({
    ...layer,
    unitPrice: layer.unitPrice ?? overrides.unitPrice ?? 0,
    supplierUnitPrice: layer.supplierUnitPrice ?? overrides.supplierUnitPrice ?? 0
  }));
  return {
    id: overrides.id || uid(),
    glassMode: mode,
    quantity: overrides.quantity ?? 1,
    unitPrice: overrides.unitPrice ?? 0,
    supplierUnitPrice: overrides.supplierUnitPrice ?? 0,
    materialUnitPrice: overrides.materialUnitPrice ?? 0,
    supplierMaterialUnitPrice: overrides.supplierMaterialUnitPrice ?? 0,
    doubleGap: overrides.doubleGap || "فراغ 6مم",
    triplexPvb: overrides.triplexPvb || "0.76 PVB",
    extraDirection: overrides.extraDirection || "في المنتصف تماماً",
    notes: overrides.notes || "",
    expanded: overrides.expanded ?? false,
    layers,
    drawing: normalizeDrawing(overrides.drawing)
  };
}

function toLatinClipboardDigits(value) {
  const digits = {
    "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
    "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
    "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
    "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9"
  };
  return String(value ?? "").replace(/[٠-٩۰-۹]/g, (digit) => digits[digit] || digit);
}

function clipboardNumber(value) {
  const match = toLatinClipboardDigits(value).replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatMeasurementCm(value) {
  const cm = Math.abs(value) > 300 ? value / 10 : value;
  return Number(cm.toFixed(2)).toString();
}

function formatQuantity(value) {
  const quantity = Math.max(0, value || 0);
  return Number(quantity.toFixed(2)).toString();
}

function likelyQuantityColumn(values = []) {
  const numeric = values.filter((value) => value != null);
  if (!numeric.length) return false;
  const small = numeric.filter((value) => Math.abs(value) <= 100).length / numeric.length;
  const whole = numeric.filter((value) => Math.abs(value - Math.round(value)) < 0.001).length / numeric.length;
  return small >= 0.85 && whole >= 0.85;
}

function parseMeasurementPaste(text = "") {
  const rawRows = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.split(/\t|;/).map((cell) => clipboardNumber(cell)).filter((value) => value != null))
    .filter((row) => row.length);
  if (!rawRows.length) return [];

  const multiColumnRows = rawRows.filter((row) => row.length >= 2);
  if (multiColumnRows.length) {
    const maxColumns = Math.max(...multiColumnRows.map((row) => row.length));
    const columns = Array.from({ length: maxColumns }, (_, columnIndex) => multiColumnRows.map((row) => row[columnIndex]).filter((value) => value != null));
    const quantityIndex = columns.findIndex((column) => likelyQuantityColumn(column));
    return multiColumnRows.map((row) => {
      if (quantityIndex === 0 && row.length >= 3) {
        return { quantity: formatQuantity(row[0]), height: formatMeasurementCm(row[1]), width: formatMeasurementCm(row[2]) };
      }
      if (quantityIndex >= 2 && row.length >= 3) {
        return { quantity: formatQuantity(row[quantityIndex]), width: formatMeasurementCm(row[0]), height: formatMeasurementCm(row[1]) };
      }
      if (row.length >= 3) {
        return { quantity: formatQuantity(row[0]), height: formatMeasurementCm(row[1]), width: formatMeasurementCm(row[2]) };
      }
      return { quantity: "1", width: formatMeasurementCm(row[0]), height: formatMeasurementCm(row[1]) };
    }).filter((row) => numberValue(row.width) > 0 && numberValue(row.height) > 0 && numberValue(row.quantity, 0) > 0);
  }

  const values = rawRows.flat();
  if (values.length >= 3 && values.length % 3 === 0) {
    const rowCount = values.length / 3;
    const quantities = values.slice(0, rowCount);
    const heights = values.slice(rowCount, rowCount * 2);
    const widths = values.slice(rowCount * 2);
    if (likelyQuantityColumn(quantities)) {
      return quantities.map((quantity, index) => ({
        quantity: formatQuantity(quantity),
        height: formatMeasurementCm(heights[index]),
        width: formatMeasurementCm(widths[index])
      })).filter((row) => numberValue(row.width) > 0 && numberValue(row.height) > 0 && numberValue(row.quantity, 0) > 0);
    }
  }

  if (values.length >= 2 && values.length % 2 === 0) {
    const rowCount = values.length / 2;
    const heights = values.slice(0, rowCount);
    const widths = values.slice(rowCount);
    return heights.map((height, index) => ({
      quantity: "1",
      height: formatMeasurementCm(height),
      width: formatMeasurementCm(widths[index])
    })).filter((row) => numberValue(row.width) > 0 && numberValue(row.height) > 0);
  }

  return [];
}

function normalizeDrawing(drawing = {}) {
  return {
    shapes: drawing?.shapes || [],
    paths: drawing?.paths || [],
    outline: {
      points: (drawing?.outline?.points || []).map((point, index) => normalizeOutlinePoint(point, index))
    },
    edges: {
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      ...(drawing?.edges || {})
    }
  };
}

function normalizeOutlinePoint(point = {}, index = 0) {
  return {
    id: point.id || `outline-${index}`,
    x: numberValue(point.x),
    y: numberValue(point.y),
    corner: !!point.corner,
    curve: !!point.curve
  };
}

function defaultOutlinePoints(geometry, edges = {}) {
  const top = numberValue(edges.top);
  const right = numberValue(edges.right);
  const bottom = numberValue(edges.bottom);
  const left = numberValue(edges.left);
  return [
    { id: "corner-tl", x: geometry.x + left, y: geometry.y + top, corner: true, curve: false },
    { id: "corner-tr", x: geometry.x + geometry.width - right, y: geometry.y + top, corner: true, curve: false },
    { id: "corner-br", x: geometry.x + geometry.width - right, y: geometry.y + geometry.height - bottom, corner: true, curve: false },
    { id: "corner-bl", x: geometry.x + left, y: geometry.y + geometry.height - bottom, corner: true, curve: false }
  ];
}

function outlinePointsForGeometry(drawing, geometry) {
  const normalized = normalizeDrawing(drawing);
  const points = normalized.outline.points;
  return points.length >= 4 ? points : defaultOutlinePoints(geometry, normalized.edges);
}

function outlinePath(points = []) {
  if (points.length === 0) return "";
  let d = `M ${numberValue(points[0].x)} ${numberValue(points[0].y)}`;
  for (let i = 1; i < points.length; i += 1) {
    const point = points[i];
    if (point.curve && i < points.length - 1) {
      const next = points[i + 1];
      d += ` Q ${numberValue(point.x)} ${numberValue(point.y)} ${numberValue(next.x)} ${numberValue(next.y)}`;
      i += 1;
    } else {
      d += ` L ${numberValue(point.x)} ${numberValue(point.y)}`;
    }
  }
  return `${d} Z`;
}

function outlineSegments(points = []) {
  return points.map((point, index) => ({
    index,
    start: point,
    end: points[(index + 1) % points.length]
  }));
}

function geometryRight(geometry) {
  return numberValue(geometry.x) + numberValue(geometry.width);
}

function geometryBottom(geometry) {
  return numberValue(geometry.y) + numberValue(geometry.height);
}

function boundsFromOutline(points = [], fallback = { x: 0, y: 0, width: 1, height: 1 }) {
  const candidates = points.length ? points : defaultOutlinePoints(fallback);
  const xs = candidates.map((point) => numberValue(point.x));
  const ys = candidates.map((point) => numberValue(point.y));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY, right: maxX, bottom: maxY };
}

function axisIntersections(points = [], axis, value) {
  const hits = [];
  for (const segment of outlineSegments(points)) {
    const x1 = numberValue(segment.start.x);
    const y1 = numberValue(segment.start.y);
    const x2 = numberValue(segment.end.x);
    const y2 = numberValue(segment.end.y);
    if (axis === "y") {
      if (Math.abs(y1 - y2) < 0.001) {
        if (Math.abs(value - y1) < 0.001) hits.push(x1, x2);
      } else if (value >= Math.min(y1, y2) && value <= Math.max(y1, y2)) {
        hits.push(x1 + ((value - y1) / (y2 - y1)) * (x2 - x1));
      }
    } else if (Math.abs(x1 - x2) < 0.001) {
      if (Math.abs(value - x1) < 0.001) hits.push(y1, y2);
    } else if (value >= Math.min(x1, x2) && value <= Math.max(x1, x2)) {
      hits.push(y1 + ((value - x1) / (x2 - x1)) * (y2 - y1));
    }
  }
  return [...new Set(hits.map((hit) => Math.round(hit * 1000) / 1000))].sort((a, b) => a - b);
}

function measurementReference(shape, bounds, outlinePoints = []) {
  const centerX = shape.kind === "arrow"
    ? (numberValue(shape.x1) + numberValue(shape.x2)) / 2
    : shape.kind === "rect"
      ? numberValue(shape.x) + numberValue(shape.w) / 2
      : numberValue(shape.x);
  const centerY = shape.kind === "arrow"
    ? (numberValue(shape.y1) + numberValue(shape.y2)) / 2
    : shape.kind === "rect"
      ? numberValue(shape.y) + numberValue(shape.h) / 2
      : numberValue(shape.y);
  const horizontalHits = outlinePoints.length ? axisIntersections(outlinePoints, "y", centerY) : [];
  const verticalHits = outlinePoints.length ? axisIntersections(outlinePoints, "x", centerX) : [];
  const leftEdge = horizontalHits.filter((hit) => hit <= centerX).pop() ?? bounds.x;
  const rightEdge = horizontalHits.find((hit) => hit >= centerX) ?? bounds.right;
  const topEdge = verticalHits.filter((hit) => hit <= centerY).pop() ?? bounds.y;
  const bottomEdge = verticalHits.find((hit) => hit >= centerY) ?? bounds.bottom;
  const leftDistance = Math.abs(centerX - leftEdge);
  const rightDistance = Math.abs(rightEdge - centerX);
  const topDistance = Math.abs(centerY - topEdge);
  const bottomDistance = Math.abs(bottomEdge - centerY);
  const horizontalFromLeft = leftDistance <= rightDistance;
  const verticalFromTop = topDistance <= bottomDistance;
  return {
    centerX,
    centerY,
    hStart: horizontalFromLeft ? leftEdge : rightEdge,
    vStart: verticalFromTop ? topEdge : bottomEdge,
    horizontalDistance: horizontalFromLeft ? leftDistance : rightDistance,
    verticalDistance: verticalFromTop ? topDistance : bottomDistance,
    horizontalSide: horizontalFromLeft ? "الحافة اليسرى" : "الحافة اليمنى",
    verticalSide: verticalFromTop ? "الحافة العلوية" : "الحافة السفلية"
  };
}

function outlineChangeDescriptions(points = [], baseGeometry) {
  const bounds = boundsFromOutline(points, baseGeometry);
  const changes = [
    { label: "امتداد يسار", value: Math.max(0, numberValue(baseGeometry.x) - bounds.x) },
    { label: "امتداد يمين", value: Math.max(0, bounds.right - geometryRight(baseGeometry)) },
    { label: "امتداد أعلى", value: Math.max(0, numberValue(baseGeometry.y) - bounds.y) },
    { label: "امتداد أسفل", value: Math.max(0, bounds.bottom - geometryBottom(baseGeometry)) },
    { label: "قص من اليسار", value: Math.max(0, bounds.x - numberValue(baseGeometry.x)) },
    { label: "قص من اليمين", value: Math.max(0, geometryRight(baseGeometry) - bounds.right) },
    { label: "قص من الأعلى", value: Math.max(0, bounds.y - numberValue(baseGeometry.y)) },
    { label: "قص من الأسفل", value: Math.max(0, geometryBottom(baseGeometry) - bounds.bottom) }
  ];
  return changes
    .filter((item) => item.value > 0.5)
    .map((item) => `${item.label}: ${Math.round(item.value)}مم`);
}

function edgeCutInfo(shape, bounds, tolerance = 10) {
  if (!shape || shape.kind !== "rect") return null;
  const x = numberValue(shape.x);
  const y = numberValue(shape.y);
  const w = numberValue(shape.w);
  const h = numberValue(shape.h);
  const right = x + w;
  const bottom = y + h;
  const candidates = [
    { side: "left", label: "الحافة اليسرى", distance: Math.abs(x - bounds.x), edgeLength: h, depth: w },
    { side: "right", label: "الحافة اليمنى", distance: Math.abs(right - bounds.right), edgeLength: h, depth: w },
    { side: "top", label: "الحافة العلوية", distance: Math.abs(y - bounds.y), edgeLength: w, depth: h },
    { side: "bottom", label: "الحافة السفلية", distance: Math.abs(bottom - bounds.bottom), edgeLength: w, depth: h }
  ];
  const match = candidates.filter((item) => item.distance <= tolerance).sort((a, b) => a.distance - b.distance)[0];
  if (!match) return null;
  const path = {
    left: `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h}`,
    right: `M ${x + w} ${y} L ${x} ${y} L ${x} ${y + h} L ${x + w} ${y + h}`,
    top: `M ${x} ${y} L ${x} ${y + h} L ${x + w} ${y + h} L ${x + w} ${y}`,
    bottom: `M ${x} ${y + h} L ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h}`
  }[match.side];
  return { ...match, path, width: Math.round(match.edgeLength), depth: Math.round(match.depth) };
}

function shapeSizeLabel(shape, notchInfo = null) {
  if (shape.kind === "circle") return `قطر ${Math.round(numberValue(shape.r) * 2)}mm`;
  if (shape.kind === "rect" && notchInfo) return "";
  if (shape.kind === "rect") return "";
  return "";
}

function rectTouches(shape, bounds, tolerance = 10) {
  const x = numberValue(shape.x);
  const y = numberValue(shape.y);
  const w = numberValue(shape.w);
  const h = numberValue(shape.h);
  return {
    left: Math.abs(x - bounds.x) <= tolerance,
    right: Math.abs(x + w - bounds.right) <= tolerance,
    top: Math.abs(y - bounds.y) <= tolerance,
    bottom: Math.abs(y + h - bounds.bottom) <= tolerance
  };
}

function rectSideDimensionItems(shape, bounds) {
  const x = numberValue(shape.x);
  const y = numberValue(shape.y);
  const w = numberValue(shape.w);
  const h = numberValue(shape.h);
  const right = x + w;
  const bottom = y + h;
  const touches = rectTouches(shape, bounds);
  const items = [];
  const addH = (x1, x2, yy, side = "top") => items.push({
    kind: "h",
    x1,
    y1: yy,
    x2,
    y2: yy,
    tx: (x1 + x2) / 2,
    ty: yy + (side === "top" ? -22 : 34),
    label: `${Math.round(Math.abs(x2 - x1))}mm`
  });
  const addV = (xx, y1, y2, side = "right") => items.push({
    kind: "v",
    x1: xx,
    y1,
    x2: xx,
    y2,
    tx: xx + (side === "right" ? 28 : -28),
    ty: (y1 + y2) / 2,
    rotate: `rotate(90 ${xx + (side === "right" ? 28 : -28)} ${(y1 + y2) / 2})`,
    label: `${Math.round(Math.abs(y2 - y1))}mm`
  });

  if (touches.left && touches.top) {
    addH(x, right, bottom, "bottom");
    addV(right, y, bottom, "right");
  } else if (touches.left && touches.bottom) {
    addH(x, right, y, "top");
    addV(right, y, bottom, "right");
  } else if (touches.right && touches.top) {
    addH(x, right, bottom, "bottom");
    addV(x, y, bottom, "left");
  } else if (touches.right && touches.bottom) {
    addH(x, right, y, "top");
    addV(x, y, bottom, "left");
  } else if (touches.left) {
    addH(x, right, y, "top");
    addV(right, y, bottom, "right");
    addH(x, right, bottom, "bottom");
  } else if (touches.right) {
    addH(x, right, y, "top");
    addV(x, y, bottom, "left");
    addH(x, right, bottom, "bottom");
  } else if (touches.top) {
    addV(x, y, bottom, "left");
    addH(x, right, bottom, "bottom");
    addV(right, y, bottom, "right");
  } else if (touches.bottom) {
    addV(x, y, bottom, "left");
    addH(x, right, y, "top");
    addV(right, y, bottom, "right");
  } else {
    addH(x, right, y, "top");
    addV(right, y, bottom, "right");
  }
  return items;
}

function outlineDimensionItems(points = [], baseGeometry) {
  const hasEditedOutline = points.length > 4 || points.some((point) => !point.corner || point.curve);
  if (!hasEditedOutline) return [];
  const center = { x: numberValue(baseGeometry.x) + numberValue(baseGeometry.width) / 2, y: numberValue(baseGeometry.y) + numberValue(baseGeometry.height) / 2 };
  return outlineSegments(points)
    .map((segment) => {
      const x1 = numberValue(segment.start.x);
      const y1 = numberValue(segment.start.y);
      const x2 = numberValue(segment.end.x);
      const y2 = numberValue(segment.end.y);
      const length = Math.hypot(x2 - x1, y2 - y1);
      if (length < 20) return null;
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;
      const angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
      let nx = -(y2 - y1) / length;
      let ny = (x2 - x1) / length;
      if ((midX + nx * 40 - center.x) ** 2 + (midY + ny * 40 - center.y) ** 2 < (midX - nx * 40 - center.x) ** 2 + (midY - ny * 40 - center.y) ** 2) {
        nx *= -1;
        ny *= -1;
      }
      return {
        x1,
        y1,
        x2,
        y2,
        tx: midX + nx * 34,
        ty: midY + ny * 34,
        label: `${Math.round(length)}mm`,
        rotate: Math.abs(angle) > 8 && Math.abs(angle) < 172 ? `rotate(${angle} ${midX + nx * 34} ${midY + ny * 34})` : ""
      };
    })
    .filter(Boolean);
}

function curveDepthItems(points = [], baseGeometry) {
  const base = {
    left: numberValue(baseGeometry.x),
    right: geometryRight(baseGeometry),
    top: numberValue(baseGeometry.y),
    bottom: geometryBottom(baseGeometry)
  };
  return points
    .filter((point) => point.curve)
    .map((point) => {
      const x = numberValue(point.x);
      const y = numberValue(point.y);
      const outside = [
        { side: "الحافة اليسرى الأصلية", distance: Math.max(0, base.left - x), x1: base.left, y1: y, x2: x, y2: y },
        { side: "الحافة اليمنى الأصلية", distance: Math.max(0, x - base.right), x1: base.right, y1: y, x2: x, y2: y },
        { side: "الحافة العلوية الأصلية", distance: Math.max(0, base.top - y), x1: x, y1: base.top, x2: x, y2: y },
        { side: "الحافة السفلية الأصلية", distance: Math.max(0, y - base.bottom), x1: x, y1: base.bottom, x2: x, y2: y }
      ].sort((a, b) => b.distance - a.distance);
      let chosen = outside[0];
      if (!chosen.distance) {
        chosen = [
          { side: "الحافة اليسرى الأصلية", distance: Math.abs(x - base.left), x1: base.left, y1: y, x2: x, y2: y },
          { side: "الحافة اليمنى الأصلية", distance: Math.abs(base.right - x), x1: base.right, y1: y, x2: x, y2: y },
          { side: "الحافة العلوية الأصلية", distance: Math.abs(y - base.top), x1: x, y1: base.top, x2: x, y2: y },
          { side: "الحافة السفلية الأصلية", distance: Math.abs(base.bottom - y), x1: x, y1: base.bottom, x2: x, y2: y }
        ].sort((a, b) => a.distance - b.distance)[0];
      }
      return {
        ...chosen,
        tx: (chosen.x1 + chosen.x2) / 2 + 18,
        ty: (chosen.y1 + chosen.y2) / 2 - 18,
        label: `منحنى ${Math.round(chosen.distance)}mm`
      };
    })
    .filter((item) => item.distance > 1);
}

function rowBaseGeometry(row) {
  const layers = row?.layers?.length ? row.layers : [makeLayer()];
  const maxW = Math.max(200, ...layers.map((layer) => cmToMm(layer.width, 100)));
  const maxH = Math.max(200, ...layers.map((layer) => cmToMm(layer.height, 100)));
  const layer = layers[0] || {};
  const width = Math.max(1, cmToMm(layer.width, 100));
  const height = Math.max(1, cmToMm(layer.height, 100));
  const freeX = Math.max(0, maxW - width);
  const freeY = Math.max(0, maxH - height);
  const direction = row?.extraDirection || "في المنتصف تماماً";
  const x = direction === "الي اليمين" ? freeX : direction === "في المنتصف تماماً" ? freeX / 2 : 0;
  let y = direction === "الي الاسفل" ? freeY : direction === "في المنتصف تماماً" ? freeY / 2 : 0;
  if (direction === "الي الاعلي") y = 0;
  return {
    x: x + Math.max(-freeX, Math.min(freeX, numberValue(layer.offsetX))),
    y: y + Math.max(-freeY, Math.min(freeY, numberValue(layer.offsetY))),
    width,
    height
  };
}

function drawingFabricationNotes(row) {
  const drawing = normalizeDrawing(row?.drawing);
  const baseGeometry = rowBaseGeometry(row);
  const outlinePoints = outlinePointsForGeometry(drawing, baseGeometry);
  const bounds = boundsFromOutline(outlinePoints, baseGeometry);
  const notes = outlineChangeDescriptions(outlinePoints, baseGeometry);
  for (const shape of drawing.shapes || []) {
    if (shape.kind === "circle") {
      const ref = measurementReference(shape, bounds, outlinePoints);
      notes.push(`ثقب قطر ${Math.round(numberValue(shape.r) * 2)}مم على بعد ${Math.round(ref.horizontalDistance)}مم من ${ref.horizontalSide} و ${Math.round(ref.verticalDistance)}مم من ${ref.verticalSide}`);
    } else if (shape.kind === "rect") {
      const ref = measurementReference(shape, bounds, outlinePoints);
      const notchInfo = edgeCutInfo(shape, bounds);
      if (notchInfo) {
        notes.push(`قص حافة من ${notchInfo.label}: طول الفتحة ${notchInfo.width}مم، العمق إلى الداخل ${notchInfo.depth}مم`);
      } else {
        notes.push(`مستطيل: الضلع الأفقي ${Math.round(numberValue(shape.w))}مم، الضلع الرأسي ${Math.round(numberValue(shape.h))}مم، على بعد ${Math.round(ref.horizontalDistance)}مم من ${ref.horizontalSide} و ${Math.round(ref.verticalDistance)}مم من ${ref.verticalSide}`);
      }
    } else if (shape.kind === "arrow") {
      notes.push(`سهم قياس ${Math.round(Math.hypot(numberValue(shape.x2) - numberValue(shape.x1), numberValue(shape.y2) - numberValue(shape.y1)))}مم${shape.text ? ` - ${shape.text}` : ""}`);
    } else if (shape.kind === "text" && shape.text) {
      notes.push(`ملاحظة على الرسم: ${shape.text}`);
    }
  }
  return notes;
}

function canCurveOutlinePoint(points, index) {
  if (index <= 0 || index >= points.length - 1) return false;
  const point = points[index];
  if (point.corner) return false;
  const previous = points[index - 1];
  const next = points[index + 1];
  if (previous.corner || next.corner) return false;
  return Math.abs(numberValue(previous.x) - numberValue(next.x)) < 3 || Math.abs(numberValue(previous.y) - numberValue(next.y)) < 3;
}

function drawingHasContent(drawing) {
  const normalized = normalizeDrawing(drawing);
  return (
    normalized.shapes.length > 0 ||
    normalized.paths.length > 0 ||
    normalized.outline.points.length >= 4 ||
    Object.values(normalized.edges).some((value) => numberValue(value) !== 0)
  );
}

function drawingOutlineSummary(drawing) {
  const normalized = normalizeDrawing(drawing);
  if (normalized.outline.points.length >= 4) {
    return normalized.outline.points.map((point, index) => {
      const curve = point.curve ? " منحنى" : "";
      return `نقطة ${index + 1}${curve}: أفقي ${Math.round(numberValue(point.x))}مم / رأسي ${Math.round(numberValue(point.y))}مم`;
    }).join(" | ");
  }
  if (Object.values(normalized.edges).some((value) => numberValue(value) !== 0)) {
    return `أعلى ${normalized.edges.top || 0}مم / يمين ${normalized.edges.right || 0}مم / أسفل ${normalized.edges.bottom || 0}مم / يسار ${normalized.edges.left || 0}مم`;
  }
  return "مستطيل افتراضي";
}

function drawingShapeSummary(shape) {
  if (shape.kind === "circle") {
    return `ثقب قطر ${Math.round(numberValue(shape.r) * 2)}مم`;
  }
  if (shape.kind === "rect") {
    return `قص/بروز مستطيل ${Math.round(numberValue(shape.w))}مم × ${Math.round(numberValue(shape.h))}مم`;
  }
  if (shape.kind === "arrow") {
    return `سهم قياس ${Math.round(Math.hypot(numberValue(shape.x2) - numberValue(shape.x1), numberValue(shape.y2) - numberValue(shape.y1)))}مم`;
  }
  return `ملاحظة: ${shape.text || "ملاحظة"}`;
}

function normalizeLayers(mode, current) {
  const count = mode === "single" ? 1 : 2;
  const next = [...current].map((layer) => makeLayer(layer));
  while (next.length < count) next.push(makeLayer({ glassType: next[0]?.glassType || "شفاف" }));
  return next.slice(0, count);
}

function layerText(layer) {
  return [layer.glassType, layer.thickness, layer.secure ? "سيكوريت" : ""].filter(Boolean).join(" ");
}

function rowDescription(row) {
  const notes = cleanName(row.notes);
  const suffix = notes ? ` (${notes})` : "";
  if (row.glassMode === "single") return `زجاج سنجل ${layerText(row.layers[0])}${suffix}`;
  if (row.glassMode === "double") return `زجاج دبل ${layerText(row.layers[0])} - ${row.doubleGap || ""} - ${layerText(row.layers[1])}${suffix}`;
  return `زجاج تريبلكس ${layerText(row.layers[0])} - ${layerText(row.layers[1])} - ${row.triplexPvb || ""}${suffix}`;
}

function rowCompanyText(row) {
  const layers = row.layers || [];
  const pairs = uniqueValues(layers
    .map((layer) => [cleanName(layer.glassType), cleanName(layer.company)].filter(Boolean).join(" "))
    .filter(Boolean));
  const companies = uniqueValues(layers.map((layer) => cleanName(layer.company)).filter(Boolean));
  if (row.glassMode !== "single" && pairs.length > 1) return pairs.join(" / ");
  return companies.join(" / ") || "-";
}

function rowArea(row) {
  const widest = Math.max(...row.layers.map((layer) => numberValue(layer.width)));
  const tallest = Math.max(...row.layers.map((layer) => numberValue(layer.height)));
  return (widest * tallest * numberValue(row.quantity, 1)) / 10000;
}

function rowTotals(row) {
  const area = rowArea(row);
  const quantity = numberValue(row.quantity, 1);
  const layerSale = row.layers.reduce((sum, layer) => sum + layerAreaM2(layer, quantity) * numberValue(layer.unitPrice, numberValue(row.unitPrice)), 0);
  const layerCost = row.layers.reduce((sum, layer) => sum + layerAreaM2(layer, quantity) * numberValue(layer.supplierUnitPrice, numberValue(row.supplierUnitPrice)), 0);
  const spacerMeters = row.glassMode === "double" ? layerPerimeterM(row.layers[0] || {}, quantity) : 0;
  const pvbArea = row.glassMode === "triplex" ? area : 0;
  const materialQuantity = row.glassMode === "double" ? spacerMeters : pvbArea;
  const materialSale = materialQuantity * numberValue(row.materialUnitPrice);
  const materialCost = materialQuantity * numberValue(row.supplierMaterialUnitPrice);
  return {
    area,
    spacerMeters,
    pvbArea,
    materialQuantity,
    layerSale,
    layerCost,
    materialSale,
    materialCost,
    total: layerSale + materialSale,
    supplierCost: layerCost + materialCost
  };
}

function rowHasLayerSizeDifference(row) {
  if (!row?.layers || row.layers.length < 2) return false;
  const [first, second] = row.layers;
  return (
    numberValue(first.width) !== numberValue(second.width) ||
    numberValue(first.height) !== numberValue(second.height)
  );
}

function orderTotals(order) {
  return (order.rows || []).reduce(
    (sum, row) => {
      const totals = rowTotals(row);
      sum.area += totals.area;
      sum.pieces += numberValue(row.quantity, 1);
      sum.total += totals.total;
      sum.supplierCost += totals.supplierCost;
      return sum;
    },
    { area: 0, pieces: 0, total: 0, supplierCost: 0 }
  );
}

function money(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(numberValue(value));
}

function square(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(numberValue(value));
}

function createDraft(overrides = {}) {
  const date = overrides.date || today();
  const entryAt = Object.prototype.hasOwnProperty.call(overrides, "entryAt")
    ? overrides.entryAt
    : (!overrides.id ? new Date().toISOString() : "");
  return {
    id: overrides.id || "",
    orderNo: overrides.orderNo || generateOrderNo([], date),
    documentId: overrides.documentId || "",
    date,
    entryAt,
    status: normalizeOrderStatus(overrides.status || "ordered"),
    collectedPieces: numberValue(overrides.collectedPieces),
    entryMode: overrides.entryMode || "normal",
    customerName: overrides.customerName || "",
    supplierName: overrides.supplierName || "",
    project: overrides.project || "",
    code: overrides.code || "",
    notes: overrides.notes || "",
    rows: overrides.rows?.length ? overrides.rows.map(makeRow) : [makeRow()]
  };
}

const envSupabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const envSupabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
const DEFAULT_LOCAL_USERS = [{ id: "local-admin", username: "admin", display_name: "Yasser Diab", role: "admin", password: "23320001", is_active: true }];
let supabaseClientCache = { url: "", key: "", client: null };

function maskSensitiveText(value = "") {
  return String(value)
    .replace(/https:\/\/[a-z0-9-]+\.supabase\.co/gi, "https://***.supabase.co")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "eyJ***")
    .replace(/(anon(?:_key)?|service_role|apikey|api_key|supabase(?:url|key)?|vite_supabase(?:_url|_anon_key)?)(\s*[:=]\s*)\S+/gi, "$1$2***")
    .replace(/[A-Za-z0-9_-]{96,}/g, "***TOKEN***");
}

function safeErrorMessage(error) {
  return maskSensitiveText(error?.message || error || "حدث خطأ غير متوقع.");
}

function supabaseConfig() {
  return {
    url: (envSupabaseUrl || localStorage.getItem("glassOrdersSupabaseUrl") || "").trim(),
    key: (envSupabaseKey || localStorage.getItem("glassOrdersSupabaseKey") || "").trim(),
    redirectUrl: (localStorage.getItem("glassOrdersSupabaseRedirectUrl") || "").trim()
  };
}

function hasSupabaseConfig() {
  const { url, key } = supabaseConfig();
  return /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url) && key.length > 20;
}

function getSupabaseClient() {
  const { url, key } = supabaseConfig();
  if (!url || !key) return null;
  if (supabaseClientCache.client && supabaseClientCache.url === url && supabaseClientCache.key === key) {
    return supabaseClientCache.client;
  }
  supabaseClientCache = {
    url,
    key,
    client: createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
  };
  return supabaseClientCache.client;
}

function resetSupabaseClientCache() {
  supabaseClientCache = { url: "", key: "", client: null };
}

function isLocalWebOrigin() {
  const host = window.location.hostname;
  return !host || host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function localServerAllowed() {
  return !!window.glassOrdersDesktop || isLocalWebOrigin();
}

function dataSourceMode() {
  const stored = localStorage.getItem(DATA_SOURCE_KEY);
  if (DATA_SOURCE_MODES.includes(stored)) {
    if (stored === "local" && !localServerAllowed()) return hasSupabaseConfig() ? "supabase" : "browser";
    return stored;
  }
  if (localStorage.getItem("glassOrdersUseLocalServer") === "false") {
    return hasSupabaseConfig() ? "supabase" : "browser";
  }
  return hasSupabaseConfig() ? "supabase" : "local";
}

function setDataSourceMode(mode) {
  const safeMode = DATA_SOURCE_MODES.includes(mode) ? mode : "browser";
  localStorage.setItem(DATA_SOURCE_KEY, safeMode);
  localStorage.setItem("glassOrdersUseLocalServer", safeMode === "local" ? "true" : "false");
}

function localApiBase() {
  return localStorage.getItem("glassOrdersLocalApi") || DEFAULT_LOCAL_API;
}

function localServerEnabled() {
  return dataSourceMode() === "local" && localServerAllowed();
}

function supabaseEnabled() {
  return dataSourceMode() === "supabase" && hasSupabaseConfig();
}

function supabaseRedirectOptions() {
  const configured = supabaseConfig().redirectUrl;
  const fallback = window.location.origin?.startsWith("http") ? window.location.origin : "";
  const redirectTo = configured || fallback;
  return redirectTo ? { redirectTo } : undefined;
}

async function localRequest(path, options = {}, timeoutMs = 3500) {
  if (!localServerAllowed()) {
    throw new Error("الخادم المحلي متاح فقط داخل نسخة سطح المكتب أو localhost.");
  }
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${localApiBase()}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
      }
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `HTTP ${response.status}`);
    }
    return response.json();
  } finally {
    window.clearTimeout(timer);
  }
}

async function localHealth() {
  if (!localServerEnabled()) return null;
  return localRequest("/api/health", {}, 1800);
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function ensureDesktopLocalServer(timeoutMs = 8000) {
  if (!localServerEnabled()) return null;
  if (window.glassOrdersDesktop?.startLocalServer) {
    await window.glassOrdersDesktop.startLocalServer().catch(() => null);
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const health = await localHealth();
      if (health?.ok) return health;
    } catch {
      // Keep polling while the desktop helper starts.
    }
    await delay(350);
  }
  return null;
}

function readLocal() {
  try {
    return JSON.parse(localStorage.getItem("glassOrdersData") || "{}");
  } catch {
    return {};
  }
}

function writeLocal(data) {
  localStorage.setItem("glassOrdersData", JSON.stringify(data));
}

function readOfflineQueue() {
  try {
    return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeOfflineQueue(queue) {
  const safeQueue = Array.isArray(queue) ? queue : [];
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(safeQueue));
  const persisted = window.glassOrdersDesktop?.writeOfflineQueue?.({ queue: safeQueue });
  persisted?.catch?.(() => null);
}

function writeOfflineSnapshot(data) {
  const snapshot = { ...data, savedAt: new Date().toISOString() };
  localStorage.setItem(OFFLINE_SNAPSHOT_KEY, JSON.stringify(snapshot));
  const persisted = window.glassOrdersDesktop?.writeOfflineSnapshot?.(snapshot);
  persisted?.catch?.(() => null);
}

function queueOfflineOperation(operation) {
  const queue = readOfflineQueue();
  const next = [
    ...queue.filter((item) => !(item.type === operation.type && item.order?.orderNo === operation.order?.orderNo)),
    { ...operation, id: uid(), queuedAt: new Date().toISOString(), attempts: 0 }
  ];
  writeOfflineQueue(next);
  return next;
}

function isConnectivityError(error) {
  const text = safeErrorMessage(error).toLowerCase();
  return !navigator.onLine || /failed to fetch|network|timeout|load failed|abort|internet|offline|econn|enotfound|etimedout/i.test(text);
}

function upsertOfflineOrder(data, order) {
  const orders = [...(data.orders || [])];
  const nextOrder = { ...order, id: order.id || uid(), offlinePending: true, offlineQueuedAt: new Date().toISOString() };
  const index = orders.findIndex((item) => item.id === nextOrder.id || item.orderNo === nextOrder.orderNo);
  if (index >= 0) orders[index] = nextOrder;
  else orders.unshift(nextOrder);
  const customers = upsertLocalParty(data.customers || [], nextOrder.customerName);
  const suppliers = upsertLocalParty(data.suppliers || [], nextOrder.supplierName);
  const next = { ...data, source: "offline", orders, customers, suppliers, learnedOptions: learnGap(data.learnedOptions, nextOrder), offlinePending: true };
  writeLocal(next);
  writeOfflineSnapshot(next);
  return next;
}

function currentStoredUser() {
  try {
    return JSON.parse(localStorage.getItem("glassOrdersUser") || "null");
  } catch {
    return null;
  }
}

const USER_PUBLIC_COLUMNS = "id, username, display_name, role, email, auth_user_id, is_active, last_login_at, created_at";
const USER_LOGIN_COLUMNS = `${USER_PUBLIC_COLUMNS}, password`;
const USER_PUBLIC_FALLBACK_COLUMNS = "id, username, display_name, role, is_active, last_login_at, created_at";
const USER_LOGIN_FALLBACK_COLUMNS = `${USER_PUBLIC_FALLBACK_COLUMNS}, password`;
const USER_COLUMN_MISSING_RE = /(email|auth_user_id).*does not exist|Could not find.*email|Could not find.*auth_user_id|PGRST204/i;

function appPublicUser(row) {
  return row ? { id: row.id, username: row.username, display_name: row.display_name, role: row.role, email: row.email || "", auth_user_id: row.auth_user_id || "" } : null;
}

async function supabaseUserByUsername(client, username, columns = USER_LOGIN_COLUMNS) {
  let result = await client
    .from("users")
    .select(columns)
    .ilike("username", username)
    .maybeSingle();
  if (result.error && USER_COLUMN_MISSING_RE.test(result.error.message || result.error.code || "")) {
    result = await client
      .from("users")
      .select(USER_LOGIN_FALLBACK_COLUMNS)
      .ilike("username", username)
      .maybeSingle();
  }
  if (result.error) throw result.error;
  return result.data ? { email: "", auth_user_id: "", ...result.data } : null;
}

async function supabaseUserByEmail(client, email, columns = USER_LOGIN_COLUMNS) {
  const cleanEmail = cleanName(email).toLocaleLowerCase();
  if (!cleanEmail) return null;
  const result = await client
    .from("users")
    .select(columns)
    .ilike("email", cleanEmail)
    .maybeSingle();
  if (result.error) {
    if (USER_COLUMN_MISSING_RE.test(result.error.message || result.error.code || "")) return null;
    throw result.error;
  }
  return result.data ? { email: "", auth_user_id: "", ...result.data } : null;
}

async function supabaseUserByIdentity(client, username, email = "", columns = USER_LOGIN_COLUMNS) {
  const cleanUsername = cleanName(username);
  const cleanEmail = cleanName(email || (cleanUsername.includes("@") ? cleanUsername : ""));
  if (cleanUsername) {
    const user = await supabaseUserByUsername(client, cleanUsername, columns);
    if (user) return user;
  }
  return supabaseUserByEmail(client, cleanEmail, columns);
}

async function supabaseSelectAll(client, table, columns = "*", configure = (query) => query) {
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const result = await configure(client.from(table).select(columns)).range(from, to);
    if (result.error) throw result.error;
    rows.push(...(result.data || []));
    if (!result.data || result.data.length < pageSize) break;
  }
  return rows;
}

async function supabaseUsers(client) {
  try {
    return await supabaseSelectAll(client, "users", USER_PUBLIC_COLUMNS, (query) => query.order("created_at").order("username"));
  } catch (error) {
    if (!USER_COLUMN_MISSING_RE.test(error.message || error.code || "")) throw error;
    const fallback = await supabaseSelectAll(client, "users", USER_PUBLIC_FALLBACK_COLUMNS, (query) => query.order("created_at").order("username"));
    return fallback.map((user) => ({ email: "", auth_user_id: "", ...user }));
  }
}

function ensureSupabaseEmailMatches(user, email) {
  const expectedEmail = cleanName(user?.email || "").toLocaleLowerCase();
  const cleanEmail = cleanName(email || "").toLocaleLowerCase();
  if (!expectedEmail) throw new Error("هذا المستخدم لا يحتوي على بريد Supabase بعد. أضف البريد من إدارة المستخدمين.");
  if (!cleanEmail) throw new Error("اكتب البريد الإلكتروني المرتبط بهذا المستخدم.");
  if (expectedEmail !== cleanEmail) throw new Error("البريد الإلكتروني لا يطابق المستخدم المسجل في قاعدة التطبيق.");
  return cleanEmail;
}

async function loginUser(username, password, email = "") {
  const cleanUsername = cleanName(username);
  if (!cleanUsername || !password) throw new Error("اكتب اسم المستخدم وكلمة المرور.");
  const client = hasSupabaseConfig() ? getSupabaseClient() : null;
  let supabaseLoginError = null;
  if (client) {
    try {
      const user = await supabaseUserByIdentity(client, cleanUsername, email);
      if (!user || user.is_active === false) throw new Error("بيانات الدخول غير صحيحة.");
      const authEmail = cleanName(user.email || "").toLocaleLowerCase();
      const appPasswordMatches = String(user.password || "") === String(password);
      const publicUser = appPublicUser(user);
      const finishSupabaseLogin = async (updates = {}) => {
        await client.from("users").update({ last_login_at: new Date().toISOString(), ...updates }).eq("id", user.id);
        localStorage.setItem("glassOrdersUser", JSON.stringify(publicUser));
        setDataSourceMode("supabase");
        return publicUser;
      };
      if (authEmail) {
        const authResult = await client.auth.signInWithPassword({ email: authEmail, password });
        if (!authResult.error) {
          user.auth_user_id = authResult.data?.user?.id || user.auth_user_id || "";
          publicUser.auth_user_id = user.auth_user_id || "";
          return finishSupabaseLogin({ auth_user_id: user.auth_user_id || null });
        }
        if (!appPasswordMatches) throw new Error("بيانات الدخول غير صحيحة.");
        console.warn(maskSensitiveText(`Supabase Auth rejected login for ${user.username}; accepted app password fallback: ${authResult.error.message}`));
        return finishSupabaseLogin();
      }
      if (!appPasswordMatches) throw new Error("بيانات الدخول غير صحيحة.");
      return finishSupabaseLogin();
    } catch (error) {
      supabaseLoginError = error;
    }
  }
  if (localServerEnabled()) {
    try {
      await ensureDesktopLocalServer(9000);
      const data = await localRequest("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: cleanUsername, password })
      });
      localStorage.setItem("glassOrdersUser", JSON.stringify(data.user));
      return data.user;
    } catch {
      // Fall back to browser credentials when the local server is closed.
    }
  }
  if (client && !localServerAllowed()) {
    if (supabaseLoginError) {
      const message = safeErrorMessage(supabaseLoginError);
      if (/بيانات الدخول|invalid login|invalid credentials/i.test(message)) throw new Error("بيانات الدخول غير صحيحة.");
      throw new Error(`تعذر دخول Supabase: ${message}`);
    }
    throw new Error("بيانات الدخول غير صحيحة.");
  }
  const local = readLocal();
  const users = local.users?.length ? local.users : DEFAULT_LOCAL_USERS;
  const user = users.find((item) => cleanName(item.username).toLocaleLowerCase() === cleanUsername.toLocaleLowerCase() && item.password === password && item.is_active !== false);
  if (!user) {
    if (supabaseLoginError) throw new Error(`تعذر دخول Supabase: ${safeErrorMessage(supabaseLoginError)}`);
    throw new Error("بيانات الدخول غير صحيحة.");
  }
  const publicUser = { id: user.id, username: user.username, email: user.email || "", auth_user_id: user.auth_user_id || "", display_name: user.display_name, role: user.role };
  localStorage.setItem("glassOrdersUser", JSON.stringify(publicUser));
  writeLocal({ ...local, users });
  return publicUser;
}

async function setupSupabasePassword(username, email, password) {
  const client = getSupabaseClient();
  const cleanUsername = cleanName(username);
  const cleanEmailInput = cleanName(email);
  if (!client || !hasSupabaseConfig()) throw new Error("فعّل اتصال Supabase أولاً.");
  if ((!cleanUsername && !cleanEmailInput) || !password) throw new Error("اكتب اسم المستخدم وكلمة المرور الجديدة.");
  const user = await supabaseUserByIdentity(client, cleanUsername, cleanEmailInput);
  if (!user || user.is_active === false) throw new Error("المستخدم غير موجود أو موقوف في قاعدة التطبيق.");
  const cleanEmail = ensureSupabaseEmailMatches(user, cleanEmailInput);
  const result = await client.auth.signUp({
    email: cleanEmail,
    password,
    options: {
      emailRedirectTo: supabaseRedirectOptions()?.redirectTo,
      data: { username: user.username, display_name: user.display_name, app_user_id: user.id }
    }
  });
  if (result.error) throw result.error;
  if (result.data?.user?.id) {
    await client.from("users").update({ auth_user_id: result.data.user.id }).eq("id", user.id);
  }
  return result.data;
}

async function sendSupabasePasswordReset(username, email) {
  const client = getSupabaseClient();
  const cleanUsername = cleanName(username);
  const cleanEmailInput = cleanName(email);
  if (!client || !hasSupabaseConfig()) throw new Error("فعّل اتصال Supabase أولاً.");
  if (!cleanUsername && !cleanEmailInput) throw new Error("اكتب اسم المستخدم أو البريد المسجل أولاً.");
  const user = await supabaseUserByIdentity(client, cleanUsername, cleanEmailInput);
  if (user?.is_active === false) throw new Error("المستخدم موقوف في قاعدة التطبيق.");
  if (!user && !cleanEmailInput) throw new Error("المستخدم غير موجود في قاعدة التطبيق.");
  if (!user) {
    const fallbackResult = await client.auth.resetPasswordForEmail(cleanEmailInput.toLocaleLowerCase(), supabaseRedirectOptions());
    if (fallbackResult.error) throw fallbackResult.error;
    return fallbackResult.data;
  }
  const cleanEmail = ensureSupabaseEmailMatches(user, cleanEmailInput);
  const result = await client.auth.resetPasswordForEmail(cleanEmail, supabaseRedirectOptions());
  if (result.error) throw result.error;
  return result.data;
}

async function changeSupabaseAppUserPassword(currentUser, currentPassword, newPassword) {
  const client = getSupabaseClient();
  if (!client || !hasSupabaseConfig()) throw new Error("اتصال Supabase غير متاح.");
  const user = await supabaseUserByIdentity(client, currentUser?.username || "", currentUser?.email || "");
  if (!user || user.is_active === false) throw new Error("المستخدم غير موجود أو موقوف في قاعدة التطبيق.");
  if (!newPassword) throw new Error("اكتب كلمة المرور الجديدة.");
  if (!currentPassword) throw new Error("اكتب كلمة المرور الحالية.");
  const appPasswordMatches = String(user.password || "") === String(currentPassword);
  let authResult = null;
  if (user.email) {
    authResult = await client.auth.signInWithPassword({ email: cleanName(user.email).toLocaleLowerCase(), password: currentPassword });
  }
  if (!appPasswordMatches && authResult?.error) throw new Error("كلمة المرور الحالية غير صحيحة.");
  if (!appPasswordMatches && !authResult) throw new Error("كلمة المرور الحالية غير صحيحة.");
  if (authResult && !authResult.error) {
    const updateAuth = await client.auth.updateUser({ password: newPassword });
    if (updateAuth.error) throw updateAuth.error;
    user.auth_user_id = authResult.data?.user?.id || user.auth_user_id || "";
  }
  const updates = { password: newPassword };
  if (user.auth_user_id) updates.auth_user_id = user.auth_user_id;
  const result = await client.from("users").update(updates).eq("id", user.id);
  if (result.error) throw result.error;
  return appPublicUser({ ...user, ...updates });
}

async function loadData() {
  const client = hasSupabaseConfig() ? getSupabaseClient() : null;
  if (client) {
    try {
      const [customers, suppliers, payments, users, orders, rows, options] = await Promise.all([
        supabaseSelectAll(client, "customers", "*", (query) => query.order("name")),
        supabaseSelectAll(client, "suppliers", "*", (query) => query.order("name")),
        supabaseSelectAll(client, "supplier_payments", "*", (query) => query.order("paid_at", { ascending: false })),
        supabaseUsers(client),
        supabaseSelectAll(client, "glass_orders", "*", (query) => query.order("order_date", { ascending: false })),
        supabaseSelectAll(client, "glass_order_rows", "*", (query) => query.order("line_no")),
        supabaseSelectAll(client, "learned_options", "*", (query) => query.eq("kind", "double_gap"))
      ]);
      const byOrder = new Map();
      for (const row of rows || []) {
        const item = makeRow({
          id: row.id,
          glassMode: row.glass_mode,
          quantity: row.quantity,
          unitPrice: row.unit_price,
          supplierUnitPrice: row.supplier_unit_price,
          materialUnitPrice: row.material_unit_price,
          supplierMaterialUnitPrice: row.supplier_material_unit_price,
          doubleGap: row.double_gap,
          triplexPvb: row.triplex_pvb,
          extraDirection: row.extra_direction,
          notes: row.notes || "",
          layers: row.layers,
          drawing: row.drawing
        });
        if (!byOrder.has(row.order_id)) byOrder.set(row.order_id, []);
        byOrder.get(row.order_id).push(item);
      }
      setDataSourceMode("supabase");
      return {
        customers: customers || [],
        suppliers: suppliers || [],
        payments: payments || [],
        users: users || [],
        learnedOptions: [...new Set([...(options || []).map((option) => option.value), ...GAP_DEFAULTS])],
        source: "supabase",
        orders: (orders || []).map((order) =>
          createDraft({
            id: order.id,
            orderNo: order.order_no,
            documentId: order.document_id || "",
            date: order.order_date,
            entryAt: order.entry_at || "",
            status: order.status,
            collectedPieces: order.collected_pieces || order.collectedPieces || 0,
            entryMode: order.entry_mode,
            customerName: order.customer_name,
            supplierName: order.supplier_name,
            project: order.project,
            code: order.code,
            notes: order.notes,
            rows: byOrder.get(order.id) || []
          })
        )
      };
    } catch (error) {
      console.warn(maskSensitiveText(`Supabase load failed: ${safeErrorMessage(error)}`));
    }
  }
  if (localServerEnabled()) {
    try {
      await ensureDesktopLocalServer(9000);
      const data = await localRequest("/api/bootstrap");
      return { ...data, source: "local-server" };
    } catch {
      // The local server is optional during design; continue with browser data.
    }
  }
  const local = readLocal();
  return { customers: [], suppliers: [], payments: [], orders: [], learnedOptions: GAP_DEFAULTS, ...local, source: "browser" };
}

async function saveOrderToStore(order, data) {
  const normalized = { ...order, status: normalizeOrderStatus(order.status), collectedPieces: numberValue(order.collectedPieces), customerName: cleanName(order.customerName), supplierName: cleanName(order.supplierName) };
  if (localServerEnabled()) {
    try {
      return await localRequest("/api/orders", {
        method: "POST",
        body: JSON.stringify(normalized)
      }, 10000);
    } catch {
      // Keep the app usable even if the local server is closed after startup.
    }
  }
  const client = supabaseEnabled() ? getSupabaseClient() : null;
  if (!client) {
    const nextOrder = { ...normalized, id: normalized.id || uid() };
    const next = upsertOfflineOrder(data, nextOrder);
    if (hasSupabaseConfig()) {
      queueOfflineOperation({ type: "order-upsert", order: nextOrder });
    }
    return next;
  }
  try {
    await saveOrderToSupabase(client, normalized);
    return loadData();
  } catch (error) {
    if (!isConnectivityError(error)) throw error;
    const nextOrder = { ...normalized, id: normalized.id || uid() };
    const next = upsertOfflineOrder(data, nextOrder);
    queueOfflineOperation({ type: "order-upsert", order: nextOrder });
    return next;
  }
}

async function saveOrderToSupabase(client, normalized) {
  const customer = await ensureParty(client, "customers", normalized.customerName);
  const supplier = await ensureParty(client, "suppliers", normalized.supplierName);
  const payload = {
    id: normalized.id || undefined,
    order_no: normalized.orderNo,
    document_id: normalized.documentId || null,
    order_date: normalized.date,
    entry_at: normalized.entryAt || null,
    status: normalized.status,
    collected_pieces: normalized.collectedPieces,
    entry_mode: normalized.entryMode,
    customer_id: customer?.id || null,
    supplier_id: supplier?.id || null,
    customer_name: normalized.customerName,
    supplier_name: normalized.supplierName,
    project: normalized.project,
    code: normalized.code,
    notes: normalized.notes,
    totals: orderTotals(normalized)
  };
  const saved = await client.from("glass_orders").upsert(payload).select().single();
  if (saved.error) throw saved.error;
  const orderId = saved.data.id;
  await client.from("glass_order_rows").delete().eq("order_id", orderId);
  const rows = normalized.rows.map((row, index) => {
    const totals = rowTotals(row);
    return {
      order_id: orderId,
      line_no: index + 1,
      glass_mode: row.glassMode,
      description: rowDescription(row),
      quantity: numberValue(row.quantity, 1),
      unit_price: numberValue(row.unitPrice),
      supplier_unit_price: numberValue(row.supplierUnitPrice),
      material_unit_price: numberValue(row.materialUnitPrice),
      supplier_material_unit_price: numberValue(row.supplierMaterialUnitPrice),
      double_gap: row.doubleGap || null,
      triplex_pvb: row.triplexPvb || null,
      extra_direction: row.extraDirection || null,
      notes: row.notes || "",
      layers: row.layers,
      drawing: row.drawing,
      area_m2: totals.area,
      cost: totals.total,
      supplier_cost: totals.supplierCost
    };
  });
  if (rows.length) {
    const rowResult = await client.from("glass_order_rows").insert(rows);
    if (rowResult.error) throw rowResult.error;
  }
  for (const row of normalized.rows) {
    if (row.doubleGap) await client.from("learned_options").upsert({ kind: "double_gap", value: row.doubleGap });
  }
  return orderId;
}

async function syncOfflineQueue() {
  const queue = readOfflineQueue();
  if (!queue.length || !hasSupabaseConfig() || !navigator.onLine) return { synced: 0, remaining: queue.length };
  const client = getSupabaseClient();
  if (!client) return { synced: 0, remaining: queue.length };
  const remaining = [];
  let synced = 0;
  for (let index = 0; index < queue.length; index += 1) {
    const item = queue[index];
    try {
      if (item.type === "order-upsert" && item.order) {
        const normalized = { ...item.order, status: normalizeOrderStatus(item.order.status), collectedPieces: numberValue(item.order.collectedPieces), customerName: cleanName(item.order.customerName), supplierName: cleanName(item.order.supplierName) };
        await saveOrderToSupabase(client, normalized);
        synced += 1;
      } else if (item.type === "payment-upsert" && item.payment) {
        await savePaymentToSupabase(client, item.payment);
        synced += 1;
      } else if (item.type === "payment-delete" && item.paymentId) {
        const result = await client.from("supplier_payments").delete().eq("id", item.paymentId);
        if (result.error) throw result.error;
        synced += 1;
      }
    } catch (error) {
      remaining.push({ ...item, attempts: numberValue(item.attempts) + 1, lastError: safeErrorMessage(error), lastAttemptAt: new Date().toISOString() });
      if (isConnectivityError(error)) {
        remaining.push(...queue.slice(index + 1));
        break;
      }
    }
  }
  writeOfflineQueue(remaining);
  return { synced, remaining: remaining.length };
}

async function savePaymentToSupabase(client, payment) {
  const payload = {
    id: payment.id || undefined,
    supplier_id: payment.supplier_id,
    supplier_name: payment.supplier_name,
    paid_at: payment.paid_at,
    amount: numberValue(payment.amount),
    method: payment.method,
    notes: payment.notes
  };
  const result = payment.id
    ? await client.from("supplier_payments").upsert(payload)
    : await client.from("supplier_payments").insert(payload);
  if (result.error) throw result.error;
  return result;
}

async function ensureParty(client, table, name) {
  if (!name) return null;
  const existing = await client.from(table).select("*").ilike("name", name).limit(1).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data;
  const inserted = await client.from(table).insert({ name }).select().single();
  if (inserted.error) throw inserted.error;
  return inserted.data;
}

function upsertLocalParty(list, name) {
  if (!name || list.some((item) => item.name === name)) return list;
  return [...list, { id: uid(), name, opening_balance: 0 }];
}

function learnGap(options = GAP_DEFAULTS, order) {
  return [...new Set([...options, ...order.rows.map((row) => row.doubleGap).filter(Boolean)])];
}

function rowHasManualInput(row = {}) {
  const defaults = makeRow();
  return row.glassMode !== defaults.glassMode ||
    numberValue(row.quantity, 1) !== 1 ||
    numberValue(row.unitPrice) > 0 ||
    numberValue(row.supplierUnitPrice) > 0 ||
    numberValue(row.materialUnitPrice) > 0 ||
    numberValue(row.supplierMaterialUnitPrice) > 0 ||
    cleanName(row.notes) ||
    (row.layers || []).some((layer, index) => {
      const base = defaults.layers[index] || {};
      return cleanName(layer.glassType) !== cleanName(base.glassType) ||
        cleanName(layer.company) !== cleanName(base.company) ||
        cleanName(layer.thickness) !== cleanName(base.thickness) ||
        numberValue(layer.width) !== numberValue(base.width) ||
        numberValue(layer.height) !== numberValue(base.height);
    }) ||
    (row.drawing?.shapes || []).length ||
    (row.drawing?.paths || []).length;
}

function draftHasManualInput(draft = {}) {
  return !!draft.id ||
    cleanName(draft.documentId) ||
    cleanName(draft.customerName) ||
    cleanName(draft.supplierName) ||
    cleanName(draft.project) ||
    cleanName(draft.code) ||
    cleanName(draft.notes) ||
    normalizeOrderStatus(draft.status) !== "ordered" ||
    draft.entryMode !== "normal" ||
    (draft.rows || []).some(rowHasManualInput);
}

function isBlankDraft(draft = {}) {
  return !draftHasManualInput({ ...draft, id: "" });
}

function App() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [currentUser, setCurrentUser] = useState(currentStoredUser);
  const [data, setData] = useState({ customers: [], suppliers: [], payments: [], orders: [], learnedOptions: GAP_DEFAULTS });
  const [draft, setDraft] = useState(createDraft());
  const [draftSavedMarker, setDraftSavedMarker] = useState("");
  const [preview, setPreview] = useState(null);
  const [supplierPayment, setSupplierPayment] = useState(null);
  const [localStatus, setLocalStatus] = useState(null);
  const [pendingSyncCount, setPendingSyncCount] = useState(() => readOfflineQueue().length);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const [clockTick, setClockTick] = useState(0);
  const [appearance, setAppearance] = useState(readAppearanceSettings);
  const [passwordRecoveryOpen, setPasswordRecoveryOpen] = useState(false);
  const botAutoStartRef = useRef(false);

  useEffect(() => {
    if (currentUser) refresh();
    else setLoading(false);
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser || botAutoStartRef.current) return;
    botAutoStartRef.current = true;
    startTelegramBotSilently();
  }, [currentUser]);

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, []);

  useEffect(() => {
    const warning = "يوجد بيانات إدخال أو مزامنة لم تكتمل بعد.";
    const handleBeforeUnload = (event) => {
      if (!readOfflineQueue().length && !currentDraftDirty()) return undefined;
      event.preventDefault();
      event.returnValue = warning;
      return warning;
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [draft, draftSavedMarker]);

  async function syncPendingChanges({ quiet = false } = {}) {
    if (syncing) return;
    const count = readOfflineQueue().length;
    setPendingSyncCount(count);
    if (!count || !navigator.onLine) return;
    setSyncing(true);
    try {
      const result = await syncOfflineQueue();
      setPendingSyncCount(result.remaining);
      if (result.synced) {
        const next = await loadData();
        setData(next);
        if (!quiet) setMessage(`تمت مزامنة ${result.synced} عملية مع Supabase.`);
      }
    } catch (error) {
      if (!quiet) setMessage(`تعذر مزامنة البيانات: ${safeErrorMessage(error)}`);
    } finally {
      setSyncing(false);
    }
  }

  async function startTelegramBotSilently() {
    const supabase = supabaseConfig();
    try {
      if (window.glassOrdersDesktop?.startTelegramBot) {
        await window.glassOrdersDesktop.startTelegramBot({ supabaseUrl: supabase.url, supabaseKey: supabase.key });
        return;
      }
      await localRequest("/api/telegram-bot/start", {
        method: "POST",
        body: JSON.stringify({ supabaseUrl: supabase.url, supabaseKey: supabase.key })
      }, 6000);
    } catch (error) {
      console.warn(maskSensitiveText(`Telegram bot autostart skipped: ${safeErrorMessage(error)}`));
    }
  }

  useEffect(() => {
    if (online) syncPendingChanges({ quiet: true });
  }, [online]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setPendingSyncCount(readOfflineQueue().length);
      if (navigator.onLine) syncPendingChanges({ quiet: true });
    }, 15000);
    return () => window.clearInterval(timer);
  }, [syncing]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockTick((value) => value + 1), 60000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    applyAppearanceSettings(appearance);
    persistAppearanceSettings(appearance);
  }, [appearance]);

  useEffect(() => {
    if (!message) return undefined;
    const timer = window.setTimeout(() => setMessage(""), 5200);
    return () => window.clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    if (!window.glassOrdersDesktop?.onNavigate) return undefined;
    return window.glassOrdersDesktop.onNavigate((target) => {
      if (target === "new-order") newOrder();
      else if (TABS.some(([id]) => id === target)) setActiveTab(target);
    });
  }, [data.orders]);

  useEffect(() => {
    const client = getSupabaseClient();
    if (!client) return undefined;
    const { data } = client.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setPasswordRecoveryOpen(true);
    });
    return () => data?.subscription?.unsubscribe?.();
  }, []);

  useEffect(() => {
    if (activeTab !== "entry") return;
    if (!draft.id && isBlankDraft(draft) && draft.date !== today()) {
      const date = today();
      const fresh = createDraft({ orderNo: generateOrderNo(data.orders, date), date });
      setDraft(fresh);
      setDraftSavedMarker("");
    }
  }, [activeTab, data.orders]);

  async function completePasswordRecovery(newPassword) {
    setLoading(true);
    try {
      const client = getSupabaseClient();
      if (!client) throw new Error("اتصال Supabase غير متاح.");
      const result = await client.auth.updateUser({ password: newPassword });
      if (result.error) throw result.error;
      setPasswordRecoveryOpen(false);
      setMessage("تم تحديث كلمة المرور. يمكنك تسجيل الدخول الآن.");
    } catch (error) {
      setMessage(`تعذر تحديث كلمة المرور: ${safeErrorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin(credentials) {
    setLoading(true);
    setMessage("");
    try {
      const user = await loginUser(credentials.username, credentials.password, credentials.email);
      setCurrentUser(user);
      setMessage(`تم تسجيل الدخول: ${user.display_name}`);
    } catch (error) {
      setMessage(`تعذر تسجيل الدخول: ${safeErrorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleSetupSupabasePassword(credentials) {
    setLoading(true);
    setMessage("");
    try {
      await setupSupabasePassword(credentials.username, credentials.email, credentials.password);
      setMessage("تم إرسال/تجهيز حساب Supabase لهذا المستخدم. إذا كان تأكيد البريد مفعلاً، راجع البريد قبل الدخول.");
    } catch (error) {
      setMessage(`تعذر تجهيز كلمة مرور Supabase: ${safeErrorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleResetSupabasePassword(credentials) {
    setLoading(true);
    setMessage("");
    try {
      await sendSupabasePasswordReset(credentials.username, credentials.email);
      setMessage("تم إرسال رابط إعادة تعيين كلمة المرور إلى البريد المسجل لهذا المستخدم.");
    } catch (error) {
      setMessage(`تعذر إرسال إعادة التعيين: ${safeErrorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    if (currentDraftDirty() && !window.confirm("تسجيل الخروج سيمسح بيانات الإدخال الحالية. هل تريد المتابعة؟")) return;
    localStorage.removeItem("glassOrdersUser");
    setCurrentUser(null);
    setData({ customers: [], suppliers: [], payments: [], orders: [], learnedOptions: GAP_DEFAULTS });
    setDraft(createDraft());
    setMessage("");
  }

  async function refresh() {
    setLoading(true);
    try {
      await syncPendingChanges({ quiet: true });
      const next = await loadData();
      setData(next);
      setPendingSyncCount(readOfflineQueue().length);
      if (localServerEnabled()) localHealth().then(setLocalStatus).catch(() => setLocalStatus(null));
      else setLocalStatus(null);
      setDraft((current) => {
        if (current.id) return current;
        if (!isBlankDraft(current)) return current;
        if (next.orders.some((order) => order.orderNo === current.orderNo)) {
          return { ...current, orderNo: generateOrderNo(next.orders, current.date) };
        }
        if (/^GO-\d{8}-\d{4}$/.test(current.orderNo || "")) return current;
        return { ...current, orderNo: generateOrderNo(next.orders, current.date) };
      });
      setMessage(next.source === "local-server" ? "تم الاتصال بقاعدة البيانات المحلية" : next.source === "supabase" ? "تم الاتصال بقاعدة Supabase." : "تستطيع تجربة البرنامج الآن. اربطه بقاعدة البيانات من الإعدادات عند التجهيز النهائي.");
    } catch (error) {
      setMessage(`تعذر تحميل البيانات: ${safeErrorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  }

  async function saveDraft() {
    setLoading(true);
    try {
      const orderForSave = draft.id
        ? draft
        : {
            ...draft,
            orderNo:
              draft.orderNo && !data.orders.some((order) => order.orderNo === draft.orderNo)
                ? draft.orderNo
                : generateOrderNo(data.orders, draft.date)
          };
      const next = await saveOrderToStore(orderForSave, data);
      setData(next);
      setPendingSyncCount(readOfflineQueue().length);
      const saved = next.orders.find((order) => order.orderNo === orderForSave.orderNo) || orderForSave;
      setDraft(saved);
      setDraftSavedMarker(JSON.stringify(saved));
      setMessage(`تم حفظ الطلب ${displayOrderNo(saved.orderNo)}`);
    } catch (error) {
      setMessage(`تعذر الحفظ: ${safeErrorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  }

  function currentDraftDirty() {
    if (draft.id) return !!draftSavedMarker && JSON.stringify(draft) !== draftSavedMarker;
    return draftHasManualInput(draft);
  }

  function confirmEntryReplace(reason = "استبدال بيانات الإدخال الحالية؟") {
    if (!currentDraftDirty()) return true;
    return window.confirm(`${reason}\n\nهناك بيانات في شاشة الإدخال لم تحفظ أو لم تنهِ تعديلها. هل تريد المتابعة؟`);
  }

  function newOrder(seed = {}, options = {}) {
    if (!options.force && !confirmEntryReplace("فتح طلب جديد؟")) return;
    const date = seed.date || today();
    const fresh = createDraft({ ...seed, orderNo: seed.orderNo || generateOrderNo(data.orders, date), date });
    setDraft(fresh);
    setDraftSavedMarker("");
    setActiveTab("entry");
  }

  function openOrder(order) {
    const orderLabel = displayOrderNo(order.orderNo);
    if (currentDraftDirty()) {
      if (!confirmEntryReplace(`فتح الطلب ${orderLabel} للتعديل؟`)) return;
    } else if (!window.confirm(`فتح الطلب ${orderLabel} للتعديل؟`)) return;
    const opened = createDraft(order);
    setDraft(opened);
    setDraftSavedMarker(JSON.stringify(opened));
    setActiveTab("entry");
    setMessage(`تم فتح الطلب ${orderLabel} للتعديل.`);
  }

  function copyOrder(order) {
    if (!confirmEntryReplace("نسخ هذا الطلب إلى إدخال جديد؟")) return;
    const copy = createDraft({
      ...order,
      id: "",
      orderNo: generateOrderNo(data.orders, today()),
      documentId: "",
      date: today(),
      entryAt: new Date().toISOString(),
      rows: order.rows.map((row) => makeRow({ ...row, id: uid() }))
    });
    setDraft(copy);
    setDraftSavedMarker("");
    setActiveTab("entry");
  }

  function cancelEntrySession() {
    const text = draft.id ? "إلغاء تعديل الطلب الحالي والرجوع لإدخال جديد؟" : "إلغاء الإدخال الحالي وبدء طلب جديد؟";
    if (!window.confirm(text)) return;
    newOrder({}, { force: true });
    setMessage(draft.id ? "تم إلغاء التعديل وفتح إدخال جديد." : "تم مسح بيانات الإدخال.");
  }

  async function addSupplierPayment(payment) {
    setLoading(true);
    try {
      if (localServerEnabled()) {
        try {
          const endpoint = payment.id ? `/api/payments/${encodeURIComponent(payment.id)}` : "/api/payments";
          const next = await localRequest(endpoint, {
            method: payment.id ? "PUT" : "POST",
            body: JSON.stringify(payment)
          }, 8000);
          setData(next);
          setSupplierPayment(null);
          setMessage(payment.id ? "تم تعديل دفعة المورد" : "تم تسجيل دفعة المورد");
          return;
        } catch {
          // Continue to browser/Supabase fallback.
        }
      }
      const client = supabaseEnabled() ? getSupabaseClient() : null;
      if (!client) {
        const normalizedPayment = { ...payment, id: payment.id || uid(), paid_at: payment.paid_at || today() };
        const payments = payment.id
          ? data.payments.map((item) => item.id === payment.id ? normalizedPayment : item)
          : [normalizedPayment, ...data.payments];
        const next = { ...data, payments };
        writeLocal(next);
        if (hasSupabaseConfig()) queueOfflineOperation({ type: "payment-upsert", payment: normalizedPayment });
        setData(next);
      } else {
        try {
          await savePaymentToSupabase(client, payment);
          setData(await loadData());
        } catch (error) {
          if (!isConnectivityError(error)) throw error;
          const normalizedPayment = { ...payment, id: payment.id || uid(), paid_at: payment.paid_at || today(), offlinePending: true };
          const payments = payment.id
            ? data.payments.map((item) => item.id === payment.id ? normalizedPayment : item)
            : [normalizedPayment, ...data.payments];
          const next = { ...data, payments, source: "offline", offlinePending: true };
          writeLocal(next);
          writeOfflineSnapshot(next);
          queueOfflineOperation({ type: "payment-upsert", payment: normalizedPayment });
          setData(next);
        }
      }
      setPendingSyncCount(readOfflineQueue().length);
      setSupplierPayment(null);
      setMessage(payment.id ? "تم تعديل دفعة المورد" : "تم تسجيل دفعة المورد");
    } catch (error) {
      setMessage(`تعذر تسجيل الدفعة: ${safeErrorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  }

  async function deleteSupplierPayment(payment) {
    if (!payment?.id || !window.confirm("حذف هذه الدفعة؟")) return;
    setLoading(true);
    try {
      if (localServerEnabled()) {
        try {
          const next = await localRequest(`/api/payments/${encodeURIComponent(payment.id)}`, { method: "DELETE" }, 8000);
          setData(next);
          setMessage("تم حذف الدفعة");
          return;
        } catch {
          // Continue to browser/Supabase fallback.
        }
      }
      const client = supabaseEnabled() ? getSupabaseClient() : null;
      if (!client) {
        const next = { ...data, payments: data.payments.filter((item) => item.id !== payment.id) };
        writeLocal(next);
        if (hasSupabaseConfig()) queueOfflineOperation({ type: "payment-delete", paymentId: payment.id });
        setData(next);
      } else {
        try {
          const result = await client.from("supplier_payments").delete().eq("id", payment.id);
          if (result.error) throw result.error;
          setData(await loadData());
        } catch (error) {
          if (!isConnectivityError(error)) throw error;
          const next = { ...data, source: "offline", offlinePending: true, payments: data.payments.filter((item) => item.id !== payment.id) };
          writeLocal(next);
          writeOfflineSnapshot(next);
          queueOfflineOperation({ type: "payment-delete", paymentId: payment.id });
          setData(next);
        }
      }
      setPendingSyncCount(readOfflineQueue().length);
      setMessage("تم حذف الدفعة");
    } catch (error) {
      setMessage(`تعذر حذف الدفعة: ${safeErrorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  }

  async function updateOrderStatus(order, patchValue) {
    try {
      const nextOrder = { ...order, ...patchValue, status: normalizeOrderStatus(patchValue.status || order.status) };
      const next = await saveOrderToStore(nextOrder, data);
      setData(next);
      if (draft.id === order.id || draft.orderNo === order.orderNo) {
        const saved = next.orders.find((item) => item.id === order.id || item.orderNo === order.orderNo) || nextOrder;
        setDraft(createDraft(saved));
      }
      setMessage(`تم تحديث حالة ${displayOrderNo(order.orderNo)}: ${statusLabel(nextOrder.status)}`);
    } catch (error) {
      setMessage(`تعذر تحديث حالة الطلب: ${safeErrorMessage(error)}`);
    }
  }

  const totals = orderTotals(draft);
  const smartOptions = useMemo(() => buildSmartOptions(data), [data]);
  const priceHistory = useMemo(() => buildPriceHistory(data.orders), [data.orders]);
  const connectionLabel = data.source === "local-server" ? `Local: ${localApiBase()}` : data.source === "supabase" ? "Supabase online" : "Local database disconnected";
  const cairoNow = useMemo(() => clockText("Africa/Cairo"), [clockTick]);
  const utcNow = useMemo(() => clockText("UTC"), [clockTick]);
  const appLogoSrc = appLogo;
  const reportLogoSrc = appearance.reportLogoDataUrl || hgadReportLogo;

  if (!currentUser) {
    return (
      <>
        {loading && <LoadingLayer logoSrc={appLogoSrc} />}
        <LoginView
          onLogin={handleLogin}
          onSetupPassword={handleSetupSupabasePassword}
          onResetPassword={handleResetSupabasePassword}
          supabaseMode={hasSupabaseConfig()}
          message={message}
          onClearMessage={() => setMessage("")}
          busy={loading}
          logoSrc={appLogoSrc}
        />
        {passwordRecoveryOpen && <PasswordRecoveryModal busy={loading} onSave={completePasswordRecovery} onClose={() => setPasswordRecoveryOpen(false)} />}
      </>
    );
  }

  return (
    <main className="app-shell" dir="rtl">
      {loading && <LoadingLayer logoSrc={appLogoSrc} />}
      <aside className="sidebar">
        <div className="brand-card">
          <BrandMark small logoSrc={appLogoSrc} />
          <div className="brand-copy">
            <strong>{APP_NAME}</strong>
            <span>إدارة أوامر الزجاج والموردين</span>
            <small>{VERSION} · {BYLINE}</small>
          </div>
        </div>
        <nav>
          {TABS.map(([id, label, Icon]) => (
            <button key={id} className={activeTab === id ? "active" : ""} onClick={() => setActiveTab(id)}>
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>{TABS.find(([id]) => id === activeTab)?.[1]}</h1>
            <p dir="ltr">{connectionLabel}</p>
          </div>
          <div className="top-actions">
            <span className="time-chip" dir="ltr">Cairo {cairoNow}</span>
            <span className="time-chip" dir="ltr">UTC {utcNow}</span>
            <span className="user-chip">Eng. {currentUser.display_name}</span>
            <button className="icon-button" title="تحديث" onClick={refresh}><RefreshCw size={18} /></button>
            <button className="primary" onClick={() => newOrder()}><Plus size={18} />طلب جديد</button>
            <button className="icon-button" title="خروج" onClick={logout}><LogOut size={18} /></button>
          </div>
        </header>
        {message && <Notice message={message} onClose={() => setMessage("")} />}
        <SyncStatusBanner online={online} pending={pendingSyncCount} syncing={syncing} onSync={() => syncPendingChanges()} />

        {activeTab === "dashboard" && (
          <DashboardView
            data={data}
            pendingSyncCount={pendingSyncCount}
            online={online}
            onOpenOrders={() => setActiveTab("orders")}
            onNewOrder={() => newOrder()}
          />
        )}
        {activeTab === "entry" && (
          <EntryView
            draft={draft}
            setDraft={setDraft}
            customers={data.customers}
            suppliers={data.suppliers}
            learnedOptions={data.learnedOptions}
            smartOptions={smartOptions}
            priceHistory={priceHistory}
            totals={totals}
            onSave={saveDraft}
            onPreview={() => setPreview({ type: "order", order: draft })}
            onExportPdf={() => exportOrderPdf(draft, currentUser, reportLogoSrc)}
            onExportExcel={() => exportOrderExcel(draft)}
            onCancel={cancelEntrySession}
            notify={setMessage}
          />
        )}
        {activeTab === "orders" && (
          <OrdersStatusView
            data={data}
            currentUser={currentUser}
            logoSrc={reportLogoSrc}
            onOpen={openOrder}
            onUpdateOrder={updateOrderStatus}
            onPreview={(report) => setPreview({ type: "orderStatus", report })}
          />
        )}
        {activeTab === "customers" && (
          <CustomersView orders={data.orders} customers={data.customers} onOpen={openOrder} onCopy={copyOrder} onPreview={(order) => setPreview({ type: "order", order })} currentUser={currentUser} logoSrc={reportLogoSrc} />
        )}
        {activeTab === "suppliers" && (
          <SuppliersView
            data={data}
            onPayment={setSupplierPayment}
            onEditPayment={(supplier, payment) => setSupplierPayment({ ...supplier, payment })}
            onDeletePayment={deleteSupplierPayment}
            onPreview={(supplier) => setPreview({ type: "supplier", supplier, data })}
          />
        )}
        {activeTab === "statements" && (
          <StatementsView
            data={data}
            onPreview={(statement) => setPreview({ type: "statement", statement })}
            onExportPdf={(statement) => exportStatementPdf(statement, currentUser, reportLogoSrc)}
            onExportExcel={exportStatementExcel}
          />
        )}
        {activeTab === "settings" && <SettingsView refreshAll={refresh} localStatus={localStatus} setMessage={setMessage} setLocalStatus={setLocalStatus} currentUser={currentUser} data={data} setData={setData} appearance={appearance} setAppearance={setAppearance} appLogoSrc={appLogoSrc} reportLogoSrc={reportLogoSrc} />}
      </section>

      {preview && <PreviewModal preview={preview} currentUser={currentUser} logoSrc={reportLogoSrc} onClose={() => setPreview(null)} />}
      {supplierPayment && <PaymentModal supplier={supplierPayment} onClose={() => setSupplierPayment(null)} onSave={addSupplierPayment} />}
      {passwordRecoveryOpen && <PasswordRecoveryModal busy={loading} onSave={completePasswordRecovery} onClose={() => setPasswordRecoveryOpen(false)} />}
    </main>
  );
}

function Notice({ message, onClose }) {
  const tone = noticeTone(message);
  return (
    <div className={`notice ${tone}`} role="status">
      <span>{message}</span>
      <button className="notice-close" type="button" title="إغلاق" onClick={onClose}><XCircle size={16} /></button>
    </div>
  );
}

function noticeTone(message = "") {
  const text = String(message).toLowerCase();
  if (/(تعذر|فشل|خطأ|error|failed|enoent|missing|غير صحيحة|غير موجود|not found|cannot|can't)/i.test(text)) return "error";
  if (/(جاري|جار|تشغيل|إعداد|اعداد|تحميل|starting|checking|installing|running|مزامنة|syncing)/i.test(text)) return "setup";
  return "success";
}

function SyncStatusBanner({ online, pending, syncing, onSync }) {
  if (online && !pending && !syncing) return null;
  return (
    <div className={online ? "sync-banner pending" : "sync-banner offline"}>
      {online ? <CloudUpload size={18} /> : <WifiOff size={18} />}
      <span>{online ? `بانتظار مزامنة ${pending} عملية مع Supabase.` : "تعمل محلياً الآن. اتصل بالإنترنت للمزامنة قبل الإغلاق."}</span>
      {online && pending > 0 && <button type="button" className="tiny" onClick={onSync} disabled={syncing}>{syncing ? "جار المزامنة" : "مزامنة الآن"}</button>}
    </div>
  );
}

function DashboardView({ data, pendingSyncCount, online, onOpenOrders, onNewOrder }) {
  const orders = data.orders || [];
  const activeOrders = orders.filter((order) => ORDER_STATUS_DEFS.find((status) => status.value === normalizeOrderStatus(order.status))?.pending);
  const collectedOrders = orders.filter((order) => normalizeOrderStatus(order.status) === "collected");
  const payableOrders = orders.filter((order) => ORDER_STATUS_DEFS.find((status) => status.value === normalizeOrderStatus(order.status))?.payable);
  const totalSupplierCost = payableOrders.reduce((sum, order) => sum + orderTotals(order).supplierCost, 0);
  const totalArea = orders.reduce((sum, order) => sum + orderTotals(order).area, 0);
  const statusGroups = ORDER_STATUS_DEFS
    .map((status) => ({ label: status.label, value: orders.filter((order) => normalizeOrderStatus(order.status) === status.value).length, color: status.tone }))
    .filter((item) => item.value > 0);
  const topSuppliers = topGroupedValues(orders, "supplierName", 6);
  const topCustomers = topGroupedValues(orders, "customerName", 6);
  const recentOrders = [...orders].sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))).slice(0, 6);
  return (
    <div className="dashboard-grid">
      <section className="dashboard-hero panel">
        <div>
          <h2>متابعة أوامر الزجاج</h2>
          <p>نظرة تشغيلية على الطلبات، الموردين، العملاء، وحالة المزامنة.</p>
        </div>
        <div className="actions">
          <button className="primary" type="button" onClick={onNewOrder}><Plus size={18} />طلب جديد</button>
          <button type="button" onClick={onOpenOrders}><ClipboardList size={18} />حالة الطلبات</button>
        </div>
      </section>

      <div className="metric-card"><PackageCheck size={20} /><span>طلبات مفتوحة</span><strong>{activeOrders.length}</strong></div>
      <div className="metric-card"><CheckCircle2 size={20} /><span>مستلمة</span><strong>{collectedOrders.length}</strong></div>
      <div className="metric-card"><BadgeDollarSign size={20} /><span>تكلفة الموردين</span><strong>{money(totalSupplierCost)}</strong></div>
      <div className="metric-card"><PieChart size={20} /><span>إجمالي المساحة</span><strong>{square(totalArea)}</strong></div>

      <section className="panel dashboard-chart">
        <div className="panel-head"><h2><PieChart size={18} /> توزيع الحالات</h2></div>
        <PieDonutChart items={statusGroups} total={orders.length} />
      </section>
      <section className="panel dashboard-chart">
        <div className="panel-head"><h2><BarChart3 size={18} /> أعلى الموردين</h2></div>
        <BarList items={topSuppliers} />
      </section>
      <section className="panel dashboard-chart">
        <div className="panel-head"><h2><UsersRound size={18} /> أعلى العملاء</h2></div>
        <BarList items={topCustomers} />
      </section>
      <section className="panel dashboard-chart">
        <div className="panel-head"><h2>{online ? <CloudUpload size={18} /> : <CloudOff size={18} />} المزامنة</h2></div>
        <div className={online && !pendingSyncCount ? "sync-card online" : "sync-card offline"}>
          <strong>{online ? "متصل" : "غير متصل"}</strong>
          <span>{pendingSyncCount ? `${pendingSyncCount} عملية في انتظار Supabase` : "كل البيانات متزامنة"}</span>
        </div>
      </section>

      <section className="panel dashboard-wide">
        <div className="panel-head"><h2>أحدث الطلبات</h2></div>
        <div className="mini-order-list">
          {recentOrders.map((order) => (
            <div key={order.id || order.orderNo} className="mini-order-row">
              <strong dir="ltr">{displayOrderNo(order.orderNo)}</strong>
              <span>{order.customerName || "بدون عميل"}</span>
              <span>{order.supplierName || "بدون مورد"}</span>
              <span>{statusLabel(order.status)}</span>
              <bdi>{formatStatusDate(order.date)}</bdi>
            </div>
          ))}
          {!recentOrders.length && <p className="hint">لا توجد طلبات بعد.</p>}
        </div>
      </section>
    </div>
  );
}

function topGroupedValues(orders, key, limit = 6) {
  const counts = new Map();
  for (const order of orders) {
    const name = cleanName(order[key]) || "غير محدد";
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

function PieDonutChart({ items, total }) {
  if (!items.length || !total) return <p className="hint">لا توجد بيانات كافية للرسم.</p>;
  const colors = ["#d8a83f", "#155f9c", "#087d45", "#b42318", "#8a63d2", "#c76b2c", "#64748b", "#14b8a6"];
  let start = 0;
  const segments = items.map((item, index) => {
    const pct = (item.value / total) * 100;
    const segment = `${colors[index % colors.length]} ${start}% ${start + pct}%`;
    start += pct;
    return segment;
  }).join(", ");
  return (
    <div className="donut-wrap">
      <div className="donut" style={{ background: `conic-gradient(${segments})` }}><span>{total}</span></div>
      <div className="donut-legend">
        {items.map((item, index) => <span key={item.label}><i style={{ background: colors[index % colors.length] }} />{item.label}: {item.value}</span>)}
      </div>
    </div>
  );
}

function BarList({ items }) {
  const max = Math.max(...items.map((item) => item.value), 1);
  if (!items.length) return <p className="hint">لا توجد بيانات كافية للرسم.</p>;
  return (
    <div className="bar-list">
      {items.map((item) => (
        <div className="bar-row" key={item.label}>
          <span>{item.label}</span>
          <div><i style={{ width: `${Math.max(8, (item.value / max) * 100)}%` }} /></div>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}

function BrandMark({ small = false, logoSrc = appLogo }) {
  return (
    <div className={small ? "brand-mark small" : "brand-mark"} dir="ltr" aria-label={APP_NAME}>
      <img className="brand-logo-img" src={logoSrc} alt="Glass Orders" />
      {!small && <small>{BYLINE}</small>}
    </div>
  );
}

function LoadingLayer({ logoSrc = appLogo }) {
  return (
    <div className="loading-layer" dir="ltr">
      <div className="mask-blur" />
      <BrandMark logoSrc={logoSrc} />
      <h2>{APP_NAME}</h2>
      <p>{SUB_NAME}</p>
    </div>
  );
}

function LoginView({ onLogin, onSetupPassword, onResetPassword, supabaseMode, message, onClearMessage, busy, logoSrc }) {
  const [username, setUsername] = useState(() => localStorage.getItem("glassOrdersLastUsername") || "admin");
  const [email, setEmail] = useState(() => localStorage.getItem("glassOrdersLastEmail") || "");
  const [password, setPassword] = useState("");
  async function submit(event) {
    event.preventDefault();
    localStorage.setItem("glassOrdersLastUsername", username);
    if (email) localStorage.setItem("glassOrdersLastEmail", email);
    await onLogin({ username, email, password });
  }
  async function setupPassword() {
    localStorage.setItem("glassOrdersLastUsername", username);
    if (email) localStorage.setItem("glassOrdersLastEmail", email);
    await onSetupPassword?.({ username, email, password });
  }
  async function resetPassword() {
    localStorage.setItem("glassOrdersLastUsername", username);
    if (email) localStorage.setItem("glassOrdersLastEmail", email);
    await onResetPassword?.({ username, email });
  }
  return (
    <main className="login-shell" dir="rtl">
      <section className="login-panel">
        <div className="login-brand">
          <BrandMark small logoSrc={logoSrc} />
          <div>
            <strong>{APP_NAME}</strong>
            <span>{SUB_NAME}</span>
            <small>{BYLINE}</small>
          </div>
        </div>
        <form className="login-form" onSubmit={submit}>
          <Field label="اسم المستخدم">
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
          </Field>
          {supabaseMode && (
            <Field label="البريد المسجل">
              <input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="name@example.com" />
            </Field>
          )}
          <Field label="كلمة المرور">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </Field>
          <button className="primary" disabled={busy}>
            {busy ? <Loader2 className="spin" size={18} /> : <Database size={18} />}
            دخول
          </button>
          {supabaseMode && (
            <div className="login-secondary-actions">
              <button type="button" onClick={setupPassword} disabled={busy || !username || !email || !password}><Mail size={16} />تجهيز كلمة مرور Supabase</button>
              <button type="button" onClick={resetPassword} disabled={busy || !username || !email}><KeyRound size={16} />إعادة تعيين</button>
            </div>
          )}
        </form>
        <div className="login-help">
          <span>{supabaseMode ? "اتصال Supabase مفعّل" : "تجربة بدون قاعدة بيانات Supabase"}</span>
          {!supabaseMode && <span>المستخدم الأول: admin / 23320001</span>}
        </div>
        {message && <Notice message={message} onClose={onClearMessage} />}
      </section>
    </main>
  );
}

function PasswordRecoveryModal({ busy, onSave, onClose }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  async function submit(event) {
    event.preventDefault();
    if (!password || password !== confirm) return;
    await onSave(password);
  }
  return (
    <div className="modal-backdrop">
      <form className="modal recovery-modal" onSubmit={submit}>
        <div className="panel-head">
          <h2><KeyRound size={18} /> تحديث كلمة مرور Supabase</h2>
          <button type="button" onClick={onClose}><XCircle size={18} />إغلاق</button>
        </div>
        <div className="form-grid">
          <Field label="كلمة المرور الجديدة">
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required />
          </Field>
          <Field label="تأكيد كلمة المرور">
            <input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" required />
          </Field>
        </div>
        <div className="actions modal-actions">
          <button className="primary" type="submit" disabled={busy || !password || password !== confirm}><Save size={18} />حفظ كلمة المرور</button>
        </div>
      </form>
    </div>
  );
}

function EntryView({ draft, setDraft, customers, suppliers, learnedOptions, smartOptions, priceHistory, totals, onSave, onPreview, onExportPdf, onExportExcel, onCancel, notify }) {
  const [tableFullScreen, setTableFullScreen] = useState(false);
  const tableScrollRef = useRef(null);
  function patch(patchValue) {
    setDraft((current) => ({ ...current, ...patchValue }));
  }
  function updateRow(index, updater) {
    setDraft((current) => {
      const rows = [...current.rows];
      rows[index] = typeof updater === "function" ? updater(rows[index]) : { ...rows[index], ...updater };
      return { ...current, rows };
    });
  }
  function addRow() {
    setDraft((current) => ({ ...current, rows: [...current.rows, makeRow()] }));
  }
  function removeRow(index) {
    if (!window.confirm("هل تريد حذف هذا الصف؟")) return;
    setDraft((current) => ({ ...current, rows: current.rows.length === 1 ? current.rows : current.rows.filter((_, i) => i !== index) }));
  }
  function handleTableWheel(event) {
    if (!event.shiftKey || !tableScrollRef.current) return;
    event.preventDefault();
    tableScrollRef.current.scrollLeft += event.deltaY;
  }
  function rowWithMeasurements(baseRow, measurements) {
    const base = makeRow({ ...baseRow, id: uid(), expanded: false, drawing: normalizeDrawing() });
    return makeRow({
      ...base,
      id: uid(),
      quantity: measurements.quantity,
      expanded: false,
      drawing: normalizeDrawing(),
      layers: base.layers.map((layer) => ({
        ...layer,
        width: measurements.width,
        height: measurements.height
      }))
    });
  }
  function applyPastedMeasurements(text, startIndex = null) {
    const parsedRows = parseMeasurementPaste(text);
    if (!parsedRows.length) {
      notify?.("لم أستطع قراءة المقاسات من النص الملصوق.");
      return false;
    }
    const manualRows = draft.rows.some(rowHasManualInput);
    const resolvedStart = Number.isInteger(startIndex) && startIndex >= 0 ? startIndex : null;
    if (manualRows && resolvedStart == null && !window.confirm("استبدال جدول المقاسات الحالي بالمقاسات الملصوقة؟")) return false;
    setDraft((current) => {
      const baseRow = current.rows[resolvedStart ?? 0] || current.rows[0] || makeRow();
      const pasted = parsedRows.map((measurements) => rowWithMeasurements(baseRow, measurements));
      const rows = !manualRows || resolvedStart == null
        ? pasted
        : [
            ...current.rows.slice(0, resolvedStart),
            ...pasted,
            ...current.rows.slice(resolvedStart + parsedRows.length)
          ];
      return { ...current, rows };
    });
    notify?.(`تم لصق ${parsedRows.length} صف مقاسات.`);
    return true;
  }
  async function pasteMeasurementsFromClipboard() {
    try {
      const text = await navigator.clipboard?.readText?.();
      if (!text) throw new Error("clipboard-empty");
      applyPastedMeasurements(text, null);
    } catch {
      notify?.("استخدم Ctrl+V داخل جدول الإدخال للصق المقاسات.");
    }
  }
  function handleTablePaste(event) {
    const text = event.clipboardData?.getData("text/plain") || "";
    if (!text) return;
    const activeRow = Number(event.target?.dataset?.row);
    const parsedRows = parseMeasurementPaste(text);
    if (!parsedRows.length) return;
    event.preventDefault();
    applyPastedMeasurements(text, Number.isInteger(activeRow) ? activeRow : null);
  }
  return (
    <div className={tableFullScreen ? "stack table-fullscreen-active" : "stack"}>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>بيانات الطلب</h2>
            <p>أدخل بيانات العميل والمورد والمشروع، ثم أضف مقاسات الزجاج في الجدول.</p>
          </div>
          <div className="actions">
            <button className="danger" onClick={onCancel}><XCircle size={18} />{draft.id ? "إلغاء التعديل" : "مسح الإدخال"}</button>
            <button onClick={onPreview}><Eye size={18} />معاينة</button>
            <button onClick={onExportPdf}><FileDown size={18} />PDF</button>
            <button onClick={onExportExcel}><Download size={18} />Excel</button>
            <button className="primary" onClick={onSave}><Save size={18} />حفظ</button>
          </div>
        </div>
        <div className="form-grid">
          <Field label="رقم الطلب الداخلي"><input className="generated-id" dir="ltr" value={displayOrderNo(draft.orderNo)} readOnly title="رقم تلقائي لا يتكرر" /></Field>
          <Field label="رقم إذن / طلب المورد"><input dir="ltr" value={draft.documentId} onChange={(e) => patch({ documentId: e.target.value })} /></Field>
          <Field label="التاريخ"><input type="date" dir="ltr" value={draft.date} onChange={(e) => patch({ date: e.target.value })} /></Field>
          <Field label="حالة الطلب">
            <select value={normalizeOrderStatus(draft.status)} onChange={(e) => patch({ status: e.target.value })}>
              {ORDER_STATUS_DEFS.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
            </select>
          </Field>
          <Field label="وضع الإدخال">
            <select value={draft.entryMode} onChange={(e) => patch({ entryMode: e.target.value })}>
              <option value="normal">طلب زجاج عادي</option>
              <option value="drawings">طلب زجاج برسم</option>
            </select>
          </Field>
          <Field label="العميل"><Combo value={draft.customerName} options={customers.map((c) => c.name)} onChange={(customerName) => patch({ customerName })} /></Field>
          <Field label="المورد"><Combo value={draft.supplierName} options={suppliers.map((s) => s.name)} onChange={(supplierName) => patch({ supplierName })} /></Field>
          <Field label="المشروع"><input value={draft.project} onChange={(e) => patch({ project: e.target.value })} /></Field>
        </div>
      </section>
      <section className={tableFullScreen ? "panel table-panel fullscreen-table" : "panel table-panel"}>
        <div className="panel-head">
          <div>
            <h2>جدول الادخال</h2>
          </div>
          <div className="actions">
            <button onClick={pasteMeasurementsFromClipboard}><ClipboardList size={18} />لصق مقاسات</button>
            <button onClick={() => setTableFullScreen((value) => !value)}>
              {tableFullScreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
              {tableFullScreen ? "رجوع" : "ملء الشاشة"}
            </button>
          </div>
        </div>
        <div className="table-scroll" ref={tableScrollRef} onWheel={handleTableWheel} onPaste={handleTablePaste}>
          <div className="smart-table">
            <div className="table-row table-head">
              <span>البيان</span><span>النظام</span><span>الطبقات والأسعار</span><span>ملاحظات</span><span>م2</span><span>إجمالي الفاتورة</span><span>تكلفة المورد</span><span>الرسم</span><span></span>
            </div>
            {draft.rows.map((row, index) => (
              <GlassRowEditor
                key={row.id}
                row={row}
                index={index}
                supplierName={draft.supplierName}
                drawingEnabled={draft.entryMode === "drawings"}
                learnedOptions={learnedOptions}
                smartOptions={smartOptions}
                priceHistory={priceHistory}
                updateRow={(updater) => updateRow(index, updater)}
                addRow={addRow}
                removeRow={() => removeRow(index)}
              />
            ))}
          </div>
        </div>
      </section>
      <OrderTotalsPanel totals={totals} floating={tableFullScreen} />
    </div>
  );
}

function OrderTotalsPanel({ totals, floating = false }) {
  return (
    <details className={floating ? "totals-panel floating" : "totals-panel"} open={!floating}>
      <summary>إجماليات الطلب</summary>
      <div className="totals-bar">
        <span>إجمالي القطع <strong>{money(totals.pieces)}</strong></span>
        <span>إجمالي المساحة <strong>{square(totals.area)} م2</strong></span>
        <span>إجمالي الفاتورة <strong>{money(totals.total)}</strong></span>
        <span>تكلفة المورد <strong>{money(totals.supplierCost)}</strong></span>
      </div>
    </details>
  );
}

function GlassRowEditor({ row, index, supplierName, learnedOptions, smartOptions, priceHistory, drawingEnabled, updateRow, addRow, removeRow }) {
  const totals = rowTotals(row);
  const hasLayerSizeDifference = rowHasLayerSizeDifference(row);
  const tableCellProps = (column) => ({
    className: "table-control",
    "data-row": index,
    "data-col": column
  });
  function patch(patchValue) {
    updateRow({ ...row, ...patchValue });
  }
  function setMode(glassMode) {
    updateRow({ ...row, glassMode, layers: normalizeLayers(glassMode, row.layers) });
  }
  function updateLayer(layerIndex, patchValue) {
    const autoPriceKeys = ["glassType", "company", "thickness", "secure"];
    const layers = row.layers.map((layer, i) => {
      if (i !== layerIndex) return layer;
      const nextLayer = { ...layer, ...patchValue };
      if (autoPriceKeys.some((key) => Object.prototype.hasOwnProperty.call(patchValue, key))) {
        const latest = findLatestLayerPrice(priceHistory, supplierName, nextLayer);
        if (latest) {
          nextLayer.unitPrice = latest.unitPrice ?? nextLayer.unitPrice;
          nextLayer.supplierUnitPrice = latest.supplierUnitPrice ?? nextLayer.supplierUnitPrice;
        }
      }
      return nextLayer;
    });
    updateRow({ ...row, layers });
  }
  function patchMaterial(patchValue) {
    const next = { ...row, ...patchValue };
    const changedValue = Object.prototype.hasOwnProperty.call(patchValue, "doubleGap")
      ? patchValue.doubleGap
      : Object.prototype.hasOwnProperty.call(patchValue, "triplexPvb")
        ? patchValue.triplexPvb
        : "";
    if (changedValue) {
      const latest = findLatestMaterialPrice(priceHistory, supplierName, next.glassMode, changedValue);
      if (latest) {
        next.materialUnitPrice = latest.materialUnitPrice ?? next.materialUnitPrice;
        next.supplierMaterialUnitPrice = latest.supplierMaterialUnitPrice ?? next.supplierMaterialUnitPrice;
      }
    }
    updateRow(next);
  }
  function focusTableField(rowIndex, column) {
    const selector = `.table-control[data-row="${rowIndex}"][data-col="${CSS.escape(column)}"]`;
    const target = document.querySelector(selector);
    if (!target) return false;
    target.focus();
    if (typeof target.select === "function") target.select();
    target.scrollIntoView({ block: "nearest", inline: "nearest" });
    return true;
  }
  function handleEnter(event) {
    if (event.key !== "Enter") return;
    if (event.target?.tagName === "BUTTON" || event.target?.closest(".drawing-editor")) return;
    const column = event.target?.dataset?.col;
    if (!column) return;
    event.preventDefault();
    const nextRow = index + 1;
    if (focusTableField(nextRow, column)) return;
    addRow();
    window.setTimeout(() => focusTableField(nextRow, column), 60);
  }
  return (
    <div className="table-entry" onKeyDown={handleEnter}>
      <div className="table-row">
        <div className="description" dir="auto">{rowDescription(row)}</div>
        <select {...tableCellProps("mode")} value={row.glassMode} onChange={(e) => setMode(e.target.value)}>
          <option value="single">Single</option>
          <option value="double">Double</option>
          <option value="triplex">Triplex</option>
        </select>
        <div className="layers-cell">
          <div className="layer-head">
            <span>#</span><span>عرض سم</span><span>طول سم</span><span>العدد</span><span>نوع الزجاج</span><span>الشركة</span><span>السمك</span><span>سعر/م2</span><span>تكلفة/م2</span><span>سيكوريت</span><span>لون</span><span>شفافية</span><span>Mirror</span>
          </div>
          {row.layers.map((layer, layerIndex) => (
            <React.Fragment key={layerIndex}>
              <div className="layer-line">
                <span className="layer-index">{layerIndex + 1}</span>
                <input {...tableCellProps(`layer${layerIndex}-width`)} inputMode="decimal" dir="ltr" value={layer.width} onChange={(e) => updateLayer(layerIndex, { width: e.target.value })} placeholder="عرض سم" title="العرض بالسنتيمتر" />
                <input {...tableCellProps(`layer${layerIndex}-height`)} inputMode="decimal" dir="ltr" value={layer.height} onChange={(e) => updateLayer(layerIndex, { height: e.target.value })} placeholder="طول سم" title="الطول بالسنتيمتر" />
                {layerIndex === 0 ? (
                  <input {...tableCellProps("quantity")} inputMode="decimal" dir="ltr" value={row.quantity} onChange={(e) => patch({ quantity: e.target.value })} title="عدد القطع لهذا البيان" />
                ) : (
                  <span className="shared-quantity" dir="ltr">{row.quantity}</span>
                )}
                <Combo {...tableCellProps(`layer${layerIndex}-glassType`)} value={layer.glassType} options={smartOptions.glassTypes} onChange={(glassType) => updateLayer(layerIndex, { glassType })} />
                <Combo {...tableCellProps(`layer${layerIndex}-company`)} value={layer.company} options={smartOptions.companies} onChange={(company) => updateLayer(layerIndex, { company })} />
                <Combo {...tableCellProps(`layer${layerIndex}-thickness`)} value={layer.thickness} options={smartOptions.thicknesses} onChange={(thickness) => updateLayer(layerIndex, { thickness })} />
                <input {...tableCellProps(`layer${layerIndex}-unitPrice`)} inputMode="decimal" dir="ltr" value={layer.unitPrice} onChange={(e) => updateLayer(layerIndex, { unitPrice: e.target.value })} placeholder="سعر/م2" title="سعر هذه الطبقة لكل متر مربع" />
                <input {...tableCellProps(`layer${layerIndex}-supplierUnitPrice`)} inputMode="decimal" dir="ltr" value={layer.supplierUnitPrice} onChange={(e) => updateLayer(layerIndex, { supplierUnitPrice: e.target.value })} placeholder="تكلفة/م2" title="تكلفة المورد لهذه الطبقة لكل متر مربع" />
                <label className="check-cell"><input {...tableCellProps(`layer${layerIndex}-secure`)} type="checkbox" checked={layer.secure} onChange={(e) => updateLayer(layerIndex, { secure: e.target.checked })} onKeyDown={(e) => e.key === " " && updateLayer(layerIndex, { secure: !layer.secure })} />سيكوريت</label>
                <input {...tableCellProps(`layer${layerIndex}-color`)} type="color" value={layer.color} onChange={(e) => updateLayer(layerIndex, { color: e.target.value })} title="لون الطبقة" />
                <input {...tableCellProps(`layer${layerIndex}-alpha`)} inputMode="numeric" dir="ltr" value={layer.alpha ?? 45} onChange={(e) => updateLayer(layerIndex, { alpha: e.target.value })} title="شفافية الطبقة من 0 إلى 100" />
                <label className="check-cell"><input {...tableCellProps(`layer${layerIndex}-mirror`)} type="checkbox" checked={layer.mirror} onChange={(e) => updateLayer(layerIndex, { mirror: e.target.checked })} />Mirror</label>
              </div>
              {layerIndex === 0 && row.glassMode !== "single" && (
                <div className="material-line">
                  <span className="layer-index">M</span>
                  <div className="material-choice">
                    {row.glassMode === "double" ? (
                      <Combo {...tableCellProps("doubleGap")} value={row.doubleGap} options={smartOptions.gaps || learnedOptions} onChange={(doubleGap) => patchMaterial({ doubleGap })} />
                    ) : (
                      <Combo {...tableCellProps("triplexPvb")} value={row.triplexPvb} options={smartOptions.pvb} onChange={(triplexPvb) => patchMaterial({ triplexPvb })} />
                    )}
                  </div>
                  <span className="material-note">{row.glassMode === "double" ? "اسبيسر / متر طولي" : "PVB / م2"}</span>
                  <input {...tableCellProps("materialUnitPrice")} inputMode="decimal" dir="ltr" value={row.materialUnitPrice} onChange={(e) => patch({ materialUnitPrice: e.target.value })} placeholder="سعر المادة" />
                  <input {...tableCellProps("supplierMaterialUnitPrice")} inputMode="decimal" dir="ltr" value={row.supplierMaterialUnitPrice} onChange={(e) => patch({ supplierMaterialUnitPrice: e.target.value })} placeholder="تكلفة المادة" />
                </div>
              )}
            </React.Fragment>
          ))}
          {row.layers.length > 1 && hasLayerSizeDifference && (
            <div className="layer-line compact">
              <select {...tableCellProps("extraDirection")} value={row.extraDirection} onChange={(e) => patch({ extraDirection: e.target.value })}>{EXTRA_DIRECTIONS.map((item) => <option key={item}>{item}</option>)}</select>
              <span className="hint">التموضع يؤثر على الطبقات والرسم عند اختلاف المقاسات.</span>
            </div>
          )}
        </div>
        <input {...tableCellProps("notes")} value={row.notes || ""} onChange={(e) => patch({ notes: e.target.value })} placeholder="ملاحظات البيان" />
        <strong dir="ltr">{square(totals.area)}</strong>
        <strong dir="ltr">{money(totals.total)}</strong>
        <strong dir="ltr">{money(totals.supplierCost)}</strong>
        <button className={row.expanded ? "active tiny" : "tiny"} onClick={() => patch({ expanded: !row.expanded })}><Pencil size={16} />{drawingEnabled ? "رسم" : ""}</button>
        <button className="icon-button danger" onClick={removeRow}><Trash2 size={16} /></button>
      </div>
      {drawingEnabled && !row.expanded && (
        <div className="drawing-collapsed">
          <button className="tiny" onClick={() => patch({ expanded: true })}><Pencil size={16} />فتح رسم هذا الصف</button>
          <span>الرسم مرتبط بمقاسات الصف والطبقات.</span>
        </div>
      )}
      {(drawingEnabled || row.expanded) && row.expanded && (
        <DrawingEditor row={row} updateRow={updateRow} />
      )}
    </div>
  );
}

function DrawingEditor({ row, updateRow }) {
  const [tool, setTool] = useState("select");
  const [drag, setDrag] = useState(null);
  const [selectedShapeId, setSelectedShapeId] = useState(null);
  const [viewScale, setViewScale] = useState(1);
  const editorRef = useRef(null);
  const svgRef = useRef(null);
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const drawing = normalizeDrawing(row.drawing);
  const shapes = drawing.shapes || [];
  const paths = drawing.paths || [];
  const selectedShape = shapes.find((shape) => shape.id === selectedShapeId) || null;
  const maxW = Math.max(200, ...row.layers.map((layer) => cmToMm(layer.width, 100)));
  const maxH = Math.max(200, ...row.layers.map((layer) => cmToMm(layer.height, 100)));
  const pad = 360;
  const viewBox = `${-pad} ${-pad} ${maxW + pad * 2} ${maxH + pad * 2}`;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, numberValue(value)));
  }
  function layerGeometry(layer, layerIndex) {
    const width = Math.max(1, cmToMm(layer.width, 100));
    const height = Math.max(1, cmToMm(layer.height, 100));
    const freeX = Math.max(0, maxW - width);
    const freeY = Math.max(0, maxH - height);
    const direction = row.extraDirection || "في المنتصف تماماً";
    const aligned = {
      x: direction === "الي اليمين" ? freeX : direction === "في المنتصف تماماً" ? freeX / 2 : 0,
      y: direction === "الي الاسفل" ? freeY : direction === "في المنتصف تماماً" ? freeY / 2 : 0
    };
    if (direction === "الي الاعلي") aligned.y = 0;
    if (direction === "الي اليسار") aligned.x = 0;
    const visualOffset = layerIndex * 28;
    return {
      width,
      height,
      x: aligned.x + clamp(layer.offsetX, -freeX, freeX) + visualOffset,
      y: aligned.y + clamp(layer.offsetY, -freeY, freeY) + visualOffset,
      offset: visualOffset
    };
  }
  const layerGeometries = row.layers.map(layerGeometry);
  const baseGeometry = layerGeometries[0] || { x: 0, y: 0, width: maxW, height: maxH };
  const outlinePoints = outlinePointsForGeometry(drawing, baseGeometry);
  const outlineBounds = boundsFromOutline(outlinePoints, baseGeometry);
  const outlineDims = outlineDimensionItems(outlinePoints, baseGeometry);
  const curveDims = curveDepthItems(outlinePoints, baseGeometry);

  function svgPointFromEvent(event) {
    if (!svgRef.current) return { x: 0, y: 0 };
    const point = svgRef.current.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(svgRef.current.getScreenCTM().inverse());
  }
  function mmFromEvent(event) {
    const transformed = svgPointFromEvent(event);
    return { x: clamp(transformed.x, outlineBounds.x, outlineBounds.right), y: clamp(transformed.y, outlineBounds.y, outlineBounds.bottom) };
  }
  function outlinePointFromEvent(event, geometry = baseGeometry) {
    const point = svgPointFromEvent(event);
    return {
      x: clamp(point.x, geometry.x - 320, geometry.x + geometry.width + 320),
      y: clamp(point.y, geometry.y - 320, geometry.y + geometry.height + 320)
    };
  }
  function workspacePointFromEvent(event) {
    const point = svgPointFromEvent(event);
    return {
      x: clamp(point.x, -pad + 40, maxW + pad - 40),
      y: clamp(point.y, -pad + 40, maxH + pad - 40)
    };
  }
  useEffect(() => {
    if (selectedShapeId && !shapes.some((shape) => shape.id === selectedShapeId)) setSelectedShapeId(null);
  }, [selectedShapeId, shapes]);

  useEffect(() => {
    document.body.classList.toggle("drawing-dragging", !!drag);
    return () => document.body.classList.remove("drawing-dragging");
  }, [drag]);

  useEffect(() => {
    function handleKey(event) {
      if (!editorRef.current?.contains(document.activeElement)) return;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(event.target?.tagName)) return;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === "z") {
        event.preventDefault();
        undoDrawing();
      } else if ((event.ctrlKey || event.metaKey) && (key === "y" || (event.shiftKey && key === "z"))) {
        event.preventDefault();
        redoDrawing();
      } else if ((event.key === "Delete" || event.key === "Backspace") && selectedShapeId) {
        event.preventDefault();
        deleteShape(selectedShapeId);
      } else if (event.key === "Escape") {
        event.preventDefault();
        setSelectedShapeId(null);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  function setDrawing(next) {
    updateRow({ ...row, drawing: normalizeDrawing(next) });
  }
  function pushHistory() {
    undoStackRef.current = [...undoStackRef.current.slice(-59), normalizeDrawing(drawing)];
    redoStackRef.current = [];
  }
  function commitDrawing(next) {
    pushHistory();
    setDrawing(next);
  }
  function undoDrawing() {
    const previous = undoStackRef.current.pop();
    if (!previous) return;
    redoStackRef.current = [...redoStackRef.current.slice(-59), normalizeDrawing(drawing)];
    setDrawing(previous);
  }
  function redoDrawing() {
    const next = redoStackRef.current.pop();
    if (!next) return;
    undoStackRef.current = [...undoStackRef.current.slice(-59), normalizeDrawing(drawing)];
    setDrawing(next);
  }
  function updateShape(id, patchValue) {
    setSelectedShapeId(id);
    commitDrawing({ ...drawing, shapes: shapes.map((shape) => shape.id === id ? { ...shape, ...patchValue } : shape) });
  }
  function setOutlinePoints(points) {
    setDrawing({ ...drawing, outline: { points: points.map((point, index) => normalizeOutlinePoint(point, index)) } });
  }
  function resetShape() {
    commitDrawing({
      ...drawing,
      outline: { points: [] },
      edges: { top: 0, right: 0, bottom: 0, left: 0 }
    });
  }
  function pointerDown(event) {
    event.preventDefault();
    editorRef.current?.focus();
    if (tool === "edge") return;
    const point = tool === "arrow" || tool === "text" ? workspacePointFromEvent(event) : mmFromEvent(event);
    if (tool === "select") {
      setSelectedShapeId(null);
      return;
    }
    const id = uid();
    if (tool === "circle") {
      commitDrawing({ ...drawing, shapes: [...shapes, { id, kind: "circle", x: point.x, y: point.y, r: 25, layer: 0 }] });
    } else if (tool === "rect") {
      commitDrawing({ ...drawing, shapes: [...shapes, { id, kind: "rect", x: point.x, y: point.y, w: 80, h: 50, layer: 0 }] });
    } else if (tool === "text") {
      commitDrawing({ ...drawing, shapes: [...shapes, { id, kind: "text", x: point.x, y: point.y, text: "ملاحظة", layer: 0 }] });
    } else if (tool === "arrow") {
      commitDrawing({ ...drawing, shapes: [...shapes, { id, kind: "arrow", x1: point.x, y1: point.y, x2: clamp(point.x + 160, -pad + 40, maxW + pad - 40), y2: point.y, text: "", layer: 0 }] });
    }
    setSelectedShapeId(id);
  }
  function pointerMove(event) {
    if (drag?.outlinePoint) {
      const point = outlinePointFromEvent(event, baseGeometry);
      const next = outlinePoints.map((outlinePoint, pointIndex) => {
        if (pointIndex !== drag.index) return outlinePoint;
        return {
          ...outlinePoint,
          x: Math.round(point.x),
          y: Math.round(point.y),
          curve: drag.canCurve ? true : outlinePoint.curve
        };
      });
      setOutlinePoints(next);
      return;
    }
    if (drag?.outlineSegment) {
      const point = outlinePointFromEvent(event, baseGeometry);
      const deltaX = point.x - drag.startMouse.x;
      const deltaY = point.y - drag.startMouse.y;
      const amount = deltaX * drag.normal.x + deltaY * drag.normal.y;
      const offsetX = drag.normal.x * amount;
      const offsetY = drag.normal.y * amount;
      const next = drag.points.map((outlinePoint, pointIndex) => {
        if (pointIndex !== drag.startIndex && pointIndex !== drag.endIndex) return outlinePoint;
        const original = pointIndex === drag.startIndex ? drag.startPoint : drag.endPoint;
        return {
          ...outlinePoint,
          x: Math.round(clamp(original.x + offsetX, baseGeometry.x - 320, baseGeometry.x + baseGeometry.width + 320)),
          y: Math.round(clamp(original.y + offsetY, baseGeometry.y - 320, baseGeometry.y + baseGeometry.height + 320)),
          curve: false
        };
      });
      setOutlinePoints(next);
      return;
    }
    const point = mmFromEvent(event);
    if (drag) {
      const next = shapes.map((shape) => {
        if (shape.id !== drag.id) return shape;
        if (shape.kind === "arrow") {
          const freePoint = workspacePointFromEvent(event);
          if (drag.handle === "start") return { ...shape, x1: freePoint.x, y1: freePoint.y };
          if (drag.handle === "end") return { ...shape, x2: freePoint.x, y2: freePoint.y };
          const dx = freePoint.x - drag.anchorX;
          const dy = freePoint.y - drag.anchorY;
          return {
            ...shape,
            x1: clamp(drag.x1 + dx, -pad + 40, maxW + pad - 40),
            y1: clamp(drag.y1 + dy, -pad + 40, maxH + pad - 40),
            x2: clamp(drag.x2 + dx, -pad + 40, maxW + pad - 40),
            y2: clamp(drag.y2 + dy, -pad + 40, maxH + pad - 40)
          };
        }
        if (shape.kind === "text") {
          const freePoint = workspacePointFromEvent(event);
          return { ...shape, x: clamp(freePoint.x - drag.dx, -pad + 40, maxW + pad - 40), y: clamp(freePoint.y - drag.dy, -pad + 40, maxH + pad - 40) };
        }
        const nextX = point.x - drag.dx;
        const nextY = point.y - drag.dy;
        if (shape.kind === "circle") {
          return { ...shape, x: clamp(nextX, outlineBounds.x + numberValue(shape.r), outlineBounds.right - numberValue(shape.r)), y: clamp(nextY, outlineBounds.y + numberValue(shape.r), outlineBounds.bottom - numberValue(shape.r)) };
        }
        return { ...shape, x: clamp(nextX, outlineBounds.x, outlineBounds.right - numberValue(shape.w)), y: clamp(nextY, outlineBounds.y, outlineBounds.bottom - numberValue(shape.h)) };
      });
      setDrawing({ ...drawing, shapes: next });
    }
  }
  function pointerUp() {
    setDrag(null);
  }
  function zoomDrawing(delta) {
    setViewScale((value) => Math.max(0.35, Math.min(4, Number((value + delta).toFixed(2)))));
  }
  function handleDrawingWheel(event) {
    if (!event.ctrlKey) return;
    event.preventDefault();
    zoomDrawing(event.deltaY < 0 ? 0.1 : -0.1);
  }
  function resetDrawingView() {
    setViewScale(1);
  }
  function startShapeDrag(event, shape) {
    event.preventDefault();
    event.stopPropagation();
    editorRef.current?.focus();
    setSelectedShapeId(shape.id);
    pushHistory();
    const point = shape.kind === "arrow" || shape.kind === "text" ? workspacePointFromEvent(event) : mmFromEvent(event);
    if (shape.kind === "arrow") {
      setDrag({ id: shape.id, anchorX: point.x, anchorY: point.y, x1: numberValue(shape.x1), y1: numberValue(shape.y1), x2: numberValue(shape.x2), y2: numberValue(shape.y2) });
      return;
    }
    setDrag({ id: shape.id, dx: point.x - shape.x, dy: point.y - shape.y });
  }
  function startArrowHandleDrag(event, shape, handle) {
    event.preventDefault();
    event.stopPropagation();
    editorRef.current?.focus();
    setSelectedShapeId(shape.id);
    pushHistory();
    setDrag({ id: shape.id, handle });
  }
  function deleteShape(id) {
    commitDrawing({ ...drawing, shapes: shapes.filter((shape) => shape.id !== id), paths: paths.filter((path) => path.id !== id) });
    setSelectedShapeId(null);
  }
  function addOutlinePoint(event, segmentIndex) {
    event.preventDefault();
    event.stopPropagation();
    if (tool !== "edge") return;
    pushHistory();
    const point = outlinePointFromEvent(event, baseGeometry);
    const next = outlinePoints.map((outlinePoint, index) => normalizeOutlinePoint(outlinePoint, index));
    const pointIndex = segmentIndex + 1;
    next.splice(pointIndex, 0, {
      id: uid(),
      x: Math.round(point.x),
      y: Math.round(point.y),
      corner: false,
      curve: false
    });
    setOutlinePoints(next);
    setDrag({ outlinePoint: true, index: pointIndex, canCurve: canCurveOutlinePoint(next, pointIndex) });
  }
  function startOutlinePointDrag(event, point, pointIndex) {
    event.preventDefault();
    event.stopPropagation();
    if (point.corner) return;
    pushHistory();
    setDrag({ outlinePoint: true, index: pointIndex, canCurve: canCurveOutlinePoint(outlinePoints, pointIndex) });
  }
  function startOutlineSegmentDrag(event, segment) {
    event.preventDefault();
    event.stopPropagation();
    if (segment.start.corner || segment.end.corner) return;
    pushHistory();
    const startMouse = outlinePointFromEvent(event, baseGeometry);
    const dx = numberValue(segment.end.x) - numberValue(segment.start.x);
    const dy = numberValue(segment.end.y) - numberValue(segment.start.y);
    const length = Math.max(1, Math.hypot(dx, dy));
    setDrag({
      outlineSegment: true,
      startIndex: segment.index,
      endIndex: (segment.index + 1) % outlinePoints.length,
      startPoint: { ...segment.start },
      endPoint: { ...segment.end },
      startMouse,
      normal: { x: -dy / length, y: dx / length },
      points: outlinePoints.map((point, index) => normalizeOutlinePoint(point, index))
    });
  }
  function segmentHitPoints(segment, width = 46) {
    const x1 = numberValue(segment.start.x);
    const y1 = numberValue(segment.start.y);
    const x2 = numberValue(segment.end.x);
    const y2 = numberValue(segment.end.y);
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.max(1, Math.hypot(dx, dy));
    const nx = (-dy / length) * (width / 2);
    const ny = (dx / length) * (width / 2);
    return [
      `${x1 + nx},${y1 + ny}`,
      `${x2 + nx},${y2 + ny}`,
      `${x2 - nx},${y2 - ny}`,
      `${x1 - nx},${y1 - ny}`
    ].join(" ");
  }
  function shapeCenter(shape) {
    if (!shape) return { x: 0, y: 0 };
    if (shape.kind === "arrow") return { x: (numberValue(shape.x1) + numberValue(shape.x2)) / 2, y: (numberValue(shape.y1) + numberValue(shape.y2)) / 2 };
    if (shape.kind === "rect") return { x: numberValue(shape.x) + numberValue(shape.w) / 2, y: numberValue(shape.y) + numberValue(shape.h) / 2 };
    return { x: numberValue(shape.x), y: numberValue(shape.y) };
  }
  function shapeTitle(shape) {
    if (!shape) return "";
    return shape.kind === "circle" ? "ثقب" : shape.kind === "rect" ? "مستطيل" : shape.kind === "arrow" ? "سهم" : "نص";
  }
  return (
    <div className="drawing-editor" ref={editorRef} tabIndex={0}>
      <div className="drawing-top">
        <div className="drawing-tools">
          <button className={tool === "select" ? "active tiny" : "tiny"} onClick={() => setTool("select")}><Sparkles size={16} />تحريك</button>
          <button className={tool === "circle" ? "active tiny" : "tiny"} onClick={() => setTool("circle")}><Circle size={16} />ثقب</button>
          <button className={tool === "rect" ? "active tiny" : "tiny"} onClick={() => setTool("rect")}><RectangleHorizontal size={16} />مستطيل</button>
          <button className={tool === "text" ? "active tiny" : "tiny"} onClick={() => setTool("text")}><Pencil size={16} />نص</button>
          <button className={tool === "arrow" ? "active tiny" : "tiny"} onClick={() => setTool("arrow")}><Maximize2 size={16} />سهم</button>
          <button className={tool === "edge" ? "active tiny" : "tiny"} onClick={() => setTool("edge")}><Sparkles size={16} />حواف</button>
          <button className="tiny" onClick={() => zoomDrawing(0.1)}>+</button>
          <button className="tiny" onClick={() => zoomDrawing(-0.1)}>-</button>
          <button className="tiny" onClick={resetDrawingView}>إعادة العرض</button>
          <button className="tiny danger" onClick={() => selectedShapeId && deleteShape(selectedShapeId)} disabled={!selectedShapeId}><Trash2 size={14} />حذف المحدد</button>
          <button className="tiny danger" onClick={resetShape}><RefreshCw size={15} />Reset Shape</button>
        </div>
        <div className="outline-controls">
          <span className="outline-count">{outlinePoints.filter((point) => !point.corner).length} نقاط تعديل</span>
          <span className="outline-count">{outlinePoints.filter((point) => point.curve).length} منحنى</span>
        </div>
      </div>
      <div className="drawing-stage" onWheel={handleDrawingWheel}>
        <svg
          ref={svgRef}
          className="drawing-canvas"
          style={{
            transform: `scale(${viewScale})`,
            transformOrigin: "center center"
          }}
          viewBox={viewBox}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerLeave={pointerUp}
        >
          <defs>
            <linearGradient id={`mirror-${row.id}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#ffffff" stopOpacity=".86" />
              <stop offset=".35" stopColor="#b7d5ed" stopOpacity=".38" />
              <stop offset=".62" stopColor="#f6d47b" stopOpacity=".44" />
              <stop offset="1" stopColor="#6b7a86" stopOpacity=".5" />
            </linearGradient>
            <pattern id={`grid-${row.id}`} width="100" height="100" patternUnits="userSpaceOnUse">
              <path d="M 100 0 L 0 0 0 100" fill="none" stroke="#cbd5e1" strokeWidth="1" />
            </pattern>
            <marker id={`arrow-head-${row.id}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto-start-reverse" markerUnits="strokeWidth">
              <path d="M 0 0 L 8 4 L 0 8 z" fill="#111827" />
            </marker>
          </defs>
          <rect x={-pad} y={-pad} width={maxW + pad * 2} height={maxH + pad * 2} fill={`url(#grid-${row.id})`} />
          <line x1="0" y1="-60" x2="0" y2={maxH + 80} stroke="#64748b" strokeWidth="3" strokeDasharray="14 14" />
          <line x1="-60" y1="0" x2={maxW + 80} y2="0" stroke="#64748b" strokeWidth="3" strokeDasharray="14 14" />
          <text x="-130" y="-84" fontSize="28" fill="#475569">0,0</text>
          {row.layers.map((layer, index) => {
            const geometry = layerGeometries[index];
            const opacity = Math.max(0.05, Math.min(1, numberValue(layer.alpha, 45) / 100));
            const layerOutline = index === 0 ? outlinePoints : defaultOutlinePoints(geometry);
            const layerPath = outlinePath(layerOutline);
            return (
              <g key={index} opacity={index === 0 ? 1 : 0.82}>
                <path className="glass-outline-fill" d={layerPath} fill={layer.color} fillOpacity={opacity} stroke={layer.mirror ? "#a67c1e" : "#1d4ed8"} strokeWidth="5" strokeDasharray={index ? "18 10" : "0"} />
                {layer.mirror && (
                  <>
                    <path d={`M ${geometry.x + geometry.width * .12} ${geometry.y} L ${geometry.x + geometry.width * .78} ${geometry.y + geometry.height}`} stroke="#ffffff" strokeWidth="18" opacity=".32" />
                    <path d={`M ${geometry.x + geometry.width * .34} ${geometry.y} L ${geometry.x + geometry.width * .94} ${geometry.y + geometry.height}`} stroke="#ffffff" strokeWidth="8" opacity=".34" />
                  </>
                )}
                {index === 0 && tool === "edge" && (
                  <g className="outline-edit-guides">
                    <path className="outline-active-path" d={layerPath} />
                    {outlinePoints.map((point, pointIndex) => {
                      if (!point.curve || pointIndex <= 0 || pointIndex >= outlinePoints.length - 1) return null;
                      const previous = outlinePoints[pointIndex - 1];
                      const next = outlinePoints[pointIndex + 1];
                      return (
                        <g className="outline-curve-guides" key={`curve-${point.id}`}>
                          <line x1={previous.x} y1={previous.y} x2={point.x} y2={point.y} />
                          <line x1={point.x} y1={point.y} x2={next.x} y2={next.y} />
                        </g>
                      );
                    })}
                    {outlineSegments(outlinePoints).map((segment) => {
                      const midX = (numberValue(segment.start.x) + numberValue(segment.end.x)) / 2;
                      const midY = (numberValue(segment.start.y) + numberValue(segment.end.y)) / 2;
                      const segmentCanDrag = !segment.start.corner && !segment.end.corner;
                      return (
                        <g key={`segment-${segment.index}`}>
                          <polygon className="outline-segment-hit" points={segmentHitPoints(segment)} onPointerDown={(event) => addOutlinePoint(event, segment.index)} />
                          {segmentCanDrag && <circle className="outline-segment-handle" cx={midX} cy={midY} r="12" onPointerDown={(event) => startOutlineSegmentDrag(event, segment)} />}
                        </g>
                      );
                    })}
                    {outlinePoints.map((point, pointIndex) => (
                      <circle
                        key={point.id}
                        className={`outline-control-point${point.corner ? " corner" : ""}${point.curve ? " curve" : ""}`}
                        cx={point.x}
                        cy={point.y}
                        r={point.corner ? 9 : 12}
                        onPointerDown={(event) => startOutlinePointDrag(event, point, pointIndex)}
                      >
                        <title>{point.corner ? "ركن ثابت" : `أفقي ${Math.round(numberValue(point.x))}مم / رأسي ${Math.round(numberValue(point.y))}مم`}</title>
                      </circle>
                    ))}
                  </g>
                )}
                <text className="dimension-label" x={geometry.x + geometry.width / 2} y={geometry.y - 28} textAnchor="middle">{`${Math.round(geometry.width)}mm`}</text>
                <text className="dimension-label" x={geometry.x + geometry.width + 34} y={geometry.y + geometry.height / 2} textAnchor="middle" transform={`rotate(90 ${geometry.x + geometry.width + 34} ${geometry.y + geometry.height / 2})`}>{`${Math.round(geometry.height)}mm`}</text>
              </g>
            );
          })}
          <g className="outline-total-dimensions">
            <line x1={outlineBounds.x} y1={outlineBounds.y - 88} x2={outlineBounds.right} y2={outlineBounds.y - 88} />
            <line x1={outlineBounds.right + 88} y1={outlineBounds.y} x2={outlineBounds.right + 88} y2={outlineBounds.bottom} />
            <text x={outlineBounds.x + outlineBounds.width / 2} y={outlineBounds.y - 104} textAnchor="middle">{`إجمالي العرض ${Math.round(outlineBounds.width)}mm`}</text>
            <text x={outlineBounds.right + 106} y={outlineBounds.y + outlineBounds.height / 2} textAnchor="middle" transform={`rotate(90 ${outlineBounds.right + 106} ${outlineBounds.y + outlineBounds.height / 2})`}>{`إجمالي الارتفاع ${Math.round(outlineBounds.height)}mm`}</text>
          </g>
          <g className="edge-dimension-lines">
            {outlineDims.map((item, itemIndex) => (
              <g key={`outline-dim-${itemIndex}`}>
                <line x1={item.x1} y1={item.y1} x2={item.x2} y2={item.y2} />
                <text x={item.tx} y={item.ty} textAnchor="middle" transform={item.rotate || undefined}>{item.label}</text>
              </g>
            ))}
            {curveDims.map((item, itemIndex) => (
              <g key={`curve-dim-${itemIndex}`}>
                <line x1={item.x1} y1={item.y1} x2={item.x2} y2={item.y2} />
                <text x={item.tx} y={item.ty} textAnchor="middle">{item.label}</text>
              </g>
            ))}
          </g>
          {paths.map((path) => (
            <polyline key={path.id} points={path.points.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke="#111827" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" onDoubleClick={() => deleteShape(path.id)} />
          ))}
          {shapes.map((shape) => {
            if (shape.kind === "arrow") {
              const x1 = numberValue(shape.x1);
              const y1 = numberValue(shape.y1);
              const x2 = numberValue(shape.x2);
              const y2 = numberValue(shape.y2);
              const length = Math.hypot(x2 - x1, y2 - y1);
              const selected = shape.id === selectedShapeId;
              return (
                <g key={shape.id} className={selected ? "drawing-arrow selected-shape" : "drawing-arrow"}>
                  <line x1={x1} y1={y1} x2={x2} y2={y2} markerStart={`url(#arrow-head-${row.id})`} markerEnd={`url(#arrow-head-${row.id})`} onPointerDown={(event) => startShapeDrag(event, shape)} />
                  <circle className="arrow-handle" cx={x1} cy={y1} r="12" onPointerDown={(event) => startArrowHandleDrag(event, shape, "start")} />
                  <circle className="arrow-handle" cx={x2} cy={y2} r="12" onPointerDown={(event) => startArrowHandleDrag(event, shape, "end")} />
                  <text x={(x1 + x2) / 2 + 12} y={(y1 + y2) / 2 - 12}>{shape.text || `${Math.round(length)}mm`}</text>
                </g>
              );
            }
            if (shape.kind === "text") {
              const label = shape.text || "ملاحظة";
              const width = Math.max(120, label.length * 18 + 28);
              const height = 52;
              const selected = shape.id === selectedShapeId;
              return (
                <g key={shape.id} className={selected ? "drawing-text-label selected-shape" : "drawing-text-label"} onPointerDown={(event) => startShapeDrag(event, shape)} cursor="move">
                  <rect x={numberValue(shape.x) - width / 2} y={numberValue(shape.y) - height / 2} width={width} height={height} rx="8" fill="#ffffff" stroke="#c3922c" strokeWidth="3" />
                  <text x={shape.x} y={numberValue(shape.y) + 9} textAnchor="middle" fontSize="28" fill="#111827">{label}</text>
                </g>
              );
            }
            const centerX = shape.kind === "circle" ? numberValue(shape.x) : numberValue(shape.x) + numberValue(shape.w) / 2;
            const centerY = shape.kind === "circle" ? numberValue(shape.y) : numberValue(shape.y) + numberValue(shape.h) / 2;
            const ref = measurementReference(shape, outlineBounds, outlinePoints);
            const hStart = ref.hStart;
            const vStart = ref.vStart;
            const hLabelX = (hStart + centerX) / 2;
            const vLabelY = (vStart + centerY) / 2;
            const notchInfo = shape.kind === "rect" ? edgeCutInfo(shape, outlineBounds) : null;
            const rectDims = shape.kind === "rect" ? rectSideDimensionItems(shape, outlineBounds) : [];
            const sizeLabelX = centerX + 24;
            const sizeLabelY = centerY - 22;
            const selected = shape.id === selectedShapeId;
            return (
              <g key={shape.id} className={selected ? "selected-shape" : ""}>
                <g className="measurement-lines">
                  <line x1={hStart} y1={centerY} x2={centerX} y2={centerY} />
                  <line x1={centerX} y1={vStart} x2={centerX} y2={centerY} />
                  <text x={hLabelX} y={centerY - 12} textAnchor="middle">{`${Math.round(ref.horizontalDistance)}mm`}</text>
                  <text x={centerX + 14} y={vLabelY} textAnchor="start">{`${Math.round(ref.verticalDistance)}mm`}</text>
                </g>
                <g onPointerDown={(event) => startShapeDrag(event, shape)} onDoubleClick={() => deleteShape(shape.id)} cursor="move">
                  {shape.kind === "circle" ? (
                    <circle cx={shape.x} cy={shape.y} r={shape.r} fill="#ffffff" stroke="#b42318" strokeWidth="5">
                      <title>{`ثقب قطر ${numberValue(shape.r) * 2}مم`}</title>
                    </circle>
                  ) : notchInfo ? (
                    <>
                      <rect className="edge-notch-fill" x={shape.x} y={shape.y} width={shape.w} height={shape.h}>
                        <title>{`قص حافة ${notchInfo.width}مم × عمق ${notchInfo.depth}مم`}</title>
                      </rect>
                      <path className="edge-notch-cut" d={notchInfo.path} />
                    </>
                  ) : (
                    <rect x={shape.x} y={shape.y} width={shape.w} height={shape.h} fill="#ffffff" stroke="#087d45" strokeWidth="5">
                      <title>{`قص/بروز مستطيل ${shape.w}×${shape.h}مم`}</title>
                    </rect>
                  )}
                  {shape.kind === "rect" && (
                    <g className="rect-side-dimensions">
                      {rectDims.map((item, itemIndex) => (
                        <g key={`rect-side-${shape.id}-${itemIndex}`}>
                          <line x1={item.x1} y1={item.y1} x2={item.x2} y2={item.y2} />
                          <text x={item.tx} y={item.ty} textAnchor="middle" transform={item.rotate || undefined}>{item.label}</text>
                        </g>
                      ))}
                    </g>
                  )}
                  {shape.kind === "circle" && <text className="shape-size-label angled" x={sizeLabelX} y={sizeLabelY} transform={`rotate(-24 ${sizeLabelX} ${sizeLabelY})`}>{shapeSizeLabel(shape, notchInfo)}</text>}
                </g>
              </g>
            );
          })}
          {selectedShape && (() => {
            const center = shapeCenter(selectedShape);
            const popoverX = clamp(center.x + 34, -pad + 24, maxW + pad - 300);
            const popoverY = clamp(center.y - 124, -pad + 24, maxH + pad - 138);
            return (
              <foreignObject className="shape-popover-object" x={popoverX} y={popoverY} width="270" height="112" onPointerDown={(event) => event.stopPropagation()} onPointerMove={(event) => event.stopPropagation()} onPointerUp={(event) => event.stopPropagation()}>
                <div className="shape-popover" dir="rtl" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
                  <strong>{shapeTitle(selectedShape)}</strong>
                  <span>طبقة {(selectedShape.layer ?? 0) + 1}</span>
                  <div className="shape-popover-actions">
                    <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setSelectedShapeId(null); }}>إخفاء</button>
                    <button type="button" className="danger" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); deleteShape(selectedShape.id); }}>حذف</button>
                  </div>
                </div>
              </foreignObject>
            );
          })()}
        </svg>
      </div>
      <div className="shape-list">
        {shapes.length === 0 && <span className="hint">اختر ثقب، مستطيل، نص، أو سهم ثم اضغط داخل الرسم لإضافته.</span>}
        {shapes.map((shape) => (
          <div className={shape.id === selectedShapeId ? "shape-control selected" : "shape-control"} key={shape.id} onPointerDown={() => setSelectedShapeId(shape.id)}>
            <strong>{shape.kind === "circle" ? "ثقب" : shape.kind === "rect" ? "مستطيل" : shape.kind === "arrow" ? "سهم" : "نص"}</strong>
            {shape.kind === "arrow" ? (
              <>
                <label><span>بداية أفقية مم</span><input dir="ltr" inputMode="decimal" value={Math.round(numberValue(shape.x1))} onChange={(event) => updateShape(shape.id, { x1: event.target.value })} /></label>
                <label><span>بداية رأسية مم</span><input dir="ltr" inputMode="decimal" value={Math.round(numberValue(shape.y1))} onChange={(event) => updateShape(shape.id, { y1: event.target.value })} /></label>
                <label><span>نهاية أفقية مم</span><input dir="ltr" inputMode="decimal" value={Math.round(numberValue(shape.x2))} onChange={(event) => updateShape(shape.id, { x2: event.target.value })} /></label>
                <label><span>نهاية رأسية مم</span><input dir="ltr" inputMode="decimal" value={Math.round(numberValue(shape.y2))} onChange={(event) => updateShape(shape.id, { y2: event.target.value })} /></label>
                <label><span>نص السهم</span><input value={shape.text || ""} onChange={(event) => updateShape(shape.id, { text: event.target.value })} /></label>
              </>
            ) : shape.kind === "text" ? (
              <>
                <label><span>من اليسار مم</span><input dir="ltr" inputMode="decimal" value={Math.round(numberValue(shape.x))} onChange={(event) => updateShape(shape.id, { x: event.target.value })} /></label>
                <label><span>من الأعلى مم</span><input dir="ltr" inputMode="decimal" value={Math.round(numberValue(shape.y))} onChange={(event) => updateShape(shape.id, { y: event.target.value })} /></label>
                <label className="wide-field"><span>النص</span><input value={shape.text || ""} onChange={(event) => updateShape(shape.id, { text: event.target.value })} /></label>
              </>
            ) : (
              <>
                <label><span>من اليسار مم</span><input dir="ltr" inputMode="decimal" value={Math.round(numberValue(shape.x))} onChange={(event) => updateShape(shape.id, { x: event.target.value })} /></label>
                <label><span>من الأعلى مم</span><input dir="ltr" inputMode="decimal" value={Math.round(numberValue(shape.y))} onChange={(event) => updateShape(shape.id, { y: event.target.value })} /></label>
                {shape.kind === "circle" ? (
                  <label><span>قطر mm</span><input dir="ltr" inputMode="decimal" value={numberValue(shape.r) * 2} onChange={(event) => updateShape(shape.id, { r: numberValue(event.target.value) / 2 })} /></label>
                ) : (
                  <>
                <label><span>عرض mm</span><input dir="ltr" inputMode="decimal" value={shape.w} onChange={(event) => updateShape(shape.id, { w: event.target.value })} /></label>
                <label><span>طول mm</span><input dir="ltr" inputMode="decimal" value={shape.h} onChange={(event) => updateShape(shape.id, { h: event.target.value })} /></label>
                  </>
                )}
              </>
            )}
            <label><span>طبقة</span><select value={shape.layer ?? 0} onChange={(event) => updateShape(shape.id, { layer: Number(event.target.value) })}>{row.layers.map((_, i) => <option key={i} value={i}>{i + 1}</option>)}</select></label>
            <button className="tiny danger" onClick={() => deleteShape(shape.id)}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function CustomersView({ orders, customers, onOpen, onCopy, onPreview, currentUser, logoSrc }) {
  const [query, setQuery] = useState("");
  const grouped = useMemo(() => {
    const names = new Set([...customers.map((c) => c.name), ...orders.map((order) => order.customerName).filter(Boolean)]);
    return [...names].map((name) => {
      const customer = customers.find((item) => item.name === name) || {};
      const customerMatches = matchesQuery(query, name, customer.phone, customer.email, customer.address, customer.tax_no, customer.notes);
      const customerOrders = orders.filter((order) => order.customerName === name);
      const visibleOrders = customerOrders.filter((order) => customerMatches || matchesQuery(query, order.orderNo, order.documentId, order.project, order.code, order.supplierName, order.date, order.notes));
      return { name, orders: visibleOrders, matches: customerMatches || visibleOrders.length > 0 };
    }).filter((customer) => customer.matches);
  }, [orders, customers, query]);
  return (
    <section className="panel">
      <div className="panel-head"><h2>شجرة طلبات العملاء</h2><SearchBox value={query} onChange={setQuery} placeholder="بحث بالعميل / الطلب / الإذن / المشروع" /></div>
      <div className="tree-list">
        {grouped.length === 0 && <p className="hint">لا توجد نتائج مطابقة للبحث.</p>}
        {grouped.map((customer) => (
          <details key={customer.name} open>
            <summary>{customer.name || "بدون اسم"} <span>{customer.orders.length} طلب</span></summary>
            {customer.orders.map((order) => {
              const totals = orderTotals(order);
              return (
                <div className="tree-order" key={order.id || order.orderNo}>
                  <button onClick={() => onOpen(order)}>{displayOrderNo(order.orderNo)} / {order.project || "بدون مشروع"}</button>
                  <small>{square(totals.area)} م2 - {money(totals.total)}</small>
                  <button title="نسخ كطلب جديد" onClick={() => onCopy(order)}><Copy size={16} /></button>
                  <button title="معاينة" onClick={() => onPreview(order)}><Eye size={16} /></button>
                  <button title="PDF" onClick={() => exportOrderPdf(order, currentUser, logoSrc)}><FileDown size={16} /></button>
                  <button title="Excel" onClick={() => exportOrderExcel(order)}><FileSpreadsheet size={16} /></button>
                </div>
              );
            })}
          </details>
        ))}
      </div>
    </section>
  );
}

function SuppliersView({ data, onPayment, onEditPayment, onDeletePayment, onPreview }) {
  const [query, setQuery] = useState("");
  const suppliers = useMemo(() => {
    const names = new Set([...data.suppliers.map((s) => s.name), ...data.orders.map((order) => order.supplierName).filter(Boolean)]);
    return [...names].map((name) => {
      const supplier = data.suppliers.find((item) => item.name === name) || { id: name, name, opening_balance: 0 };
      const orders = data.orders.filter((order) => order.supplierName === name);
      const payments = data.payments.filter((payment) => payment.supplier_id === supplier.id || payment.supplier_name === name);
      const payableOrders = orders.filter(isOrderPayableForSupplier);
      const debt = payableOrders.reduce((sum, order) => sum + orderTotals(order).supplierCost, numberValue(supplier.opening_balance));
      const paid = payments.reduce((sum, payment) => sum + numberValue(payment.amount), 0);
      const supplierMatches = matchesQuery(query, name, supplier.phone, supplier.email, supplier.address, supplier.notes, supplier.opening_balance);
      const visibleOrders = orders.filter((order) => supplierMatches || matchesQuery(query, order.orderNo, order.documentId, order.customerName, order.project, order.code, order.date, order.notes));
      const visiblePayments = payments.filter((payment) => supplierMatches || matchesQuery(query, payment.paid_at, payment.amount, payment.method, payment.notes));
      return { ...supplier, orders: visibleOrders, payments: visiblePayments, debt, paid, balance: debt - paid, matches: supplierMatches || visibleOrders.length > 0 || visiblePayments.length > 0 };
    }).filter((supplier) => supplier.matches);
  }, [data, query]);
  return (
    <section className="panel">
      <div className="panel-head"><h2>حسابات الموردين</h2><SearchBox value={query} onChange={setQuery} placeholder="بحث بالمورد / الطلب / الإذن / الدفعة" /></div>
      <div className="supplier-tree-list">
        {suppliers.length === 0 && <p className="hint">لا توجد نتائج مطابقة للبحث.</p>}
        {suppliers.map((supplier) => (
          <details className="supplier-tree" key={supplier.name} open>
            <summary>
              <strong>{supplier.name || "بدون مورد"}</strong>
              <span>التوريد {money(supplier.debt)}</span>
              <span>المدفوع {money(supplier.paid)}</span>
              <span>المستحق {money(supplier.balance)}</span>
            </summary>
            <div className="supplier-tree-actions">
              <button onClick={() => onPayment(supplier)}><BadgeDollarSign size={16} />إضافة دفعة</button>
              <button onClick={() => onPreview(supplier)}><Eye size={16} />كشف حساب</button>
            </div>
            <div className="supplier-branches">
              <section>
                <h3>أوامر المورد</h3>
                {supplier.orders.length === 0 && <p className="hint">لا توجد أوامر لهذا المورد.</p>}
                {supplier.orders.map((order) => {
                  const totals = orderTotals(order);
                  return (
                    <div className="supplier-branch-row" key={order.id || order.orderNo}>
                      <span dir="ltr">{orderDocumentId(order)}</span>
                      <span>{order.date}</span>
                      <span>{order.project || "بدون مشروع"}</span>
                      <strong>{isOrderPayableForSupplier(order) ? money(totals.supplierCost) : "غير مستحق"}</strong>
                      <span className={statusClassName(order.status)}>{statusLabel(order.status)}</span>
                    </div>
                  );
                })}
              </section>
              <section>
                <h3>الدفعات</h3>
                {supplier.payments.length === 0 && <p className="hint">لا توجد دفعات مسجلة.</p>}
                {supplier.payments.map((payment) => (
                  <div className="supplier-branch-row payment-row" key={payment.id}>
                    <span>{payment.paid_at}</span>
                    <strong>{money(payment.amount)}</strong>
                    <span>{payment.method || "دفعة"}</span>
                    <span>{payment.notes || ""}</span>
                    <button className="tiny" onClick={() => onEditPayment(supplier, payment)}><Pencil size={14} />تعديل</button>
                    <button className="tiny danger" onClick={() => onDeletePayment(payment)}><Trash2 size={14} />حذف</button>
                  </div>
                ))}
              </section>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

function StatementsView({ data, onPreview, onExportPdf, onExportExcel }) {
  const [period, setPeriod] = useState("month");
  const availableYears = useMemo(() => uniqueValues(data.orders.map((order) => String(new Date(order.date || today()).getFullYear()))).sort((a, b) => Number(b) - Number(a)), [data.orders]);
  const [selectedYear, setSelectedYear] = useState(() => String(new Date().getFullYear()));
  const [selectedMonth, setSelectedMonth] = useState(() => String(new Date().getMonth() + 1).padStart(2, "0"));
  useEffect(() => {
    if (availableYears.length && !availableYears.includes(selectedYear)) setSelectedYear(availableYears[0]);
  }, [availableYears, selectedYear]);
  const statement = useMemo(() => buildGlassStatement(data.orders, period, selectedYear, selectedMonth), [data.orders, period, selectedYear, selectedMonth]);
  return (
    <section className="panel">
      <div className="panel-head">
        <div><h2>تقرير مساحات الزجاج</h2><p>مقسم حسب المورد ورقم الإذن.</p></div>
        <div className="actions">
          <select value={period} onChange={(e) => setPeriod(e.target.value)}><option value="month">شهري</option><option value="year">سنوي</option></select>
          <select value={selectedYear} onChange={(e) => setSelectedYear(e.target.value)}>
            {(availableYears.length ? availableYears : [selectedYear]).map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
          {period === "month" && (
            <select value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)}>
              {Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0")).map((month) => <option key={month} value={month}>{month}</option>)}
            </select>
          )}
          <button onClick={() => onPreview(statement)}><Eye size={18} />معاينة</button>
          <button onClick={() => onExportPdf(statement)}><FileDown size={18} />PDF</button>
          <button onClick={() => onExportExcel(statement)}><FileSpreadsheet size={18} />Excel</button>
        </div>
      </div>
      <StatementTable statement={statement} />
    </section>
  );
}

function buildGlassStatement(orders, period, selectedYear = String(new Date().getFullYear()), selectedMonth = String(new Date().getMonth() + 1).padStart(2, "0")) {
  const groups = {};
  for (const order of orders.filter(isOrderPayableForSupplier)) {
    const date = new Date(order.date || today());
    const year = String(date.getFullYear());
    const month = String(date.getMonth() + 1).padStart(2, "0");
    if (year !== String(selectedYear)) continue;
    if (period === "month" && month !== String(selectedMonth).padStart(2, "0")) continue;
    const key = period === "year" ? year : `${year}-${month}`;
    const supplier = order.supplierName || "بدون مورد";
    const documentId = orderDocumentId(order);
    groups[supplier] ||= { supplier, subtotal: { pieces: 0, area: 0, cost: 0 }, documents: {} };
    groups[supplier].documents[documentId] ||= { documentId, period: key, pieces: 0, area: 0, cost: 0, orders: [] };
    const totals = orderTotals(order);
    groups[supplier].documents[documentId].pieces += totals.pieces;
    groups[supplier].documents[documentId].area += totals.area;
    groups[supplier].documents[documentId].cost += totals.supplierCost;
    groups[supplier].documents[documentId].orders.push(order);
    groups[supplier].subtotal.pieces += totals.pieces;
    groups[supplier].subtotal.area += totals.area;
    groups[supplier].subtotal.cost += totals.supplierCost;
  }
  return { period, selectedYear, selectedMonth, suppliers: Object.values(groups).map((group) => ({ ...group, documents: Object.values(group.documents) })) };
}

function StatementTable({ statement }) {
  return (
    <div className="report-table">
        <div className="report-row head"><span>المورد</span><span>رقم الإذن</span><span>القطع</span><span>المساحة م2</span><span>التكلفة</span></div>
      {statement.suppliers.map((supplier) => (
        <React.Fragment key={supplier.supplier}>
          {supplier.documents.map((doc) => (
            <div className="report-row" key={`${supplier.supplier}-${doc.documentId}`}>
              <span>{supplier.supplier}</span><span className="keep-line" dir="ltr">{doc.documentId}</span><span className="keep-line">{money(doc.pieces)}</span><span className="keep-line">{square(doc.area)}</span><span className="keep-line">{money(doc.cost)}</span>
            </div>
          ))}
          <div className="report-row subtotal"><span className="statement-subtotal-label">إجمالي المورد {supplier.supplier}</span><span className="keep-line">{money(supplier.subtotal.pieces)}</span><span className="keep-line">{square(supplier.subtotal.area)}</span><span className="keep-line">{money(supplier.subtotal.cost)}</span></div>
        </React.Fragment>
      ))}
    </div>
  );
}

function PreviewModal({ preview, currentUser, logoSrc, onClose }) {
  const contentRef = useRef(null);
  const title = preview.type === "statement"
    ? "تقرير مساحات الزجاج"
    : preview.type === "supplier"
      ? "كشف حساب مورد"
      : preview.type === "orderStatus"
        ? "تقرير حالة الطلبات"
        : `طلب ${displayOrderNo(preview.order.orderNo)}`;
  return (
    <div className="modal-backdrop">
      <div className="modal large">
        <div className="panel-head">
          <h2>{title}</h2>
          <div className="actions">
            <button onClick={() => exportElementPdf(contentRef.current, `${safeFileName(title)}.pdf`).catch(showExportError)}><FileDown size={16} />PDF</button>
            <button onClick={() => exportPreviewExcel(preview)}><FileSpreadsheet size={16} />Excel</button>
            <button onClick={onClose}>إغلاق</button>
          </div>
        </div>
        <div ref={contentRef} className="preview-page">
          {preview.type === "order" && <OrderReport order={preview.order} currentUser={currentUser} logoSrc={logoSrc} />}
          {preview.type === "statement" && <><ReportHeader title="تقرير مساحات الزجاج" logoSrc={logoSrc} /><StatementTable statement={preview.statement} /><ReportFooter currentUser={currentUser} /></>}
          {preview.type === "supplier" && <SupplierReport supplier={preview.supplier} data={preview.data} currentUser={currentUser} logoSrc={logoSrc} />}
          {preview.type === "orderStatus" && <OrderStatusReport report={preview.report} currentUser={currentUser} logoSrc={logoSrc} />}
        </div>
      </div>
    </div>
  );
}

function OrderReport({ order, currentUser, logoSrc }) {
  const totals = orderTotals(order);
  const issuedAt = new Date();
  return (
    <div className="report">
      <ReportHeader title={`طلب شراء زجاج ${displayOrderNo(order.orderNo)}`} logoSrc={logoSrc} />
      <ReportTiming items={[
        { label: "تاريخ الإدخال", value: order.entryAt || order.date, exact: !!order.entryAt },
        { label: "تاريخ الإصدار", value: issuedAt, exact: true }
      ]} />
      <div className="report-meta">
        <span>العميل: {order.customerName}</span><span>المورد: {order.supplierName}</span><span>رقم إذن المورد: <bdi dir="ltr">{orderDocumentId(order)}</bdi></span><span>المشروع: {order.project}</span>
      </div>
      <div className="report-table order-report-table">
        <div className="report-row order-report-row head"><span>NO.</span><span>البيان</span><span>الشركة</span><span>العرض سم</span><span>الطول سم</span><span>العدد</span><span>م2</span></div>
        {order.rows.map((row, index) => {
          const t = rowTotals(row);
          const companies = rowCompanyText(row);
          const maxW = Math.max(...row.layers.map((layer) => numberValue(layer.width)));
          const maxH = Math.max(...row.layers.map((layer) => numberValue(layer.height)));
          return <div className="report-row order-report-row" key={row.id}><span className="keep-line">{index + 1}</span><span>{rowDescription(row)}</span><span dir="auto">{companies}</span><span className="keep-line">{maxW}</span><span className="keep-line">{maxH}</span><span className="keep-line">{row.quantity}</span><span className="keep-line">{square(t.area)}</span></div>;
        })}
        <div className="report-row order-report-row subtotal"><span className="subtotal-label">الإجمالي</span><span className="keep-line">{money(totals.pieces)}</span><span className="keep-line">{square(totals.area)}</span></div>
      </div>
      {order.rows.some((row) => drawingHasContent(row.drawing)) && (
        <div className="drawing-report">
          {order.rows.map((row, index) => <DrawingReportPage key={row.id} row={row} index={index} />)}
        </div>
      )}
      <ReportFooter currentUser={currentUser} />
    </div>
  );
}

function DrawingReportPage({ row, index }) {
  const fabricationNotes = drawingFabricationNotes(row);
  return (
    <div className="drawing-page">
      <h3>رسم الصف {index + 1}: {rowDescription(row)}</h3>
      <DrawingPreview row={row} />
      <div className="layer-specs">
        {row.layers.map((layer, layerIndex) => (
          <p key={layerIndex}>{layerReportDescription(layer, layerIndex)}</p>
        ))}
      </div>
      {fabricationNotes.length > 0 && (
        <div className="fabrication-notes">
          {fabricationNotes.map((note, noteIndex) => <p key={noteIndex}>{note}</p>)}
        </div>
      )}
    </div>
  );
}

function layerReportDescription(layer, index) {
  const names = ["الأولى", "الثانية", "الثالثة"];
  const secure = layer.secure ? " سيكوريت" : "";
  return `الطبقة ${names[index] || index + 1}: زجاج ${layer.glassType || "شفاف"} ${layer.thickness || "6مم"}${secure} مقاس ${numberValue(layer.width)}سم × ${numberValue(layer.height)}سم`;
}

function DrawingPreview({ row }) {
  const drawing = normalizeDrawing(row.drawing);
  const maxW = Math.max(200, ...row.layers.map((layer) => cmToMm(layer.width, 100)));
  const maxH = Math.max(200, ...row.layers.map((layer) => cmToMm(layer.height, 100)));
  const pad = 360;
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, numberValue(value)));
  }
  function previewGeometry(layer, index) {
    const width = Math.max(1, cmToMm(layer.width, 100));
    const height = Math.max(1, cmToMm(layer.height, 100));
    const freeX = Math.max(0, maxW - width);
    const freeY = Math.max(0, maxH - height);
    const direction = row.extraDirection || "في المنتصف تماماً";
    const aligned = {
      x: direction === "الي اليمين" ? freeX : direction === "في المنتصف تماماً" ? freeX / 2 : 0,
      y: direction === "الي الاسفل" ? freeY : direction === "في المنتصف تماماً" ? freeY / 2 : 0
    };
    if (direction === "الي الاعلي") aligned.y = 0;
    if (direction === "الي اليسار") aligned.x = 0;
    const visualOffset = index * 24;
    return {
      width,
      height,
      x: aligned.x + clamp(layer.offsetX, -freeX, freeX) + visualOffset,
      y: aligned.y + clamp(layer.offsetY, -freeY, freeY) + visualOffset
    };
  }
  const geometries = row.layers.map(previewGeometry);
  const baseGeometry = geometries[0] || { x: 0, y: 0, width: maxW, height: maxH };
  const outlinePoints = outlinePointsForGeometry(drawing, baseGeometry);
  const outlineBounds = boundsFromOutline(outlinePoints, baseGeometry);
  const outlineDims = outlineDimensionItems(outlinePoints, baseGeometry);
  const curveDims = curveDepthItems(outlinePoints, baseGeometry);
  return (
    <svg className="drawing-preview" viewBox={`${-pad} ${-pad} ${maxW + pad * 2} ${maxH + pad * 2}`}>
      <defs>
        <marker id={`preview-arrow-head-${row.id}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto-start-reverse" markerUnits="strokeWidth">
          <path d="M 0 0 L 8 4 L 0 8 z" fill="#111827" />
        </marker>
      </defs>
      <rect x={-pad} y={-pad} width={maxW + pad * 2} height={maxH + pad * 2} fill="#fff" stroke="#d9e0e8" />
      {row.layers.map((layer, i) => {
        const geometry = geometries[i];
        const layerOutline = i === 0 ? outlinePoints : defaultOutlinePoints(geometry);
        return (
          <g key={i}>
            <path d={outlinePath(layerOutline)} fill={layer.color} opacity={layer.mirror ? ".42" : ".25"} stroke={layer.mirror ? "#c3922c" : i ? "#c3922c" : "#1d4ed8"} strokeWidth="4" strokeDasharray={i ? "14 8" : "0"} />
          </g>
        );
      })}
      <g className="outline-total-dimensions">
        <line x1={outlineBounds.x} y1={outlineBounds.y - 88} x2={outlineBounds.right} y2={outlineBounds.y - 88} />
        <line x1={outlineBounds.right + 88} y1={outlineBounds.y} x2={outlineBounds.right + 88} y2={outlineBounds.bottom} />
        <text x={outlineBounds.x + outlineBounds.width / 2} y={outlineBounds.y - 104} textAnchor="middle">{`إجمالي العرض ${Math.round(outlineBounds.width)}mm`}</text>
        <text x={outlineBounds.right + 106} y={outlineBounds.y + outlineBounds.height / 2} textAnchor="middle" transform={`rotate(90 ${outlineBounds.right + 106} ${outlineBounds.y + outlineBounds.height / 2})`}>{`إجمالي الارتفاع ${Math.round(outlineBounds.height)}mm`}</text>
      </g>
      <g className="edge-dimension-lines">
        {outlineDims.map((item, itemIndex) => (
          <g key={`preview-outline-dim-${itemIndex}`}>
            <line x1={item.x1} y1={item.y1} x2={item.x2} y2={item.y2} />
            <text x={item.tx} y={item.ty} textAnchor="middle" transform={item.rotate || undefined}>{item.label}</text>
          </g>
        ))}
        {curveDims.map((item, itemIndex) => (
          <g key={`preview-curve-dim-${itemIndex}`}>
            <line x1={item.x1} y1={item.y1} x2={item.x2} y2={item.y2} />
            <text x={item.tx} y={item.ty} textAnchor="middle">{item.label}</text>
          </g>
        ))}
      </g>
      {(drawing.paths || []).map((path) => <polyline key={path.id} points={path.points.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#111" strokeWidth="6" />)}
      {(drawing.shapes || []).map((shape) => {
        const centerX = shape.kind === "arrow" ? (numberValue(shape.x1) + numberValue(shape.x2)) / 2 : shape.kind === "rect" ? numberValue(shape.x) + numberValue(shape.w) / 2 : numberValue(shape.x);
        const centerY = shape.kind === "arrow" ? (numberValue(shape.y1) + numberValue(shape.y2)) / 2 : shape.kind === "rect" ? numberValue(shape.y) + numberValue(shape.h) / 2 : numberValue(shape.y);
        const ref = measurementReference(shape, outlineBounds, outlinePoints);
        const hStart = ref.hStart;
        const vStart = ref.vStart;
        const hLabelX = (hStart + centerX) / 2;
        const vLabelY = (vStart + centerY) / 2;
        const notchInfo = shape.kind === "rect" ? edgeCutInfo(shape, outlineBounds) : null;
        const rectDims = shape.kind === "rect" ? rectSideDimensionItems(shape, outlineBounds) : [];
        const sizeLabelX = centerX + 24;
        const sizeLabelY = centerY - 22;
        const measure = (
          <g className="measurement-lines">
            <line x1={hStart} y1={centerY} x2={centerX} y2={centerY} />
            <line x1={centerX} y1={vStart} x2={centerX} y2={centerY} />
            <text x={hLabelX} y={centerY - 12} textAnchor="middle">{`${Math.round(ref.horizontalDistance)}mm`}</text>
            <text x={centerX + 14} y={vLabelY} textAnchor="start">{`${Math.round(ref.verticalDistance)}mm`}</text>
          </g>
        );
        if (shape.kind === "circle") return <g key={shape.id}>{measure}<circle cx={shape.x} cy={shape.y} r={shape.r} fill="#fff" stroke="#b42318" strokeWidth="5" /><text className="shape-size-label angled" x={sizeLabelX} y={sizeLabelY} transform={`rotate(-24 ${sizeLabelX} ${sizeLabelY})`}>{shapeSizeLabel(shape)}</text></g>;
        if (shape.kind === "rect") return <g key={shape.id}>{measure}{notchInfo ? <><rect className="edge-notch-fill" x={shape.x} y={shape.y} width={shape.w} height={shape.h} /><path className="edge-notch-cut" d={notchInfo.path} /></> : <rect x={shape.x} y={shape.y} width={shape.w} height={shape.h} fill="#fff" stroke="#087d45" strokeWidth="5" />}<g className="rect-side-dimensions">{rectDims.map((item, itemIndex) => <g key={`preview-rect-side-${shape.id}-${itemIndex}`}><line x1={item.x1} y1={item.y1} x2={item.x2} y2={item.y2} /><text x={item.tx} y={item.ty} textAnchor="middle" transform={item.rotate || undefined}>{item.label}</text></g>)}</g></g>;
        if (shape.kind === "arrow") return <g key={shape.id}><line x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} stroke="#111827" strokeWidth="4" markerStart={`url(#preview-arrow-head-${row.id})`} markerEnd={`url(#preview-arrow-head-${row.id})`} /><text className="shape-size-label" x={centerX + 12} y={centerY - 12}>{shape.text || `${Math.round(Math.hypot(numberValue(shape.x2) - numberValue(shape.x1), numberValue(shape.y2) - numberValue(shape.y1)))}mm`}</text></g>;
        return <text key={shape.id} x={shape.x} y={shape.y} textAnchor="middle" fontSize="32" fontWeight="800">{shape.text || "ملاحظة"}</text>;
      })}
    </svg>
  );
}

function OrdersStatusView({ data, currentUser, logoSrc, onOpen, onUpdateOrder, onPreview }) {
  const supplierNames = useMemo(() => uniqueValues([...data.suppliers.map((supplier) => supplier.name), ...data.orders.map((order) => order.supplierName || "بدون مورد")]), [data]);
  const statusScrollRef = useRef(null);
  const [query, setQuery] = useState("");
  const [selectedSuppliers, setSelectedSuppliers] = useState([]);
  const [selectedStatuses, setSelectedStatuses] = useState(["ordered", "fabrication", "ready", "partial"]);
  const [pinnedRows, setPinnedRows] = useState(() => new Set());
  const [collectedDrafts, setCollectedDrafts] = useState({});
  const selectedSupplierSet = useMemo(() => new Set(selectedSuppliers), [selectedSuppliers]);
  const selectedStatusSet = useMemo(() => new Set(selectedStatuses), [selectedStatuses]);
  const visibleOrders = useMemo(() => data.orders.filter((order) => {
    const status = normalizeOrderStatus(order.status);
    const rowKey = order.id || order.orderNo;
    const supplierAllowed = selectedSupplierSet.size === 0 || selectedSupplierSet.has(order.supplierName || "بدون مورد");
    const statusAllowed = selectedStatusSet.size === 0 || selectedStatusSet.has(status);
    const normalMatch = supplierAllowed && statusAllowed && matchesQuery(query, order.orderNo, order.documentId, order.supplierName, order.customerName, order.project, order.code, order.notes, statusLabel(status));
    return normalMatch || pinnedRows.has(rowKey);
  }), [data.orders, query, selectedSupplierSet, selectedStatusSet, pinnedRows]);
  const report = useMemo(() => buildOrderStatusReport(data.orders, selectedSuppliers), [data.orders, selectedSuppliers]);

  function updateStatus(order, patchValue) {
    setPinnedRows((current) => new Set([...current, order.id || order.orderNo]));
    return onUpdateOrder(order, patchValue);
  }

  function setSpecialStatus(order, enabled, status) {
    const totalPieces = orderTotals(order).pieces;
    updateStatus(order, {
      status: enabled ? status : "ordered",
      collectedPieces: status === "collected" && enabled ? totalPieces : status === "collected" ? 0 : orderCollectedPieces(order)
    });
  }

  function setCollectedPieces(order, value) {
    const totalPieces = orderTotals(order).pieces;
    const collectedPieces = Math.max(0, Math.min(totalPieces, numberValue(value)));
    const status = collectedPieces >= totalPieces && totalPieces > 0
      ? "collected"
      : collectedPieces > 0
        ? "partial"
        : normalizeOrderStatus(order.status) === "partial"
          ? "ordered"
          : normalizeOrderStatus(order.status);
    updateStatus(order, { collectedPieces, status });
  }

  function rowKeyForOrder(order) {
    return order.id || order.orderNo;
  }

  function editCollectedDraft(order, value) {
    const key = rowKeyForOrder(order);
    setCollectedDrafts((current) => ({ ...current, [key]: value }));
  }

  function commitCollectedDraft(order, valueOverride) {
    const key = rowKeyForOrder(order);
    const hasDraft = Object.prototype.hasOwnProperty.call(collectedDrafts, key);
    if (!hasDraft && valueOverride === undefined) return;
    const value = valueOverride ?? collectedDrafts[key];
    setCollectedDrafts((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setCollectedPieces(order, value);
  }

  function handleStatusWheel(event) {
    if (!event.shiftKey || !statusScrollRef.current) return;
    event.preventDefault();
    statusScrollRef.current.scrollLeft += event.deltaY;
  }

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>متابعة حالة الطلبات</h2>
            <p>فلترة الموردين متعددة الاختيار، وتحديث حالة كل طلب من نفس المكان.</p>
          </div>
          <div className="actions">
            <button onClick={() => onPreview(report)}><Eye size={18} />معاينة التقرير</button>
            <button onClick={() => exportOrderStatusPdf(report, currentUser, logoSrc)}><FileDown size={18} />PDF</button>
            <button onClick={() => exportOrderStatusExcel(report)}><FileSpreadsheet size={18} />Excel</button>
          </div>
        </div>
        <div className="status-filters">
          <SearchBox value={query} onChange={setQuery} placeholder="بحث بالمورد / العميل / رقم الطلب / رقم الإذن" />
          <MultiChoice label="الموردين" options={supplierNames.length ? supplierNames : ["بدون مورد"]} selected={selectedSuppliers} onChange={setSelectedSuppliers} allLabel="كل الموردين" />
          <MultiChoice label="الحالات" options={ORDER_STATUS_DEFS.map((status) => status.value)} optionLabel={statusLabel} selected={selectedStatuses} onChange={setSelectedStatuses} allLabel="كل الحالات" />
        </div>
      </section>

      <section className="panel status-table-panel" ref={statusScrollRef} onWheel={handleStatusWheel}>
        <div className="status-table">
          <div className="status-row status-head">
            <span>رقم داخلي</span><span>رقم المورد</span><span>المورد</span><span>العميل / المشروع</span><span>التاريخ</span><span>الحالة</span><span>المستلم / المتبقي</span><span>اختصارات</span><span>تكلفة المورد</span><span></span>
          </div>
          {visibleOrders.length === 0 && <p className="hint padded">لا توجد طلبات مطابقة للفلاتر.</p>}
          {visibleOrders.map((order) => {
            const status = normalizeOrderStatus(order.status);
            const rowKey = rowKeyForOrder(order);
            const totals = orderTotals(order);
            const collectedPieces = orderCollectedPieces(order);
            const remainingPieces = orderRemainingPieces(order);
            const collectionLocked = ["pricing", "cancelled"].includes(status);
            const collectedDraftValue = Object.prototype.hasOwnProperty.call(collectedDrafts, rowKey) ? collectedDrafts[rowKey] : (collectedPieces || "");
            return (
              <div className="status-row" key={rowKey}>
                <strong dir="ltr">{displayOrderNo(order.orderNo)}</strong>
                <span dir="ltr">{orderDocumentId(order)}</span>
                <span>{order.supplierName || "بدون مورد"}</span>
                <span>{order.customerName || "بدون عميل"} / {order.project || "بدون مشروع"}</span>
                <span className="status-date" dir="ltr">{formatStatusDate(order.date)}</span>
                <select value={status} onChange={(event) => updateStatus(order, { status: event.target.value, collectedPieces: event.target.value === "collected" ? totals.pieces : orderCollectedPieces(order) })}>
                  {ORDER_STATUS_DEFS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
                <div className="collection-control">
                  <input
                    dir="ltr"
                    inputMode="decimal"
                    value={collectedDraftValue}
                    onChange={(event) => editCollectedDraft(order, event.target.value)}
                    onBlur={(event) => commitCollectedDraft(order, event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                    disabled={collectionLocked}
                    placeholder="0"
                  />
                  <span>متبقي {money(remainingPieces)}</span>
                </div>
                <div className="status-checks">
                  <label><input type="checkbox" checked={status === "collected"} onChange={(event) => setSpecialStatus(order, event.target.checked, "collected")} />تم الاستلام</label>
                  <label><input type="checkbox" checked={status === "pricing"} onChange={(event) => setSpecialStatus(order, event.target.checked, "pricing")} />تسعير فقط</label>
                  <label><input type="checkbox" checked={status === "cancelled"} onChange={(event) => setSpecialStatus(order, event.target.checked, "cancelled")} />ملغي</label>
                </div>
                <span className={isOrderPayableForSupplier(order) ? "payable yes" : "payable no"}>{isOrderPayableForSupplier(order) ? money(totals.supplierCost) : "غير مستحق"}</span>
                <button className="tiny" onClick={() => onOpen(order)}><Pencil size={14} />فتح</button>
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>ملخص التقرير غير المستلم</h2>
            <p>يظهر الطلبات الموجودة عند المورد ولم يتم جمعها بعد.</p>
          </div>
          <span className="status-chip warning">{report.rows.length} بند</span>
        </div>
        <OrderStatusMiniTable report={report} />
      </section>
    </div>
  );
}

function MultiChoice({ label, options, selected, onChange, allLabel = "الكل", optionLabel = (value) => value }) {
  const selectedSet = new Set(selected);
  function toggle(value) {
    const next = new Set(selectedSet);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange([...next]);
  }
  return (
    <details className="multi-choice">
      <summary>{label}<span>{selected.length ? `${selected.length} محدد` : allLabel}</span></summary>
      <div className="multi-choice-list">
        <button type="button" className="tiny" onClick={() => onChange([])}>{allLabel}</button>
        {options.map((option) => (
          <label key={option}>
            <input type="checkbox" checked={selectedSet.has(option)} onChange={() => toggle(option)} />
            {optionLabel(option)}
          </label>
        ))}
      </div>
    </details>
  );
}

function buildOrderStatusReport(orders, selectedSuppliers = []) {
  const selected = new Set(selectedSuppliers);
  const pendingOrders = orders
    .filter((order) => isOrderPendingCollection(order))
    .filter((order) => selected.size === 0 || selected.has(order.supplierName || "بدون مورد"));
  const groupedRows = new Map();
  for (const order of pendingOrders) {
    const supplier = order.supplierName || "بدون مورد";
    const documentId = orderDocumentId(order);
    const key = `${supplier}::${documentId}`;
    if (!groupedRows.has(key)) {
      groupedRows.set(key, {
        supplier,
        documentId,
        orderNos: new Set(),
        dates: new Set(),
        customers: new Set(),
        projects: new Set(),
        glassItems: new Set(),
        statuses: new Set(),
        quantity: 0,
        area: 0,
        supplierCost: 0,
        notes: new Set()
      });
    }
    const group = groupedRows.get(key);
    const totals = orderTotals(order);
    const remainingPieces = orderRemainingPieces(order);
    const remainingRatio = orderRemainingRatio(order);
    if (remainingPieces <= 0) continue;
    group.orderNos.add(displayOrderNo(order.orderNo));
    if (order.date) group.dates.add(order.date);
    if (order.customerName) group.customers.add(order.customerName);
    if (order.project) group.projects.add(order.project);
    if (order.notes) group.notes.add(order.notes);
    group.statuses.add(normalizeOrderStatus(order.status));
    group.quantity += remainingPieces;
    group.area += totals.area * remainingRatio;
    group.supplierCost += totals.supplierCost * remainingRatio;
    for (const row of order.rows || []) {
      group.glassItems.add(rowDescription(row));
      if (row.notes) group.notes.add(row.notes);
    }
  }
  const rows = [...groupedRows.values()].map((row) => {
    const statuses = [...row.statuses];
    return {
      supplier: row.supplier,
      documentId: row.documentId,
      orderNo: [...row.orderNos].join(" / "),
      date: [...row.dates].sort().join(" / "),
      customer: [...row.customers].join(" / "),
      project: [...row.projects].join(" / "),
      glass: [...row.glassItems].join(" | "),
      quantity: row.quantity,
      area: row.area,
      supplierCost: row.supplierCost,
      status: statuses[0] || "ordered",
      statusText: statuses.map(statusLabel).join(" / "),
      notes: [...row.notes].join(" | ")
    };
  }).sort((a, b) => a.supplier.localeCompare(b.supplier, "ar") || String(a.documentId).localeCompare(String(b.documentId), "ar"));
  const suppliers = Object.values(rows.reduce((groups, row) => {
    groups[row.supplier] ||= { supplier: row.supplier, rows: [], subtotal: { quantity: 0, area: 0, supplierCost: 0 } };
    groups[row.supplier].rows.push(row);
    groups[row.supplier].subtotal.quantity += numberValue(row.quantity);
    groups[row.supplier].subtotal.area += numberValue(row.area);
    groups[row.supplier].subtotal.supplierCost += numberValue(row.supplierCost);
    return groups;
  }, {}));
  const total = rows.reduce((sum, row) => {
    sum.quantity += numberValue(row.quantity);
    sum.area += numberValue(row.area);
    sum.supplierCost += numberValue(row.supplierCost);
    return sum;
  }, { quantity: 0, area: 0, supplierCost: 0 });
  return { generatedAt: new Date().toISOString(), selectedSuppliers, rows, suppliers, total, singleSupplier: suppliers.length === 1 };
}

function OrderStatusMiniTable({ report }) {
  return (
    <div className="report-table order-status-report-table compact-report">
      <div className="report-row order-status-report-row head"><span>المورد</span><span>رقم الإذن</span><span>العميل / المشروع</span><span>رقم الطلب</span><span>القطع</span><span>المساحة</span><span>التكلفة</span><span>الحالة</span></div>
      {report.rows.slice(0, 16).map((row, index) => (
        <div className="report-row order-status-report-row" key={`${row.supplier}-${row.documentId}-${index}`}>
          <span>{row.supplier}</span><span dir="ltr" className="keep-line">{row.documentId}</span><span>{[row.customer, row.project].filter(Boolean).join(" / ")}</span><span dir="ltr" className="keep-line">{row.orderNo}</span><span className="keep-line">{money(row.quantity)}</span><span className="keep-line">{square(row.area)}</span><span className="keep-line">{money(row.supplierCost)}</span><span>{row.statusText}</span>
        </div>
      ))}
      {report.rows.length > 16 && <div className="report-row order-status-report-row subtotal"><span className="subtotal-label">والمزيد في التصدير الكامل</span><span>{report.rows.length - 16}</span><span></span><span></span><span></span></div>}
    </div>
  );
}

function OrderStatusReport({ report, currentUser, logoSrc }) {
  return (
    <div className="report">
      <ReportHeader title="بيان بطلبيات الزجاج غير المستلمة" logoSrc={logoSrc} />
      <ReportTiming items={[{ label: "تاريخ الإصدار", value: report.generatedAt, exact: true }]} />
      <div className="report-meta">
        <span>المورد: {report.selectedSuppliers.length ? report.selectedSuppliers.join(" / ") : "كل الموردين"}</span>
        <span>عدد البنود: {report.rows.length}</span>
        <span>إجمالي المساحة: {square(report.total.area)} م2</span>
        <span>إجمالي القطع: {money(report.total.quantity)}</span>
      </div>
      <div className="report-table order-status-report-table">
        <div className="report-row order-status-report-row head"><span>رقم الإذن</span><span>العميل / المشروع</span><span>رقم الطلب</span><span>تاريخ الطلب</span><span>القطع</span><span>المساحة م2</span><span>تكلفة المورد</span><span>الحالة</span></div>
        {report.suppliers.map((supplier) => (
          <React.Fragment key={supplier.supplier}>
            {supplier.rows.map((row, index) => (
              <div className="report-row order-status-report-row" key={`${row.supplier}-${row.documentId}-${index}`}>
                <span dir="ltr" className="keep-line">{row.documentId}</span><span>{[row.customer, row.project].filter(Boolean).join(" / ")}</span><span dir="ltr" className="keep-line">{row.orderNo}</span><span dir="ltr" className="keep-line">{formatStatusDate(row.date)}</span><span className="keep-line">{money(row.quantity)}</span><span className="keep-line">{square(row.area)}</span><span className="keep-line">{money(row.supplierCost)}</span><span>{row.statusText}</span>
              </div>
            ))}
            {!report.singleSupplier && <div className="report-row order-status-report-row subtotal"><span className="subtotal-label">إجمالي المورد {supplier.supplier}</span><span>{money(supplier.subtotal.quantity)}</span><span>{square(supplier.subtotal.area)}</span><span>{money(supplier.subtotal.supplierCost)}</span><span></span></div>}
          </React.Fragment>
        ))}
        <div className="report-row order-status-report-row total"><span className="subtotal-label">الإجمالي</span><span>{money(report.total.quantity)}</span><span>{square(report.total.area)}</span><span>{money(report.total.supplierCost)}</span><span></span></div>
      </div>
      <ReportFooter currentUser={currentUser} />
    </div>
  );
}

function SupplierReport({ supplier, data, currentUser, logoSrc }) {
  const orders = data.orders.filter((order) => order.supplierName === supplier.name && isOrderPayableForSupplier(order));
  const payments = data.payments.filter((payment) => payment.supplier_id === supplier.id || payment.supplier_name === supplier.name);
  return (
    <div className="report">
      <ReportHeader title={`كشف حساب ${supplier.name}`} logoSrc={logoSrc} />
      <div className="report-table supplier-report-table">
        <div className="report-row supplier-report-row head"><span>التاريخ</span><span>البيان</span><span>مدين</span><span>دائن</span></div>
        {orders.map((order) => <div className="report-row supplier-report-row" key={order.id}><span className="keep-line">{order.date}</span><span className="keep-line">{displayOrderNo(order.orderNo)} - {statusLabel(order.status)}</span><span className="keep-line">{money(orderTotals(order).supplierCost)}</span><span></span></div>)}
        {payments.map((payment) => <div className="report-row supplier-report-row" key={payment.id}><span className="keep-line">{payment.paid_at}</span><span>{payment.notes || payment.method || "دفعة"}</span><span></span><span className="keep-line">{money(payment.amount)}</span></div>)}
      </div>
      <ReportFooter currentUser={currentUser} />
    </div>
  );
}

function ReportHeader({ title, logoSrc = hgadReportLogo }) {
  return (
    <header className="report-header">
      <img className="report-logo-main" src={logoSrc || hgadReportLogo} alt="HGAD" />
      <div>
        <strong>{COMPANY.nameEn}</strong>
        <span>{COMPANY.nameAr}</span>
        <h2>{title}</h2>
      </div>
      <img className="report-logo-app" src={appLogo} alt="Glass Orders" />
    </header>
  );
}

function ReportFooter({ currentUser }) {
  return (
    <footer className="report-footer">
      <span>{COMPANY.shortName}</span>
      <span>{COMPANY.website}</span>
      <span>By Eng. {currentUser?.display_name || "User"}</span>
    </footer>
  );
}

function PaymentModal({ supplier, onClose, onSave }) {
  const existing = supplier.payment || {};
  const [form, setForm] = useState({
    id: existing.id || "",
    supplier_id: existing.supplier_id || supplier.id,
    supplier_name: existing.supplier_name || supplier.name,
    paid_at: existing.paid_at || today(),
    amount: existing.amount ?? "",
    method: existing.method || "cash",
    notes: existing.notes || ""
  });
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="panel-head"><h2>{existing.id ? "تعديل دفعة" : "إضافة دفعة"}: {supplier.name}</h2><button onClick={onClose}>إغلاق</button></div>
        <Field label="التاريخ"><input type="date" value={form.paid_at} onChange={(e) => setForm({ ...form, paid_at: e.target.value })} /></Field>
        <Field label="القيمة"><input dir="ltr" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
        <Field label="الطريقة"><input value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} /></Field>
        <Field label="ملاحظات"><textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        <button className="primary" onClick={() => onSave(form)}><Save size={18} />{existing.id ? "حفظ التعديل" : "حفظ الدفعة"}</button>
      </div>
    </div>
  );
}

function LogoDropzone({ logoSrc, title = "شعار التقرير", description = "اسحب صورة هنا أو اختر ملفاً لتحديث شعار التقارير.", onLogo, onReset }) {
  const [dragging, setDragging] = useState(false);
  function readFile(file) {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => onLogo(String(reader.result || ""));
    reader.readAsDataURL(file);
  }
  return (
    <div
      className={dragging ? "logo-dropzone dragging" : "logo-dropzone"}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        readFile(event.dataTransfer.files?.[0]);
      }}
    >
      <div className="report-logo-preview">
        <img src={logoSrc} alt={title} />
      </div>
      <div>
        <strong>{title}</strong>
        <span>{description}</span>
        <div className="actions">
          <label className="file-button">
            <ImagePlus size={16} />
            اختيار صورة
            <input type="file" accept="image/*" onChange={(event) => readFile(event.target.files?.[0])} />
          </label>
          <button type="button" className="tiny" onClick={onReset}>استعادة شعار HGAD</button>
        </div>
      </div>
    </div>
  );
}

function LogConsole({ title, logs, expanded, onToggle }) {
  const [copied, setCopied] = useState(false);
  const logsText = logs?.length ? logs.join("\n") : "No logs yet. Start the service and live logs will appear here.";
  async function copyLogs() {
    await navigator.clipboard?.writeText(logsText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }
  return (
    <div className={expanded ? "log-console expanded" : "log-console"}>
      <div className="log-console-head">
        <strong>{title}</strong>
        <div className="log-console-actions">
          <button type="button" className="tiny" onClick={copyLogs}><Copy size={14} />{copied ? "تم النسخ" : "نسخ"}</button>
          <button type="button" className="tiny" onClick={onToggle}>{expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}{expanded ? "تصغير" : "توسيع"}</button>
        </div>
      </div>
      <pre dir="ltr">{logsText}</pre>
    </div>
  );
}

function SettingsView({ refreshAll, localStatus, setLocalStatus, setMessage, currentUser, data, setData, appearance, setAppearance, appLogoSrc, reportLogoSrc }) {
  const [localApi, setLocalApi] = useState(localApiBase());
  const [useLocalServer, setUseLocalServer] = useState(localServerEnabled());
  const [sourceMode, setSourceMode] = useState(dataSourceMode());
  const [supabaseForm, setSupabaseForm] = useState(() => supabaseConfig());
  const [users, setUsers] = useState(data.users || []);
  const [newUser, setNewUser] = useState({ username: "", display_name: "", email: "", password: "", role: "user", is_active: true });
  const [editingUserId, setEditingUserId] = useState(null);
  const [editingUser, setEditingUser] = useState({});
  const [passwordDraft, setPasswordDraft] = useState({ current_password: "", new_password: "" });
  const [serverLogs, setServerLogs] = useState([]);
  const [serverLogExpanded, setServerLogExpanded] = useState(false);
  const [botLogs, setBotLogs] = useState([]);
  const [botStatus, setBotStatus] = useState({ running: false });
  const [botLogExpanded, setBotLogExpanded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => setUsers(data.users || []), [data.users]);

  useEffect(() => {
    readServerLogs();
    readTelegramBotStatus();
    const timer = window.setInterval(() => {
      readServerLogs();
      readTelegramBotStatus();
    }, 1800);
    return () => window.clearInterval(timer);
  }, []);

  function patchAppearance(patchValue) {
    setAppearance((current) => ({ ...current, ...patchValue }));
  }

  async function refreshUsers() {
    try {
      const client = supabaseEnabled() ? getSupabaseClient() : null;
      if (client) {
        const result = await client.from("users").select(USER_PUBLIC_COLUMNS).order("created_at").order("username");
        if (result.error) throw result.error;
        setUsers(result.data || []);
        setData((current) => ({ ...current, users: result.data || [] }));
        return;
      }
      const rows = await localRequest("/api/users", {}, 5000);
      setUsers(rows || []);
      setData((current) => ({ ...current, users: rows || [] }));
    } catch {
      setUsers(data.users || []);
    }
  }

  function saveLocalSettings() {
    localStorage.setItem("glassOrdersLocalApi", localApi);
    const nextMode = useLocalServer ? "local" : sourceMode === "local" ? "browser" : sourceMode;
    setDataSourceMode(nextMode);
    setSourceMode(nextMode);
    setMessage("تم حفظ إعدادات القاعدة المحلية.");
  }

  async function readServerLogs() {
    if (!window.glassOrdersDesktop?.localServerLogs) {
      setServerLogs(["الخادم المحلي يعمل تلقائياً في نسخة سطح المكتب. السجل التفصيلي يظهر هنا عند فتح البرنامج من Windows app."]);
      return;
    }
    try {
      setServerLogs(await window.glassOrdersDesktop.localServerLogs());
    } catch {
      // Logs are only available in the desktop app.
    }
  }

  async function startLocalServerFromDesktop() {
    if (!window.glassOrdersDesktop?.startLocalServer) return null;
    const result = await window.glassOrdersDesktop.startLocalServer();
    setServerLogs(result?.logs || []);
    await new Promise((resolve) => window.setTimeout(resolve, 1200));
    return result;
  }

  async function stopLocalServerFromDesktop() {
    if (!window.glassOrdersDesktop?.stopLocalServer) return null;
    const result = await window.glassOrdersDesktop.stopLocalServer();
    setServerLogs(result?.logs || []);
    setLocalStatus(null);
    setMessage("تم إيقاف الخادم المحلي.");
    return result;
  }

  async function readTelegramBotStatus() {
    try {
      const status = await localRequest("/api/telegram-bot/status", {}, 2500);
      setBotStatus(status || { running: false });
      setBotLogs(status?.logs || []);
      return;
    } catch {
      // Fall back to Electron direct control when the local API is still starting.
    }
    if (!window.glassOrdersDesktop?.telegramBotStatus) {
      setBotStatus({ running: false });
      setBotLogs(["اضغط حفظ وتشغيل لتجهيز القاعدة المحلية أولاً، ثم شغل البوت من هنا."]);
      return;
    }
    try {
      const status = await window.glassOrdersDesktop.telegramBotStatus();
      setBotStatus(status || { running: false });
      setBotLogs(status?.logs || []);
    } catch {
      setBotStatus({ running: false });
    }
  }

  async function toggleTelegramBot() {
    setBusy(true);
    try {
      let result;
      const supabase = supabaseConfig();
      if (window.glassOrdersDesktop) {
        result = botStatus?.running
          ? await window.glassOrdersDesktop?.stopTelegramBot?.()
          : await window.glassOrdersDesktop?.startTelegramBot?.({ supabaseUrl: supabase.url, supabaseKey: supabase.key });
      } else {
        try {
          result = await localRequest(botStatus?.running ? "/api/telegram-bot/stop" : "/api/telegram-bot/start", {
            method: "POST",
            body: JSON.stringify(botStatus?.running ? {} : { supabaseUrl: supabase.url, supabaseKey: supabase.key })
          }, 8000);
        } catch (error) {
          if (/failed to fetch|network|refused/i.test(safeErrorMessage(error))) {
            throw new Error("الخادم المحلي غير يعمل الآن. افتح نسخة سطح المكتب أو اضغط حفظ وتشغيل في القاعدة المحلية أولاً.");
          }
          throw error;
        }
      }
      setBotStatus(result || { running: false });
      setBotLogs(result?.logs || []);
      setMessage(result?.running ? "تم تشغيل بوت Telegram." : "تم إيقاف بوت Telegram.");
    } catch (error) {
      setMessage(`تعذر التحكم في بوت Telegram: ${safeErrorMessage(error)}`);
    } finally {
      setBusy(false);
      await readTelegramBotStatus();
    }
  }

  async function saveLocalAndPrepare() {
    setBusy(true);
    try {
      saveLocalSettings();
      await startLocalServerFromDesktop();
      let health = await localHealth();
      setLocalStatus(health);
      const result = await localRequest("/api/import/excel", { method: "POST", body: JSON.stringify({}) }, 120000);
      await refreshAll();
      await refreshUsers();
      await readServerLogs();
      setMessage(`القاعدة المحلية تعمل. تم تجهيز ${result.importedOrders} طلب و ${result.importedRows} صف من ملف الإكسل.`);
    } catch (error) {
      await readServerLogs();
      setLocalStatus(null);
      setMessage(`تعذر تجهيز القاعدة المحلية: ${safeErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function checkLocalServer() {
    setBusy(true);
    try {
      saveLocalSettings();
      const health = await localHealth();
      setLocalStatus(health);
      setMessage(health?.ok ? "القاعدة المحلية تعمل الآن." : "القاعدة المحلية غير متاحة.");
    } catch (error) {
      setLocalStatus(null);
      setMessage(`تعذر الاتصال بالقاعدة المحلية: ${safeErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function importExcelToLocal() {
    setBusy(true);
    try {
      saveLocalSettings();
      const result = await localRequest("/api/import/excel", { method: "POST", body: JSON.stringify({}) }, 120000);
      setMessage(`تم استيراد ${result.importedOrders} طلب و ${result.importedRows} صف من ملف الإكسل.`);
      await refreshAll();
    } catch (error) {
      setMessage(`تعذر استيراد ملف الإكسل: ${safeErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  function saveSupabaseSettings() {
    localStorage.setItem("glassOrdersSupabaseUrl", supabaseForm.url.trim());
    localStorage.setItem("glassOrdersSupabaseKey", supabaseForm.key.trim());
    localStorage.setItem("glassOrdersSupabaseRedirectUrl", supabaseForm.redirectUrl.trim());
    resetSupabaseClientCache();
    setDataSourceMode("supabase");
    setSourceMode("supabase");
    setUseLocalServer(false);
    setMessage("تم حفظ إعدادات Supabase وتفعيلها كمصدر بيانات.");
  }

  async function checkSupabaseConnection() {
    setBusy(true);
    try {
      saveSupabaseSettings();
      const client = getSupabaseClient();
      if (!client) throw new Error("بيانات Supabase غير مكتملة.");
      const [orders, usersResult] = await Promise.all([
        client.from("glass_orders").select("id", { count: "exact", head: true }),
        client.from("users").select("id", { count: "exact", head: true })
      ]);
      if (orders.error) throw orders.error;
      if (usersResult.error) throw usersResult.error;
      await refreshAll();
      await refreshUsers();
      setMessage(`Supabase يعمل. الطلبات: ${orders.count ?? 0}، المستخدمون: ${usersResult.count ?? 0}.`);
    } catch (error) {
      setMessage(`تعذر الاتصال بـ Supabase: ${safeErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function addUser(event) {
    event.preventDefault();
    setBusy(true);
    try {
      let user;
      const client = supabaseEnabled() ? getSupabaseClient() : null;
      if (client) {
        const payload = {
          username: cleanName(newUser.username),
          display_name: cleanName(newUser.display_name),
          email: cleanName(newUser.email).toLocaleLowerCase() || null,
          role: newUser.role === "admin" ? "admin" : "user",
          password: String(newUser.password || ""),
          is_active: newUser.is_active === false ? false : true
        };
        if (!payload.username || !payload.display_name || !payload.email) throw new Error("اكتب اسم الدخول والاسم والبريد.");
        const result = await client.from("users").insert(payload).select(USER_PUBLIC_COLUMNS).single();
        if (result.error) throw result.error;
        user = result.data;
      } else {
        user = await localRequest("/api/users", { method: "POST", body: JSON.stringify(newUser) }, 8000);
      }
      setUsers((current) => [...current, user]);
      setData((current) => ({ ...current, users: [...(current.users || []), user] }));
      setNewUser({ username: "", display_name: "", email: "", password: "", role: "user", is_active: true });
      setMessage("تم إضافة المستخدم.");
    } catch (error) {
      setMessage(`تعذر إضافة المستخدم: ${safeErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveUser(userId) {
    setBusy(true);
    try {
      let updated;
      const client = supabaseEnabled() ? getSupabaseClient() : null;
      if (client) {
        const patch = { ...editingUser };
        if (patch.username !== undefined) patch.username = cleanName(patch.username);
        if (patch.display_name !== undefined) patch.display_name = cleanName(patch.display_name);
        if (patch.email !== undefined) patch.email = cleanName(patch.email).toLocaleLowerCase() || null;
        if (!patch.password) delete patch.password;
        const result = await client.from("users").update(patch).eq("id", userId).select(USER_PUBLIC_COLUMNS).single();
        if (result.error) throw result.error;
        updated = result.data;
      } else {
        updated = await localRequest(`/api/users/${encodeURIComponent(userId)}`, { method: "PUT", body: JSON.stringify(editingUser) }, 8000);
      }
      setUsers((current) => current.map((user) => user.id === userId ? updated : user));
      setData((current) => ({ ...current, users: (current.users || []).map((user) => user.id === userId ? updated : user) }));
      setEditingUserId(null);
      setEditingUser({});
      setMessage("تم تعديل المستخدم.");
    } catch (error) {
      setMessage(`تعذر تعديل المستخدم: ${safeErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function deactivateUser(userId) {
    const target = users.find((user) => user.id === userId);
    if (isCurrentUserRecord(target)) {
      setMessage("لا يمكن إيقاف المستخدم الحالي.");
      return;
    }
    if (!window.confirm("إيقاف هذا المستخدم؟")) return;
    setBusy(true);
    try {
      const client = supabaseEnabled() ? getSupabaseClient() : null;
      if (client) {
        const result = await client.from("users").update({ is_active: false }).eq("id", userId);
        if (result.error) throw result.error;
      } else {
        await localRequest(`/api/users/${encodeURIComponent(userId)}`, { method: "DELETE" }, 8000);
      }
      setUsers((current) => current.map((user) => user.id === userId ? { ...user, is_active: false } : user));
      setData((current) => ({ ...current, users: (current.users || []).map((user) => user.id === userId ? { ...user, is_active: false } : user) }));
      setMessage("تم إيقاف المستخدم.");
    } catch (error) {
      setMessage(`تعذر إيقاف المستخدم: ${safeErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  function isCurrentUserRecord(user) {
    return !!user && (user.id === currentUser?.id || user.username === currentUser?.username);
  }

  async function deleteUserCompletely(user) {
    if (!user?.id) return;
    if (isCurrentUserRecord(user)) {
      setMessage("لا يمكن حذف المستخدم الحالي.");
      return;
    }
    if (!window.confirm(`حذف المستخدم ${user.username} نهائياً من قاعدة التطبيق؟`)) return;
    setBusy(true);
    try {
      const client = supabaseEnabled() ? getSupabaseClient() : null;
      if (client) {
        const result = await client.from("users").delete().eq("id", user.id);
        if (result.error) throw result.error;
      } else {
        await localRequest(`/api/users/${encodeURIComponent(user.id)}/hard`, { method: "DELETE" }, 8000);
      }
      setUsers((current) => current.filter((item) => item.id !== user.id));
      setData((current) => ({ ...current, users: (current.users || []).filter((item) => item.id !== user.id) }));
      setMessage("تم حذف المستخدم نهائياً من قاعدة التطبيق.");
    } catch (error) {
      setMessage(`تعذر حذف المستخدم: ${safeErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function changeMyPassword(event) {
    event.preventDefault();
    if (!currentUser?.id) return;
    setBusy(true);
    try {
      const client = supabaseEnabled() ? getSupabaseClient() : null;
      if (client) {
        await changeSupabaseAppUserPassword(currentUser, passwordDraft.current_password, passwordDraft.new_password);
        await refreshUsers();
      } else {
        await localRequest(`/api/users/${encodeURIComponent(currentUser.id)}/password`, { method: "PUT", body: JSON.stringify(passwordDraft) }, 8000);
      }
      setPasswordDraft({ current_password: "", new_password: "" });
      setMessage("تم تغيير كلمة المرور.");
    } catch (error) {
      setMessage(`تعذر تغيير كلمة المرور: ${safeErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-stack">
      <section className="panel">
        <div className="panel-head">
          <h2><Palette size={18} /> المظهر والهوية</h2>
          <div className="actions">
            {Object.entries(THEME_PRESETS).map(([key, preset]) => {
              const Icon = preset.icon;
              return (
                <button key={key} className={appearance.theme === key ? "active" : ""} type="button" onClick={() => setAppearance((current) => appearanceWithTheme(key, current))}>
                  <Icon size={16} />{preset.name}
                </button>
              );
            })}
          </div>
        </div>
        <div className="settings-grid appearance-grid">
          <LogoDropzone
            logoSrc={reportLogoSrc}
            title="شعار التقارير"
            description="هذا الشعار يظهر في رأس تقارير PDF والطباعة، مثل شعار HGAD."
            onLogo={(reportLogoDataUrl) => patchAppearance({ reportLogoDataUrl })}
            onReset={() => patchAppearance({ reportLogoDataUrl: "" })}
          />
          <Field label="خط العناوين">
            <Combo value={appearance.headingFontFamily} options={FONT_OPTIONS} onChange={(headingFontFamily) => patchAppearance({ headingFontFamily })} />
          </Field>
          <Field label="خط النصوص">
            <Combo value={appearance.bodyFontFamily} options={FONT_OPTIONS} onChange={(bodyFontFamily) => patchAppearance({ bodyFontFamily })} />
          </Field>
          <Field label="خط عناوين الجداول">
            <Combo value={appearance.tableHeadingFontFamily} options={FONT_OPTIONS} onChange={(tableHeadingFontFamily) => patchAppearance({ tableHeadingFontFamily })} />
          </Field>
          <Field label="خط جسم الجداول">
            <Combo value={appearance.tableBodyFontFamily} options={FONT_OPTIONS} onChange={(tableBodyFontFamily) => patchAppearance({ tableBodyFontFamily })} />
          </Field>
          <Field label="لون نص العناوين">
            <input type="color" value={appearance.headingFontColor} onChange={(event) => patchAppearance({ headingFontColor: event.target.value })} />
          </Field>
          <Field label="لون نصوص التطبيق">
            <input type="color" value={appearance.bodyFontColor} onChange={(event) => patchAppearance({ bodyFontColor: event.target.value })} />
          </Field>
          <Field label="خلفية عنوان الجدول">
            <input type="color" value={appearance.tableHeaderBg} onChange={(event) => patchAppearance({ tableHeaderBg: event.target.value })} />
          </Field>
          <Field label="لون عنوان الجدول">
            <input type="color" value={appearance.tableHeaderColor} onChange={(event) => patchAppearance({ tableHeaderColor: event.target.value })} />
          </Field>
          <Field label="لون خطوط الجداول">
            <input type="color" value={appearance.tableLineColor} onChange={(event) => patchAppearance({ tableLineColor: event.target.value })} />
          </Field>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>القاعدة المحلية</h2></div>
        <div className="settings-grid">
          <Field label="مصدر البيانات">
            <select value={sourceMode} onChange={(event) => {
              const mode = event.target.value;
              setSourceMode(mode);
              setUseLocalServer(mode === "local");
              setDataSourceMode(mode);
            }}>
              <option value="supabase">Supabase مباشر</option>
              <option value="local" disabled={!localServerAllowed()}>قاعدة محلية داخل التطبيق</option>
              <option value="browser">تجربة داخل المتصفح فقط</option>
            </select>
          </Field>
          <Field label="رابط الخادم المحلي">
            <input dir="ltr" value={localApi} onChange={(event) => setLocalApi(event.target.value)} />
          </Field>
          <label className="toggle-line">
            <input type="checkbox" checked={useLocalServer && localServerAllowed()} disabled={!localServerAllowed()} onChange={(event) => {
              const checked = event.target.checked;
              setUseLocalServer(checked);
              setSourceMode(checked ? "local" : sourceMode === "local" ? "browser" : sourceMode);
            }} />
            استخدام القاعدة المحلية عند فتح البرنامج
          </label>
          <div className="server-card">
            <Server size={22} />
            <div>
              <strong>{localStatus?.ok ? "الخادم المحلي يعمل" : "الخادم المحلي غير متصل"}</strong>
              <span dir="ltr">{localStatus?.database || "npm run local:server"}</span>
            </div>
          </div>
          <div className="actions">
            <button className="primary" onClick={saveLocalAndPrepare} disabled={busy || !localServerAllowed()}><Save size={18} />حفظ وتشغيل</button>
            <button onClick={stopLocalServerFromDesktop} disabled={busy || !localServerAllowed()}><PowerOff size={18} />إيقاف الخادم</button>
            <button onClick={checkLocalServer} disabled={busy || !localServerAllowed()}><RefreshCw size={18} />فحص الاتصال</button>
          </div>
          <LogConsole title="سجل الخادم المحلي" logs={serverLogs} expanded={serverLogExpanded} onToggle={() => setServerLogExpanded((value) => !value)} />
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2><Bot size={18} /> بوت Telegram</h2>
            <p>تشغيل وإيقاف البوت من داخل البرنامج مع متابعة السجل الحي.</p>
          </div>
          <button className={botStatus?.running ? "danger" : "primary"} onClick={toggleTelegramBot} disabled={busy}>
            {botStatus?.running ? <PowerOff size={18} /> : <Power size={18} />}
            {botStatus?.running ? "إيقاف البوت" : "تشغيل البوت"}
          </button>
        </div>
        <div className="settings-grid">
          <div className="server-card">
            <Bot size={22} />
            <div>
              <strong>{botStatus?.running ? "البوت يعمل الآن" : "البوت متوقف"}</strong>
              <span dir="ltr">{botStatus?.pid ? `PID ${botStatus.pid}` : "server/telegramBot.mjs"}</span>
            </div>
          </div>
          <LogConsole title="سجل بوت Telegram" logs={botLogs} expanded={botLogExpanded} onToggle={() => setBotLogExpanded((value) => !value)} />
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>Supabase</h2></div>
        <div className="settings-grid">
          <Field label="Project URL">
            <input type="password" dir="ltr" value={supabaseForm.url} onChange={(event) => setSupabaseForm((current) => ({ ...current, url: event.target.value }))} autoComplete="off" placeholder="https://***.supabase.co" />
          </Field>
          <Field label="Anon key">
            <input type="password" dir="ltr" value={supabaseForm.key} onChange={(event) => setSupabaseForm((current) => ({ ...current, key: event.target.value }))} autoComplete="off" placeholder="eyJ..." />
          </Field>
          <Field label="رابط الرجوع للبريد">
            <input type="password" dir="ltr" value={supabaseForm.redirectUrl} onChange={(event) => setSupabaseForm((current) => ({ ...current, redirectUrl: event.target.value }))} autoComplete="off" placeholder="اختياري" />
          </Field>
          <div className="actions">
            <button onClick={saveSupabaseSettings}><Save size={18} />حفظ وتفعيل Supabase</button>
            <button onClick={checkSupabaseConnection} disabled={busy}><RefreshCw size={18} />فحص Supabase</button>
            <button onClick={() => navigator.clipboard?.writeText("supabase/schema.sql").then(() => setMessage("تم نسخ مسار ملف تجهيز الجداول."))}><Copy size={18} />نسخ مسار الجداول</button>
          </div>
        </div>
      </section>

      <section className="panel users-panel">
        <div className="panel-head">
          <h2><UsersRound size={18} /> المستخدمون</h2>
          <button type="button" onClick={refreshUsers} disabled={busy}><RefreshCw size={18} />تحديث</button>
        </div>
        <form className="form-grid user-form" onSubmit={changeMyPassword}>
          <Field label="كلمة المرور الحالية">
            <input type="password" value={passwordDraft.current_password} onChange={(event) => setPasswordDraft({ ...passwordDraft, current_password: event.target.value })} required />
          </Field>
          <Field label="كلمة المرور الجديدة">
            <input type="password" value={passwordDraft.new_password} onChange={(event) => setPasswordDraft({ ...passwordDraft, new_password: event.target.value })} required />
          </Field>
          <button type="submit" disabled={busy}><KeyRound size={18} />تغيير كلمتي</button>
        </form>
        {currentUser?.role === "admin" ? (
          <>
            <form className="form-grid user-form" onSubmit={addUser}>
              <Field label="اسم الدخول">
                <input value={newUser.username} onChange={(event) => setNewUser({ ...newUser, username: event.target.value })} required />
              </Field>
              <Field label="البريد الإلكتروني">
                <input type="email" dir="ltr" value={newUser.email} onChange={(event) => setNewUser({ ...newUser, email: event.target.value })} required={supabaseEnabled()} />
              </Field>
              <Field label="الاسم في التقارير">
                <input value={newUser.display_name} onChange={(event) => setNewUser({ ...newUser, display_name: event.target.value })} placeholder="Yasser Diab" required />
              </Field>
              <Field label="كلمة المرور">
                <input type="password" value={newUser.password} onChange={(event) => setNewUser({ ...newUser, password: event.target.value })} required={!supabaseEnabled()} placeholder={supabaseEnabled() ? "اختياري" : ""} />
              </Field>
              <Field label="الدور">
                <select value={newUser.role} onChange={(event) => setNewUser({ ...newUser, role: event.target.value })}>
                  <option value="user">مستخدم</option>
                  <option value="admin">مدير</option>
                </select>
              </Field>
              <button type="submit" className="primary" disabled={busy}><UserPlus size={18} />إضافة مستخدم</button>
            </form>
            <div className="table-scroll users-scroll">
              <table className="users-table">
                <thead>
                  <tr>
                    <th>اسم الدخول</th>
                    <th>البريد</th>
                    <th>الاسم في التقارير</th>
                    <th>الدور</th>
                    <th>الحالة</th>
                    <th>كلمة مرور جديدة</th>
                    <th>آخر دخول</th>
                    <th>إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id}>
                      {editingUserId === user.id ? (
                        <>
                          <td><input value={editingUser.username ?? user.username} onChange={(event) => setEditingUser({ ...editingUser, username: event.target.value })} /></td>
                          <td><input type="email" dir="ltr" value={editingUser.email ?? user.email ?? ""} onChange={(event) => setEditingUser({ ...editingUser, email: event.target.value })} /></td>
                          <td><input value={editingUser.display_name ?? user.display_name} onChange={(event) => setEditingUser({ ...editingUser, display_name: event.target.value })} /></td>
                          <td>
                            <select value={editingUser.role ?? user.role} onChange={(event) => setEditingUser({ ...editingUser, role: event.target.value })}>
                              <option value="user">مستخدم</option>
                              <option value="admin">مدير</option>
                            </select>
                          </td>
                          <td>
                            <select value={String(editingUser.is_active ?? user.is_active)} onChange={(event) => setEditingUser({ ...editingUser, is_active: event.target.value === "true" })}>
                              <option value="true">نشط</option>
                              <option value="false">موقوف</option>
                            </select>
                          </td>
                          <td><input type="password" value={editingUser.password || ""} onChange={(event) => setEditingUser({ ...editingUser, password: event.target.value })} placeholder="اتركها فارغة" /></td>
                          <td dir="ltr">{user.last_login_at || ""}</td>
                          <td className="row-actions">
                            <button className="tiny primary" type="button" onClick={() => saveUser(user.id)}>حفظ</button>
                            <button className="tiny" type="button" onClick={() => { setEditingUserId(null); setEditingUser({}); }}>إلغاء</button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td dir="ltr">{user.username}</td>
                          <td dir="ltr">{user.email || ""}</td>
                          <td>{user.display_name}</td>
                          <td>{user.role === "admin" ? "مدير" : "مستخدم"}</td>
                          <td>{user.is_active === false ? "موقوف" : "نشط"}</td>
                          <td></td>
                          <td dir="ltr">{user.last_login_at || ""}</td>
                          <td className="row-actions">
                            <button className="tiny" type="button" onClick={() => { setEditingUserId(user.id); setEditingUser({}); }}>تعديل</button>
                            <button className="tiny danger" type="button" disabled={isCurrentUserRecord(user)} onClick={() => deactivateUser(user.id)}>إيقاف</button>
                            <button className="tiny danger" type="button" disabled={isCurrentUserRecord(user)} onClick={() => deleteUserCompletely(user)}>
                              <Trash2 size={14} />حذف
                            </button>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="hint">إدارة المستخدمين تظهر لحساب المدير فقط.</p>
        )}
      </section>
    </div>
  );
}

function Field({ label, children }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function Combo({ value, options, onChange, className = "", ...inputProps }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const inputClass = [inputProps.className, className].filter(Boolean).join(" ");
  const cleanOptions = useMemo(() => uniqueValues(options), [options]);
  const visibleOptions = useMemo(() => {
    return cleanOptions.slice(0, 90);
  }, [cleanOptions]);
  useEffect(() => {
    function close(event) {
      if (!wrapRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  function commit(nextValue) {
    onChange(nextValue);
    setOpen(false);
  }
  return (
    <div className={open ? "combo open" : "combo"} ref={wrapRef}>
      <input
        {...inputProps}
        className={inputClass}
        value={value || ""}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        dir={inputProps.dir || "auto"}
        autoComplete="off"
      />
      <button
        type="button"
        className="combo-toggle"
        tabIndex={-1}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((current) => !current)}
        aria-label="فتح القائمة"
      >
        ▾
      </button>
      {open && (
        <div className="combo-menu" role="listbox">
          {visibleOptions.length === 0 && <button type="button" className="combo-option muted" onMouseDown={(event) => event.preventDefault()}>لا توجد قيم محفوظة</button>}
          {visibleOptions.map((option) => (
            <button key={option} type="button" className="combo-option" onMouseDown={(event) => event.preventDefault()} onClick={() => commit(option)}>
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SearchBox({ value, onChange, placeholder = "بحث" }) {
  return <div className="search-box"><Search size={16} /><input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} /></div>;
}

async function exportElementPdf(element, fileName) {
  if (!element) return null;
  await waitForPaint();
  const canvas = await html2canvas(element, {
    scale: 2,
    backgroundColor: "#ffffff",
    useCORS: true,
    logging: false,
    onclone: (clonedDocument, clonedElement) => preparePdfClone(clonedDocument, clonedElement),
    windowWidth: Math.max(element.scrollWidth, element.clientWidth, 900),
    windowHeight: Math.max(element.scrollHeight, element.clientHeight, 1200)
  });
  const pdf = new jsPDF({ orientation: "p", unit: "pt", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 24;
  const drawableWidth = pageWidth - margin * 2;
  const drawableHeight = pageHeight - margin * 2;
  const imageScale = drawableWidth / canvas.width;
  const sourcePageHeight = Math.max(1, Math.floor(drawableHeight / imageScale));
  const pageCanvas = document.createElement("canvas");
  pageCanvas.width = canvas.width;
  const context = pageCanvas.getContext("2d");
  let sourceY = 0;
  let pageIndex = 0;
  while (sourceY < canvas.height) {
    const sliceHeight = Math.min(sourcePageHeight, canvas.height - sourceY);
    pageCanvas.height = sliceHeight;
    context.clearRect(0, 0, pageCanvas.width, pageCanvas.height);
    context.drawImage(canvas, 0, sourceY, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);
    if (pageIndex > 0) pdf.addPage();
    pdf.addImage(pageCanvas.toDataURL("image/png"), "PNG", margin, margin, drawableWidth, sliceHeight * imageScale);
    sourceY += sliceHeight;
    pageIndex += 1;
  }
  return saveBinaryFile(fileName, pdf.output("arraybuffer"), "application/pdf");
}

function preparePdfClone(clonedDocument, clonedElement) {
  clonedElement?.classList?.add("pdf-export-root");
  const style = clonedDocument.createElement("style");
  style.textContent = `
    .pdf-export-root, .pdf-export-root *,
    .pdf-host, .pdf-host * {
      box-shadow: none !important;
      text-shadow: none !important;
      filter: none !important;
      background-image: none !important;
      border-color: #274761 !important;
      color: #111827 !important;
    }
    .pdf-export-root, .pdf-export-root .preview-page, .pdf-export-root .report,
    .pdf-host, .pdf-host .preview-page, .pdf-host .report {
      background: #ffffff !important;
      background-color: #ffffff !important;
    }
    .pdf-export-root .report-row.head, .pdf-export-root .report-row.head *,
    .pdf-host .report-row.head, .pdf-host .report-row.head * {
      background: #0b1f2e !important;
      background-color: #0b1f2e !important;
      color: #fff4cf !important;
    }
    .pdf-export-root .report-row.subtotal, .pdf-export-root .report-row.total,
    .pdf-export-root .report-row.subtotal *, .pdf-export-root .report-row.total *,
    .pdf-host .report-row.subtotal, .pdf-host .report-row.total,
    .pdf-host .report-row.subtotal *, .pdf-host .report-row.total * {
      background: #f6efdf !important;
      background-color: #f6efdf !important;
      color: #111827 !important;
    }
    .pdf-export-root .report-header strong,
    .pdf-export-root .report-header span,
    .pdf-export-root .report-footer,
    .pdf-export-root .report-footer *,
    .pdf-export-root .report-timing strong,
    .pdf-export-root .report-date-card small,
    .pdf-host .report-header strong,
    .pdf-host .report-header span,
    .pdf-host .report-footer,
    .pdf-host .report-footer *,
    .pdf-host .report-timing strong,
    .pdf-host .report-date-card small {
      color: #9a6b16 !important;
    }
    .pdf-export-root .report-date-card,
    .pdf-export-root .report-meta span,
    .pdf-export-root .layer-specs p,
    .pdf-host .report-date-card,
    .pdf-host .report-meta span,
    .pdf-host .layer-specs p {
      background: #fbfdff !important;
      background-color: #fbfdff !important;
    }
  `;
  clonedDocument.head.appendChild(style);
  clonedDocument.querySelectorAll(".pdf-export-root, .pdf-export-root *, .pdf-host, .pdf-host *").forEach((node) => {
    if (!node.style) return;
    node.style.backgroundImage = "none";
    node.style.boxShadow = "none";
    node.style.textShadow = "none";
    node.style.filter = "none";
  });
}

function safeFileName(fileName) {
  return String(fileName || "GlassOrders-export")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function waitForPaint(delay = 0) {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => window.setTimeout(resolve, delay)));
  });
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function browserDownload(fileName, buffer, mimeType) {
  const blob = new Blob([buffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = safeFileName(fileName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
  return { ok: true, fallback: true };
}

async function saveBinaryFile(fileName, buffer, mimeType) {
  const outputName = safeFileName(fileName);
  if (window.glassOrdersDesktop?.saveFile) {
    try {
      const result = await window.glassOrdersDesktop.saveFile({
        fileName: outputName,
        mimeType,
        data: arrayBufferToBase64(buffer)
      });
      if (result?.ok || result?.canceled) return result;
    } catch (error) {
      console.warn("Desktop save failed, falling back to browser download.", error);
    }
  }
  return browserDownload(outputName, buffer, mimeType);
}

function showExportError(error) {
  console.error(error);
    window.alert(`تعذر تصدير الملف: ${safeErrorMessage(error)}`);
}

async function renderReportPdf(children, fileName) {
  const host = document.createElement("div");
  host.className = "pdf-host";
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    root.render(<div className="preview-page">{children}</div>);
    await waitForPaint(220);
    return await exportElementPdf(host, fileName);
  } finally {
    root.unmount();
    host.remove();
  }
}

function workbookToArrayBuffer(workbook) {
  return XLSX.write(workbook, { bookType: "xlsx", type: "array" });
}

async function saveWorkbook(workbook, fileName) {
  return saveBinaryFile(fileName, workbookToArrayBuffer(workbook), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

async function exportOrderPdf(order, currentUser, logoSrc) {
  try {
    return await renderReportPdf(<OrderReport order={order} currentUser={currentUser} logoSrc={logoSrc} />, `GlassOrder-${displayOrderNo(order.orderNo)}.pdf`);
  } catch (error) {
    showExportError(error);
    return null;
  }
}

async function exportOrderExcel(order) {
  try {
    const rows = order.rows.map((row, index) => {
      const totals = rowTotals(row);
      return {
        NO: index + 1,
        "رقم الطلب": displayOrderNo(order.orderNo),
        "رقم الإذن": order.documentId,
        "العميل": order.customerName,
        "المورد": order.supplierName,
        "البيان": rowDescription(row),
        "ملاحظات البيان": row.notes || "",
        "الشركات": rowCompanyText(row),
        "العرض سم": Math.max(...row.layers.map((layer) => numberValue(layer.width))),
        "الطول سم": Math.max(...row.layers.map((layer) => numberValue(layer.height))),
        "العدد": row.quantity,
        "المساحة": totals.area,
        "سعر طبقة 1": row.layers[0]?.unitPrice || 0,
        "تكلفة طبقة 1": row.layers[0]?.supplierUnitPrice || 0,
        "سعر طبقة 2": row.layers[1]?.unitPrice || "",
        "تكلفة طبقة 2": row.layers[1]?.supplierUnitPrice || "",
        "سعر المادة": row.materialUnitPrice || 0,
        "تكلفة المادة": row.supplierMaterialUnitPrice || 0,
        "إجمالي الفاتورة": totals.total,
        "تكلفة المورد": totals.supplierCost,
        "ملاحظات الرسم": drawingFabricationNotes(row).join(" | ") || (row.drawing?.shapes || []).map(drawingShapeSummary).join(" | "),
        "حواف الرسم": drawingOutlineSummary(row.drawing)
      };
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Glass Order");
    return await saveWorkbook(wb, `GlassOrder-${displayOrderNo(order.orderNo)}.xlsx`);
  } catch (error) {
    showExportError(error);
    return null;
  }
}

async function exportStatementExcel(statement) {
  try {
    const rows = [];
    for (const supplier of statement.suppliers) {
      for (const doc of supplier.documents) rows.push({ "المورد": supplier.supplier, "رقم الإذن": doc.documentId, "القطع": doc.pieces, "المساحة م2": doc.area, "التكلفة": doc.cost });
      rows.push({ "المورد": `إجمالي المورد ${supplier.supplier}`, "القطع": supplier.subtotal.pieces, "المساحة م2": supplier.subtotal.area, "التكلفة": supplier.subtotal.cost });
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Glass Statement");
    return await saveWorkbook(wb, "GlassStatement.xlsx");
  } catch (error) {
    showExportError(error);
    return null;
  }
}

async function exportSupplierExcel(supplier, data) {
  try {
    const opening = numberValue(supplier.opening_balance);
    const orderRows = data.orders
      .filter((order) => order.supplierName === supplier.name && isOrderPayableForSupplier(order))
      .map((order) => ({
        "التاريخ": order.date,
        "النوع": "طلب مورد",
        "البيان": `${displayOrderNo(order.orderNo)} - ${statusLabel(order.status)} - ${order.project || ""}`,
        "مدين": orderTotals(order).supplierCost,
        "دائن": 0
      }));
    const paymentRows = data.payments
      .filter((payment) => payment.supplier_id === supplier.id || payment.supplier_name === supplier.name)
      .map((payment) => ({
        "التاريخ": payment.paid_at,
        "النوع": "دفعة",
        "البيان": payment.notes || payment.method || "دفعة",
        "مدين": 0,
        "دائن": numberValue(payment.amount)
      }));
    const rows = [
      { "التاريخ": "", "النوع": "رصيد افتتاحي", "البيان": supplier.name, "مدين": opening, "دائن": 0 },
      ...[...orderRows, ...paymentRows].sort((a, b) => String(a["التاريخ"]).localeCompare(String(b["التاريخ"])) )
    ];
    let balance = 0;
    const balancedRows = rows.map((row) => {
      balance += numberValue(row["مدين"]) - numberValue(row["دائن"]);
      return { ...row, "الرصيد": balance };
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(balancedRows), "Supplier Statement");
    return await saveWorkbook(wb, `SupplierStatement-${supplier.name || "supplier"}.xlsx`);
  } catch (error) {
    showExportError(error);
    return null;
  }
}

async function exportOrderStatusExcel(report) {
  try {
    const rows = report.rows.map((row) => ({
      "المورد": row.supplier,
      "رقم الإذن": row.documentId,
      "العميل / المشروع": [row.customer, row.project].filter(Boolean).join(" / "),
      "رقم الطلب": row.orderNo,
      "تاريخ الطلب": row.date,
      "القطع": row.quantity,
      "المساحة": row.area,
      "تكلفة المورد": row.supplierCost,
      "الحالة": row.statusText || statusLabel(row.status),
      "نوع الزجاج": row.glass,
      "ملاحظات": row.notes
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "Orders Status");
    return await saveWorkbook(wb, "OrdersStatus-NotCollected.xlsx");
  } catch (error) {
    showExportError(error);
    return null;
  }
}

async function exportStatementPdf(statement, currentUser, logoSrc) {
  try {
    return await renderReportPdf(<><ReportHeader title="تقرير مساحات الزجاج" logoSrc={logoSrc} /><StatementTable statement={statement} /><ReportFooter currentUser={currentUser} /></>, "GlassStatement.pdf");
  } catch (error) {
    showExportError(error);
    return null;
  }
}

async function exportSupplierPdf(supplier, data, currentUser, logoSrc) {
  try {
    return await renderReportPdf(<SupplierReport supplier={supplier} data={data} currentUser={currentUser} logoSrc={logoSrc} />, `SupplierStatement-${supplier.name || "supplier"}.pdf`);
  } catch (error) {
    showExportError(error);
    return null;
  }
}

async function exportOrderStatusPdf(report, currentUser, logoSrc) {
  try {
    return await renderReportPdf(<OrderStatusReport report={report} currentUser={currentUser} logoSrc={logoSrc} />, "OrdersStatus-NotCollected.pdf");
  } catch (error) {
    showExportError(error);
    return null;
  }
}

function exportPreviewExcel(preview) {
  if (preview.type === "order") return exportOrderExcel(preview.order);
  if (preview.type === "statement") return exportStatementExcel(preview.statement);
  if (preview.type === "supplier") return exportSupplierExcel(preview.supplier, preview.data);
  if (preview.type === "orderStatus") return exportOrderStatusExcel(preview.report);
  return null;
}

createRoot(document.getElementById("root")).render(<App />);
