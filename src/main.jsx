import React, { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share as CapacitorShare } from "@capacitor/share";
import { createClient } from "@supabase/supabase-js";
import {
  BadgeDollarSign,
  ArrowDownToLine,
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
  FolderOpen,
  ImagePlus,
  KeyRound,
  Layers,
  Loader2,
  LogOut,
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
  Printer,
  QrCode,
  RectangleHorizontal,
  RefreshCw,
  Save,
  Search,
  Server,
  Settings,
  Sparkles,
  Sun,
  Trash2,
  Undo2,
  Redo2,
  UserPlus,
  UsersRound,
  WifiOff,
  XCircle
} from "lucide-react";
import appLogo from "../icons/in-app-logo.png";
import loadingLogo from "../icons/loading-logo.png";
import {
  RANGE_STATEMENT_MODE,
  SELECTED_ORDERS_STATEMENT_MODE,
  buildSupplierStatement,
  filterSupplierOrders,
  normalizeSelectedOrderIds,
  removeSelectedOrderId,
  selectAllFilteredOrderIds
} from "./supplierStatements.js";
import {
  PASTE_MEASUREMENT_UNIT_OPTIONS,
  PASTE_SOURCE_DIRECTION_OPTIONS,
  buildPastePatch,
  normalizePastePreferences
} from "./pastePipeline.js";
import {
  isCompletelyEmptyOrderRow,
  validateOrderForSave,
  validateOrderRowForSave,
  validationErrorKey
} from "./orderSaveValidation.js";
import {
  RECEIPT_STATUS,
  ReceiptValidationError,
  applyReceiptBatch,
  buildFilteredSupplierCostSubtotals,
  buildGlassReceiptEntries,
  correctReceiptHistoryOperation,
  validateReceiptBatch
} from "./orderReceipts.js";
import {
  assertCompleteGlassData,
  loadAllRpcPagesCompat,
  loadGlassDataCountsCompat
} from "./supabasePaging.js";
import { verifyOrderSaveIntegrity } from "./orderPersistenceIntegrity.js";
import {
  DESKTOP_AUTH_RECOVERY_REDIRECT_URL,
  establishSupabaseRecoverySession
} from "./authRecovery.js";
import "./styles.css";

const VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";
const APP_VARIANT = import.meta.env.VITE_APP_VARIANT === "status" || import.meta.env.MODE === "status" ? "status" : "full";
const IS_STATUS_VARIANT = APP_VARIANT === "status";
const APP_NAME = "Y.D";
const FULL_APP_NAME = "Y.D Glass Manager";
const BRAND_NAME = "Y.D GLASS MANAGER";
const SUB_NAME = "إدارة أوامر الزجاج والموردين والتصنيع";
const PRODUCT_LINE = "A Y.D Software Product";
const RELEASES_URL = "https://github.com/Yasser-Diab/hgad-glass/releases";
const GITHUB_LATEST_RELEASE_API = "https://api.github.com/repos/Yasser-Diab/hgad-glass/releases/latest";
const GITHUB_RELEASES_API = "https://api.github.com/repos/Yasser-Diab/hgad-glass/releases";
const UPDATE_LAST_CHECK_KEY = "glassOrdersLastUpdateCheckAt";
const UPDATE_LAST_ALERT_KEY = "glassOrdersLastUpdateAlert";
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const TELEGRAM_BOT_SETTINGS_KEY = "glassOrdersTelegramBotSettings";
const PASTE_PREFERENCES_STORAGE_KEY = "glassOrdersPastePreferences";

let pdfExportModulesPromise = null;
let qrCodeModulePromise = null;
let spreadsheetModulePromise = null;

async function loadPdfExportModules() {
  if (!pdfExportModulesPromise) {
    pdfExportModulesPromise = Promise.all([import("html2canvas"), import("jspdf")]).then(([canvasModule, pdfModule]) => ({
      html2canvas: canvasModule.default,
      jsPDF: pdfModule.jsPDF
    }));
  }
  return pdfExportModulesPromise;
}

async function loadQrCodeModule() {
  if (!qrCodeModulePromise) {
    qrCodeModulePromise = import("qrcode").then((module) => module.default || module);
  }
  return qrCodeModulePromise;
}

async function loadSpreadsheetModule() {
  if (!spreadsheetModulePromise) {
    spreadsheetModulePromise = import("xlsx").then((module) => module.default?.utils ? module.default : module);
  }
  return spreadsheetModulePromise;
}

export const STATUS_VARIANT_CAPABILITIES = {
  canAuthenticate: true,
  canReadOrders: true,
  canSearchOrders: true,
  canFilterOrders: true,
  canRefreshOrders: true,
  canPreviewReports: true,
  canGeneratePdf: true,
  canSharePdf: true,
  canChangeTheme: true,
  canLogout: true,
  canCreateOrders: false,
  canEditOrders: false,
  canDeleteOrders: false,
  canDuplicateOrders: false,
  canChangeOrderStatus: false,
  canChangeSupplierOrderNumber: false,
  canChangeReceivedQuantity: false,
  canChangeRemainingQuantity: false,
  canManageCustomers: false,
  canManageSuppliers: false,
  canManagePayments: false,
  canOpenSmartTable: false,
  canEditDrawings: false,
  canImportData: false,
  canOpenSettings: false
};

function logSlowOperation(label, startTime, thresholdMs = 24, details = "") {
  try {
    const elapsed = performance.now() - startTime;
    if (elapsed >= thresholdMs) {
      console.info(`[Performance] ${label}: ${Math.round(elapsed)} ms${details ? ` ${details}` : ""}`);
    }
  } catch {
    // Development-only diagnostic; never let logging affect data entry.
  }
}
const REPORT_SAVE_SETTINGS_KEY = "glassOrdersReportSaveSettings";
const SAVE_RECOVERY_DRAFT_KEY = "glassOrdersSaveRecoveryDraft";
const TICKET_SETTINGS_KEY = "glassOrdersTicketSettings";
const DEFAULT_TICKET_FIELDS = {
  qrCode: true,
  pieceCode: true,
  orderNo: false,
  customerName: false,
  supplierName: false,
  projectName: false,
  orderDate: false,
  glassDescription: true,
  glassManufacturer: true,
  measurements: true,
  rowQuantity: false,
  orderCounter: true,
  rowCounter: true
};
const TICKET_FIELD_DEFS = [
  { key: "qrCode", label: "QR code" },
  { key: "orderNo", label: "Order number" },
  { key: "customerName", label: "Customer name" },
  { key: "supplierName", label: "Supplier name" },
  { key: "projectName", label: "Project name" },
  { key: "orderDate", label: "Order date" },
  { key: "glassDescription", label: "Glass description" },
  { key: "glassManufacturer", label: "Glass manufacturer" },
  { key: "rowQuantity", label: "Row quantity" },
  { key: "orderCounter", label: "Order counter" },
  { key: "rowCounter", label: "Row counter" }
];
const DEFAULT_PUBLIC_BOT_SETTINGS = {
  enabled: false,
  openAtLogin: false,
  startHiddenAtLogin: true,
  canOpenAtLogin: false,
  hasBotToken: false,
  hasSupabaseSession: false
};
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

const DEFAULT_REPORT_PALETTE = {
  reportPageBackground: "#ffffff",
  reportTextColor: "#111827",
  reportMutedTextColor: "#475569",
  reportBorderColor: "#274761",
  reportHeaderBg: "#0b1f2e",
  reportHeaderColor: "#ffffff",
  reportRowBackground: "#ffffff",
  reportAlternateRowBackground: "#f5f7fa",
  reportAccentColor: "#9a6b16",
  reportTotalBackground: "#f6efdf"
};

const DEFAULT_APPEARANCE = {
  theme: "gold",
  reportLogoDataUrl: "",
  ...DEFAULT_REPORT_PALETTE,
  ...THEME_PRESETS.gold.values
};

const APPEARANCE_STORAGE_KEY = "glassOrdersAppearance";
const APPEARANCE_GLOBAL_CACHE_KEY = "glassOrdersAppearanceGlobal";
const APPEARANCE_USER_STORAGE_PREFIX = "glassOrdersAppearanceUser";
const APPEARANCE_GLOBAL_SETTING_KEY = "appearance";

const LEARNED_TABLE_OPTIONS_KEY = "glassOrdersLearnedTableOptions";
const LEARNED_TABLE_OPTION_LIMIT = 220;
const EMPTY_LEARNED_TABLE_OPTIONS = {
  glassTypes: [],
  companies: [],
  thicknesses: [],
  gaps: [],
  pvb: []
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
  ["manufacturing", "تقرير تصنيع", Factory],
  ["customers", "العملاء", UsersRound],
  ["suppliers", "الموردين", Building2],
  ["statements", "تقارير الزجاج", FileSpreadsheet],
  ["settings", "الإعدادات", Settings]
];

function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    return (char === "x" ? value : (value & 0x3) | 0x8).toString(16);
  });
}

function useRuntimeAppVersion() {
  const [version, setVersion] = useState(VERSION);
  useEffect(() => {
    let active = true;
    const request = window.glassOrdersDesktop?.getAppVersion?.();
    request?.then?.((value) => {
      const resolved = cleanName(value);
      if (active && resolved) setVersion(resolved);
    }).catch?.(() => null);
    return () => {
      active = false;
    };
  }, []);
  return version;
}

function uuidOrNew(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""))
    ? value
    : uid();
}

function nullableIdentifier(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

function persistentIdentifier(value) {
  return nullableIdentifier(value) || uid();
}

function numberValue(value, fallback = 0) {
  const n = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

function parseOptionalNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(String(value).replace(",", "."));
  if (!Number.isFinite(n)) throw new Error("قيمة رقمية غير صالحة. راجع الأرقام المدخلة قبل الحفظ.");
  return n;
}

function databaseNumber(value, fallback = 0) {
  const parsed = parseOptionalNumber(value);
  return parsed === null ? fallback : parsed;
}

function cmToMm(value, fallback = 0) {
  return numberValue(value, fallback) * 10;
}

function thicknessToMm(value, fallback = 6) {
  const match = String(value || "").match(/\d+(?:\.\d+)?/);
  return match ? numberValue(match[0], fallback) : fallback;
}

function normalizeThicknessText(value = "") {
  const text = cleanName(value)
    .replace(/م[\s\u00a0\u200c\u200d\u2060]*م/g, "مم")
    .replace(/\s+مم/g, "مم");
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*مم/);
  if (match) return `${match[1].replace(",", ".")}مم`;
  const number = text.match(/\d+(?:[.,]\d+)?/);
  return number ? `${number[0].replace(",", ".")}مم` : text;
}

function dimensionMmText(width, height) {
  return `${Math.round(numberValue(width))} × ${Math.round(numberValue(height))} مم`;
}

function MeasurementMm({ width, height, className = "" }) {
  return (
    <span className={["measurement-mm", className].filter(Boolean).join(" ")} dir="ltr">
      <span className="measurement-unit" dir="rtl">مم</span>
      <bdi dir="ltr">{Math.round(numberValue(width))} × {Math.round(numberValue(height))}</bdi>
    </span>
  );
}

function measurementMmHtml(width, height) {
  return `<span class="measurement-mm" dir="ltr"><span class="measurement-unit" dir="rtl">مم</span><bdi dir="ltr">${Math.round(numberValue(width))} × ${Math.round(numberValue(height))}</bdi></span>`;
}

function arabicMixedHtml(value = "") {
  return String(value).split(/(\d+(?:[.,]\d+)?\s*مم)/g).filter(Boolean).map((part) => {
    const match = part.match(/^(\d+(?:[.,]\d+)?)\s*مم$/);
    return match
      ? `<bdi class="thickness-mm" dir="rtl"><bdi class="thickness-number" dir="ltr">${escapeHtml(match[1])}</bdi><span class="thickness-unit">مم</span></bdi>`
      : escapeHtml(part);
  }).join("");
}

function ArabicMixedText({ value = "" }) {
  return String(value).split(/(\d+(?:[.,]\d+)?\s*مم)/g).filter(Boolean).map((part, index) => {
    const match = part.match(/^(\d+(?:[.,]\d+)?)\s*مم$/);
    if (!match) return <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>;
    return (
      <bdi className="thickness-mm" dir="rtl" key={`${part}-${index}`}>
        <bdi className="thickness-number" dir="ltr">{match[1]}</bdi><span className="thickness-unit">مم</span>
      </bdi>
    );
  });
}

function preventCancelableDefault(event) {
  if (!event || event.cancelable === false) return false;
  event.preventDefault();
  return true;
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
  const raw = cleanName(value || today());
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  const slashMatch = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (slashMatch) return `${slashMatch[1].padStart(2, "0")}/${slashMatch[2].padStart(2, "0")}/${slashMatch[3]}`;
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return new Intl.DateTimeFormat("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" }).format(parsed);
  }
  return raw;
}

function resolveOrderIssueDate(order = {}) {
  return cleanName(
    order.issue_date ||
    order.issueDate ||
    order.order_date ||
    order.date ||
    order.orderDate ||
    order.documentIssueDate ||
    order.document_issue_date ||
    ""
  );
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

function nextOrderNoAfter(value, fallbackOrders = []) {
  const sequence = orderSequence(value);
  if (Number.isFinite(sequence)) return displayOrderNo(sequence + 1);
  return generateOrderNo(fallbackOrders);
}

function isDuplicateOrderNoError(error) {
  const text = safeErrorMessage(error);
  return /duplicate key value|idx_glass_orders_order_no_unique|glass_orders_order_no|order_no.*unique|23505|رقم الطلب مستخدم/i.test(text);
}

function sameOrderIdentity(first = {}, second = {}) {
  const firstId = cleanName(first.id);
  const secondId = cleanName(second.id);
  if (firstId && secondId && firstId === secondId) return true;
  const firstNo = cleanName(first.orderNo || first.order_no);
  const secondNo = cleanName(second.orderNo || second.order_no);
  if (!firstNo || !secondNo) return false;
  return displayOrderNo(firstNo) === displayOrderNo(secondNo);
}

function findMatchingOrder(orders = [], order = {}) {
  return (orders || []).find((item) => sameOrderIdentity(item, order)) || null;
}

function isEditableDomTarget(target) {
  const element = target instanceof Element ? target : null;
  if (!element) return false;
  if (element.closest?.("[contenteditable='true'], [contenteditable='plaintext-only']")) return true;
  const input = element.closest?.("input, textarea, select");
  if (!input) return false;
  const type = String(input.getAttribute("type") || "").toLowerCase();
  return !["button", "checkbox", "radio", "range", "submit", "reset", "file", "color"].includes(type);
}

function missingSupabaseSchemaColumn(error, expectedTable = "") {
  const text = safeErrorMessage(error);
  const match = text.match(/Could not find the '([^']+)' column of '([^']+)' in the schema cache/i);
  if (!match) return "";
  const [, column, table] = match;
  return !expectedTable || table === expectedTable ? column : "";
}

function isSupabaseSchemaCacheError(error) {
  return !!missingSupabaseSchemaColumn(error);
}

function friendlySaveError(error) {
  if (isDuplicateOrderNoError(error)) {
    return "تعذر إنشاء رقم فريد للطلب، ولم يتم فقد أي من البيانات المدخلة. يرجى إعادة المحاولة.";
  }
  if (isSupabaseSchemaCacheError(error)) {
    return "تعذر الحفظ لأن قاعدة البيانات تحتاج تحديثاً. لم يتم فقد أي من البيانات المدخلة.";
  }
  const technicalMessage = safeErrorMessage(error);
  if (
    error?.code
    || /operator does not exist|invalid input syntax.*uuid|text\s*=\s*uuid|uuid\s*=\s*text/i.test(technicalMessage)
  ) {
    return "تعذر حفظ الطلب. لم يتم حذف البيانات المدخلة. برجاء المحاولة مرة أخرى.";
  }
  return technicalMessage;
}

function logSupabasePersistenceError(error, context = {}) {
  const safeText = (value) => maskSensitiveText(String(value || ""));
  console.error("[Y.D Glass Manager persistence]", {
    operation: safeText(context.operation),
    table: safeText(context.table),
    function: safeText(context.function),
    parameters: context.parameters || {},
    code: safeText(error?.code),
    message: safeText(error?.message || error),
    details: safeText(error?.details),
    hint: safeText(error?.hint)
  });
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

function normalizeLearnedTableOptions(value = {}) {
  return Object.fromEntries(
    Object.keys(EMPTY_LEARNED_TABLE_OPTIONS).map((key) => [
      key,
      uniqueValues(value?.[key] || []).slice(0, LEARNED_TABLE_OPTION_LIMIT)
    ])
  );
}

function mergeLearnedTableOptions(...sets) {
  return Object.fromEntries(
    Object.keys(EMPTY_LEARNED_TABLE_OPTIONS).map((key) => [
      key,
      uniqueValues(sets.flatMap((set) => set?.[key] || [])).slice(0, LEARNED_TABLE_OPTION_LIMIT)
    ])
  );
}

function readLearnedTableOptions() {
  try {
    return normalizeLearnedTableOptions(JSON.parse(localStorage.getItem(LEARNED_TABLE_OPTIONS_KEY) || "{}"));
  } catch {
    return normalizeLearnedTableOptions();
  }
}

function writeLearnedTableOptions(options) {
  localStorage.setItem(LEARNED_TABLE_OPTIONS_KEY, JSON.stringify(normalizeLearnedTableOptions(options)));
}

function learnTableOptionValue(options, key, value) {
  const cleanValue = cleanName(value);
  if (!cleanValue || !Object.prototype.hasOwnProperty.call(EMPTY_LEARNED_TABLE_OPTIONS, key)) {
    return normalizeLearnedTableOptions(options);
  }
  const current = normalizeLearnedTableOptions(options);
  return {
    ...current,
    [key]: uniqueValues([cleanValue, ...(current[key] || [])]).slice(0, LEARNED_TABLE_OPTION_LIMIT)
  };
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

function canCurrentUserEditOrder(currentUser, order = {}) {
  if (!currentUser || IS_STATUS_VARIANT) return false;
  const explicitPermission = currentUser?.permissions?.canEditOrders ?? currentUser?.can_edit_orders;
  if (explicitPermission === false) return false;
  const locked = order.locked === true || order.is_locked === true || order.orderLocked === true;
  return !locked || currentUser.role === "admin";
}

function canCurrentUserViewCosts(currentUser) {
  if (!currentUser) return false;
  const explicitPermission = currentUser?.permissions?.canViewCosts
    ?? currentUser?.permissions?.viewCosts
    ?? currentUser?.can_view_costs;
  if (typeof explicitPermission === "boolean") return explicitPermission;
  return currentUser.role === "admin";
}

function canCurrentUserCorrectReceipt(currentUser, order = {}) {
  if (!canCurrentUserEditOrder(currentUser, order)) return false;
  const explicitPermission = currentUser?.permissions?.canCorrectReceipts
    ?? currentUser?.can_correct_receipts;
  if (typeof explicitPermission === "boolean") return explicitPermission;
  return currentUser?.role === "admin";
}

function normalizeReceiptHistory(value) {
  if (Array.isArray(value)) return value.map((item) => ({ ...item }));
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => ({ ...item })) : [];
  } catch {
    return [];
  }
}

function orderReceiptSummary(order) {
  return buildGlassReceiptEntries(order || { rows: [] }, {
    getDescription: (row) => rowDescription(row),
    getQuantity: (row) => rowPanelPhysicalCount(row),
    getReceivedQuantity: (row) => row?.receivedQuantity
  });
}

function orderGlassTypeGroups(order) {
  const groups = new Map();
  for (const entry of orderReceiptSummary(order).entries) {
    const description = cleanName(entry.description) || "نوع زجاج غير محدد";
    if (!groups.has(description)) {
      groups.set(description, {
        key: `glass-${entry.rowId}`,
        description,
        orderedQuantity: 0,
        previouslyReceivedQuantity: 0,
        remainingQuantity: 0,
        entries: []
      });
    }
    const group = groups.get(description);
    group.orderedQuantity += entry.orderedQuantity;
    group.previouslyReceivedQuantity += entry.previouslyReceivedQuantity;
    group.remainingQuantity += entry.remainingQuantity;
    group.entries.push(entry);
  }
  return [...groups.values()];
}

function receiptRecordedBy(currentUser) {
  return {
    id: currentUser?.id || "",
    username: currentUser?.username || "",
    displayName: currentUser?.display_name || currentUser?.username || ""
  };
}

function appendRowReceiptHistory(rows, historyItems) {
  const byRowId = new Map(historyItems.map((item) => [String(item.rowId), item]));
  return rows.map((row) => {
    const historyItem = byRowId.get(String(row.id));
    return historyItem
      ? { ...row, receiptHistory: [...normalizeReceiptHistory(row.receiptHistory), historyItem] }
      : row;
  });
}

function receiptHistoryIdentity(item = {}) {
  return [
    cleanName(item.operationId),
    cleanName(item.rowId),
    cleanName(item.recordedAt),
    databaseNumber(item.newReceivedQuantity, 0),
    databaseNumber(item.quantityReceived, 0)
  ].join("|");
}

function receiptHistoryOperationIdentity(item = {}) {
  return [cleanName(item.operationId), cleanName(item.rowId)].join("|");
}

function rebaseReceiptRowsPatch(latestOrder, sourceOrder, patchedRows) {
  const latestRows = Array.isArray(latestOrder?.rows) ? latestOrder.rows : [];
  const sourceRows = Array.isArray(sourceOrder?.rows) ? sourceOrder.rows : [];
  const nextRows = Array.isArray(patchedRows) ? patchedRows : [];
  const latestReceiptEntries = new Map(
    orderReceiptSummary(latestOrder).entries.map((entry) => [String(entry.rowId), entry])
  );
  const sourceById = new Map(sourceRows.map((row) => [String(row.id || ""), row]));
  const patchedById = new Map(nextRows.map((row) => [String(row.id || ""), row]));

  return latestRows.map((latestRow, rowIndex) => {
    const rowId = String(latestRow.id || "");
    const sourceRow = sourceById.get(rowId) || sourceRows[rowIndex];
    const patchedRow = patchedById.get(rowId) || nextRows[rowIndex];
    if (!patchedRow || !sourceRow) return latestRow;

    const sourceHistory = normalizeReceiptHistory(sourceRow.receiptHistory);
    const patchedHistory = normalizeReceiptHistory(patchedRow.receiptHistory);
    const sourceHistoryIds = new Set(sourceHistory.map(receiptHistoryIdentity));
    const latestHistory = normalizeReceiptHistory(latestRow.receiptHistory);
    const latestHistoryIds = new Set(latestHistory.map(receiptHistoryIdentity));
    const sourceHistoryByOperation = new Map(sourceHistory.map((item) => [receiptHistoryOperationIdentity(item), item]));
    const correctsExistingOperation = patchedHistory.some((item) => {
      const sourceItem = sourceHistoryByOperation.get(receiptHistoryOperationIdentity(item));
      return sourceItem && receiptHistoryIdentity(sourceItem) !== receiptHistoryIdentity(item);
    });
    const appendedHistory = patchedHistory.filter((item) => !sourceHistoryIds.has(receiptHistoryIdentity(item)));
    const sourceReceived = sourceRow.receivedQuantity == null || sourceRow.receivedQuantity === ""
      ? null
      : databaseNumber(sourceRow.receivedQuantity, 0);
    const patchedReceived = patchedRow.receivedQuantity == null || patchedRow.receivedQuantity === ""
      ? null
      : databaseNumber(patchedRow.receivedQuantity, 0);

    if (correctsExistingOperation) {
      const sourceVersion = sourceHistory.map(receiptHistoryIdentity).join("\n");
      const latestVersion = latestHistory.map(receiptHistoryIdentity).join("\n");
      if (sourceVersion !== latestVersion) {
        throw new Error(`تعذر تصحيح استلام ${rowDescription(latestRow)} لأن سجل الاستلام تغير في عملية أحدث.`);
      }
      const orderedQuantity = latestReceiptEntries.get(rowId)?.orderedQuantity ?? rowPanelPhysicalCount(latestRow);
      return {
        ...latestRow,
        receivedQuantity: Math.max(0, Math.min(orderedQuantity, databaseNumber(patchedReceived, 0))),
        receiptHistory: patchedHistory
      };
    }

    if (!appendedHistory.length && sourceReceived === patchedReceived) return latestRow;

    const receiptEntry = latestReceiptEntries.get(rowId);
    const orderedQuantity = receiptEntry?.orderedQuantity ?? rowPanelPhysicalCount(latestRow);
    let receivedQuantity = receiptEntry?.previouslyReceivedQuantity
      ?? databaseNumber(latestRow.receivedQuantity, 0);
    const rebasedHistory = [...latestHistory];

    for (const historyItem of appendedHistory) {
      const historyId = receiptHistoryIdentity(historyItem);
      if (latestHistoryIds.has(historyId)) continue;
      const receivedNow = databaseNumber(historyItem.quantityReceived, 0);
      const nextReceivedQuantity = receivedQuantity + receivedNow;
      if (nextReceivedQuantity < -1e-9 || nextReceivedQuantity > orderedQuantity + 1e-9) {
        const description = cleanName(historyItem.description) || rowDescription(latestRow);
        throw new Error(`تعذر تطبيق استلام ${description} لأن بيانات الاستلام تغيرت في عملية أحدث.`);
      }
      const clampedReceivedQuantity = Math.max(0, Math.min(orderedQuantity, nextReceivedQuantity));
      const rebasedItem = {
        ...historyItem,
        previousReceivedQuantity: receivedQuantity,
        newReceivedQuantity: clampedReceivedQuantity,
        previousRemainingQuantity: Math.max(0, orderedQuantity - receivedQuantity),
        newRemainingQuantity: Math.max(0, orderedQuantity - clampedReceivedQuantity),
        orderedQuantity,
        correction: receivedNow < 0
      };
      rebasedHistory.push(rebasedItem);
      latestHistoryIds.add(receiptHistoryIdentity(rebasedItem));
      receivedQuantity = clampedReceivedQuantity;
    }

    if (!appendedHistory.length && sourceReceived !== patchedReceived) {
      receivedQuantity = Math.max(0, Math.min(orderedQuantity, databaseNumber(patchedReceived, 0)));
    }

    return {
      ...latestRow,
      receivedQuantity,
      receiptHistory: rebasedHistory
    };
  });
}

function applyOrderReceiptBatchPatch(order, batch, currentUser) {
  const result = applyReceiptBatch(order, batch, {
    getDescription: (row) => rowDescription(row),
    getQuantity: (row) => rowPanelPhysicalCount(row),
    getReceivedQuantity: (row) => row?.receivedQuantity,
    setReceivedQuantity: (row, quantity) => ({ ...row, receivedQuantity: quantity }),
    historyField: null,
    metadata: {
      operationId: uid(),
      recordedAt: new Date().toISOString(),
      recordedBy: receiptRecordedBy(currentUser)
    }
  });
  const sourceRowsById = new Map((order.rows || []).map((row) => [String(row.id), row]));
  const receiptChangedRowIds = result.patch.rows
    .filter((row) => sourceRowsById.get(String(row.id)) !== row)
    .map((row) => String(row.id));
  return {
    ...result.patch,
    rows: appendRowReceiptHistory(result.patch.rows, result.history),
    _receiptChangedRowIds: receiptChangedRowIds
  };
}

function applyAbsoluteOrderReceiptPatch(order, requestedTotal, currentUser) {
  const summary = orderReceiptSummary(order);
  const target = Math.max(0, Math.min(summary.orderedQuantity, numberValue(requestedTotal)));
  let remainingTarget = target;
  const recordedAt = new Date().toISOString();
  const recordedBy = receiptRecordedBy(currentUser);
  const operationId = uid();
  const entryByRowId = new Map(summary.entries.map((entry) => [String(entry.rowId), entry]));
  let collectedPieces = 0;
  const receiptChangedRowIds = [];
  const rows = (order.rows || []).map((row) => {
    const entry = entryByRowId.get(String(row.id));
    if (!entry) return row;
    const nextReceived = Math.min(entry.orderedQuantity, remainingTarget);
    remainingTarget = Math.max(0, remainingTarget - nextReceived);
    collectedPieces += nextReceived;
    if (Math.abs(nextReceived - entry.previouslyReceivedQuantity) < 1e-9
      && row.receivedQuantity !== undefined
      && row.receivedQuantity !== null
      && row.receivedQuantity !== "") return row;
    const historyItem = nextReceived === entry.previouslyReceivedQuantity ? null : {
      operationId,
      orderId: String(order.id || ""),
      orderNo: String(order.orderNo || ""),
      rowId: String(row.id),
      description: entry.description,
      quantityReceived: nextReceived - entry.previouslyReceivedQuantity,
      previousReceivedQuantity: entry.previouslyReceivedQuantity,
      newReceivedQuantity: nextReceived,
      previousRemainingQuantity: entry.remainingQuantity,
      newRemainingQuantity: Math.max(0, entry.orderedQuantity - nextReceived),
      orderedQuantity: entry.orderedQuantity,
      recordedAt,
      recordedBy,
      correction: nextReceived < entry.previouslyReceivedQuantity
    };
    receiptChangedRowIds.push(String(row.id));
    return {
      ...row,
      receivedQuantity: nextReceived,
      receiptHistory: historyItem
        ? [...normalizeReceiptHistory(row.receiptHistory), historyItem]
        : normalizeReceiptHistory(row.receiptHistory)
    };
  });
  const receiptStatus = target <= 0
    ? RECEIPT_STATUS.NOT_RECEIVED
    : target >= summary.orderedQuantity && summary.orderedQuantity > 0
      ? RECEIPT_STATUS.FULLY_RECEIVED
      : RECEIPT_STATUS.PARTIAL;
  return {
    rows,
    collectedPieces,
    receiptStatus,
    _receiptChangedRowIds: receiptChangedRowIds
  };
}

function applyReceiptHistoryCorrectionPatch(order, item, correctedQuantityReceived, currentUser) {
  const result = correctReceiptHistoryOperation(order, {
    rowId: item.rowId,
    operationId: item.operationId,
    historyIndex: item.historyIndex,
    correctedQuantityReceived
  }, {
    getDescription: (row) => rowDescription(row),
    getQuantity: (row) => rowPanelPhysicalCount(row),
    getReceivedQuantity: (row) => row?.receivedQuantity,
    getHistory: (row) => normalizeReceiptHistory(row?.receiptHistory),
    setHistory: (row, history) => ({ ...row, receiptHistory: history }),
    setReceivedQuantity: (row, quantity) => ({ ...row, receivedQuantity: quantity }),
    metadata: {
      correctionId: uid(),
      correctedAt: new Date().toISOString(),
      correctedBy: receiptRecordedBy(currentUser)
    }
  });
  return {
    ...result.patch,
    _receiptChangedRowIds: [result.rowId]
  };
}

function orderCollectedPieces(order) {
  return orderReceiptSummary(order).receivedQuantity;
}

function orderRemainingPieces(order) {
  const status = normalizeOrderStatus(order?.status);
  if (!orderStatusDef(status).payable) return 0;
  return orderReceiptSummary(order).remainingQuantity;
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

function readStoredJson(key, fallback = {}) {
  try {
    return { ...fallback, ...(JSON.parse(localStorage.getItem(key) || "{}")) };
  } catch {
    return { ...fallback };
  }
}

function appearanceStorageKey(user = null) {
  const id = cleanName(user?.id || user?.auth_user_id || user?.username || "");
  return id ? `${APPEARANCE_USER_STORAGE_PREFIX}:${id}` : APPEARANCE_STORAGE_KEY;
}

function mergeAppearanceSettings(globalSettings = {}, localSettings = {}) {
  const merged = { ...DEFAULT_APPEARANCE, ...globalSettings, ...localSettings };
  if (!cleanName(localSettings.reportLogoDataUrl) && cleanName(globalSettings.reportLogoDataUrl)) {
    merged.reportLogoDataUrl = globalSettings.reportLogoDataUrl;
  }
  return normalizeReportPalette(merged);
}

function readAppearanceSettings(user = null) {
  const globalSettings = readStoredJson(APPEARANCE_GLOBAL_CACHE_KEY, {});
  const legacyLocalSettings = readStoredJson(APPEARANCE_STORAGE_KEY, {});
  const userLocalSettings = user ? readStoredJson(appearanceStorageKey(user), legacyLocalSettings) : legacyLocalSettings;
  return mergeAppearanceSettings(globalSettings, userLocalSettings);
}

function hexToRgb(value = "") {
  const text = String(value || "").trim().replace(/^#/, "");
  const expanded = text.length === 3 ? text.split("").map((char) => char + char).join("") : text;
  const match = expanded.match(/^[0-9a-f]{6}$/i);
  if (!match) return null;
  const intValue = Number.parseInt(expanded, 16);
  return {
    r: (intValue >> 16) & 255,
    g: (intValue >> 8) & 255,
    b: intValue & 255
  };
}

function relativeLuminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 1;
  const channel = (value) => {
    const ratio = value / 255;
    return ratio <= 0.03928 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

function readableTextForBackground(background, preferred = "") {
  const bgLum = relativeLuminance(background);
  const preferredRgb = hexToRgb(preferred);
  if (preferredRgb) {
    const fgLum = relativeLuminance(preferred);
    const contrast = (Math.max(bgLum, fgLum) + 0.05) / (Math.min(bgLum, fgLum) + 0.05);
    if (contrast >= 4.5) return preferred;
  }
  return bgLum < 0.45 ? "#ffffff" : "#111827";
}

function safeLightReportColor(value, fallback, minLuminance = 0.72) {
  if (!hexToRgb(value)) return fallback;
  return relativeLuminance(value) >= minLuminance ? value : fallback;
}

function safeReportBorderColor(value, rowBackground) {
  if (!hexToRgb(value)) return DEFAULT_REPORT_PALETTE.reportBorderColor;
  const borderLum = relativeLuminance(value);
  const rowLum = relativeLuminance(rowBackground);
  const contrast = (Math.max(borderLum, rowLum) + 0.05) / (Math.min(borderLum, rowLum) + 0.05);
  return contrast >= 1.65 ? value : DEFAULT_REPORT_PALETTE.reportBorderColor;
}

function normalizeReportPalette(settings = {}) {
  const merged = { ...DEFAULT_REPORT_PALETTE, ...settings };
  const rowBackground = safeLightReportColor(merged.reportRowBackground, DEFAULT_REPORT_PALETTE.reportRowBackground, 0.82);
  const alternateRowBackground = safeLightReportColor(merged.reportAlternateRowBackground, DEFAULT_REPORT_PALETTE.reportAlternateRowBackground, 0.78);
  const totalBackground = safeLightReportColor(merged.reportTotalBackground, DEFAULT_REPORT_PALETTE.reportTotalBackground, 0.76);
  const pageBackground = safeLightReportColor(merged.reportPageBackground, DEFAULT_REPORT_PALETTE.reportPageBackground, 0.86);
  const reportTextColor = readableTextForBackground(rowBackground, merged.reportTextColor);
  return {
    ...merged,
    reportPageBackground: pageBackground,
    reportRowBackground: rowBackground,
    reportAlternateRowBackground: alternateRowBackground,
    reportTotalBackground: totalBackground,
    reportBorderColor: safeReportBorderColor(merged.reportBorderColor, rowBackground),
    reportHeaderColor: readableTextForBackground(merged.reportHeaderBg, merged.reportHeaderColor),
    reportTextColor,
    reportMutedTextColor: readableTextForBackground(rowBackground, merged.reportMutedTextColor)
  };
}

function persistAppearanceSettings(settings, user = null) {
  localStorage.setItem(appearanceStorageKey(user), JSON.stringify(settings));
  if (!user) localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(settings));
}

async function loadGlobalAppearanceSettings() {
  const client = hasSupabaseConfig() ? getSupabaseClient() : null;
  if (!client) return {};
  const result = await client
    .from("app_settings")
    .select("value")
    .eq("key", APPEARANCE_GLOBAL_SETTING_KEY)
    .maybeSingle();
  if (result.error) throw result.error;
  const value = result.data?.value && typeof result.data.value === "object" ? result.data.value : {};
  localStorage.setItem(APPEARANCE_GLOBAL_CACHE_KEY, JSON.stringify(value));
  return value;
}

async function persistGlobalAppearancePatch(patchValue = {}) {
  const client = hasSupabaseConfig() ? getSupabaseClient() : null;
  if (!client) throw new Error("الاتصال غير متاح لحفظ الشعار العام.");
  let currentValue = {};
  const existing = await client
    .from("app_settings")
    .select("value")
    .eq("key", APPEARANCE_GLOBAL_SETTING_KEY)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data?.value && typeof existing.data.value === "object") currentValue = existing.data.value;
  const value = { ...currentValue, ...patchValue };
  const result = await client
    .from("app_settings")
    .upsert({ key: APPEARANCE_GLOBAL_SETTING_KEY, value, updated_at: new Date().toISOString() }, { onConflict: "key" })
    .select("value")
    .single();
  if (result.error) throw result.error;
  localStorage.setItem(APPEARANCE_GLOBAL_CACHE_KEY, JSON.stringify(value));
  return value;
}

function applyAppearanceSettings(settings = DEFAULT_APPEARANCE) {
  const root = document.documentElement;
  const merged = { ...DEFAULT_APPEARANCE, ...settings };
  const report = normalizeReportPalette(merged);
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
  root.style.setProperty("--report-page-background", report.reportPageBackground);
  root.style.setProperty("--report-text", report.reportTextColor);
  root.style.setProperty("--report-muted-text", report.reportMutedTextColor);
  root.style.setProperty("--report-border", report.reportBorderColor);
  root.style.setProperty("--report-header-background", report.reportHeaderBg);
  root.style.setProperty("--report-header-text", report.reportHeaderColor);
  root.style.setProperty("--report-row-background", report.reportRowBackground);
  root.style.setProperty("--report-alternate-row-background", report.reportAlternateRowBackground);
  root.style.setProperty("--report-accent", report.reportAccentColor);
  root.style.setProperty("--report-total-background", report.reportTotalBackground);
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
  const learned = normalizeLearnedTableOptions(data.learnedTableOptions);
  return {
    glassTypes: uniqueValues([...GLASS_TYPES, ...learned.glassTypes, ...layers.map((layer) => layer.glassType)]),
    companies: uniqueValues([...COMPANIES, ...learned.companies, ...layers.map((layer) => layer.company)]),
    thicknesses: uniqueValues([...THICKNESSES, ...learned.thicknesses, ...layers.map((layer) => layer.thickness)]),
    gaps: uniqueValues([...GAP_DEFAULTS, ...(data.learnedOptions || []), ...learned.gaps, ...rows.map((row) => row.doubleGap)]),
    pvb: uniqueValues([...PVB, ...learned.pvb])
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
    width: overrides.width ?? "",
    height: overrides.height ?? "",
    glassType: overrides.glassType || "",
    company: overrides.company || "",
    thickness: normalizeThicknessText(overrides.thickness || ""),
    unitPrice: overrides.unitPrice ?? "",
    supplierUnitPrice: overrides.supplierUnitPrice ?? "",
    secure: !!overrides.secure,
    color: overrides.color || "#9fd3ff",
    alpha: overrides.alpha ?? 45,
    mirror: !!overrides.mirror,
    offsetX: overrides.offsetX ?? 0,
    offsetY: overrides.offsetY ?? 0,
    followBaseWidth: overrides.followBaseWidth,
    followBaseHeight: overrides.followBaseHeight
  };
}

function makeRow(overrides = {}) {
  const mode = overrides.glassMode || "single";
  const layers = normalizeLayers(mode, overrides.layers || [makeLayer()]).map((layer) => ({
    ...layer,
    unitPrice: layer.unitPrice ?? overrides.unitPrice ?? "",
    supplierUnitPrice: layer.supplierUnitPrice ?? overrides.supplierUnitPrice ?? ""
  }));
  const explicitCode = Object.prototype.hasOwnProperty.call(overrides, "code");
  return {
    id: overrides.id || uid(),
    code: explicitCode ? (overrides.code || "") : drawingRowCode(overrides.drawing),
    glassMode: mode,
    quantity: overrides.quantity ?? "",
    unitPrice: overrides.unitPrice ?? "",
    supplierUnitPrice: overrides.supplierUnitPrice ?? "",
    materialUnitPrice: overrides.materialUnitPrice ?? "",
    supplierMaterialUnitPrice: overrides.supplierMaterialUnitPrice ?? "",
    doubleGap: overrides.doubleGap || "",
    triplexPvb: overrides.triplexPvb || "",
    extraDirection: overrides.extraDirection || "في المنتصف تماماً",
    notes: overrides.notes || "",
    receivedQuantity: overrides.receivedQuantity ?? overrides.received_quantity,
    receiptHistory: normalizeReceiptHistory(overrides.receiptHistory ?? overrides.receipt_history),
    expanded: overrides.expanded ?? false,
    layers,
    drawing: normalizeDrawing(overrides.drawing)
  };
}

function copyRowSpecToTarget(sourceRow, targetRow) {
  const targetLayers = targetRow.layers?.length ? targetRow.layers : [makeLayer()];
  const targetMeasurements = targetLayers.map((layer) => ({ width: layer.width, height: layer.height }));
  const fallbackMeasurement = targetMeasurements[0] || { width: 100, height: 100 };
  const sourceLayers = normalizeLayers(sourceRow.glassMode || "single", sourceRow.layers || [makeLayer()]).map((layer, index) => {
    const targetLayer = targetLayers[index] || {};
    const measurement = targetMeasurements[index] || fallbackMeasurement;
    return {
      ...layer,
      width: measurement.width,
      height: measurement.height,
      followBaseWidth: index === 0 ? false : targetLayer.followBaseWidth,
      followBaseHeight: index === 0 ? false : targetLayer.followBaseHeight
    };
  });
  return makeRow({
    ...targetRow,
    id: targetRow.id,
    code: sourceRow.code,
    glassMode: sourceRow.glassMode,
    quantity: targetRow.quantity,
    unitPrice: sourceRow.unitPrice,
    supplierUnitPrice: sourceRow.supplierUnitPrice,
    materialUnitPrice: sourceRow.materialUnitPrice,
    supplierMaterialUnitPrice: sourceRow.supplierMaterialUnitPrice,
    doubleGap: sourceRow.doubleGap,
    triplexPvb: sourceRow.triplexPvb,
    extraDirection: sourceRow.extraDirection,
    notes: sourceRow.notes,
    expanded: targetRow.expanded,
    layers: sourceLayers,
    drawing: targetRow.drawing
  });
}

function cloneOrderRows(rows = []) {
  return rows.map((row) => {
    const cloned = typeof structuredClone === "function" ? structuredClone(row) : JSON.parse(JSON.stringify(row || {}));
    return makeRow(cloned);
  });
}

function activeOrderRows(rows = []) {
  return cloneOrderRows(rows).filter((row) => !isCompletelyEmptyRow(row));
}

function duplicateOrderRow(row = {}) {
  const cloned = typeof structuredClone === "function" ? structuredClone(row) : JSON.parse(JSON.stringify(row || {}));
  return makeRow({ ...cloned, id: uid(), expanded: false, drawing: normalizeDrawing(cloned.drawing) });
}

function normalizeModeValue(value) {
  const text = cleanName(value).toLocaleLowerCase();
  if (["double", "دبل", "مزدوج"].includes(text)) return "double";
  if (["triplex", "تريبلكس", "تربلكس"].includes(text)) return "triplex";
  if (["single", "سنجل", "مفرد"].includes(text)) return "single";
  return text ? "" : "single";
}

function parseBooleanCell(value) {
  const text = cleanName(value).toLocaleLowerCase();
  return ["1", "true", "yes", "y", "نعم", "صح", "✓", "سيكوريت", "mirror"].includes(text);
}

function isNumericColumn(column = "") {
  return /(?:width|height|quantity|unitPrice|supplierUnitPrice|materialUnitPrice|supplierMaterialUnitPrice|alpha)$/i.test(column);
}

function normalizedCellValueForColumn(column, value) {
  if (!isNumericColumn(column)) return value;
  if (cleanName(value) === "") return "";
  const text = toLatinClipboardDigits(value).trim().replace(",", ".");
  if (/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return text;
  const parsed = clipboardNumber(value);
  return parsed === null ? null : String(parsed);
}

function readRowCellValue(row = {}, column = "") {
  if (column === "mode") return row.glassMode || "single";
  if (column === "quantity") return row.quantity ?? "";
  if (column === "rowCode") return row.code || "";
  if (column === "notes") return row.notes || "";
  if (column === "doubleGap") return row.doubleGap || "";
  if (column === "triplexPvb") return row.triplexPvb || "";
  if (column === "materialUnitPrice") return row.materialUnitPrice ?? "";
  if (column === "supplierMaterialUnitPrice") return row.supplierMaterialUnitPrice ?? "";
  if (column === "extraDirection") return row.extraDirection || "";
  const match = column.match(/^layer(\d+)-(.+)$/);
  if (match) {
    const layer = row.layers?.[Number(match[1])] || {};
    const field = match[2];
    if (field === "secure" || field === "mirror") return layer[field] ? "1" : "";
    return layer[field] ?? "";
  }
  return "";
}

function applyCellValueToRow(row = {}, column = "", rawValue = "") {
  const nextValue = normalizedCellValueForColumn(column, rawValue);
  if (nextValue === null) return { row, ok: false };
  if (column === "mode") {
    const glassMode = normalizeModeValue(rawValue);
    if (!glassMode) return { row, ok: false };
    const drawing = glassMode === "single" ? row.drawing : { ...normalizeDrawing(row.drawing), panels: [] };
    return { row: makeRow({ ...row, glassMode, layers: normalizeLayers(glassMode, row.layers), drawing }), ok: true };
  }
  if (column === "quantity") return { row: makeRow({ ...row, quantity: nextValue }), ok: true };
  if (column === "rowCode") return { row: makeRow({ ...row, code: rawValue }), ok: true };
  if (column === "notes") return { row: makeRow({ ...row, notes: rawValue }), ok: true };
  if (["doubleGap", "triplexPvb", "materialUnitPrice", "supplierMaterialUnitPrice", "extraDirection"].includes(column)) {
    return { row: makeRow({ ...row, [column]: nextValue }), ok: true };
  }
  const match = column.match(/^layer(\d+)-(.+)$/);
  if (match) {
    const layerIndex = Number(match[1]);
    const field = match[2];
    const glassMode = layerIndex > 0 && (row.glassMode || "single") === "single" ? "double" : (row.glassMode || "single");
    const layers = normalizeLayers(glassMode, row.layers || [makeLayer()]);
    while (layers.length <= layerIndex) layers.push(makeLayer());
    const layerValue = field === "secure" || field === "mirror" ? parseBooleanCell(rawValue) : nextValue;
    layers[layerIndex] = makeLayer({ ...layers[layerIndex], [field]: layerValue });
    if (layerIndex > 0 && field === "width") layers[layerIndex].followBaseWidth = false;
    if (layerIndex > 0 && field === "height") layers[layerIndex].followBaseHeight = false;
    return { row: makeRow({ ...row, glassMode, layers }), ok: true };
  }
  return { row, ok: true };
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

function drawingRowCode(drawing = {}) {
  return cleanName(
    drawing?.meta?.rowCode ||
    drawing?.glassOrders?.rowCode ||
    drawing?.rowCode ||
    drawing?._rowCode ||
    ""
  );
}

function normalizeDrawing(drawing = {}) {
  const rowCode = drawingRowCode(drawing);
  const meta = { ...(drawing?.meta || {}) };
  if (rowCode) meta.rowCode = rowCode;
  else delete meta.rowCode;
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
    },
    panels: Array.isArray(drawing?.panels)
      ? drawing.panels.map((panel, index) => normalizeDrawingPanel(panel, index))
      : [],
    meta
  };
}

function normalizePanelDrawingData(drawing = {}) {
  return {
    shapes: Array.isArray(drawing?.shapes) ? drawing.shapes : [],
    paths: Array.isArray(drawing?.paths) ? drawing.paths : [],
    outline: {
      points: (drawing?.outline?.points || []).map((point, index) => normalizeOutlinePoint(point, index))
    },
    edges: {
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      ...(drawing?.edges || {})
    },
    meta: { ...(drawing?.meta || {}) }
  };
}

function panelLetter(index = 0) {
  let value = Math.max(0, Math.floor(numberValue(index)));
  let label = "";
  do {
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return label;
}

function firstLayerSizeMm(row = {}) {
  const layer = row.layers?.[0] || makeLayer();
  return {
    width: Math.max(1, cmToMm(layer.width, 100)),
    height: Math.max(1, cmToMm(layer.height, 100))
  };
}

function rowWorkingAreaMm(row = {}) {
  return firstLayerSizeMm(row);
}

function clampDrawingPanelToWorkingArea(panel = {}, row = {}) {
  const area = rowWorkingAreaMm(row);
  const width = Math.max(1, Math.min(area.width, numberValue(panel.width, area.width)));
  const height = Math.max(1, Math.min(area.height, numberValue(panel.height, area.height)));
  return {
    ...panel,
    width,
    height,
    x: Math.max(0, Math.min(area.width - width, numberValue(panel.x))),
    y: Math.max(0, Math.min(area.height - height, numberValue(panel.y)))
  };
}

function normalizeDrawingPanel(panel = {}, index = 0) {
  const fallbackLabel = panelLetter(index);
  const width = Math.max(1, numberValue(panel.width, 1000));
  const height = Math.max(1, numberValue(panel.height, 1000));
  return {
    id: panel.id || uid(),
    label: cleanName(panel.label) || fallbackLabel,
    code: cleanName(panel.code || ""),
    width,
    height,
    x: numberValue(panel.x, index * (width + 160)),
    y: numberValue(panel.y, 0),
    notes: panel.notes || "",
    drawing: normalizePanelDrawingData(panel.drawing)
  };
}

function defaultDrawingPanelForRow(row = {}, index = 0) {
  const drawing = normalizeDrawing(row.drawing);
  const size = firstLayerSizeMm(row);
  return normalizeDrawingPanel({
    id: drawing.meta?.panelId || `${row.id || "row"}-panel-${index + 1}`,
    label: panelLetter(index),
    code: cleanName(row.code) ? `${cleanName(row.code)}-${panelLetter(index)}` : panelLetter(index),
    width: size.width,
    height: size.height,
    x: 0,
    y: 0,
    notes: row.notes || "",
    drawing: normalizePanelDrawingData(drawing)
  }, index);
}

function isSingleGlassRow(row = {}) {
  return (row.glassMode || "single") === "single";
}

function rowStoredPanels(row = {}) {
  if (!isSingleGlassRow(row)) return [];
  return normalizeDrawing(row.drawing).panels;
}

function rowDrawingPanels(row = {}) {
  if (!isSingleGlassRow(row)) return [];
  const drawing = normalizeDrawing(row.drawing);
  if (drawing.panels.length) return drawing.panels;
  return [defaultDrawingPanelForRow(row, 0)];
}

function rowHasPanels(row = {}) {
  return isSingleGlassRow(row) && normalizeDrawing(row.drawing).panels.length > 0;
}

function panelDisplayName(panel = {}, index = 0) {
  return cleanName(panel.label) || panelLetter(index);
}

function panelCode(row = {}, panel = {}, index = 0) {
  return cleanName(panel.code) || (cleanName(row.code) ? `${cleanName(row.code)}-${panelDisplayName(panel, index)}` : `R${index + 1}${panelDisplayName(panel, index)}`);
}

function panelAreaM2(panel = {}) {
  return (Math.max(0, numberValue(panel.width)) * Math.max(0, numberValue(panel.height))) / 1000000;
}

function rowPanelArea(row = {}) {
  return rowDrawingPanels(row).reduce((sum, panel) => sum + panelAreaM2(panel), 0);
}

function rowPanelPhysicalCount(row = {}) {
  return rowHasPanels(row) ? rowDrawingPanels(row).length : Math.max(0, Math.floor(numberValue(row.quantity, 1)));
}

function drawingWithRowCode(drawing = {}, code = "") {
  const normalized = normalizeDrawing(drawing);
  const rowCode = cleanName(code);
  const meta = { ...(normalized.meta || {}) };
  if (rowCode) meta.rowCode = rowCode;
  else delete meta.rowCode;
  return { ...normalized, meta };
}

function normalizeOutlinePoint(point = {}, index = 0) {
  const mode = point.corner
    ? "free"
    : ["free", "curve", "arc"].includes(point.mode)
      ? point.mode
      : point.arc
        ? "arc"
        : point.curve
          ? "curve"
          : "free";
  return {
    id: point.id || `outline-${index}`,
    x: numberValue(point.x),
    y: numberValue(point.y),
    corner: !!point.corner,
    mode,
    halfDiameter: Math.max(0, numberValue(point.halfDiameter)),
    curve: mode === "curve",
    arc: mode === "arc"
  };
}

function defaultOutlinePoints(geometry, edges = {}) {
  const top = numberValue(edges.top);
  const right = numberValue(edges.right);
  const bottom = numberValue(edges.bottom);
  const left = numberValue(edges.left);
  return [
    { id: "corner-tl", x: geometry.x + left, y: geometry.y + top, corner: true, mode: "free", curve: false },
    { id: "corner-tr", x: geometry.x + geometry.width - right, y: geometry.y + top, corner: true, mode: "free", curve: false },
    { id: "corner-br", x: geometry.x + geometry.width - right, y: geometry.y + geometry.height - bottom, corner: true, mode: "free", curve: false },
    { id: "corner-bl", x: geometry.x + left, y: geometry.y + geometry.height - bottom, corner: true, mode: "free", curve: false }
  ];
}

function outlinePointsForGeometry(drawing, geometry) {
  const normalized = normalizeDrawing(drawing);
  const points = normalized.outline.points;
  return points.length >= 4 ? points : defaultOutlinePoints(geometry, normalized.edges);
}

function pointNear(a = {}, b = {}, tolerance = 0.5) {
  return Math.abs(numberValue(a.x) - numberValue(b.x)) <= tolerance && Math.abs(numberValue(a.y) - numberValue(b.y)) <= tolerance;
}

function isDefaultRectOutline(points = [], geometry = {}) {
  const defaults = defaultOutlinePoints(geometry);
  if (points.length !== defaults.length) return false;
  return points.every((point, index) => pointNear(point, defaults[index]));
}

function normalizeCornerCode(value = "") {
  const raw = String(value || "").toLowerCase().replace(/[_\s-]+/g, "-");
  if (["tl", "top-left", "left-top"].includes(raw)) return "tl";
  if (["tr", "top-right", "right-top"].includes(raw)) return "tr";
  if (["br", "bottom-right", "right-bottom"].includes(raw)) return "br";
  if (["bl", "bottom-left", "left-bottom"].includes(raw)) return "bl";
  return "";
}

function cornerDisplayName(corner = "") {
  return {
    tl: "top-left",
    tr: "top-right",
    br: "bottom-right",
    bl: "bottom-left"
  }[normalizeCornerCode(corner)] || "top-left";
}

function cornerNotchRect(corner = "tl", width = 1, height = 1, bounds = {}) {
  const safeCorner = normalizeCornerCode(corner) || "tl";
  const left = numberValue(bounds.x);
  const top = numberValue(bounds.y);
  const right = numberValue(bounds.right, left + numberValue(bounds.width));
  const bottom = numberValue(bounds.bottom, top + numberValue(bounds.height));
  const w = Math.max(1, Math.min(Math.max(1, right - left - 1), numberValue(width, 1)));
  const h = Math.max(1, Math.min(Math.max(1, bottom - top - 1), numberValue(height, 1)));
  const x = safeCorner === "tr" || safeCorner === "br" ? right - w : left;
  const y = safeCorner === "bl" || safeCorner === "br" ? bottom - h : top;
  return { corner: safeCorner, x, y, right: x + w, bottom: y + h, width: w, height: h };
}

function legacyRectCornerCutInfo(shape, bounds, tolerance = 10) {
  const x = Math.max(numberValue(bounds.x), numberValue(shape.x));
  const y = Math.max(numberValue(bounds.y), numberValue(shape.y));
  const right = Math.min(numberValue(bounds.right), numberValue(shape.x) + numberValue(shape.w));
  const bottom = Math.min(numberValue(bounds.bottom), numberValue(shape.y) + numberValue(shape.h));
  if (right <= x || bottom <= y) return null;
  const touches = rectTouches({ ...shape, x, y, w: right - x, h: bottom - y }, bounds, tolerance);
  const corner = touches.left && touches.top
    ? "tl"
    : touches.right && touches.top
      ? "tr"
      : touches.right && touches.bottom
        ? "br"
        : touches.left && touches.bottom
          ? "bl"
          : "";
  if (!corner) return null;
  return { corner, x, y, right, bottom, width: right - x, height: bottom - y };
}

function isCornerNotchShape(shape = {}, bounds = null) {
  if (!shape) return false;
  if (shape.kind === "cornerNotch" || shape.type === "cornerNotch" || shape.rectType === "corner") return true;
  if (shape.kind !== "rect" || shape.rectType) return false;
  return !!(bounds && legacyRectCornerCutInfo(shape, bounds));
}

function cornerCutInfo(shape, bounds, tolerance = 10) {
  if (!shape) return null;
  if (shape.kind === "cornerNotch" || shape.type === "cornerNotch" || shape.rectType === "corner") {
    return cornerNotchRect(shape.corner || "tl", shape.width ?? shape.w, shape.height ?? shape.h, bounds);
  }
  if (shape.kind !== "rect" || shape.rectType) return null;
  return legacyRectCornerCutInfo(shape, bounds, tolerance);
}

function cornerCutsByCorner(shapes = [], bounds = {}) {
  return shapes.reduce((cuts, shape) => {
    const cut = cornerCutInfo(shape, bounds);
    if (!cut) return cuts;
    const previous = cuts[cut.corner];
    if (!previous || cut.width * cut.height > previous.width * previous.height) {
      cuts[cut.corner] = cut;
    }
    return cuts;
  }, {});
}

function removeConsecutiveDuplicatePoints(points = []) {
  return points.filter((point, index) => index === 0 || !pointNear(point, points[index - 1]));
}

function outlinePointsWithCornerCuts(points = [], geometry = {}, shapes = []) {
  if (!isDefaultRectOutline(points, geometry)) return points;
  const bounds = boundsFromOutline(points, geometry);
  const cuts = cornerCutsByCorner(shapes, bounds);
  if (!Object.keys(cuts).length) return points;
  const left = numberValue(bounds.x);
  const top = numberValue(bounds.y);
  const right = numberValue(bounds.right);
  const bottom = numberValue(bounds.bottom);
  const tl = cuts.tl;
  const tr = cuts.tr;
  const br = cuts.br;
  const bl = cuts.bl;
  const next = [];
  if (tl) next.push({ x: tl.right, y: top });
  else next.push({ x: left, y: top });
  if (tr) next.push({ x: tr.x, y: top }, { x: tr.x, y: tr.bottom }, { x: right, y: tr.bottom });
  else next.push({ x: right, y: top });
  if (br) next.push({ x: right, y: br.y }, { x: br.x, y: br.y }, { x: br.x, y: bottom });
  else next.push({ x: right, y: bottom });
  if (bl) next.push({ x: bl.right, y: bottom }, { x: bl.right, y: bl.y }, { x: left, y: bl.y });
  else next.push({ x: left, y: bottom });
  if (tl) next.push({ x: left, y: tl.bottom }, { x: tl.right, y: tl.bottom });
  return removeConsecutiveDuplicatePoints(next).map((point, index) => normalizeOutlinePoint({ ...point, id: `corner-cut-${index}`, corner: true }, index));
}

function visualOutlinePointsForDrawing(drawing, geometry) {
  const normalized = normalizeDrawing(drawing);
  const basePoints = outlinePointsForGeometry(normalized, geometry);
  return outlinePointsWithCornerCuts(basePoints, geometry, normalized.shapes || []);
}

function outlinePath(points = []) {
  if (points.length === 0) return "";
  let d = `M ${numberValue(points[0].x)} ${numberValue(points[0].y)}`;
  for (const segment of outlinePathSegments(points)) {
    if (segment.kind === "quad") d += ` Q ${numberValue(segment.control.x)} ${numberValue(segment.control.y)} ${numberValue(segment.end.x)} ${numberValue(segment.end.y)}`;
    else if (segment.kind === "arc") {
      const spec = arcSpec(segment);
      d += ` A ${spec.radius} ${spec.radius} 0 ${spec.largeArc} ${spec.sweep} ${numberValue(segment.end.x)} ${numberValue(segment.end.y)}`;
    } else {
      d += ` L ${numberValue(segment.end.x)} ${numberValue(segment.end.y)}`;
    }
  }
  return `${d} Z`;
}

function quadraticPoint(start, control, end, t) {
  const mt = 1 - t;
  return {
    x: mt * mt * numberValue(start.x) + 2 * mt * t * numberValue(control.x) + t * t * numberValue(end.x),
    y: mt * mt * numberValue(start.y) + 2 * mt * t * numberValue(control.y) + t * t * numberValue(end.y)
  };
}

function quadraticTangent(start, control, end, t) {
  return {
    x: 2 * (1 - t) * (numberValue(control.x) - numberValue(start.x)) + 2 * t * (numberValue(end.x) - numberValue(control.x)),
    y: 2 * (1 - t) * (numberValue(control.y) - numberValue(start.y)) + 2 * t * (numberValue(end.y) - numberValue(control.y))
  };
}

function outlinePointMode(point = {}) {
  if (point.corner) return "free";
  if (point.mode === "arc") return "arc";
  if (point.mode === "curve" || point.curve) return "curve";
  return "free";
}

function chordDepth(start, control, end) {
  const sx = numberValue(start.x);
  const sy = numberValue(start.y);
  const ex = numberValue(end.x);
  const ey = numberValue(end.y);
  const cx = numberValue(control.x);
  const cy = numberValue(control.y);
  const dx = ex - sx;
  const dy = ey - sy;
  const length = Math.max(1, Math.hypot(dx, dy));
  return ((cx - sx) * -dy + (cy - sy) * dx) / length;
}

function arcDepth(segment) {
  const chord = Math.hypot(numberValue(segment.end.x) - numberValue(segment.start.x), numberValue(segment.end.y) - numberValue(segment.start.y));
  const measured = Math.abs(chordDepth(segment.start, segment.control, segment.end));
  return Math.max(1, numberValue(segment.control.halfDiameter) || measured || chord / 4 || 1);
}

function arcRadiusFromDepth(chordLength, depth) {
  const chord = Math.max(1, chordLength);
  const sagitta = Math.max(1, depth);
  return (chord * chord) / (8 * sagitta) + sagitta / 2;
}

function arcSpec(segment) {
  const sx = numberValue(segment.start.x);
  const sy = numberValue(segment.start.y);
  const ex = numberValue(segment.end.x);
  const ey = numberValue(segment.end.y);
  const dx = ex - sx;
  const dy = ey - sy;
  const chord = Math.max(1, Math.hypot(dx, dy));
  const depth = Math.min(arcDepth(segment), chord * 2);
  const radius = arcRadiusFromDepth(chord, depth);
  const sign = Math.sign(chordDepth(segment.start, segment.control, segment.end)) || 1;
  const normal = { x: -dy / chord, y: dx / chord };
  const mid = { x: (sx + ex) / 2, y: (sy + ey) / 2 };
  const centerOffset = Math.max(0, radius - depth);
  const center = { x: mid.x - normal.x * sign * centerOffset, y: mid.y - normal.y * sign * centerOffset };
  const startAngle = Math.atan2(sy - center.y, sx - center.x);
  const endAngle = Math.atan2(ey - center.y, ex - center.x);
  const arcPeak = { x: mid.x + normal.x * sign * depth, y: mid.y + normal.y * sign * depth };
  const candidates = [1, -1].map((direction) => {
    let delta = endAngle - startAngle;
    if (direction > 0) {
      while (delta <= 0) delta += Math.PI * 2;
    } else {
      while (delta >= 0) delta -= Math.PI * 2;
    }
    const midAngle = startAngle + delta / 2;
    const midpoint = { x: center.x + Math.cos(midAngle) * radius, y: center.y + Math.sin(midAngle) * radius };
    return { direction, delta, midpoint, score: Math.hypot(midpoint.x - arcPeak.x, midpoint.y - arcPeak.y) };
  }).sort((a, b) => a.score - b.score)[0];
  return {
    center,
    radius,
    startAngle,
    delta: candidates.delta,
    largeArc: Math.abs(candidates.delta) > Math.PI ? 1 : 0,
    sweep: candidates.delta > 0 ? 1 : 0
  };
}

function arcPoint(segment, t) {
  const spec = arcSpec(segment);
  const angle = spec.startAngle + spec.delta * t;
  return {
    x: spec.center.x + Math.cos(angle) * spec.radius,
    y: spec.center.y + Math.sin(angle) * spec.radius
  };
}

function outlinePathSegments(points = []) {
  if (points.length < 2) return [];
  const segments = [];
  let current = points[0];
  let currentIndex = 0;
  for (let i = 1; i < points.length; i += 1) {
    const point = points[i];
    const mode = outlinePointMode(point);
    if ((mode === "curve" || mode === "arc") && i < points.length - 1) {
      const next = points[i + 1];
      segments.push({ kind: mode === "arc" ? "arc" : "quad", start: current, control: point, end: next, startIndex: currentIndex, controlIndex: i, endIndex: i + 1 });
      current = next;
      currentIndex = i + 1;
      i += 1;
    } else {
      segments.push({ kind: "line", start: current, end: point, startIndex: currentIndex, endIndex: i });
      current = point;
      currentIndex = i;
    }
  }
  segments.push({ kind: "line", start: current, end: points[0], startIndex: currentIndex, endIndex: 0 });
  return segments;
}

function flattenOutlinePoints(points = [], samples = 24) {
  if (!points.length) return [];
  const flat = [{ x: numberValue(points[0].x), y: numberValue(points[0].y) }];
  for (const segment of outlinePathSegments(points)) {
    if (segment.kind === "quad" || segment.kind === "arc") {
      for (let step = 1; step <= samples; step += 1) {
        flat.push(segment.kind === "arc" ? arcPoint(segment, step / samples) : quadraticPoint(segment.start, segment.control, segment.end, step / samples));
      }
    } else {
      flat.push({ x: numberValue(segment.end.x), y: numberValue(segment.end.y) });
    }
  }
  return flat;
}

function segmentPathD(segment) {
  if (segment.kind === "quad") {
    return `M ${numberValue(segment.start.x)} ${numberValue(segment.start.y)} Q ${numberValue(segment.control.x)} ${numberValue(segment.control.y)} ${numberValue(segment.end.x)} ${numberValue(segment.end.y)}`;
  }
  if (segment.kind === "arc") {
    const spec = arcSpec(segment);
    return `M ${numberValue(segment.start.x)} ${numberValue(segment.start.y)} A ${spec.radius} ${spec.radius} 0 ${spec.largeArc} ${spec.sweep} ${numberValue(segment.end.x)} ${numberValue(segment.end.y)}`;
  }
  return "";
}

function approximateSegmentLength(segment) {
  if (segment.kind !== "quad" && segment.kind !== "arc") {
    return Math.hypot(numberValue(segment.end.x) - numberValue(segment.start.x), numberValue(segment.end.y) - numberValue(segment.start.y));
  }
  let length = 0;
  let previous = segment.kind === "arc" ? arcPoint(segment, 0) : quadraticPoint(segment.start, segment.control, segment.end, 0);
  for (let step = 1; step <= 32; step += 1) {
    const point = segment.kind === "arc" ? arcPoint(segment, step / 32) : quadraticPoint(segment.start, segment.control, segment.end, step / 32);
    length += Math.hypot(point.x - previous.x, point.y - previous.y);
    previous = point;
  }
  return length;
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
  const flattened = flattenOutlinePoints(candidates);
  const xs = flattened.map((point) => numberValue(point.x));
  const ys = flattened.map((point) => numberValue(point.y));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY, right: maxX, bottom: maxY };
}

function axisIntersections(points = [], axis, value) {
  const hits = [];
  const flattened = flattenOutlinePoints(points);
  for (let index = 0; index < flattened.length - 1; index += 1) {
    const start = flattened[index];
    const end = flattened[index + 1];
    const x1 = numberValue(start.x);
    const y1 = numberValue(start.y);
    const x2 = numberValue(end.x);
    const y2 = numberValue(end.y);
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

function shapeEdgeBox(shape = {}) {
  if (shape.kind === "circle") {
    const r = numberValue(shape.r);
    return {
      x: numberValue(shape.x) - r,
      y: numberValue(shape.y) - r,
      right: numberValue(shape.x) + r,
      bottom: numberValue(shape.y) + r,
      width: r * 2,
      height: r * 2,
      centerX: numberValue(shape.x),
      centerY: numberValue(shape.y)
    };
  }
  const x = numberValue(shape.x);
  const y = numberValue(shape.y);
  const width = numberValue(shape.w);
  const height = numberValue(shape.h);
  return {
    x,
    y,
    right: x + width,
    bottom: y + height,
    width,
    height,
    centerX: x + width / 2,
    centerY: y + height / 2
  };
}

function nearestShapeEdgeFields(shape = {}, bounds = {}) {
  const box = shapeEdgeBox(shape);
  const left = Math.max(0, box.x - numberValue(bounds.x));
  const right = Math.max(0, numberValue(bounds.right) - box.right);
  const top = Math.max(0, box.y - numberValue(bounds.y));
  const bottom = Math.max(0, numberValue(bounds.bottom) - box.bottom);
  return {
    horizontal: left <= right ? { side: "left", label: "Left", value: left } : { side: "right", label: "Right", value: right },
    vertical: top <= bottom ? { side: "top", label: "Top", value: top } : { side: "bottom", label: "Bottom", value: bottom }
  };
}

function shapePositionPatchFromNearestInput(shape = {}, bounds = {}, axis = "x", rawValue = "") {
  const value = Math.max(0, numberValue(rawValue));
  const nearest = nearestShapeEdgeFields(shape, bounds);
  if (shape.kind === "circle") {
    const r = numberValue(shape.r);
    if (axis === "x") {
      return nearest.horizontal.side === "right"
        ? { x: numberValue(bounds.right) - r - value }
        : { x: numberValue(bounds.x) + r + value };
    }
    return nearest.vertical.side === "bottom"
      ? { y: numberValue(bounds.bottom) - r - value }
      : { y: numberValue(bounds.y) + r + value };
  }
  if (axis === "x") {
    return nearest.horizontal.side === "right"
      ? { x: numberValue(bounds.right) - numberValue(shape.w) - value }
      : { x: numberValue(bounds.x) + value };
  }
  return nearest.vertical.side === "bottom"
    ? { y: numberValue(bounds.bottom) - numberValue(shape.h) - value }
    : { y: numberValue(bounds.y) + value };
}

function engineeringDiameterLabel(shape = {}) {
  return `⌀${Math.round(numberValue(shape.r) * 2)} mm`;
}

function holeLeaderLabelItems(shapes = [], bounds = {}) {
  const circles = shapes
    .filter((shape) => shape.kind === "circle")
    .map((shape) => {
      const box = shapeEdgeBox(shape);
      const midX = numberValue(bounds.x) + numberValue(bounds.width) / 2;
      const side = box.centerX <= midX ? "left" : "right";
      return { shape, box, side };
    });
  const grouped = circles.reduce((map, item) => {
    map[item.side] = [...(map[item.side] || []), item];
    return map;
  }, {});
  const minGap = 58;
  const topBandBottom = numberValue(bounds.y) + 54;
  const sideLeader = (item, side, adjusted) => {
    const label = engineeringDiameterLabel(item.shape);
    const leftSide = side === "left";
    const textX = leftSide ? numberValue(bounds.x) - 182 : numberValue(bounds.right) + 182;
    const elbowX = leftSide ? numberValue(bounds.x) - 74 : numberValue(bounds.right) + 74;
    const shortX = leftSide ? textX + 16 : textX - 16;
    const startX = leftSide ? item.box.x : item.box.right;
    const startY = item.box.centerY;
    return {
      ...item,
      label,
      textX,
      textY: adjusted,
      textAnchor: leftSide ? "end" : "start",
      path: `M ${startX} ${startY} L ${elbowX} ${adjusted} L ${shortX} ${adjusted}`
    };
  };
  return Object.entries(grouped).flatMap(([side, items]) => {
    const sorted = [...items].sort((a, b) => a.box.centerY - b.box.centerY);
    let last = -Infinity;
    return sorted.map((item) => {
      const natural = Math.max(topBandBottom, item.box.centerY);
      const adjusted = Math.max(natural, last + minGap);
      last = adjusted;
      return sideLeader(item, side, adjusted);
    });
  });
}

function holeDetailClusters(shapes = [], threshold = 190) {
  const circles = shapes.filter((shape) => shape.kind === "circle");
  const visited = new Set();
  const clusters = [];
  for (const circle of circles) {
    if (visited.has(circle.id)) continue;
    const queue = [circle];
    const group = [];
    visited.add(circle.id);
    while (queue.length) {
      const current = queue.shift();
      group.push(current);
      for (const other of circles) {
        if (visited.has(other.id)) continue;
        const distance = Math.hypot(numberValue(current.x) - numberValue(other.x), numberValue(current.y) - numberValue(other.y));
        if (distance <= threshold) {
          visited.add(other.id);
          queue.push(other);
        }
      }
    }
    if (group.length >= 3) clusters.push(group);
  }
  return clusters;
}

function HoleDetailViews({ shapes = [] }) {
  const clusters = holeDetailClusters(shapes);
  if (!clusters.length) return null;
  return (
    <div className="hole-detail-views">
      {clusters.map((cluster, clusterIndex) => {
        const minX = Math.min(...cluster.map((shape) => numberValue(shape.x) - numberValue(shape.r)));
        const maxX = Math.max(...cluster.map((shape) => numberValue(shape.x) + numberValue(shape.r)));
        const minY = Math.min(...cluster.map((shape) => numberValue(shape.y) - numberValue(shape.r)));
        const maxY = Math.max(...cluster.map((shape) => numberValue(shape.y) + numberValue(shape.r)));
        const pad = 90;
        const sorted = [...cluster].sort((a, b) => numberValue(a.x) - numberValue(b.x));
        const first = sorted[0];
        const last = sorted[sorted.length - 1];
        const dx = Math.abs(numberValue(last.x) - numberValue(first.x));
        const verticalSorted = [...cluster].sort((a, b) => numberValue(a.y) - numberValue(b.y));
        const top = verticalSorted[0];
        const bottom = verticalSorted[verticalSorted.length - 1];
        const dy = Math.abs(numberValue(bottom.y) - numberValue(top.y));
        return (
          <div className="hole-detail" key={`detail-${clusterIndex}`}>
            <strong>Detail {String.fromCharCode(65 + clusterIndex)}</strong>
            <svg viewBox={`${minX - pad} ${minY - pad} ${Math.max(260, maxX - minX + pad * 2)} ${Math.max(220, maxY - minY + pad * 2)}`}>
              {cluster.map((shape) => <circle key={shape.id} cx={shape.x} cy={shape.y} r={shape.r} fill="#fff" stroke="#b42318" strokeWidth="2.4" vectorEffect="non-scaling-stroke" />)}
              {dx > 0 && (
                <g className="detail-dimension">
                  <line x1={first.x} y1={maxY + 42} x2={last.x} y2={maxY + 42} />
                  <text x={(numberValue(first.x) + numberValue(last.x)) / 2} y={maxY + 32} textAnchor="middle">{Math.round(dx)} mm</text>
                </g>
              )}
              {dy > 0 && (
                <g className="detail-dimension">
                  <line x1={maxX + 42} y1={top.y} x2={maxX + 42} y2={bottom.y} />
                  <text x={maxX + 54} y={(numberValue(top.y) + numberValue(bottom.y)) / 2} textAnchor="middle" transform={`rotate(90 ${maxX + 54} ${(numberValue(top.y) + numberValue(bottom.y)) / 2})`}>{Math.round(dy)} mm</text>
                </g>
              )}
            </svg>
          </div>
        );
      })}
    </div>
  );
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
  if (shape.kind === "circle") return engineeringDiameterLabel(shape);
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

function rectsOverlap(a = {}, b = {}) {
  return numberValue(a.x) < numberValue(b.right) &&
    numberValue(a.right) > numberValue(b.x) &&
    numberValue(a.y) < numberValue(b.bottom) &&
    numberValue(a.bottom) > numberValue(b.y);
}

function cornerCutAsBox(cut = {}) {
  return { x: cut.x, y: cut.y, right: cut.right, bottom: cut.bottom, width: cut.width, height: cut.height, corner: cut.corner };
}

function panelFeatureBounds(shape = {}) {
  if (shape.kind === "circle") {
    const r = Math.max(1, numberValue(shape.r));
    return { x: numberValue(shape.x) - r, y: numberValue(shape.y) - r, right: numberValue(shape.x) + r, bottom: numberValue(shape.y) + r, width: r * 2, height: r * 2 };
  }
  const x = numberValue(shape.x);
  const y = numberValue(shape.y);
  const width = Math.max(1, numberValue(shape.width ?? shape.w));
  const height = Math.max(1, numberValue(shape.height ?? shape.h));
  return { x, y, right: x + width, bottom: y + height, width, height };
}

function removedCornerBoxes(shapes = [], bounds = {}, excludeId = "") {
  return (shapes || [])
    .filter((shape) => !excludeId || shape.id !== excludeId)
    .map((shape) => cornerCutInfo(shape, bounds))
    .filter(Boolean)
    .map(cornerCutAsBox);
}

function resolveCornerNotchShape(shape = {}, bounds = {}) {
  const cut = cornerCutInfo(shape, bounds) || cornerNotchRect(shape.corner || "tl", shape.width ?? shape.w, shape.height ?? shape.h, bounds);
  return {
    ...shape,
    kind: "rect",
    type: "cornerNotch",
    rectType: "corner",
    corner: cut.corner,
    x: cut.x,
    y: cut.y,
    w: cut.width,
    h: cut.height,
    width: cut.width,
    height: cut.height
  };
}

function nearestPanelCorner(point = {}, bounds = {}) {
  const corners = [
    { corner: "tl", x: bounds.x, y: bounds.y },
    { corner: "tr", x: bounds.right, y: bounds.y },
    { corner: "br", x: bounds.right, y: bounds.bottom },
    { corner: "bl", x: bounds.x, y: bounds.bottom }
  ];
  return corners
    .map((item) => ({ ...item, distance: Math.hypot(numberValue(point.x) - numberValue(item.x), numberValue(point.y) - numberValue(item.y)) }))
    .sort((a, b) => a.distance - b.distance)[0]?.corner || "tl";
}

function pushFeatureBoxOutsideCut(box = {}, cut = {}, bounds = {}) {
  if (!rectsOverlap(box, cut)) return { x: box.x, y: box.y };
  const candidates = [];
  if (cut.corner === "tl" || cut.corner === "bl") candidates.push({ x: cut.right, y: box.y, cost: Math.abs(cut.right - box.x) });
  if (cut.corner === "tr" || cut.corner === "br") candidates.push({ x: cut.x - box.width, y: box.y, cost: Math.abs(box.right - cut.x) });
  if (cut.corner === "tl" || cut.corner === "tr") candidates.push({ x: box.x, y: cut.bottom, cost: Math.abs(cut.bottom - box.y) });
  if (cut.corner === "bl" || cut.corner === "br") candidates.push({ x: box.x, y: cut.y - box.height, cost: Math.abs(box.bottom - cut.y) });
  return candidates
    .map((candidate) => ({
      ...candidate,
      x: Math.max(bounds.x, Math.min(bounds.right - box.width, candidate.x)),
      y: Math.max(bounds.y, Math.min(bounds.bottom - box.height, candidate.y))
    }))
    .filter((candidate) => !rectsOverlap({ ...box, x: candidate.x, y: candidate.y, right: candidate.x + box.width, bottom: candidate.y + box.height }, cut))
    .sort((a, b) => a.cost - b.cost)[0] || { x: box.x, y: box.y };
}

function clampFeatureShapeToPanel(shape = {}, drawing = {}, geometry = {}) {
  const bounds = { x: 0, y: 0, width: numberValue(geometry.width), height: numberValue(geometry.height), right: numberValue(geometry.width), bottom: numberValue(geometry.height) };
  if (isCornerNotchShape(shape, bounds)) return resolveCornerNotchShape(shape, bounds);
  if (shape.kind === "circle") {
    const maxRadius = Math.max(1, Math.min(bounds.width, bounds.height) / 2 - 1);
    const r = Math.max(1, Math.min(maxRadius, numberValue(shape.r, 25)));
    let x = Math.max(r, Math.min(bounds.right - r, numberValue(shape.x)));
    let y = Math.max(r, Math.min(bounds.bottom - r, numberValue(shape.y)));
    for (const cut of removedCornerBoxes(drawing.shapes || [], bounds, shape.id)) {
      const box = { x: x - r, y: y - r, right: x + r, bottom: y + r, width: r * 2, height: r * 2 };
      const next = pushFeatureBoxOutsideCut(box, cut, bounds);
      x = next.x + r;
      y = next.y + r;
    }
    return { ...shape, kind: "circle", x: Math.round(x), y: Math.round(y), r };
  }
  if (shape.kind === "rect") {
    const width = Math.max(1, Math.min(bounds.width, numberValue(shape.width ?? shape.w, 80)));
    const height = Math.max(1, Math.min(bounds.height, numberValue(shape.height ?? shape.h, 50)));
    let x = Math.max(bounds.x, Math.min(bounds.right - width, numberValue(shape.x)));
    let y = Math.max(bounds.y, Math.min(bounds.bottom - height, numberValue(shape.y)));
    for (const cut of removedCornerBoxes(drawing.shapes || [], bounds, shape.id)) {
      const box = { x, y, right: x + width, bottom: y + height, width, height };
      const next = pushFeatureBoxOutsideCut(box, cut, bounds);
      x = next.x;
      y = next.y;
    }
    return { ...shape, rectType: shape.rectType || "internal", x: Math.round(x), y: Math.round(y), w: width, h: height };
  }
  return shape;
}

function sanitizePanelDrawingGeometry(drawing = {}, panel = {}) {
  const normalized = normalizePanelDrawingData(drawing);
  const geometry = { x: 0, y: 0, width: numberValue(panel.width), height: numberValue(panel.height) };
  const shapes = (normalized.shapes || []).map((shape) => clampFeatureShapeToPanel(shape, normalized, geometry));
  return { ...normalized, shapes };
}

function panelFeatureResizeViolation(panel = {}, patchValue = {}) {
  const nextWidth = Math.max(1, numberValue(patchValue.width ?? panel.width));
  const nextHeight = Math.max(1, numberValue(patchValue.height ?? panel.height));
  const bounds = { x: 0, y: 0, width: nextWidth, height: nextHeight, right: nextWidth, bottom: nextHeight };
  const drawing = normalizePanelDrawingData(panel.drawing);
  const cornerBoxes = [];
  for (let index = 0; index < (drawing.shapes || []).length; index += 1) {
    const shape = drawing.shapes[index];
    if (isCornerNotchShape(shape, bounds)) {
      const cut = cornerCutInfo(shape, bounds);
      if (!cut || cut.width >= nextWidth || cut.height >= nextHeight) return `لا يمكن تقليل مقاس اللوح لأن قص الركنة رقم ${index + 1} سيصبح خارج حدود اللوح.`;
      const cutBox = cornerCutAsBox(cut);
      if (cornerBoxes.some((box) => rectsOverlap(box, cutBox))) return "عرض الركنة أكبر من المساحة المتاحة داخل اللوح.";
      cornerBoxes.push(cutBox);
      continue;
    }
  }
  for (let index = 0; index < (drawing.shapes || []).length; index += 1) {
    const shape = drawing.shapes[index];
    if (isCornerNotchShape(shape, bounds)) continue;
    const box = panelFeatureBounds(shape);
    if (box.x < 0 || box.y < 0 || box.right > nextWidth || box.bottom > nextHeight) {
      const label = shape.kind === "circle" ? "الثقب" : "العنصر";
      return `لا يمكن تقليل مقاس اللوح لأن ${label} رقم ${index + 1} سيصبح خارج حدود اللوح.`;
    }
    if ((shape.kind === "circle" || shape.kind === "rect") && cornerBoxes.some((cut) => rectsOverlap(box, cut))) {
      const label = shape.kind === "circle" ? "الثقب" : "العنصر";
      return `لا يمكن تقليل مقاس اللوح لأن ${label} رقم ${index + 1} سيتداخل مع قص الركنة.`;
    }
  }
  return "";
}

function cornerNotchDimensionItems(cut = {}, bounds = {}) {
  if (!cut) return [];
  const offset = 34;
  const textOffset = 50;
  const top = numberValue(bounds.y);
  const left = numberValue(bounds.x);
  const right = numberValue(bounds.right);
  const bottom = numberValue(bounds.bottom);
  const horizontalY = cut.corner === "bl" || cut.corner === "br" ? bottom + offset : top - offset;
  const horizontalTextY = cut.corner === "bl" || cut.corner === "br" ? horizontalY + textOffset : horizontalY - 14;
  const verticalX = cut.corner === "tr" || cut.corner === "br" ? right + offset : left - offset;
  const verticalTextX = cut.corner === "tr" || cut.corner === "br" ? verticalX + textOffset : verticalX - textOffset;
  const hx1 = cut.corner === "tr" || cut.corner === "br" ? cut.x : left;
  const hx2 = cut.corner === "tr" || cut.corner === "br" ? right : cut.right;
  const vy1 = cut.corner === "bl" || cut.corner === "br" ? cut.y : top;
  const vy2 = cut.corner === "bl" || cut.corner === "br" ? bottom : cut.bottom;
  return [
    { x1: hx1, y1: horizontalY, x2: hx2, y2: horizontalY, tx: (hx1 + hx2) / 2, ty: horizontalTextY, label: `${Math.round(cut.width)} mm` },
    { x1: verticalX, y1: vy1, x2: verticalX, y2: vy2, tx: verticalTextX, ty: (vy1 + vy2) / 2, rotate: `rotate(90 ${verticalTextX} ${(vy1 + vy2) / 2})`, label: `${Math.round(cut.height)} mm` }
  ];
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
    label: `${Math.round(Math.abs(x2 - x1))}مم`
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
    label: `${Math.round(Math.abs(y2 - y1))}مم`
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
  const hasEditedOutline = points.length > 4 || points.some((point) => !point.corner || outlinePointMode(point) !== "free");
  if (!hasEditedOutline) return [];
  const center = { x: numberValue(baseGeometry.x) + numberValue(baseGeometry.width) / 2, y: numberValue(baseGeometry.y) + numberValue(baseGeometry.height) / 2 };
  return outlinePathSegments(points)
    .map((segment) => {
      const x1 = numberValue(segment.start.x);
      const y1 = numberValue(segment.start.y);
      const x2 = numberValue(segment.end.x);
      const y2 = numberValue(segment.end.y);
      const length = approximateSegmentLength(segment);
      if (length < 20) return null;
      const midPoint = segment.kind === "quad"
        ? quadraticPoint(segment.start, segment.control, segment.end, 0.5)
        : segment.kind === "arc"
          ? arcPoint(segment, 0.5)
          : { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
      const arcBefore = segment.kind === "arc" ? arcPoint(segment, 0.48) : null;
      const arcAfter = segment.kind === "arc" ? arcPoint(segment, 0.52) : null;
      const tangent = segment.kind === "quad"
        ? quadraticTangent(segment.start, segment.control, segment.end, 0.5)
        : segment.kind === "arc"
          ? { x: arcAfter.x - arcBefore.x, y: arcAfter.y - arcBefore.y }
          : { x: x2 - x1, y: y2 - y1 };
      const tangentLength = Math.max(1, Math.hypot(tangent.x, tangent.y));
      const angle = Math.atan2(tangent.y, tangent.x) * 180 / Math.PI;
      let nx = -tangent.y / tangentLength;
      let ny = tangent.x / tangentLength;
      const midX = midPoint.x;
      const midY = midPoint.y;
      if ((midX + nx * 40 - center.x) ** 2 + (midY + ny * 40 - center.y) ** 2 < (midX - nx * 40 - center.x) ** 2 + (midY - ny * 40 - center.y) ** 2) {
        nx *= -1;
        ny *= -1;
      }
      return {
        path: segmentPathD(segment),
        x1,
        y1,
        x2,
        y2,
        tx: midX + nx * 34,
        ty: midY + ny * 34,
        label: `${Math.round(length)}مم`,
        rotate: Math.abs(angle) > 8 && Math.abs(angle) < 172 ? `rotate(${angle} ${midX + nx * 34} ${midY + ny * 34})` : ""
      };
    })
    .filter(Boolean);
}

function curveDepthItems(points = [], baseGeometry) {
  return outlinePathSegments(points)
    .filter((segment) => segment.kind === "quad" || segment.kind === "arc")
    .map((segment) => {
      const sx = numberValue(segment.start.x);
      const sy = numberValue(segment.start.y);
      const ex = numberValue(segment.end.x);
      const ey = numberValue(segment.end.y);
      const dx = ex - sx;
      const dy = ey - sy;
      const chordLength = Math.max(1, Math.hypot(dx, dy));
      let best = null;
      for (let step = 1; step < 32; step += 1) {
        const point = quadraticPoint(segment.start, segment.control, segment.end, step / 32);
        const along = ((point.x - sx) * dx + (point.y - sy) * dy) / (chordLength * chordLength);
        const projection = {
          x: sx + dx * Math.max(0, Math.min(1, along)),
          y: sy + dy * Math.max(0, Math.min(1, along))
        };
        const distance = Math.hypot(point.x - projection.x, point.y - projection.y);
        if (!best || distance > best.distance) best = { point, projection, distance };
      }
      if (!best) return null;
      return {
        x1: best.projection.x,
        y1: best.projection.y,
        x2: best.point.x,
        y2: best.point.y,
        tx: (best.projection.x + best.point.x) / 2 + 18,
        ty: (best.projection.y + best.point.y) / 2 - 18,
        distance: best.distance,
        label: `${segment.kind === "arc" ? "ارتفاع القوس" : "ارتفاع المنحنى"} ${Math.round(best.distance)}مم`
      };
    })
    .filter((item) => item && item.distance > 1);
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
  if (rowHasPanels(row)) {
    return rowDrawingPanels(row).flatMap((panel, panelIndex) => {
      const panelDrawing = normalizePanelDrawingData(panel.drawing);
      const panelGeometry = { x: 0, y: 0, width: numberValue(panel.width), height: numberValue(panel.height) };
      const outlinePoints = visualOutlinePointsForDrawing(panelDrawing, panelGeometry);
      const bounds = boundsFromOutline(outlinePoints, panelGeometry);
      const label = panelDisplayName(panel, panelIndex);
      const prefix = `Panel ${label}`;
      const notes = [`${prefix}: ${Math.round(numberValue(panel.width))}مم × ${Math.round(numberValue(panel.height))}مم${panel.notes ? ` - ${panel.notes}` : ""}`];
      notes.push(...outlineChangeDescriptions(outlinePoints, panelGeometry).map((note) => `${prefix}: ${note}`));
      for (const shape of panelDrawing.shapes || []) {
        if (shape.kind === "circle") {
          const ref = measurementReference(shape, bounds, outlinePoints);
          notes.push(`${prefix}: ثقب ${engineeringDiameterLabel(shape)} على بعد ${Math.round(ref.horizontalDistance)}مم من ${ref.horizontalSide} و ${Math.round(ref.verticalDistance)}مم من ${ref.verticalSide}`);
        } else if (shape.kind === "rect") {
          const ref = measurementReference(shape, bounds, outlinePoints);
          const cornerCut = cornerCutInfo(shape, bounds);
          const notchInfo = cornerCut ? null : edgeCutInfo(shape, bounds);
          if (cornerCut) {
            notes.push(`${prefix}: قص ركن ${Math.round(cornerCut.width)}مم × ${Math.round(cornerCut.height)}مم`);
          } else if (notchInfo) {
            notes.push(`${prefix}: قص حافة من ${notchInfo.label}: طول الفتحة ${notchInfo.width}مم، العمق إلى الداخل ${notchInfo.depth}مم`);
          } else {
            notes.push(`${prefix}: مستطيل ${Math.round(numberValue(shape.w))}مم × ${Math.round(numberValue(shape.h))}مم على بعد ${Math.round(ref.horizontalDistance)}مم من ${ref.horizontalSide} و ${Math.round(ref.verticalDistance)}مم من ${ref.verticalSide}`);
          }
        } else if (shape.kind === "arrow") {
          notes.push(`${prefix}: سهم قياس ${Math.round(Math.hypot(numberValue(shape.x2) - numberValue(shape.x1), numberValue(shape.y2) - numberValue(shape.y1)))}مم${shape.text ? ` - ${shape.text}` : ""}`);
        } else if (shape.kind === "text" && shape.text) {
          notes.push(`${prefix}: ${shape.text}`);
        }
      }
      return notes;
    });
  }
  const drawing = normalizeDrawing(row?.drawing);
  const baseGeometry = rowBaseGeometry(row);
  const outlinePoints = visualOutlinePointsForDrawing(drawing, baseGeometry);
  const bounds = boundsFromOutline(outlinePoints, baseGeometry);
  const notes = outlineChangeDescriptions(outlinePoints, baseGeometry);
  for (const shape of drawing.shapes || []) {
    if (shape.kind === "circle") {
      const ref = measurementReference(shape, bounds, outlinePoints);
      notes.push(`ثقب ${engineeringDiameterLabel(shape)} على بعد ${Math.round(ref.horizontalDistance)}مم من ${ref.horizontalSide} و ${Math.round(ref.verticalDistance)}مم من ${ref.verticalSide}`);
    } else if (shape.kind === "rect") {
      const ref = measurementReference(shape, bounds, outlinePoints);
      const cornerCut = cornerCutInfo(shape, bounds);
      const notchInfo = cornerCut ? null : edgeCutInfo(shape, bounds);
      if (cornerCut) {
        notes.push(`قص ركن ${Math.round(cornerCut.width)}مم × ${Math.round(cornerCut.height)}مم`);
      } else if (notchInfo) {
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
  return true;
}

function drawingHasContent(drawing) {
  const normalized = normalizeDrawing(drawing);
  return (
    normalized.panels.length > 0 ||
    normalized.shapes.length > 0 ||
    normalized.paths.length > 0 ||
    normalized.outline.points.length >= 4 ||
    Object.values(normalized.edges).some((value) => numberValue(value) !== 0)
  );
}

function drawingOutlineSummary(drawing) {
  const normalized = normalizeDrawing(drawing);
  if (normalized.panels.length) {
    return normalized.panels.map((panel, index) => `${panelDisplayName(panel, index)}: ${Math.round(numberValue(panel.width))}مم × ${Math.round(numberValue(panel.height))}مم`).join(" | ");
  }
  if (normalized.outline.points.length >= 4) {
    return normalized.outline.points.map((point, index) => {
      const mode = outlinePointMode(point);
      const modeText = mode === "arc" ? " قوس" : mode === "curve" ? " منحنى" : "";
      const depth = mode === "arc" || mode === "curve" ? ` / عمق ${Math.round(numberValue(point.halfDiameter))}مم` : "";
      return `نقطة ${index + 1}${modeText}: أفقي ${Math.round(numberValue(point.x))}مم / رأسي ${Math.round(numberValue(point.y))}مم${depth}`;
    }).join(" | ");
  }
  if (Object.values(normalized.edges).some((value) => numberValue(value) !== 0)) {
    return `أعلى ${normalized.edges.top || 0}مم / يمين ${normalized.edges.right || 0}مم / أسفل ${normalized.edges.bottom || 0}مم / يسار ${normalized.edges.left || 0}مم`;
  }
  return "مستطيل افتراضي";
}

function drawingShapeSummary(shape) {
  if (shape.kind === "circle") {
    return `ثقب ${engineeringDiameterLabel(shape)}`;
  }
  if (shape.kind === "rect") {
    return `قص/بروز مستطيل ${Math.round(numberValue(shape.w))}مم × ${Math.round(numberValue(shape.h))}مم`;
  }
  if (shape.kind === "arrow") {
    return `سهم قياس ${Math.round(Math.hypot(numberValue(shape.x2) - numberValue(shape.x1), numberValue(shape.y2) - numberValue(shape.y1)))}مم`;
  }
  return `ملاحظة: ${shape.text || "ملاحظة"}`;
}

function layerFollowsBase(layer, base, field) {
  const flag = field === "width" ? layer.followBaseWidth : layer.followBaseHeight;
  if (flag === false) return false;
  if (flag === true) return true;
  return numberValue(layer[field]) === numberValue(base[field]);
}

function normalizeLayers(mode, current) {
  const count = mode === "single" ? 1 : 2;
  const next = [...(current || [])].map((layer) => makeLayer(layer));
  const base = next[0] || makeLayer();
  while (next.length < count) {
    next.push(makeLayer({
      glassType: base.glassType,
      company: base.company,
      thickness: base.thickness,
      unitPrice: base.unitPrice,
      supplierUnitPrice: base.supplierUnitPrice,
      secure: base.secure,
      color: base.color,
      alpha: base.alpha,
      mirror: base.mirror,
      width: base.width,
      height: base.height,
      followBaseWidth: true,
      followBaseHeight: true
    }));
  }
  return next.slice(0, count).map((layer, index) => {
    if (index === 0) return { ...layer, followBaseWidth: false, followBaseHeight: false };
    const followWidth = layerFollowsBase(layer, base, "width");
    const followHeight = layerFollowsBase(layer, base, "height");
    return {
      ...layer,
      width: followWidth ? base.width : layer.width,
      height: followHeight ? base.height : layer.height,
      followBaseWidth: followWidth,
      followBaseHeight: followHeight
    };
  });
}

function layerText(layer, { includeCompany = true } = {}) {
  return [
    cleanName(layer.glassType),
    normalizeThicknessText(layer.thickness || ""),
    layer.secure ? "سيكوريت" : "",
    includeCompany ? cleanName(layer.company) : ""
  ].filter(Boolean).join(" ");
}

function rowDescription(row) {
  const notes = cleanName(row.notes);
  const suffix = notes ? ` (${notes})` : "";
  if (row.glassMode === "single") return cleanName(`زجاج سنجل ${layerText(row.layers[0] || {})}${suffix}`);
  if (row.glassMode === "double") return cleanName(`زجاج دبل ${layerText(row.layers[0] || {})} - ${row.doubleGap || ""} - ${layerText(row.layers[1] || {})}${suffix}`);
  return cleanName(`زجاج تريبلكس ${layerText(row.layers[0] || {})} - ${layerText(row.layers[1] || {})} - ${row.triplexPvb || ""}${suffix}`);
}

function rowDescriptionWithoutManufacturer(row) {
  const notes = cleanName(row.notes);
  const suffix = notes ? ` (${notes})` : "";
  if (row.glassMode === "single") return cleanName(`زجاج سنجل ${layerText(row.layers[0] || {}, { includeCompany: false })}${suffix}`);
  if (row.glassMode === "double") return cleanName(`زجاج دبل ${layerText(row.layers[0] || {}, { includeCompany: false })} - ${row.doubleGap || ""} - ${layerText(row.layers[1] || {}, { includeCompany: false })}${suffix}`);
  return cleanName(`زجاج تريبلكس ${layerText(row.layers[0] || {}, { includeCompany: false })} - ${layerText(row.layers[1] || {}, { includeCompany: false })} - ${row.triplexPvb || ""}${suffix}`);
}

function rowArea(row) {
  if (rowHasPanels(row)) return rowPanelArea(row);
  const layers = row.layers?.length ? row.layers : [makeLayer()];
  const widest = Math.max(0, ...layers.map((layer) => numberValue(layer.width)));
  const tallest = Math.max(0, ...layers.map((layer) => numberValue(layer.height)));
  return (widest * tallest * numberValue(row.quantity, 1)) / 10000;
}

function rowTotals(row) {
  const area = rowArea(row);
  if (rowHasPanels(row)) {
    const layer = row.layers?.[0] || makeLayer();
    const layerSale = area * numberValue(layer.unitPrice, numberValue(row.unitPrice));
    const layerCost = area * numberValue(layer.supplierUnitPrice, numberValue(row.supplierUnitPrice));
    return {
      area,
      spacerMeters: 0,
      pvbArea: 0,
      materialQuantity: 0,
      layerSale,
      layerCost,
      materialSale: 0,
      materialCost: 0,
      total: layerSale,
      supplierCost: layerCost
    };
  }
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
  const [first] = row.layers;
  return row.layers.some((layer, index) => index > 0 && (
    numberValue(layer.width) !== numberValue(first.width) ||
    numberValue(layer.height) !== numberValue(first.height)
  ));
}

function shouldSplitLayersInOrderReport(row = {}) {
  const mode = row.glassMode || "single";
  return ["double", "triplex"].includes(mode) && rowHasLayerSizeDifference(row);
}

function orderReportLayerDescription(layer, layerIndex) {
  const names = ["الأولى", "الثانية", "الثالثة"];
  const glassType = cleanName(layer.glassType);
  const glassLabel = glassType && glassType.startsWith("زجاج") ? glassType : cleanName(`زجاج ${glassType}`);
  return cleanName(`الطبقة ${names[layerIndex] || layerIndex + 1}: ${glassLabel} ${normalizeThicknessText(layer.thickness || "")} ${layer.secure ? "سيكوريت" : ""} ${cleanName(layer.company)}`);
}

function orderReportLineItems(row = {}, index = 0) {
  const rowNumber = index + 1;
  const layers = row.layers?.length ? row.layers : [makeLayer()];
  const pieceCount = rowHasPanels(row) ? rowPanelPhysicalCount(row) : databaseNumber(row.quantity, 1);
  const totals = rowTotals(row);
  const rootDescription = rowDescription(row);
  if (!shouldSplitLayersInOrderReport({ ...row, layers })) {
    return [{
      key: row.id || `row-${rowNumber}`,
      rowNumber,
      split: false,
      description: rootDescription,
      layerDescription: "",
      code: row.code || "-",
      width: rowHasPanels(row) ? Number(rowMaxWidthCm(row).toFixed(1)) : Math.max(...layers.map((layer) => numberValue(layer.width))),
      height: rowHasPanels(row) ? Number(rowMaxHeightCm(row).toFixed(1)) : Math.max(...layers.map((layer) => numberValue(layer.height))),
      quantity: pieceCount,
      area: totals.area
    }];
  }
  return layers.map((layer, layerIndex) => ({
    key: `${row.id || `row-${rowNumber}`}-layer-${layerIndex + 1}`,
    rowNumber,
    split: true,
    description: rootDescription,
    layerDescription: orderReportLayerDescription(layer, layerIndex),
    code: row.code || "-",
    width: numberValue(layer.width),
    height: numberValue(layer.height),
    quantity: pieceCount,
    area: layerAreaM2(layer, pieceCount)
  }));
}

function orderTotals(order) {
  return activeOrderRows(order.rows || []).reduce(
    (sum, row) => {
      const totals = rowTotals(row);
      sum.area += totals.area;
      sum.pieces += rowPanelPhysicalCount(row);
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
  const date = overrides.issue_date || overrides.issueDate || overrides.order_date || overrides.date || today();
  const entryAt = Object.prototype.hasOwnProperty.call(overrides, "entryAt")
    ? overrides.entryAt
    : (!overrides.id ? new Date().toISOString() : "");
  const clientDocumentId = overrides.clientDocumentId || overrides.client_document_id || overrides.id || uid();
  const rows = overrides.rows?.length ? overrides.rows.map(makeRow) : [makeRow()];
  const originalRowIds = Array.isArray(overrides.originalRowIds)
    ? overrides.originalRowIds.map(String)
    : (overrides.id ? rows.map((row) => String(row.id || "")).filter(Boolean) : []);
  return {
    id: overrides.id || "",
    clientDocumentId,
    orderNo: overrides.orderNo || generateOrderNo([], date),
    documentId: overrides.documentId || "",
    date,
    entryAt,
    status: normalizeOrderStatus(overrides.status || "ordered"),
    collectedPieces: numberValue(overrides.collectedPieces),
    entryMode: overrides.entryMode || "normal",
    customerId: overrides.customerId || overrides.customer_id || "",
    customerName: overrides.customerName || "",
    supplierId: overrides.supplierId || overrides.supplier_id || "",
    supplierName: overrides.supplierName || "",
    project: overrides.project || "",
    code: overrides.code || "",
    notes: overrides.notes || "",
    originalRowIds,
    deletedRowIds: Array.isArray(overrides.deletedRowIds) ? overrides.deletedRowIds.map(String) : [],
    rows
  };
}

const envSupabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const envSupabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
const LOCAL_SESSION_TOKEN_KEY = "glassOrdersLocalSessionToken";
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

function plainClone(value) {
  try {
    return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value || {}));
  } catch {
    return JSON.parse(JSON.stringify(value || {}));
  }
}

function orderSaveSnapshot(order = {}) {
  const cloned = plainClone(order);
  return {
    ...cloned,
    id: cleanName(cloned.id),
    clientDocumentId: cleanName(cloned.clientDocumentId || cloned.client_document_id),
    orderNo: cleanName(cloned.orderNo),
    documentId: cleanName(cloned.documentId),
    date: cloned.date || today(),
    entryAt: cloned.entryAt || "",
    status: normalizeOrderStatus(cloned.status || "ordered"),
    collectedPieces: databaseNumber(cloned.collectedPieces, 0),
    entryMode: cloned.entryMode || "normal",
    customerId: cleanName(cloned.customerId || cloned.customer_id),
    customerName: cleanName(cloned.customerName),
    supplierId: cleanName(cloned.supplierId || cloned.supplier_id),
    supplierName: cleanName(cloned.supplierName),
    project: cleanName(cloned.project),
    code: cleanName(cloned.code),
    notes: cloned.notes || "",
    originalRowIds: Array.isArray(cloned.originalRowIds) ? cloned.originalRowIds.map(String) : [],
    deletedRowIds: Array.isArray(cloned.deletedRowIds) ? cloned.deletedRowIds.map(String) : [],
    rows: activeOrderRows(cloned.rows || [])
  };
}

function persistSaveRecoveryDraft(order) {
  try {
    localStorage.setItem(SAVE_RECOVERY_DRAFT_KEY, JSON.stringify({
      savedAt: new Date().toISOString(),
      order: orderSaveSnapshot(order)
    }));
  } catch {
    // Recovery is best-effort; saving must continue if localStorage is unavailable.
  }
}

function clearSaveRecoveryDraft() {
  try {
    localStorage.removeItem(SAVE_RECOVERY_DRAFT_KEY);
  } catch {
    // Ignore localStorage cleanup failures.
  }
}

function readSaveRecoveryDraft() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVE_RECOVERY_DRAFT_KEY) || "null");
    if (!parsed?.order) return null;
    return { ...parsed, order: orderSaveSnapshot(parsed.order) };
  } catch {
    return null;
  }
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

function normalizePublicBotSettings(settings = {}) {
  return {
    ...DEFAULT_PUBLIC_BOT_SETTINGS,
    enabled: settings.enabled === true,
    openAtLogin: settings.openAtLogin === true,
    startHiddenAtLogin: settings.startHiddenAtLogin !== false,
    canOpenAtLogin: settings.canOpenAtLogin === true,
    hasBotToken: settings.hasBotToken === true,
    hasSupabaseSession: settings.hasSupabaseSession === true
  };
}

function telegramBotStateLabel(status = {}) {
  const state = status.state || (status.running ? "running" : "stopped");
  return ({
    starting: "البوت يبدأ التشغيل",
    running: "البوت يعمل الآن",
    reconnecting: "البوت يعيد الاتصال",
    waiting_for_session: "البوت ينتظر تسجيل الدخول",
    failed: "فشل تشغيل البوت",
    stopped: "البوت متوقف"
  })[state] || "البوت متوقف";
}

function readBrowserBotSettings() {
  try {
    return normalizePublicBotSettings(JSON.parse(localStorage.getItem(TELEGRAM_BOT_SETTINGS_KEY) || "{}"));
  } catch {
    return { ...DEFAULT_PUBLIC_BOT_SETTINGS };
  }
}

function saveBrowserBotSettings(patch = {}) {
  const next = normalizePublicBotSettings({ ...readBrowserBotSettings(), ...patch });
  localStorage.setItem(TELEGRAM_BOT_SETTINGS_KEY, JSON.stringify(next));
  return next;
}

function supabaseProjectRef(url = supabaseConfig().url) {
  return String(url || "").match(/^https:\/\/([a-z0-9-]+)\.supabase\.co$/i)?.[1] || "";
}

function supabaseAuthStorageKey(url = supabaseConfig().url) {
  const projectRef = supabaseProjectRef(url) || "custom";
  return `glass-orders-supabase-auth-${projectRef}-v2`;
}

function clearSupabaseAuthStorage(url = supabaseConfig().url) {
  const projectRef = supabaseProjectRef(url);
  const exactKeys = new Set([
    "supabase.auth.token",
    projectRef ? `sb-${projectRef}-auth-token` : "",
    supabaseAuthStorageKey(url)
  ].filter(Boolean));
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index) || "";
    if (exactKeys.has(key) || key.startsWith("glass-orders-supabase-auth-")) {
      localStorage.removeItem(key);
    }
  }
}

function isSupabaseSessionError(error) {
  const text = String(error?.message || error?.code || error || "");
  return /jwt|token|session|refresh_token|refresh token|unauthorized|forbidden|401|403|PGRST301/i.test(text);
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
        detectSessionInUrl: !window.glassOrdersDesktop,
        storageKey: supabaseAuthStorageKey(url)
      }
    })
  };
  return supabaseClientCache.client;
}

async function currentTelegramSupabaseSession() {
  const config = supabaseConfig();
  const client = getSupabaseClient();
  if (!client || !hasSupabaseConfig()) throw new Error("الاتصال غير متاح.");
  const result = await client.auth.getSession();
  if (result.error) throw result.error;
  const session = result.data?.session;
  if (!session?.access_token || !session?.refresh_token) {
    throw new Error("انتهى تسجيل الدخول. سجل الدخول مرة أخرى.");
  }
  return {
    supabaseUrl: config.url,
    supabaseKey: config.key,
    accessToken: session.access_token,
    refreshToken: session.refresh_token
  };
}

async function syncDesktopTelegramSession(active = true) {
  if (!window.glassOrdersDesktop?.syncTelegramBotSession) return null;
  if (!active) return window.glassOrdersDesktop.syncTelegramBotSession({});
  return window.glassOrdersDesktop.syncTelegramBotSession(await currentTelegramSupabaseSession());
}

function resetSupabaseClientCache() {
  supabaseClientCache = { url: "", key: "", client: null };
}

function isLocalWebOrigin() {
  const host = window.location.hostname;
  return !host || host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function localServerAllowed() {
  return !!window.glassOrdersDesktop;
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
  if (window.glassOrdersDesktop?.authRecoveryRedirectUrl === DESKTOP_AUTH_RECOVERY_REDIRECT_URL) {
    return { redirectTo: DESKTOP_AUTH_RECOVERY_REDIRECT_URL };
  }
  const configured = (() => {
    try {
      const parsed = new URL(supabaseConfig().redirectUrl || "");
      return ["https:", "http:"].includes(parsed.protocol) ? parsed.toString() : "";
    } catch {
      return "";
    }
  })();
  const fallback = window.location.origin?.startsWith("http") ? window.location.origin : "";
  const redirectTo = configured || fallback;
  return redirectTo ? { redirectTo } : undefined;
}

async function clearSupabaseRecoverySession(setRecoveryOpen, setCurrentUser) {
  const client = getSupabaseClient();
  let signOutPromise = Promise.resolve();
  try {
    signOutPromise = Promise.resolve(client?.auth?.signOut?.({ scope: "local" })).catch(() => null);
  } catch {
    // Continue with mandatory local cleanup.
  }
  try {
    clearSupabaseAuthStorage();
    localStorage.removeItem("glassOrdersUser");
  } catch {
    // Continue clearing in-memory state when storage is unavailable.
  }
  resetSupabaseClientCache();
  setCurrentUser(null);
  setRecoveryOpen(false);
  await signOutPromise;
}

function useDesktopPasswordRecovery(setRecoveryOpen, setMessage, setCurrentUser) {
  useEffect(() => {
    const desktop = window.glassOrdersDesktop;
    if (!desktop?.consumeAuthRecoveryUrl || !desktop?.onAuthRecoveryUrl) return undefined;
    let active = true;
    let processing = Promise.resolve();

    function processCallback(callbackUrl) {
      if (!callbackUrl) return;
      processing = processing.then(async () => {
        if (!active) return;
        try {
          const client = getSupabaseClient();
          if (!client || !hasSupabaseConfig()) throw new Error("الاتصال غير متاح.");
          await establishSupabaseRecoverySession(client, callbackUrl);
          if (!active) return;
          localStorage.removeItem("glassOrdersUser");
          setDataSourceMode("supabase");
          setCurrentUser(null);
          setRecoveryOpen(true);
          setMessage("تم التحقق من رابط الاستعادة. أدخل كلمة مرور جديدة.");
        } catch (error) {
          if (active) setMessage(`تعذر فتح رابط الاستعادة: ${safeErrorMessage(error)}`);
        }
      });
    }

    const unsubscribe = desktop.onAuthRecoveryUrl(processCallback);
    Promise.resolve(desktop.consumeAuthRecoveryUrl())
      .then(processCallback)
      .catch(() => {
        if (active) setMessage("تعذر قراءة رابط استعادة كلمة المرور.");
      });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [setRecoveryOpen, setMessage, setCurrentUser]);
}

function normalizeVersionText(value = "") {
  const match = String(value || "").match(/v?\s*(\d+(?:\.\d+){0,2})/i);
  if (!match) return "";
  return match[1].split(".").concat(["0", "0"]).slice(0, 3).join(".");
}

function compareVersions(a, b) {
  const left = normalizeVersionText(a).split(".").map((value) => numberValue(value));
  const right = normalizeVersionText(b).split(".").map((value) => numberValue(value));
  for (let index = 0; index < 3; index += 1) {
    if ((left[index] || 0) > (right[index] || 0)) return 1;
    if ((left[index] || 0) < (right[index] || 0)) return -1;
  }
  return 0;
}

function currentUpdatePlatform() {
  const capacitorPlatform = window.Capacitor?.getPlatform?.();
  if (capacitorPlatform === "android" || /Android/i.test(navigator.userAgent || "")) return "android";
  if (window.glassOrdersDesktop || window.glassOrdersDesktop?.platform === "win32" || /Windows/i.test(navigator.userAgent || "")) return "windows";
  return "windows";
}

const UPDATE_TARGETS = {
  android: { label: "ملف APK للأندرويد", extensions: [".apk"] },
  windows: { label: "ملف EXE لويندوز", extensions: [".exe"] }
};

function releaseAssets(release) {
  return Array.isArray(release?.assets) ? release.assets : [];
}

function releaseAssetName(asset) {
  const rawName = asset?.name || (() => {
    try {
      return new URL(asset?.browser_download_url || "").pathname.split("/").pop();
    } catch {
      return "";
    }
  })();
  try {
    return decodeURIComponent(String(rawName || ""));
  } catch {
    return String(rawName || "");
  }
}

function releaseAssetUrl(asset) {
  return asset?.browser_download_url || "";
}

function assetMatchesExtensions(asset, extensions) {
  const name = releaseAssetName(asset).toLowerCase();
  if (!releaseAssetUrl(asset) || name.endsWith(".blockmap")) return false;
  return extensions.some((extension) => name.endsWith(extension));
}

function selectReleaseDownload(release) {
  const platform = currentUpdatePlatform();
  const target = UPDATE_TARGETS[platform] || UPDATE_TARGETS.windows;
  const assets = releaseAssets(release);
  const matchedAsset = assets.find((asset) => assetMatchesExtensions(asset, target.extensions));
  if (matchedAsset) {
    return {
      platform,
      label: target.label,
      url: releaseAssetUrl(matchedAsset),
      fileName: releaseAssetName(matchedAsset),
      isDirectDownload: true
    };
  }
  return {
    platform,
    label: "صفحة الإصدارات",
    url: release?.html_url || RELEASES_URL,
    fileName: "",
    isDirectDownload: false
  };
}

function releaseUpdateInfo(release, latestVersion) {
  const download = selectReleaseDownload(release);
  return {
    release,
    latestVersion,
    releaseLabel: release?.tag_name || `v${latestVersion}`,
    releaseUrl: release?.html_url || RELEASES_URL,
    downloadUrl: download.url || release?.html_url || RELEASES_URL,
    downloadLabel: download.label,
    downloadFileName: download.fileName,
    isDirectDownload: download.isDirectDownload,
    platform: download.platform
  };
}

function updateActionLabel(updateInfo) {
  if (!updateInfo) return "الإصدارات";
  return updateInfo.isDirectDownload ? `تحميل ${updateInfo.downloadLabel}` : "فتح صفحة الإصدارات";
}

async function latestGitHubRelease() {
  const response = await fetch(GITHUB_LATEST_RELEASE_API, {
    headers: { Accept: "application/vnd.github+json" },
    cache: "no-store"
  });
  if (response.ok) return response.json();
  if (response.status === 404) {
    const listResponse = await fetch(GITHUB_RELEASES_API, {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-store"
    });
    if (listResponse.ok) {
      const releases = await listResponse.json();
      return Array.isArray(releases) ? releases.find((release) => !release.draft) || null : null;
    }
  }
  {
    const errorText = await response.text().catch(() => "");
    throw new Error(errorText || `GitHub HTTP ${response.status}`);
  }
}

function externalUpdateUrl(url = RELEASES_URL) {
  try {
    const parsed = new URL(String(url || RELEASES_URL), RELEASES_URL);
    return ["https:", "http:"].includes(parsed.protocol) ? parsed.toString() : RELEASES_URL;
  } catch {
    return RELEASES_URL;
  }
}

function openReleasePage(url = RELEASES_URL) {
  const targetUrl = externalUpdateUrl(url);
  if (window.glassOrdersDesktop?.openExternal) {
    window.glassOrdersDesktop.openExternal(targetUrl).catch(() => window.open(targetUrl, "_blank", "noopener,noreferrer"));
    return;
  }
  const opened = window.open(targetUrl, "_blank", "noopener,noreferrer");
  if (!opened && currentUpdatePlatform() === "android") window.location.href = targetUrl;
}

async function showUpdateNotification(title, body, url) {
  try {
    const desktopResult = await window.glassOrdersDesktop?.showNotification?.({ title, body, url: externalUpdateUrl(url) });
    if (desktopResult?.ok) return;
    if (!("Notification" in window)) return;
    let permission = Notification.permission;
    if (permission === "default") return;
    if (permission !== "granted") return;
    const notification = new Notification(title, { body, icon: appLogo });
    notification.onclick = () => openReleasePage(url);
  } catch {
    // Browser/Electron notification support is best-effort.
  }
}

async function localRequest(path, options = {}, timeoutMs = 3500) {
  if (!localServerAllowed()) {
    throw new Error("الخادم المحلي متاح فقط داخل نسخة سطح المكتب أو localhost.");
  }
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  const sessionToken = sessionStorage.getItem(LOCAL_SESSION_TOKEN_KEY) || "";
  try {
    const response = await fetch(`${localApiBase()}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        ...(options.headers || {})
      }
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const error = new Error(payload.error || `HTTP ${response.status}`);
      error.code = payload.code || "";
      error.fields = Array.isArray(payload.fields) ? payload.fields : [];
      error.status = response.status;
      throw error;
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

function dataWithoutSupplierCosts(data = {}) {
  return {
    ...data,
    orders: (data.orders || []).map((order) => ({
      ...order,
      supplierCost: 0,
      supplier_cost: 0,
      totals: order.totals && typeof order.totals === "object"
        ? { ...order.totals, supplierCost: 0, supplier_cost: 0 }
        : order.totals,
      rows: (order.rows || []).map((row) => ({
        ...row,
        supplierUnitPrice: 0,
        supplier_unit_price: 0,
        supplierMaterialUnitPrice: 0,
        supplier_material_unit_price: 0,
        supplierCost: 0,
        supplier_cost: 0,
        layers: (row.layers || []).map((layer) => ({
          ...layer,
          supplierUnitPrice: 0,
          supplier_unit_price: 0
        }))
      }))
    }))
  };
}

function sanitizeLocalCostCachesForUser(user) {
  if (canCurrentUserViewCosts(user)) return;
  for (const key of ["glassOrdersData", OFFLINE_SNAPSHOT_KEY]) {
    try {
      const cached = JSON.parse(localStorage.getItem(key) || "null");
      if (cached && typeof cached === "object") {
        localStorage.setItem(key, JSON.stringify(dataWithoutSupplierCosts(cached)));
      }
    } catch {
      localStorage.removeItem(key);
    }
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

function offlineOperationKey(operation = {}) {
  if (operation.type?.startsWith("order-")) {
    return `order:${operation.orderNo || operation.order?.orderNo || operation.orderId || operation.order?.id || ""}`;
  }
  if (operation.type?.startsWith("payment-")) {
    return `payment:${operation.paymentId || operation.payment?.id || ""}`;
  }
  return `${operation.type || "unknown"}:${operation.id || ""}`;
}

function queueOfflineOperation(operation) {
  const queue = readOfflineQueue();
  const key = offlineOperationKey(operation);
  const previous = queue.find((item) => offlineOperationKey(item) === key);
  const mergedOperation = operation.type === "order-status-patch" && previous?.type === "order-upsert"
    ? { ...previous, order: operation.order }
    : operation.type === "order-status-patch" && previous?.type === "order-status-patch"
      ? {
        ...operation,
        rowsChanged: operation.rowsChanged === true || previous.rowsChanged === true,
        changedRowIds: [...new Set([
          ...(previous.changedRowIds || []),
          ...(operation.changedRowIds || [])
        ].map((id) => String(id)))]
      }
      : operation;
  const next = [
    ...queue.filter((item) => offlineOperationKey(item) !== key),
    { ...mergedOperation, id: uid(), queuedAt: new Date().toISOString(), attempts: 0 }
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

function deleteOfflineOrder(data, order) {
  const orders = (data.orders || []).filter((item) => item.id !== order.id && item.orderNo !== order.orderNo);
  const next = { ...data, source: "offline", orders, offlinePending: true };
  writeLocal(next);
  writeOfflineSnapshot(next);
  return next;
}

function mergeSavedOrderData(data, savedOrder) {
  const nextOrder = createDraft({ ...savedOrder, _existingOrder: true });
  const orders = [...(data.orders || [])];
  const index = orders.findIndex((item) => sameOrderIdentity(item, nextOrder));
  if (index >= 0) orders[index] = nextOrder;
  else orders.unshift(nextOrder);
  return {
    ...data,
    orders,
    customers: upsertLocalParty(data.customers || [], nextOrder.customerName),
    suppliers: upsertLocalParty(data.suppliers || [], nextOrder.supplierName),
    learnedOptions: learnGap(data.learnedOptions, nextOrder)
  };
}

function removeSavedOrderData(data, order) {
  return {
    ...data,
    orders: (data.orders || []).filter((item) => !sameOrderIdentity(item, order))
  };
}

function mergeOrderStatusPatchData(data, order) {
  const orders = (data.orders || []).map((item) => sameOrderIdentity(item, order) ? order : item);
  if (!orders.some((item) => sameOrderIdentity(item, order))) orders.unshift(order);
  return { ...data, orders };
}

function refreshPreviewWithData(preview, nextData) {
  if (!preview || !nextData) return preview || null;
  if (preview.type === "order") {
    return {
      ...preview,
      order: findMatchingOrder(nextData.orders || [], preview.order) || preview.order
    };
  }
  if (preview.type === "statement") {
    const statement = preview.statement || {};
    return {
      ...preview,
      statement: buildGlassStatement(
        nextData.orders || [],
        statement.period || "month",
        statement.selectedYear,
        statement.selectedMonth
      )
    };
  }
  if (preview.type === "supplier") {
    const statement = preview.statement || {};
    const selectedOrderIds = statement.selectedOrderIds?.length
      ? statement.selectedOrderIds
      : (statement.orders || []).map((order) => order.orderId).filter(Boolean);
    return {
      ...preview,
      statement: buildAppSupplierStatement({
        supplier: statement.supplier,
        orders: nextData.orders || [],
        payments: nextData.payments || [],
        mode: statement.mode,
        fromDate: statement.fromDate,
        toDate: statement.toDate,
        selectedOrderIds
      })
    };
  }
  if (preview.type === "orderStatus") {
    const report = preview.report || {};
    const scopedOrderIds = new Set(
      (report.rows || []).flatMap((row) => [
        cleanName(row.orderId),
        cleanName(row.sourceOrder?.id),
        cleanName(row.sourceOrder?.orderNo)
      ]).filter(Boolean)
    );
    const scopedOrders = (nextData.orders || []).filter((order) => (
      scopedOrderIds.has(cleanName(order.id))
      || scopedOrderIds.has(cleanName(order.orderNo))
    ));
    return {
      ...preview,
      report: buildOrderStatusReport(
        scopedOrders,
        report.selectedSuppliers || [],
        { showCosts: report.showCosts === true }
      )
    };
  }
  return preview;
}

function currentStoredUser() {
  // A profile cached in localStorage is not proof of authentication. Each app
  // launch must establish a fresh local bearer session or Supabase Auth session.
  return null;
}

const USER_PUBLIC_COLUMNS = "id, username, display_name, role, can_view_costs, email, auth_user_id, is_active, last_login_at, created_at";
const USER_PUBLIC_FALLBACK_COLUMNS = "id, username, display_name, role, is_active, last_login_at, created_at";
const USER_COLUMN_MISSING_RE = /(email|auth_user_id|can_view_costs).*does not exist|Could not find.*(email|auth_user_id|can_view_costs)|PGRST204/i;

function appPublicUser(row) {
  return row ? {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    role: row.role,
    can_view_costs: row.role === "admin" || row.can_view_costs === true,
    email: row.email || "",
    auth_user_id: row.auth_user_id || ""
  } : null;
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

async function supabaseRpcValue(client, functionName, args = {}) {
  const result = await client.rpc(functionName, args);
  if (result.error) throw result.error;
  return result.data;
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

async function supabaseProfileForAuthUser(client, authUserId) {
  const result = await client
    .from("users")
    .select(USER_PUBLIC_COLUMNS)
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data || null;
}

async function glassAuthFunctionError(error) {
  const context = error?.context;
  if (context?.clone) {
    try {
      const payload = await context.clone().json();
      if (payload?.error) return safeErrorMessage(payload.error);
    } catch {
      // Fall through to the SDK error message when the response has no JSON body.
    }
  }
  return safeErrorMessage(error);
}

async function invokeGlassAuth(action, payload = {}) {
  const client = getSupabaseClient();
  if (!client || !hasSupabaseConfig()) throw new Error("الاتصال غير متاح.");
  const result = await client.functions.invoke("glass-auth", {
    body: { action, ...payload }
  });
  if (result.error) throw new Error(await glassAuthFunctionError(result.error));
  if (result.data?.error) throw new Error(safeErrorMessage(result.data.error));
  return result.data || {};
}

async function restoreSupabaseSessionUser() {
  if (!hasSupabaseConfig()) return null;
  const client = getSupabaseClient();
  if (!client) return null;
  try {
    const sessionResult = await client.auth.getSession();
    const authUserId = sessionResult.data?.session?.user?.id;
    if (sessionResult.error || !authUserId) return null;
    const profile = await supabaseProfileForAuthUser(client, authUserId);
    if (!profile || profile.is_active === false) {
      await client.auth.signOut({ scope: "local" }).catch(() => null);
      return null;
    }
    const user = appPublicUser(profile);
    sanitizeLocalCostCachesForUser(user);
    localStorage.setItem("glassOrdersUser", JSON.stringify(user));
    setDataSourceMode("supabase");
    return user;
  } catch {
    // Fail closed without deleting a potentially valid session during a
    // temporary network outage. The user can retry or use email break-glass.
    return null;
  }
}

async function loginUser(username, password, email = "") {
  const cleanUsername = cleanName(username);
  const useSupabaseAuth = hasSupabaseConfig();
  if (useSupabaseAuth) {
    const identity = cleanUsername || cleanName(email).toLocaleLowerCase();
    if (!identity || !password) throw new Error("اكتب اسم المستخدم وكلمة المرور.");
    const client = getSupabaseClient();
    if (!client) throw new Error("الاتصال غير متاح.");
    try {
      let profile;
      let directEmailLogin = false;
      if (identity.includes("@")) {
        // Break-glass path: a linked administrator can still enter by email if
        // the username resolver function is temporarily unavailable.
        directEmailLogin = true;
        const directResult = await client.auth.signInWithPassword({
          email: identity.toLocaleLowerCase(),
          password
        });
        if (directResult.error || !directResult.data?.user?.id) {
          throw directResult.error || new Error("بيانات الدخول غير صحيحة.");
        }
        profile = await supabaseProfileForAuthUser(client, directResult.data.user.id);
      } else {
        const response = await invokeGlassAuth("login", {
          identity,
          password
        });
        const session = response.session || {};
        if (!session.access_token || !session.refresh_token) throw new Error("بيانات الدخول غير صحيحة.");
        const sessionResult = await client.auth.setSession({
          access_token: session.access_token,
          refresh_token: session.refresh_token
        });
        if (sessionResult.error || !sessionResult.data?.user?.id) {
          throw sessionResult.error || new Error("تعذر إنشاء جلسة الدخول.");
        }
        profile = response.profile;
      }
      if (!profile || profile.is_active === false) {
        await client.auth.signOut({ scope: "local" }).catch(() => null);
        throw new Error("الحساب غير مفعّل في التطبيق. تواصل مع مدير النظام.");
      }
      if (directEmailLogin) {
        const lastLoginResult = await client.rpc("glass_auth_record_login");
        if (lastLoginResult.error) {
          console.warn(maskSensitiveText(`Direct-email last_login_at update skipped: ${safeErrorMessage(lastLoginResult.error)}`));
        }
      }
      const publicUser = appPublicUser(profile);
      sanitizeLocalCostCachesForUser(publicUser);
      localStorage.setItem("glassOrdersUser", JSON.stringify(publicUser));
      setDataSourceMode("supabase");
      return publicUser;
    } catch (error) {
      if (isSupabaseSessionError(error)) {
        clearSupabaseAuthStorage();
        resetSupabaseClientCache();
      }
      const message = safeErrorMessage(error);
      if (/invalid login|invalid credentials|بيانات الدخول/i.test(message)) throw new Error("بيانات الدخول غير صحيحة.");
      throw new Error(`تعذر تسجيل الدخول: ${message}`);
    }
  }

  throw new Error("إعداد الاتصال غير مكتمل. راجع مسؤول النظام.");
}

async function sendSupabasePasswordReset(username, email) {
  const identity = cleanName(username || email).toLocaleLowerCase();
  if (!identity) throw new Error("اكتب اسم المستخدم أو البريد الإلكتروني المسجل.");
  return invokeGlassAuth("reset-password", {
    identity,
    redirectTo: supabaseRedirectOptions()?.redirectTo || ""
  });
}

async function changeSupabaseAppUserPassword(currentUser, currentPassword, newPassword) {
  const client = getSupabaseClient();
  if (!client || !hasSupabaseConfig()) throw new Error("الاتصال غير متاح.");
  const email = cleanName(currentUser?.email).toLocaleLowerCase();
  if (!email) throw new Error("لا يحتوي الحساب على بريد صالح.");
  if (!newPassword) throw new Error("اكتب كلمة المرور الجديدة.");
  if (!currentPassword) throw new Error("اكتب كلمة المرور الحالية.");
  const authResult = await client.auth.signInWithPassword({ email, password: currentPassword });
  if (authResult.error) throw new Error("كلمة المرور الحالية غير صحيحة.");
  const updateResult = await client.auth.updateUser({ password: newPassword });
  if (updateResult.error) throw updateResult.error;
  return currentUser;
}

async function loadSupabaseStage(label, loader) {
  const startedAt = performance.now();
  try {
    const result = await loader();
    console.info(`[Supabase] ${label} loaded in ${Math.round(performance.now() - startedAt)}ms`);
    return result;
  } catch (error) {
    const elapsed = Math.round(performance.now() - startedAt);
    console.error(`[Supabase] ${label} failed after ${elapsed}ms: ${safeErrorMessage(error)}`);
    if (error && typeof error === "object" && !error.operation) error.operation = label;
    throw error;
  }
}

async function loadData() {
  const localLearnedTableOptions = readLearnedTableOptions();
  const client = supabaseEnabled() ? getSupabaseClient() : null;
  if (client) {
    try {
      const [customers, suppliers, payments, users, integrityCounts, options] = await Promise.all([
        loadSupabaseStage("customers", () => supabaseSelectAll(client, "customers", "*", (query) => query.order("name"))),
        loadSupabaseStage("suppliers", () => supabaseSelectAll(client, "suppliers", "*", (query) => query.order("name"))),
        loadSupabaseStage("supplier payments", () => supabaseSelectAll(client, "supplier_payments", "*", (query) => query.order("paid_at", { ascending: false }))),
        loadSupabaseStage("users", () => supabaseUsers(client)),
        loadSupabaseStage("integrity counts", () => loadGlassDataCountsCompat(client)),
        loadSupabaseStage("learned options", () => supabaseSelectAll(client, "learned_options", "*", (query) => query.eq("kind", "double_gap")))
      ]);
      const [orders, rows] = await Promise.all([
        loadSupabaseStage("orders", () => loadAllRpcPagesCompat(client, "load_glass_orders_page", "load_glass_orders", {}, {
          expectedCount: integrityCounts?.order_count,
          concurrency: 3
        })),
        loadSupabaseStage("order rows", () => loadAllRpcPagesCompat(client, "load_glass_order_rows_page", "load_glass_order_rows", {}, {
          expectedCount: integrityCounts?.row_count,
          concurrency: 3
        }))
      ]);
      assertCompleteGlassData(orders, rows, integrityCounts);
      const byOrder = new Map();
      for (const row of rows || []) {
        const item = makeRow({
          id: row.id,
          code: row.code || drawingRowCode(row.drawing) || "",
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
          receivedQuantity: row.received_quantity,
          receiptHistory: row.receipt_history,
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
        learnedTableOptions: localLearnedTableOptions,
        source: "supabase",
        orders: (orders || []).map((order) =>
          createDraft({
            id: order.id,
            orderNo: order.order_no,
            documentId: order.document_id || "",
            date: order.issue_date || order.order_date,
            entryAt: order.entry_at || "",
            status: order.status,
            collectedPieces: order.collected_pieces || order.collectedPieces || 0,
            entryMode: order.entry_mode,
            customerId: order.customer_id || "",
            customerName: order.customer_name,
            supplierId: order.supplier_id || "",
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
      throw error;
    }
  }
  if (localServerEnabled()) {
    try {
      await ensureDesktopLocalServer(9000);
      const data = await localRequest("/api/bootstrap");
      return {
        ...data,
        learnedTableOptions: mergeLearnedTableOptions(data.learnedTableOptions, localLearnedTableOptions),
        source: "local-server"
      };
    } catch (error) {
      throw new Error(`تعذر تحميل بيانات الخادم المحلي: ${safeErrorMessage(error)}`);
    }
  }
  const local = readLocal();
  return {
    customers: [],
    suppliers: [],
    payments: [],
    orders: [],
    learnedOptions: GAP_DEFAULTS,
    ...local,
    learnedTableOptions: mergeLearnedTableOptions(local.learnedTableOptions, localLearnedTableOptions),
    source: "browser"
  };
}

async function saveOrderToStore(order, data) {
  const validation = validateOrderForSave(order, { customers: data?.customers || [], suppliers: data?.suppliers || [] });
  if (!validation.isValid) {
    throw new Error(validation.errors[0]?.message || "تعذر حفظ الطلب لوجود بيانات مطلوبة غير مكتملة.");
  }
  const normalized = { ...orderSaveSnapshot({ ...order, rows: validation.payloadRows }), expectedItemCount: validation.payloadRows.length, status: normalizeOrderStatus(order.status), collectedPieces: databaseNumber(order.collectedPieces, 0), customerName: cleanName(order.customerName), supplierName: cleanName(order.supplierName) };
  if (order._existingOrder === true) normalized._existingOrder = true;
  if (localServerEnabled()) {
    try {
      const result = await localRequest("/api/orders", {
        method: "POST",
        body: JSON.stringify(normalized)
      }, 10000);
      verifyOrderSaveIntegrity(result?.persistence, result?.order?.rows || normalized.rows);
      return result?.order ? mergeSavedOrderData(data, result.order) : result;
    } catch (error) {
      if (!isConnectivityError(error)) throw error;
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
    const savedOrder = await saveOrderToSupabase(client, normalized);
    return mergeSavedOrderData(data, savedOrder);
  } catch (error) {
    if (!isConnectivityError(error)) throw error;
    const nextOrder = { ...normalized, id: normalized.id || uid() };
    const next = upsertOfflineOrder(data, nextOrder);
    queueOfflineOperation({ type: "order-upsert", order: nextOrder });
    return next;
  }
}

function receiptRowsForPersistence(order, rowsChanged, changedRowIds = []) {
  if (!rowsChanged) return [];
  const changedSet = new Set((changedRowIds || []).map((id) => String(id)));
  const rows = changedSet.size
    ? (order.rows || []).filter((row) => changedSet.has(String(row.id)))
    : (order.rows || []);
  return rows.map((row) => ({
    id: row.id,
    receivedQuantity: row.receivedQuantity,
    receiptHistory: normalizeReceiptHistory(row.receiptHistory)
  }));
}

function orderStatusPersistencePayload(order, rowsChanged, changedRowIds = []) {
  const identity = {
    id: order.id || "",
    orderNo: order.orderNo || ""
  };
  if (rowsChanged) {
    return {
      ...identity,
      operation: "receipt",
      collectedPieces: databaseNumber(order.collectedPieces, 0),
      rows: receiptRowsForPersistence(order, true, changedRowIds)
    };
  }
  return {
    ...identity,
    operation: "status",
    documentId: order.documentId || "",
    status: normalizeOrderStatus(order.status)
  };
}

async function persistOrderStatusToSupabase(client, order, rowsChanged, changedRowIds = []) {
  if (!order?.id) throw new Error("تعذر تحديث الحالة لأن معرّف الطلب غير متاح.");
  const result = rowsChanged
    ? await client.rpc("apply_order_receipts", {
      p_order_id: order.id,
      p_collected_pieces: databaseNumber(order.collectedPieces, 0),
      p_rows: receiptRowsForPersistence(order, true, changedRowIds).map((row) => ({
        id: row.id,
        received_quantity: databaseNumber(row.receivedQuantity, 0),
        receipt_history: normalizeReceiptHistory(row.receiptHistory)
      })),
      p_app_version: VERSION,
      p_client_type: Capacitor.getPlatform()
    })
    : await client.rpc("update_order_status", {
      p_order_id: order.id,
      p_document_id: order.documentId || null,
      p_status: normalizeOrderStatus(order.status),
      p_app_version: VERSION,
      p_client_type: Capacitor.getPlatform()
    });
  if (result.error) throw result.error;
  return order;
}

async function patchOrderStatusToStore(order, data, { rowsChanged = false, changedRowIds = [] } = {}) {
  const optimistic = mergeOrderStatusPatchData(data, order);
  const persistencePayload = orderStatusPersistencePayload(order, rowsChanged, changedRowIds);
  if (localServerEnabled()) {
    try {
      await localRequest(`/api/orders/${encodeURIComponent(order.id || order.orderNo)}/status`, {
        method: "PATCH",
        body: JSON.stringify(persistencePayload)
      }, 10000);
      return optimistic;
    } catch (error) {
      if (!isConnectivityError(error)) throw error;
    }
  }
  const client = supabaseEnabled() ? getSupabaseClient() : null;
  if (!client) {
    const next = { ...optimistic, source: hasSupabaseConfig() ? "offline" : optimistic.source };
    writeLocal(next);
    if (hasSupabaseConfig()) queueOfflineOperation({ type: "order-status-patch", order, rowsChanged, changedRowIds });
    return next;
  }
  try {
    await persistOrderStatusToSupabase(client, order, rowsChanged, changedRowIds);
    return optimistic;
  } catch (error) {
    if (!isConnectivityError(error)) throw error;
    const next = { ...optimistic, source: "offline", offlinePending: true };
    writeLocal(next);
    writeOfflineSnapshot(next);
    queueOfflineOperation({ type: "order-status-patch", order, rowsChanged, changedRowIds });
    return next;
  }
}

async function deleteOrderFromStore(order, data) {
  if (!order?.id && !order?.orderNo) throw new Error("لا يوجد رقم طلب صالح للحذف.");
  if (localServerEnabled()) {
    try {
      const result = await localRequest(`/api/orders/${encodeURIComponent(order.id || order.orderNo)}`, { method: "DELETE" }, 10000);
      return result?.deleted ? removeSavedOrderData(data, order) : result;
    } catch (error) {
      if (!isConnectivityError(error)) throw error;
      // Keep the app usable if the local server is closed after startup.
    }
  }
  const client = supabaseEnabled() ? getSupabaseClient() : null;
  if (!client) {
    const next = deleteOfflineOrder(data, order);
    if (hasSupabaseConfig()) {
      queueOfflineOperation({ type: "order-delete", orderId: order.id, orderNo: order.orderNo });
    }
    return next;
  }
  try {
    await deleteOrderFromSupabase(client, order);
    return removeSavedOrderData(data, order);
  } catch (error) {
    if (!isConnectivityError(error)) throw error;
    const next = deleteOfflineOrder(data, order);
    queueOfflineOperation({ type: "order-delete", orderId: order.id, orderNo: order.orderNo });
    return next;
  }
}

async function nextSupabaseOrderNo(client, floorValue = "") {
  const rows = await supabaseSelectAll(client, "glass_orders", "order_no");
  const maxSequence = rows.reduce((max, row) => {
    const sequence = orderSequence(row.order_no);
    return Number.isFinite(sequence) ? Math.max(max, sequence) : max;
  }, 0);
  const floorSequence = orderSequence(floorValue);
  return displayOrderNo(Math.max(maxSequence, Number.isFinite(floorSequence) ? floorSequence : 0) + 1);
}

function supabaseOrderRowPayload(row, index, orderId) {
  const totals = rowTotals(row);
  return {
    id: persistentIdentifier(row.id),
    order_id: orderId,
    line_no: index + 1,
    glass_mode: row.glassMode,
    code: row.code || "",
    description: rowDescription(row),
    quantity: rowHasPanels(row) ? rowPanelPhysicalCount(row) : databaseNumber(row.quantity, 1),
    unit_price: databaseNumber(row.unitPrice, 0),
    supplier_unit_price: databaseNumber(row.supplierUnitPrice, 0),
    material_unit_price: databaseNumber(row.materialUnitPrice, 0),
    supplier_material_unit_price: databaseNumber(row.supplierMaterialUnitPrice, 0),
    double_gap: row.doubleGap || null,
    triplex_pvb: row.triplexPvb || null,
    extra_direction: row.extraDirection || null,
    notes: row.notes || "",
    received_quantity: row.receivedQuantity == null || row.receivedQuantity === ""
      ? null
      : databaseNumber(row.receivedQuantity, 0),
    receipt_history: normalizeReceiptHistory(row.receiptHistory),
    layers: row.layers,
    drawing: drawingWithRowCode(row.drawing, row.code),
    area_m2: totals.area,
    cost: totals.total,
    supplier_cost: totals.supplierCost
  };
}

async function saveOrderToSupabase(client, normalized) {
  let persistenceStage = {
    operation: "resolve parties",
    table: "customers, suppliers",
    function: "",
    parameters: {}
  };
  try {
  const customer = await selectedPartyForPersistence(client, "customers", normalized.customerId, normalized.customerName, "العميل");
  const supplier = await selectedPartyForPersistence(client, "suppliers", normalized.supplierId, normalized.supplierName, "المورد");
  const saveAsExisting = normalized._existingOrder === true;
  let candidateOrderNo = normalized.orderNo ? displayOrderNo(normalized.orderNo) : await nextSupabaseOrderNo(client);
  let saved = null;
  let savedRows = [];
  const requestedOrderId = normalized.id || normalized.clientDocumentId || "";
  const normalizedOrderId = uuidOrNew(requestedOrderId);
  const validNormalizedOrderId = requestedOrderId === normalizedOrderId ? normalizedOrderId : "";
  let existingId = "";
  if (validNormalizedOrderId) {
    persistenceStage = {
      operation: "find order by id",
      table: "glass_orders",
      function: "",
      parameters: { order_id: validNormalizedOrderId }
    };
    const byId = await client.from("glass_orders").select("id, order_no").eq("id", validNormalizedOrderId).maybeSingle();
    if (byId.error) throw byId.error;
    existingId = byId.data?.id || "";
    if (existingId && byId.data?.order_no) candidateOrderNo = displayOrderNo(byId.data.order_no);
  }
  if (saveAsExisting && !existingId && candidateOrderNo) {
    persistenceStage = {
      operation: "find order by number",
      table: "glass_orders",
      function: "",
      parameters: { order_no: candidateOrderNo }
    };
    const byOrderNo = await client.from("glass_orders").select("id, order_no").eq("order_no", candidateOrderNo).maybeSingle();
    if (byOrderNo.error) throw byOrderNo.error;
    existingId = byOrderNo.data?.id || "";
  }
  if (saveAsExisting && !existingId) {
    throw new Error("تعذر تحديث الطلب لأن السجل الأصلي غير موجود في قاعدة البيانات. لم يتم إنشاء طلب جديد.");
  }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    persistenceStage = {
      operation: "check order number",
      table: "glass_orders",
      function: "",
      parameters: { order_no: candidateOrderNo, attempt: attempt + 1 }
    };
    const duplicate = await client.from("glass_orders").select("id, order_no").eq("order_no", candidateOrderNo).maybeSingle();
    if (duplicate.error) throw duplicate.error;
    if (duplicate.data?.id && duplicate.data.id !== existingId) {
      if (!existingId && !saveAsExisting) {
        const rowCheck = await client.from("glass_order_rows").select("id", { count: "exact", head: true }).eq("order_id", duplicate.data.id);
        if (rowCheck.error) throw rowCheck.error;
        if ((rowCheck.count || 0) === 0) {
          existingId = duplicate.data.id;
        } else {
          candidateOrderNo = await nextSupabaseOrderNo(client, candidateOrderNo);
          continue;
        }
      } else {
        throw new Error("رقم الطلب مستخدم بالفعل في طلب آخر. يرجى اختيار رقم مختلف.");
      }
    }
    const orderId = existingId || normalizedOrderId;
    const rows = normalized.rows.map((row, index) => supabaseOrderRowPayload(row, index, orderId));
    const payload = {
      id: orderId,
      order_no: candidateOrderNo,
      document_id: normalized.documentId || null,
      order_date: normalized.date,
      entry_at: normalized.entryAt || null,
      status: normalized.status,
      collected_pieces: databaseNumber(normalized.collectedPieces, 0),
      entry_mode: normalized.entryMode,
      customer_id: nullableIdentifier(customer?.id),
      supplier_id: nullableIdentifier(supplier?.id),
      customer_name: normalized.customerName,
      supplier_name: normalized.supplierName,
      project: normalized.project,
      code: normalized.code,
      notes: normalized.notes,
      deleted_row_ids: (normalized.deletedRowIds || []).map(String),
      expected_item_count: rows.length,
      app_version: VERSION,
      client_type: Capacitor.getPlatform(),
      totals: orderTotals(normalized)
    };
    // Header save, row updates/inserts, and removed-row pruning must either all
    // commit or all roll back. This path is also used by persisted Undo restore.
    persistenceStage = {
      operation: "save complete order",
      table: "glass_orders, glass_order_rows",
      function: "save_glass_order_atomic",
      parameters: {
        order_id: orderId,
        order_no: candidateOrderNo,
        customer_id: payload.customer_id,
        supplier_id: payload.supplier_id,
        row_count: rows.length,
        row_ids: rows.map((row) => row.id)
      }
    };
    const result = await client.rpc("save_glass_order_atomic", {
      p_order: payload,
      p_rows: rows
    });
    if (!result.error) {
      verifyOrderSaveIntegrity(result.data, rows);
      saved = result;
      savedRows = rows;
      normalized.orderNo = candidateOrderNo;
      normalized.id = result.data?.id || orderId;
      break;
    }
    if (!isDuplicateOrderNoError(result.error)) throw result.error;
    console.warn(maskSensitiveText(`Supabase duplicate order number ${candidateOrderNo}: ${safeErrorMessage(result.error)}`));
    if (saveAsExisting || existingId) {
      throw new Error("رقم الطلب مستخدم بالفعل في طلب آخر. لم يتم تغيير أي من البيانات المدخلة.");
    }
    candidateOrderNo = await nextSupabaseOrderNo(client, candidateOrderNo);
  }
  if (!saved?.data?.id) throw new Error("تعذر إنشاء رقم فريد للطلب، ولم يتم فقد أي من البيانات المدخلة. يرجى إعادة المحاولة.");
  const orderId = saved.data.id;
  const learnedGaps = [...new Set(normalized.rows.map((row) => cleanName(row.doubleGap)).filter(Boolean))]
    .map((value) => ({ kind: "double_gap", value }));
  if (learnedGaps.length) {
    persistenceStage = {
      operation: "save learned glass options",
      table: "learned_options",
      function: "",
      parameters: { option_count: learnedGaps.length }
    };
    const learnedResult = await client.from("learned_options").upsert(learnedGaps, { onConflict: "kind,value" });
    if (learnedResult.error) throw learnedResult.error;
  }
  return createDraft({
    ...normalized,
    id: orderId,
    orderNo: candidateOrderNo,
    rows: normalized.rows.map((row, index) => ({
      ...row,
      id: savedRows[index]?.id || row.id
    })),
    originalRowIds: savedRows.map((row) => String(row.id || "")).filter(Boolean),
    deletedRowIds: [],
    _existingOrder: true
  });
  } catch (error) {
    logSupabasePersistenceError(error, persistenceStage);
    throw error;
  }
}

async function deleteOrderFromSupabase(client, order) {
  let orderId = order.id || "";
  if (orderId) {
    const byId = await client.from("glass_orders").select("id").eq("id", orderId).maybeSingle();
    if (byId.error) throw byId.error;
    orderId = byId.data?.id || "";
  }
  if (!orderId && order.orderNo) {
    const existing = await client.from("glass_orders").select("id").eq("order_no", order.orderNo).maybeSingle();
    if (existing.error) throw existing.error;
    orderId = existing.data?.id || "";
  }
  if (!orderId) return;
  // glass_order_rows.order_id uses ON DELETE CASCADE. Deleting only the parent
  // keeps the operation atomic and avoids a half-deleted order if a second
  // request fails between child and parent removal.
  const orderResult = await client.from("glass_orders").delete().eq("id", orderId);
  if (orderResult.error) throw orderResult.error;
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
        const normalized = { ...orderSaveSnapshot(item.order), status: normalizeOrderStatus(item.order.status), collectedPieces: databaseNumber(item.order.collectedPieces, 0), customerName: cleanName(item.order.customerName), supplierName: cleanName(item.order.supplierName) };
        if (item.order._existingOrder === true) normalized._existingOrder = true;
        await saveOrderToSupabase(client, normalized);
        synced += 1;
      } else if (item.type === "order-status-patch" && item.order) {
        await persistOrderStatusToSupabase(client, item.order, item.rowsChanged === true, item.changedRowIds || []);
        synced += 1;
      } else if (item.type === "order-delete" && (item.orderId || item.orderNo)) {
        await deleteOrderFromSupabase(client, { id: item.orderId, orderNo: item.orderNo });
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

async function selectedPartyForPersistence(client, table, id, name, label) {
  const selectedId = cleanName(id);
  const selectedName = cleanName(name);
  if (!selectedName) {
    throw new Error(`يجب إدخال ${label} قبل حفظ الطلب.`);
  }

  if (selectedId) {
    const existing = await client.from(table).select("id, name").eq("id", selectedId).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data && cleanName(existing.data.name).toLocaleLowerCase() === selectedName.toLocaleLowerCase()) {
      return existing.data;
    }
  }

  const byName = await client.from(table).select("id, name").eq("name", selectedName).maybeSingle();
  if (byName.error) throw byName.error;
  if (byName.data?.id) return byName.data;

  const insertPayload = table === "suppliers"
    ? { name: selectedName, opening_balance: 0 }
    : { name: selectedName };
  let inserted = await client.from(table).insert(insertPayload).select("id, name").single();
  if (inserted.error && missingSupabaseSchemaColumn(inserted.error, table) === "opening_balance") {
    inserted = await client.from(table).insert({ name: selectedName }).select("id, name").single();
  }
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
    cleanName(row.quantity) ||
    numberValue(row.unitPrice) > 0 ||
    numberValue(row.supplierUnitPrice) > 0 ||
    numberValue(row.materialUnitPrice) > 0 ||
    numberValue(row.supplierMaterialUnitPrice) > 0 ||
    cleanName(row.code) ||
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
    (row.drawing?.paths || []).length ||
    rowStoredPanels(row).length;
}

function layerHasAnyInput(layer = {}) {
  return cleanName(layer.glassType) ||
    cleanName(layer.company) ||
    cleanName(layer.thickness) ||
    cleanName(layer.width) ||
    cleanName(layer.height) ||
    numberValue(layer.unitPrice) > 0 ||
    numberValue(layer.supplierUnitPrice) > 0 ||
    !!layer.secure ||
    !!layer.mirror;
}

function isCompletelyEmptyRow(row = {}) {
  return isCompletelyEmptyOrderRow(row);
}

function isRecoverableEmptyOrderRecord(order = {}) {
  return !!order.id && !activeOrderRows(order.rows || []).length;
}

function requiredLayerCount(row = {}) {
  return row.glassMode === "single" ? 1 : 2;
}

function validateOrderRows(order = {}) {
  const rows = order.rows || [];
  const errors = rows.flatMap((row, rowIndex) => validateOrderRowForSave(row, rowIndex));
  const meaningfulRows = rows.filter((row) => !isCompletelyEmptyOrderRow(row));
  if (!meaningfulRows.length) {
    errors.push({
      scope: "row",
      rowId: rows[0]?.id || "local-row-0",
      rowIndex: 0,
      field: "layer0-glassType",
      message: "الصف 1: يجب إدخال بند زجاج مكتمل واحد على الأقل."
    });
  }
  const first = errors[0];
  return first
    ? { ok: false, errors, message: first.message, rowIndex: first.rowIndex, column: first.field }
    : { ok: true, errors: [] };
}

function validateOrderIssueDate(order = {}) {
  if (resolveOrderIssueDate(order)) return { ok: true };
  return { ok: false, message: "لا يمكن تصدير التقرير قبل تحديد تاريخ الطلب." };
}

function validateOrderCustomerName(order = {}) {
  if (cleanName(order.customerName)) return { ok: true };
  return {
    ok: false,
    message: "تعذر تحديد اسم العميل لهذا الطلب. يرجى مراجعة بيانات العميل قبل حفظ التقرير.",
    column: "customerName"
  };
}

function validateOrderForReport(order = {}) {
  const rowValidation = validateOrderRows(order);
  if (!rowValidation.ok) return rowValidation;
  const dateValidation = validateOrderIssueDate(order);
  if (!dateValidation.ok) return dateValidation;
  return validateOrderCustomerName(order);
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
  const runtimeVersion = useRuntimeAppVersion();
  const [activeTab, setActiveTab] = useState("dashboard");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState("بدء تشغيل التطبيق...");
  const [loadingSlow, setLoadingSlow] = useState(false);
  const [loadingFailure, setLoadingFailure] = useState(null);
  const [message, setMessage] = useState("");
  const [currentUser, setCurrentUser] = useState(currentStoredUser);
  const [sessionRestoreChecked, setSessionRestoreChecked] = useState(false);
  const [data, setData] = useState({ customers: [], suppliers: [], payments: [], orders: [], learnedOptions: GAP_DEFAULTS, learnedTableOptions: normalizeLearnedTableOptions() });
  const [draft, setDraft] = useState(createDraft());
  const [draftSavedMarker, setDraftSavedMarker] = useState("");
  const [preview, setPreview] = useState(null);
  const [supplierPayment, setSupplierPayment] = useState(null);
  const [deleteOrderTarget, setDeleteOrderTarget] = useState(null);
  const [deleteOrderBusy, setDeleteOrderBusy] = useState(false);
  const [localStatus, setLocalStatus] = useState(null);
  const [pendingSyncCount, setPendingSyncCount] = useState(() => readOfflineQueue().length);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const [clockTick, setClockTick] = useState(0);
  const [appearance, setAppearance] = useState(readAppearanceSettings);
  const [passwordRecoveryOpen, setPasswordRecoveryOpen] = useState(false);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [availableUpdate, setAvailableUpdate] = useState(null);
  useDesktopPasswordRecovery(setPasswordRecoveryOpen, setMessage, setCurrentUser);
  const saveInFlightRef = useRef(false);
  const savePromiseRef = useRef(null);
  const saveRecoveryCheckedRef = useRef(false);
  const deleteOrderFocusRef = useRef({ trigger: null, neighbor: null });
  const appStateRef = useRef({ activeTab, data, draft, draftSavedMarker });
  const appHistoryRef = useRef({ undo: [], redo: [], restoring: false, busy: false, lastLabel: "", lastPushAt: 0 });
  const orderStatusMutationRef = useRef(new Map());
  const editorOriginRef = useRef(null);

  function replaceAppData(nextValue) {
    const current = appStateRef.current?.data || data;
    const next = typeof nextValue === "function" ? nextValue(current) : nextValue;
    appStateRef.current = { ...appStateRef.current, data: next };
    setData(next);
    return next;
  }

  function replaceDraftState(nextDraft, nextSavedMarker = appStateRef.current?.draftSavedMarker || "") {
    appStateRef.current = {
      ...appStateRef.current,
      draft: nextDraft,
      draftSavedMarker: nextSavedMarker
    };
    setDraft(nextDraft);
    setDraftSavedMarker(nextSavedMarker);
  }

  function currentAppSnapshot() {
    const state = appStateRef.current || { activeTab, data, draft, draftSavedMarker };
    return {
      activeTab: state.activeTab,
      data: plainClone(state.data),
      draft: plainClone(state.draft),
      draftSavedMarker: state.draftSavedMarker || ""
    };
  }

  function historyEntrySnapshot(entry) {
    return entry?.snapshot ? entry.snapshot : entry;
  }

  function historyEntryLabel(entry) {
    return entry?.label || "آخر إجراء";
  }

  function pushAppHistory(label = "تعديل", options = {}) {
    const history = appHistoryRef.current;
    if (history.restoring || history.busy) return null;
    const now = Date.now();
    const coalesceMs = numberValue(options.coalesceMs);
    const historyKey = options.key || label;
    if (!options.force && coalesceMs && history.lastKey === historyKey && now - history.lastPushAt < coalesceMs) return null;
    const snapshot = currentAppSnapshot();
    if (options.dataSnapshot) snapshot.data = plainClone(options.dataSnapshot);
    if (options.draftSnapshot) snapshot.draft = plainClone(options.draftSnapshot);
    const entry = {
      id: uid(),
      label,
      key: historyKey,
      timestamp: now,
      snapshot,
      persistence: options.persistence ? plainClone(options.persistence) : null,
      pending: options.pending === true
    };
    history.undo.push(entry);
    if (history.undo.length > 80) history.undo.shift();
    history.redo = [];
    history.lastLabel = label;
    history.lastKey = historyKey;
    history.lastPushAt = now;
    return entry;
  }

  function restoreAppSnapshot(snapshot) {
    const resolvedSnapshot = historyEntrySnapshot(snapshot);
    if (!resolvedSnapshot) return;
    const history = appHistoryRef.current;
    history.restoring = true;
    const restoredData = resolvedSnapshot.data || { customers: [], suppliers: [], payments: [], orders: [], learnedOptions: GAP_DEFAULTS, learnedTableOptions: normalizeLearnedTableOptions() };
    const restoredDraft = resolvedSnapshot.draft || createDraft();
    const restoredMarker = resolvedSnapshot.draftSavedMarker || "";
    const restoredTab = resolvedSnapshot.activeTab || "dashboard";
    appStateRef.current = {
      activeTab: restoredTab,
      data: restoredData,
      draft: restoredDraft,
      draftSavedMarker: restoredMarker
    };
    setData(restoredData);
    setDraft(restoredDraft);
    setDraftSavedMarker(restoredMarker);
    setActiveTab(restoredTab);
    window.setTimeout(() => {
      history.restoring = false;
      settleAppFocus();
    }, 0);
  }

  function orderStatusMutationKey(order = {}) {
    return cleanName(order.id || order.orderNo || order.documentId);
  }

  function enqueueOrderStatusPersistence(order, baseData, options = {}) {
    const key = orderStatusMutationKey(order);
    const previous = orderStatusMutationRef.current.get(key);
    const version = (previous?.version || 0) + 1;
    const promise = (previous?.promise || Promise.resolve())
      .catch(() => null)
      .then(() => patchOrderStatusToStore(order, baseData, options));
    const mutation = { key, version, promise };
    orderStatusMutationRef.current.set(key, mutation);
    return mutation;
  }

  async function waitForOrderStatusPersistence(order) {
    const mutation = orderStatusMutationRef.current.get(orderStatusMutationKey(order));
    if (mutation?.promise) await mutation.promise.catch(() => null);
  }

  function statusHistoryTarget(currentOrder, targetOrder, rowsChanged) {
    const targetRowsById = new Map((targetOrder.rows || []).map((row) => [String(row.id || ""), row]));
    const rows = rowsChanged
      ? (currentOrder.rows || []).map((row, index) => {
          const targetRow = targetRowsById.get(String(row.id || "")) || targetOrder.rows?.[index];
          return targetRow
            ? {
                ...row,
                receivedQuantity: targetRow.receivedQuantity,
                receiptHistory: normalizeReceiptHistory(targetRow.receiptHistory)
              }
            : row;
        })
      : (currentOrder.rows || []);
    return {
      ...currentOrder,
      documentId: targetOrder.documentId || "",
      status: normalizeOrderStatus(targetOrder.status),
      collectedPieces: databaseNumber(targetOrder.collectedPieces, 0),
      receiptStatus: targetOrder.receiptStatus,
      rows,
      _existingOrder: true
    };
  }

  function applyPersistedHistoryData(nextData, affectedOrder, removed = false) {
    const history = appHistoryRef.current;
    history.restoring = true;
    replaceAppData(nextData);
    const currentDraft = appStateRef.current?.draft || draft;
    if (affectedOrder && sameOrderIdentity(currentDraft, affectedOrder)) {
      if (removed) {
        const fresh = createDraft({ orderNo: generateOrderNo(nextData.orders || [], today()), date: today() });
        replaceDraftState(fresh, "");
      } else {
        const restoredDraft = createDraft(affectedOrder);
        replaceDraftState(restoredDraft, JSON.stringify(restoredDraft));
      }
    }
    window.setTimeout(() => {
      history.restoring = false;
      settleAppFocus();
    }, 0);
  }

  async function applyPersistedHistoryEntry(entry, direction) {
    const persistence = entry?.persistence;
    if (!persistence) return null;
    const currentData = appStateRef.current?.data || data;
    if (persistence.type === "order-delete") {
      const deletedOrder = plainClone(persistence.order);
      if (direction === "undo") {
        const restoreOrder = { ...orderSaveSnapshot(deletedOrder), _existingOrder: false };
        const persisted = await saveOrderToStore(restoreOrder, currentData);
        const latestData = appStateRef.current?.data || currentData;
        const savedOrder = findMatchingOrder(persisted?.orders || [], restoreOrder) || createDraft({ ...restoreOrder, _existingOrder: true });
        const nextData = mergeSavedOrderData(
          persisted?.offlinePending ? { ...latestData, source: "offline", offlinePending: true } : latestData,
          savedOrder
        );
        return { nextData, affectedOrder: findMatchingOrder(nextData.orders || [], savedOrder) || savedOrder, removed: false };
      }
      await waitForOrderStatusPersistence(deletedOrder);
      const latestData = appStateRef.current?.data || currentData;
      const currentOrder = findMatchingOrder(latestData.orders || [], deletedOrder) || deletedOrder;
      const persisted = await deleteOrderFromStore(currentOrder, latestData);
      const afterPersistence = appStateRef.current?.data || latestData;
      const nextData = removeSavedOrderData(
        persisted?.offlinePending ? { ...afterPersistence, source: "offline", offlinePending: true } : afterPersistence,
        currentOrder
      );
      return { nextData, affectedOrder: currentOrder, removed: true };
    }
    if (persistence.type === "order-status") {
      const targetOrder = direction === "undo" ? persistence.beforeOrder : persistence.afterOrder;
      const latestData = appStateRef.current?.data || currentData;
      const currentOrder = findMatchingOrder(latestData.orders || [], targetOrder);
      if (!currentOrder) throw new Error("تعذر العثور على الطلب لتطبيق التراجع.");
      const rowsChanged = persistence.rowsChanged === true;
      const nextOrder = statusHistoryTarget(currentOrder, targetOrder, rowsChanged);
      const changedRowIds = Array.isArray(persistence.changedRowIds)
        ? persistence.changedRowIds.map((id) => String(id))
        : [];
      const mutation = enqueueOrderStatusPersistence(nextOrder, latestData, { rowsChanged, changedRowIds });
      await mutation.promise;
      const afterPersistence = appStateRef.current?.data || latestData;
      return {
        nextData: mergeOrderStatusPatchData(afterPersistence, nextOrder),
        affectedOrder: nextOrder,
        removed: false
      };
    }
    throw new Error("هذا الإجراء لا يدعم تراجعاً دائماً.");
  }

  async function undoAppState() {
    const history = appHistoryRef.current;
    const previous = history.undo[history.undo.length - 1];
    if (!previous) {
      setMessage("لا يوجد إجراء سابق للتراجع.");
      return;
    }
    if (history.busy || previous.pending) {
      setMessage("انتظر اكتمال حفظ الإجراء الحالي قبل التراجع.");
      return;
    }
    if (!previous.persistence) {
      history.undo.pop();
      history.redo.push({
        id: uid(),
        label: historyEntryLabel(previous),
        timestamp: Date.now(),
        snapshot: currentAppSnapshot()
      });
      restoreAppSnapshot(previous);
      setMessage(`تم التراجع: ${historyEntryLabel(previous)}.`);
      return;
    }
    history.busy = true;
    setMessage(`جاري التراجع وحفظه: ${historyEntryLabel(previous)}...`);
    try {
      const result = await applyPersistedHistoryEntry(previous, "undo");
      if (history.undo[history.undo.length - 1]?.id !== previous.id) throw new Error("تغير سجل التراجع أثناء الحفظ.");
      history.undo.pop();
      history.redo.push({
        id: uid(),
        label: historyEntryLabel(previous),
        key: previous.key,
        timestamp: Date.now(),
        snapshot: currentAppSnapshot(),
        persistence: plainClone(previous.persistence),
        pending: false
      });
      applyPersistedHistoryData(result.nextData, result.affectedOrder, result.removed);
      setPendingSyncCount(readOfflineQueue().length);
      setMessage(`تم التراجع وحفظه: ${historyEntryLabel(previous)}.`);
    } catch (error) {
      setMessage(`تعذر التراجع؛ لم تتغير الواجهة: ${safeErrorMessage(error)}`);
    } finally {
      history.busy = false;
    }
  }

  async function redoAppState() {
    const history = appHistoryRef.current;
    const next = history.redo[history.redo.length - 1];
    if (!next) {
      setMessage("لا يوجد إجراء لإعادته.");
      return;
    }
    if (history.busy || next.pending) {
      setMessage("انتظر اكتمال حفظ الإجراء الحالي قبل الإعادة.");
      return;
    }
    if (!next.persistence) {
      history.redo.pop();
      history.undo.push({
        id: uid(),
        label: historyEntryLabel(next),
        timestamp: Date.now(),
        snapshot: currentAppSnapshot()
      });
      restoreAppSnapshot(next);
      setMessage(`تمت إعادة: ${historyEntryLabel(next)}.`);
      return;
    }
    history.busy = true;
    setMessage(`جاري إعادة الإجراء وحفظه: ${historyEntryLabel(next)}...`);
    try {
      const result = await applyPersistedHistoryEntry(next, "redo");
      if (history.redo[history.redo.length - 1]?.id !== next.id) throw new Error("تغير سجل الإعادة أثناء الحفظ.");
      history.redo.pop();
      history.undo.push({
        id: uid(),
        label: historyEntryLabel(next),
        key: next.key,
        timestamp: Date.now(),
        snapshot: currentAppSnapshot(),
        persistence: plainClone(next.persistence),
        pending: false
      });
      applyPersistedHistoryData(result.nextData, result.affectedOrder, result.removed);
      setPendingSyncCount(readOfflineQueue().length);
      setMessage(`تمت إعادة الإجراء وحفظها: ${historyEntryLabel(next)}.`);
    } catch (error) {
      setMessage(`تعذرت إعادة الإجراء؛ لم تتغير الواجهة: ${safeErrorMessage(error)}`);
    } finally {
      history.busy = false;
    }
  }

  function setDraftWithHistory(action) {
    pushAppHistory("تحرير الطلب");
    setDraft(action);
  }

  function setDataWithHistory(action) {
    pushAppHistory("تعديل البيانات");
    replaceAppData(action);
  }

  useEffect(() => {
    appStateRef.current = { activeTab, data, draft, draftSavedMarker };
  }, [activeTab, data, draft, draftSavedMarker]);

  useEffect(() => {
    const pageName = TABS.find(([id]) => id === activeTab)?.[1];
    document.title = pageName ? `${pageName} — ${FULL_APP_NAME}` : FULL_APP_NAME;
  }, [activeTab]);

  useEffect(() => {
    function handleAppUndoRedo(event) {
      const key = String(event.key || "").toLowerCase();
      const command = event.ctrlKey || event.metaKey;
      const undo = command && key === "z" && !event.shiftKey;
      const redo = command && (key === "y" || (key === "z" && event.shiftKey));
      if (!undo && !redo) return;
      if (event.repeat) return;
      if (isEditableDomTarget(event.target || document.activeElement)) return;
      preventCancelableDefault(event);
      if (undo) undoAppState();
      else redoAppState();
    }
    document.addEventListener("keydown", handleAppUndoRedo, true);
    return () => document.removeEventListener("keydown", handleAppUndoRedo, true);
  }, []);

  useEffect(() => {
    function stopWheelChangingSelect(event) {
      const target = event.target instanceof Element ? event.target : null;
      const select = target?.closest?.("select");
      if (!select) return;
      select.blur();
      preventCancelableDefault(event);
    }
    document.addEventListener("wheel", stopWheelChangingSelect, { capture: true, passive: false });
    return () => document.removeEventListener("wheel", stopWheelChangingSelect, true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    restoreSupabaseSessionUser().then((user) => {
      if (cancelled) return;
      if (user) setCurrentUser(user);
      setSessionRestoreChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!sessionRestoreChecked) return;
    if (currentUser) refresh();
    else setLoading(false);
  }, [currentUser, sessionRestoreChecked]);

  useEffect(() => {
    if (!sessionRestoreChecked || !window.glassOrdersDesktop?.syncTelegramBotSession) return;
    syncDesktopTelegramSession(!!currentUser).catch((error) => {
      if (currentUser) setMessage(`تعذر تجهيز بوت Telegram. ${safeErrorMessage(error)}`);
    });
  }, [currentUser?.id, sessionRestoreChecked]);

  useEffect(() => {
    if (!loading || loadingFailure) {
      setLoadingSlow(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setLoadingSlow(true), 8000);
    return () => window.clearTimeout(timer);
  }, [loading, loadingFailure]);

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
      preventCancelableDefault(event);
      event.returnValue = warning;
      return warning;
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [draft, draftSavedMarker]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      window.glassOrdersDesktop?.setUnsavedEntry?.({ dirty: currentDraftDirty() }).catch(() => null);
    }, 350);
    return () => window.clearTimeout(timer);
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
        if (!quiet) setMessage(`تمت مزامنة ${result.synced} عملية.`);
      }
    } catch (error) {
      if (!quiet) setMessage(`تعذر مزامنة البيانات: ${friendlySaveError(error)}`);
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    if (online) syncPendingChanges({ quiet: true });
  }, [online]);

  useEffect(() => {
    if (!currentUser || !online) return undefined;
    const lastCheck = numberValue(localStorage.getItem(UPDATE_LAST_CHECK_KEY));
    if (Date.now() - lastCheck < UPDATE_CHECK_INTERVAL_MS) return undefined;
    const timer = window.setTimeout(() => {
      checkForUpdates({ quiet: true, automatic: true });
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [currentUser, online]);

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
    persistAppearanceSettings(appearance, currentUser);
  }, [appearance, currentUser?.id]);

  useEffect(() => {
    if (!currentUser || !hasSupabaseConfig()) return undefined;
    let cancelled = false;
    loadGlobalAppearanceSettings()
      .then((globalSettings) => {
        if (cancelled) return;
        setAppearance(mergeAppearanceSettings(globalSettings, readStoredJson(appearanceStorageKey(currentUser), readStoredJson(APPEARANCE_STORAGE_KEY, {}))));
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [currentUser?.id]);

  useEffect(() => {
    if (!loading) restoreRendererInputFocus();
  }, [loading]);

  useEffect(() => {
    if (loading || !currentUser || saveRecoveryCheckedRef.current) return;
    saveRecoveryCheckedRef.current = true;
    const recovery = readSaveRecoveryDraft();
    if (!recovery?.order) return;
    const savedAt = recovery.savedAt ? new Date(recovery.savedAt).toLocaleString("ar-EG") : "";
    const confirmed = window.confirm(`توجد مسودة حفظ لم يكتمل${savedAt ? ` من ${savedAt}` : ""}. هل تريد استعادتها الآن؟`);
    settleAppFocus();
    if (!confirmed) return;
    setDraft(recovery.order);
    setDraftSavedMarker("");
    setActiveTab("entry");
    setMessage("تم استعادة مسودة الحفظ. راجعها ثم حاول الحفظ مرة أخرى.");
  }, [loading, currentUser]);

  useEffect(() => {
    if (!message) return undefined;
    const timer = window.setTimeout(() => setMessage(""), 5200);
    return () => window.clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    function handleSaveResult(event) {
      const { result, error } = event.detail || {};
      if (error) setMessage(`تعذر حفظ الملف: ${error}`);
      else if (result?.ok && result.printDialog) setMessage("تم فتح نافذة الطباعة. اختر Save as PDF لحفظ التقرير كنص قابل للبحث.");
      else if (result?.ok && result.filePath) setMessage(`تم حفظ الملف: ${result.filePath}`);
      restoreRendererInputFocus();
    }
    window.addEventListener("glass-orders-save-result", handleSaveResult);
    return () => window.removeEventListener("glass-orders-save-result", handleSaveResult);
  }, []);

  useEffect(() => {
    if (!window.glassOrdersDesktop?.onNavigate) return undefined;
    return window.glassOrdersDesktop.onNavigate((target) => {
      if (target === "new-order") newOrder();
      else if (TABS.some(([id]) => id === target)) navigateToTab(target);
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
      if (String(newPassword || "").length < 10) throw new Error("كلمة المرور يجب ألا تقل عن 10 أحرف.");
      const client = getSupabaseClient();
      if (!client) throw new Error("الاتصال غير متاح.");
      const result = await client.auth.updateUser({ password: newPassword });
      if (result.error) throw result.error;
      await clearSupabaseRecoverySession(setPasswordRecoveryOpen, setCurrentUser);
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

  async function handleResetSupabasePassword(credentials) {
    setLoading(true);
    setMessage("");
    try {
      await sendSupabasePasswordReset(credentials.username, credentials.email);
      setMessage("تم قبول الطلب. إذا كانت بيانات الحساب صحيحة فسيصل رابط إعادة التعيين إلى البريد المسجل.");
    } catch (error) {
      setMessage(`تعذر إرسال إعادة التعيين: ${safeErrorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  }

  async function checkForUpdates({ quiet = false, automatic = false } = {}) {
    if (checkingUpdates) return null;
    setCheckingUpdates(true);
    try {
      localStorage.setItem(UPDATE_LAST_CHECK_KEY, String(Date.now()));
      const release = await latestGitHubRelease();
      if (!release) {
        if (!quiet) setMessage(`لا توجد إصدارات منشورة على GitHub بعد. أنت تستخدم v${VERSION}.`);
        return null;
      }
      const latestVersion = normalizeVersionText(release.tag_name || release.name);
      if (!latestVersion) throw new Error("تعذر قراءة رقم الإصدار من GitHub.");
      if (compareVersions(latestVersion, VERSION) > 0) {
        const updateInfo = releaseUpdateInfo(release, latestVersion);
        setAvailableUpdate(updateInfo);
        const releaseLabel = updateInfo.releaseLabel;
        const messageText = `يتوفر تحديث جديد ${releaseLabel}. الإصدار الحالي v${VERSION}.`;
        const alreadyAlerted = localStorage.getItem(UPDATE_LAST_ALERT_KEY) === releaseLabel;
        if (!automatic || !alreadyAlerted) {
          const downloadText = updateInfo.isDirectDownload
            ? `زر التحديث سيفتح ${updateInfo.downloadLabel}${updateInfo.downloadFileName ? `: ${updateInfo.downloadFileName}` : ""}.`
            : "لم أجد ملف التثبيت المناسب، سيتم فتح صفحة الإصدارات.";
          setMessage(`${messageText} ${downloadText}`);
          await showUpdateNotification(`تحديث جديد لبرنامج ${FULL_APP_NAME}`, `${messageText} اضغط لتحميل ${updateInfo.downloadLabel}.`, updateInfo.downloadUrl);
          localStorage.setItem(UPDATE_LAST_ALERT_KEY, releaseLabel);
        }
        return updateInfo;
      }
      setAvailableUpdate(null);
      if (!quiet) setMessage(`لا يوجد تحديث جديد. أنت تستخدم v${VERSION}.`);
      return null;
    } catch (error) {
      if (!quiet) setMessage(`تعذر فحص التحديثات: ${safeErrorMessage(error)}`);
      return null;
    } finally {
      setCheckingUpdates(false);
    }
  }

  function openAvailableUpdate() {
    openReleasePage(availableUpdate?.downloadUrl || RELEASES_URL);
  }

  function logout() {
    if (currentDraftDirty()) {
      const confirmed = window.confirm("تسجيل الخروج سيمسح بيانات الإدخال الحالية. هل تريد المتابعة؟");
      settleAppFocus();
      if (!confirmed) return;
    }
    const client = getSupabaseClient();
    client?.auth?.signOut?.({ scope: "local" }).catch(() => null);
    if (sessionStorage.getItem(LOCAL_SESSION_TOKEN_KEY)) {
      localRequest("/api/auth/logout", { method: "POST" }).catch(() => null);
      sessionStorage.removeItem(LOCAL_SESSION_TOKEN_KEY);
    }
    clearSupabaseAuthStorage();
    resetSupabaseClientCache();
    localStorage.removeItem("glassOrdersUser");
    setCurrentUser(null);
    setData({ customers: [], suppliers: [], payments: [], orders: [], learnedOptions: GAP_DEFAULTS, learnedTableOptions: normalizeLearnedTableOptions() });
    setDraft(createDraft());
    setMessage("");
  }

  async function refresh() {
    setLoading(true);
    setLoadingFailure(null);
    setLoadingSlow(false);
    setLoadingStage("تهيئة مساحة العمل...");
    let failed = false;
    try {
      await syncPendingChanges({ quiet: true });
      setLoadingStage(hasSupabaseConfig() ? "جاري الاتصال الآمن بالبيانات..." : "جاري تحميل إعدادات المستخدم...");
      const next = await loadData();
      setLoadingStage("تجهيز بيانات الطلبات...");
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
      setMessage(next.source === "local-server" ? "تم الاتصال بالبيانات المحلية." : next.source === "supabase" ? "تم الاتصال بنجاح." : "البيانات المحلية جاهزة للاستخدام.");
    } catch (error) {
      failed = true;
      const detail = safeErrorMessage(error);
      setLoadingFailure(detail);
      setLoadingStage("تعذر إكمال بدء التشغيل.");
      setMessage(`تعذر تحميل البيانات: ${detail}`);
    } finally {
      if (!failed) {
        setLoadingStage("التطبيق جاهز");
        setLoading(false);
      }
    }
  }

  function captureEditorOrigin() {
    const workspace = document.querySelector(".workspace");
    const previewModal = document.querySelector(".modal-backdrop .modal.large");
    return {
      tab: activeTab,
      workspaceScrollTop: workspace?.scrollTop || 0,
      workspaceScrollLeft: workspace?.scrollLeft || 0,
      windowScrollX: window.scrollX || 0,
      windowScrollY: window.scrollY || 0,
      preview: preview ? plainClone(preview) : null,
      previewScrollTop: previewModal?.scrollTop || 0,
      previewScrollLeft: previewModal?.scrollLeft || 0
    };
  }

  function returnToEditorOrigin(nextData = appStateRef.current?.data || data) {
    const origin = editorOriginRef.current;
    if (!origin?.tab || (origin.tab === "entry" && !origin.preview)) return false;
    editorOriginRef.current = null;
    const restoredPreview = origin.preview ? refreshPreviewWithData(origin.preview, nextData) : null;
    setActiveTab(origin.tab);
    setPreview(restoredPreview);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const workspace = document.querySelector(".workspace");
        workspace?.scrollTo?.({ top: origin.workspaceScrollTop || 0, left: origin.workspaceScrollLeft || 0, behavior: "auto" });
        window.scrollTo?.({ top: origin.windowScrollY || 0, left: origin.windowScrollX || 0, behavior: "auto" });
        const previewModal = document.querySelector(".modal-backdrop .modal.large");
        previewModal?.scrollTo?.({ top: origin.previewScrollTop || 0, left: origin.previewScrollLeft || 0, behavior: "auto" });
        restoreRendererInputFocus({ preferredSelector: "[data-editor-return-focus], input:not([disabled]), button:not([disabled])" });
      });
    });
    return true;
  }

  async function saveDraft(options = {}) {
    if (savePromiseRef.current) return savePromiseRef.current;
    const run = (async () => {
      if (saveInFlightRef.current) return null;
      saveInFlightRef.current = true;
      setLoading(true);
      try {
        await waitForPaint(0);
        const sourceDraft = options.draftOverride || draft;
        const validation = validateOrderForSave(sourceDraft, { customers: data.customers, suppliers: data.suppliers });
        if (!validation.isValid) {
          setMessage([
            "تعذر حفظ الطلب لوجود بيانات مطلوبة غير مكتملة.",
            validation.errors[0]?.message
          ].filter(Boolean).join("\n"));
          setActiveTab("entry");
          return null;
        }
        let snapshot = orderSaveSnapshot({ ...sourceDraft, rows: validation.payloadRows });
        let loadedOrderForId = snapshot.id
          ? data.orders.find((order) => order.id === snapshot.id)
          : null;
        const duplicateLoadedOrderNo = snapshot.orderNo
          ? data.orders.find((order) => displayOrderNo(order.orderNo) === displayOrderNo(snapshot.orderNo) && (!snapshot.id || order.id !== snapshot.id))
          : null;
        if (!loadedOrderForId && duplicateLoadedOrderNo && isRecoverableEmptyOrderRecord(duplicateLoadedOrderNo)) {
          loadedOrderForId = duplicateLoadedOrderNo;
        }
        const saveAsExisting = !!loadedOrderForId;
        if (saveAsExisting && duplicateLoadedOrderNo && duplicateLoadedOrderNo.id !== loadedOrderForId.id) {
          setMessage("رقم الطلب مستخدم بالفعل في طلب آخر. يرجى اختيار رقم مختلف.");
          setActiveTab("entry");
          return null;
        }
        if (!saveAsExisting && duplicateLoadedOrderNo) {
          snapshot = {
            ...snapshot,
            orderNo: generateOrderNo(data.orders, snapshot.date)
          };
        }
        const persistentOrderId = saveAsExisting
          ? loadedOrderForId.id
          : (snapshot.id || snapshot.clientDocumentId || uid());
        const orderForSave = saveAsExisting
          ? { ...snapshot, id: loadedOrderForId.id, orderNo: loadedOrderForId.orderNo || snapshot.orderNo, _existingOrder: true }
          : {
              ...snapshot,
              _existingOrder: false,
              id: persistentOrderId,
              clientDocumentId: snapshot.clientDocumentId || persistentOrderId,
              orderNo: snapshot.orderNo || generateOrderNo(data.orders, snapshot.date)
            };
        persistSaveRecoveryDraft(orderForSave);
        const latestData = appStateRef.current?.data || data;
        const next = await saveOrderToStore(orderForSave, latestData);
        replaceAppData(next);
        setPendingSyncCount(readOfflineQueue().length);
        const saved = next.orders.find((order) => order.id && order.id === orderForSave.id) || next.orders.find((order) => order.orderNo === orderForSave.orderNo) || orderForSave;
        clearSaveRecoveryDraft();
        replaceDraftState(saved, JSON.stringify(saved));
        setMessage(`تم حفظ الطلب ${displayOrderNo(saved.orderNo)}`);
        if (options.returnToOrigin) returnToEditorOrigin(next);
        return saved;
      } catch (error) {
        setMessage(`تعذر الحفظ: ${friendlySaveError(error)}`);
        return null;
      } finally {
        saveInFlightRef.current = false;
        savePromiseRef.current = null;
        setLoading(false);
      }
    })();
    savePromiseRef.current = run;
    return run;
  }

  async function previewDraftOrder(draftOverride = null) {
    const sourceDraft = draftOverride || draftRef.current || draft;
    const validation = validateOrderForReport(sourceDraft);
    if (!validation.ok) {
      setMessage(validation.message || "تعذر تجهيز المعاينة قبل استكمال البيانات المطلوبة.");
      setActiveTab("entry");
      return null;
    }
    const previewOrder = createDraft({
      ...sourceDraft,
      rows: (sourceDraft.rows || []).filter((row) => !isCompletelyEmptyOrderRow(row))
    });
    setPreview({ type: "order", order: previewOrder });
    return previewOrder;
  }

  async function exportDraftOrderPdf() {
    const saved = await saveDraft();
    if (!saved) return null;
    return exportOrderPdf(saved, currentUser, reportLogoSrc);
  }

  async function exportDraftOrderExcel() {
    const saved = await saveDraft();
    if (!saved) return null;
    return exportOrderExcel(saved);
  }

  function currentDraftDirty() {
    if (draft.id) return !!draftSavedMarker && JSON.stringify(draft) !== draftSavedMarker;
    return draftHasManualInput(draft);
  }

  function settleAppFocus(preferredSelector = "") {
    window.setTimeout(() => restoreRendererInputFocus({ preferredSelector }), 0);
    window.setTimeout(() => restoreRendererInputFocus({ preferredSelector }), 90);
  }

  function confirmEntryReplace(reason = "استبدال بيانات الإدخال الحالية؟") {
    if (!currentDraftDirty()) return true;
    const confirmed = window.confirm(`${reason}\n\nهناك بيانات في شاشة الإدخال لم تحفظ أو لم تنهِ تعديلها. هل تريد المتابعة؟`);
    settleAppFocus();
    return confirmed;
  }

  function navigateToTab(target) {
    if (target !== "entry" && activeTab === "entry" && !confirmEntryReplace("مغادرة شاشة الإدخال؟")) return;
    setMobileMenuOpen(false);
    setActiveTab(target);
  }

  function newOrder(seed = {}, options = {}) {
    if (!options.force && !confirmEntryReplace("فتح طلب جديد؟")) return;
    const date = seed.date || today();
    const fresh = createDraft({ ...seed, orderNo: seed.orderNo || generateOrderNo(data.orders, date), date });
    editorOriginRef.current = null;
    pushAppHistory("فتح طلب جديد");
    setDraft(fresh);
    setDraftSavedMarker("");
    setActiveTab("entry");
    settleAppFocus(".table-control");
  }

  function openOrder(order) {
    if (!canCurrentUserEditOrder(currentUser, order)) {
      setMessage("لا تملك صلاحية تعديل هذا الطلب أو أن الطلب مقفل حالياً.");
      return false;
    }
    const orderLabel = displayOrderNo(order.orderNo);
    if (currentDraftDirty()) {
      if (!confirmEntryReplace(`فتح الطلب ${orderLabel} للتعديل؟`)) return false;
    } else {
      const confirmed = window.confirm(`فتح الطلب ${orderLabel} للتعديل؟`);
      settleAppFocus();
      if (!confirmed) return false;
    }
    if (activeTab !== "entry" || preview) editorOriginRef.current = captureEditorOrigin();
    const opened = createDraft(order);
    pushAppHistory("فتح طلب للتعديل");
    setDraft(opened);
    setDraftSavedMarker(JSON.stringify(opened));
    setActiveTab("entry");
    setMessage(`تم فتح الطلب ${orderLabel} للتعديل.`);
    settleAppFocus(".table-control");
    return true;
  }

  function copyOrder(order) {
    if (!confirmEntryReplace("نسخ هذا الطلب إلى إدخال جديد؟")) return;
    const copy = createDraft({
      ...order,
      id: "",
      clientDocumentId: uid(),
      orderNo: generateOrderNo(data.orders, today()),
      documentId: "",
      date: today(),
      entryAt: new Date().toISOString(),
      rows: order.rows.map((row) => makeRow({ ...row, id: uid() }))
    });
    pushAppHistory("نسخ طلب");
    setDraft(copy);
    setDraftSavedMarker("");
    setActiveTab("entry");
    settleAppFocus(".table-control");
  }

  function cancelEntrySession() {
    const hasOrigin = !!editorOriginRef.current?.tab;
    const text = hasOrigin
      ? "إلغاء التعديل والعودة إلى الشاشة السابقة دون حفظ التغييرات؟"
      : draft.id ? "إلغاء تعديل الطلب الحالي والرجوع لإدخال جديد؟" : "إلغاء الإدخال الحالي وبدء طلب جديد؟";
    const confirmed = window.confirm(text);
    settleAppFocus();
    if (!confirmed) return;
    if (hasOrigin) {
      const latestData = appStateRef.current?.data || data;
      const saved = findMatchingOrder(latestData.orders, draft);
      const nextDraft = saved ? createDraft(saved) : createDraft();
      replaceDraftState(nextDraft, saved ? JSON.stringify(nextDraft) : "");
      returnToEditorOrigin(latestData);
      setMessage("تم إلغاء التعديل والعودة إلى الشاشة السابقة.");
      return;
    }
    newOrder({}, { force: true });
    setMessage(draft.id ? "تم إلغاء التعديل وفتح إدخال جديد." : "تم مسح بيانات الإدخال.");
    settleAppFocus(".table-control");
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
      settleAppFocus();
    }
  }

  async function deleteSupplierPayment(payment) {
    if (!payment?.id) return;
    const confirmed = window.confirm("حذف هذه الدفعة؟");
    settleAppFocus();
    if (!confirmed) return;
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
      settleAppFocus();
    }
  }

  async function updateOrderStatus(order, patchValue) {
    if (appHistoryRef.current.busy) {
      setMessage("انتظر اكتمال التراجع أو الإعادة الحالية قبل تحديث الطلب.");
      return null;
    }
    let historyEntry = null;
    let mutation = null;
    let beforeOrder = null;
    let rowsChanged = false;
    let changedRowIds = [];
    try {
      const latestData = appStateRef.current?.data || data;
      const currentOrder = findMatchingOrder(latestData.orders, order) || order;
      beforeOrder = plainClone(currentOrder);
      changedRowIds = Array.isArray(patchValue?._receiptChangedRowIds)
        ? patchValue._receiptChangedRowIds.map((id) => String(id))
        : [];
      const statusPatch = { ...(patchValue || {}) };
      delete statusPatch._receiptChangedRowIds;
      rowsChanged = Object.prototype.hasOwnProperty.call(statusPatch, "rows");
      const rebasedRows = rowsChanged
        ? rebaseReceiptRowsPatch(currentOrder, order, statusPatch.rows)
        : (currentOrder.rows?.length ? currentOrder.rows : (order.rows || []));
      const { rows: _discardedRows, ...scalarStatusPatch } = statusPatch;
      let nextOrder = {
        ...currentOrder,
        ...scalarStatusPatch,
        id: currentOrder.id || order.id || "",
        orderNo: currentOrder.orderNo || order.orderNo || "",
        rows: rebasedRows,
        status: normalizeOrderStatus(scalarStatusPatch.status || currentOrder.status || order.status),
        _existingOrder: true
      };
      historyEntry = pushAppHistory("تحديث حالة طلب", {
        force: true,
        dataSnapshot: latestData,
        pending: true,
        persistence: {
          type: "order-status",
          beforeOrder,
          afterOrder: nextOrder,
          rowsChanged,
          changedRowIds
        }
      });
      const optimistic = mergeOrderStatusPatchData(latestData, nextOrder);
      replaceAppData(optimistic);
      mutation = enqueueOrderStatusPersistence(nextOrder, optimistic, {
        rowsChanged,
        changedRowIds
      });
      const persisted = await mutation.promise;
      if (historyEntry) historyEntry.pending = false;
      const activeMutation = orderStatusMutationRef.current.get(mutation.key);
      if (activeMutation?.version !== mutation.version) {
        return findMatchingOrder(appStateRef.current?.data?.orders || [], nextOrder) || nextOrder;
      }
      const latestAfterPersistence = appStateRef.current?.data || optimistic;
      const persistedOrder = findMatchingOrder(persisted?.orders || [], nextOrder) || nextOrder;
      const next = mergeOrderStatusPatchData(
        persisted?.offlinePending
          ? { ...latestAfterPersistence, source: "offline", offlinePending: true }
          : latestAfterPersistence,
        persistedOrder
      );
      replaceAppData(next);
      const saved = findMatchingOrder(next.orders, persistedOrder) || persistedOrder;
      const latestDraft = appStateRef.current?.draft || draft;
      if (sameOrderIdentity(latestDraft, currentOrder)) {
        const savedDraft = createDraft(saved);
        replaceDraftState(savedDraft, JSON.stringify(savedDraft));
      }
      setPendingSyncCount(readOfflineQueue().length);
      setMessage(Object.prototype.hasOwnProperty.call(statusPatch, "status")
        ? `تم تحديث حالة ${displayOrderNo(order.orderNo)}: ${statusLabel(saved.status)}`
        : `تم تحديث الطلب ${displayOrderNo(order.orderNo)}.`);
      return saved;
    } catch (error) {
      if (historyEntry) historyEntry.pending = false;
      const activeMutation = mutation ? orderStatusMutationRef.current.get(mutation.key) : null;
      const isLatestMutation = !mutation || activeMutation?.version === mutation.version;
      if (historyEntry && isLatestMutation) {
        appHistoryRef.current.undo = appHistoryRef.current.undo.filter((entry) => entry.id !== historyEntry.id);
      }
      if (beforeOrder && isLatestMutation) {
        const latestData = appStateRef.current?.data || data;
        const currentOrder = findMatchingOrder(latestData.orders || [], beforeOrder) || beforeOrder;
        const rollbackOrder = statusHistoryTarget(currentOrder, beforeOrder, rowsChanged);
        replaceAppData(mergeOrderStatusPatchData(latestData, rollbackOrder));
      }
      setMessage(`تعذر تحديث حالة الطلب: ${safeErrorMessage(error)}`);
      return null;
    }
  }

  async function confirmDeleteOrder(order) {
    if (!order || deleteOrderBusy) return;
    if (appHistoryRef.current.busy) {
      setMessage("انتظر اكتمال التراجع أو الإعادة الحالية قبل حذف الطلب.");
      return;
    }
    let deleted = false;
    setDeleteOrderBusy(true);
    setDeleteOrderTarget(null);
    setMessage(`جار حذف الطلب ${displayOrderNo(order.orderNo)}...`);
    cleanupRendererInteractionState();
    try {
      await waitForOrderStatusPersistence(order);
      const latestState = appStateRef.current || {};
      const currentData = latestState.data || data;
      const currentOrder = findMatchingOrder(currentData.orders || [], order) || order;
      const persistedNext = await deleteOrderFromStore(currentOrder, currentData);
      const afterPersistence = appStateRef.current?.data || currentData;
      const next = removeSavedOrderData(
        persistedNext?.offlinePending ? { ...afterPersistence, source: "offline", offlinePending: true } : afterPersistence,
        currentOrder
      );
      if (persistedNext?.offlinePending) {
        writeLocal(next);
        writeOfflineSnapshot(next);
      }
      const deleteHistoryEntry = pushAppHistory("حذف طلب", {
        force: true,
        dataSnapshot: afterPersistence,
        persistence: {
          type: "order-delete",
          order: currentOrder
        }
      });
      replaceAppData(next);
      setPendingSyncCount(readOfflineQueue().length);
      const latestDraft = latestState.draft || draft;
      if (sameOrderIdentity(latestDraft, currentOrder)) {
        const fresh = createDraft({ orderNo: generateOrderNo(next.orders || [], today()), date: today() });
        replaceDraftState(fresh, "");
      }
      deleted = true;
      setMessage(deleteHistoryEntry
        ? `تم حذف الطلب ${displayOrderNo(currentOrder.orderNo)}. يمكنك التراجع لاستعادته وحفظ الاستعادة.`
        : `تم حذف الطلب ${displayOrderNo(currentOrder.orderNo)}.`);
    } catch (error) {
      setMessage(`تعذر حذف الطلب: ${safeErrorMessage(error)}`);
    } finally {
      setDeleteOrderBusy(false);
      cleanupRendererInteractionState();
      const storedFocus = deleteOrderFocusRef.current;
      const preferredElement = deleted
        ? (document.contains(storedFocus.neighbor) ? storedFocus.neighbor : null)
        : (document.contains(storedFocus.trigger) ? storedFocus.trigger : null);
      deleteOrderFocusRef.current = { trigger: null, neighbor: null };
      if (preferredElement) {
        window.setTimeout(() => restoreRendererInputFocus({ preferredElement }), 0);
        window.setTimeout(() => restoreRendererInputFocus({ preferredElement }), 90);
      } else {
        settleAppFocus(".orders-status-stack button:not([disabled]), .orders-status-stack input:not([disabled])");
      }
    }
  }

  function closePreview() {
    setPreview(null);
    settleAppFocus();
  }

  function closeSupplierPayment() {
    setSupplierPayment(null);
    settleAppFocus();
  }

  function closeDeleteOrderModal() {
    const trigger = deleteOrderFocusRef.current.trigger;
    deleteOrderFocusRef.current = { trigger: null, neighbor: null };
    setDeleteOrderTarget(null);
    cleanupRendererInteractionState();
    if (trigger && document.contains(trigger)) {
      window.setTimeout(() => restoreRendererInputFocus({ preferredElement: trigger }), 0);
    } else {
      settleAppFocus();
    }
  }

  async function closePasswordRecovery() {
    await clearSupabaseRecoverySession(setPasswordRecoveryOpen, setCurrentUser);
    settleAppFocus();
  }

  function rememberTableOption(kind, value) {
    const cleanValue = cleanName(value);
    if (!cleanValue || !Object.prototype.hasOwnProperty.call(EMPTY_LEARNED_TABLE_OPTIONS, kind)) return;
    setData((current) => {
      const learnedTableOptions = learnTableOptionValue(current.learnedTableOptions, kind, cleanValue);
      const next = { ...current, learnedTableOptions };
      const local = readLocal();
      const mergedLocalLearned = mergeLearnedTableOptions(local.learnedTableOptions, learnedTableOptions);
      writeLearnedTableOptions(mergedLocalLearned);
      writeLocal({ ...local, learnedTableOptions: mergedLocalLearned });
      return next;
    });
  }

  const totals = orderTotals(draft);
  const smartOptions = useMemo(() => buildSmartOptions(data), [data]);
  const priceHistory = useMemo(() => buildPriceHistory(data.orders), [data.orders]);
  const projectOptions = useMemo(() => uniqueValues((data.orders || []).map((order) => order.project).filter(Boolean)), [data.orders]);
  const connectionLabel = data.source === "local-server" ? "بيانات محلية" : data.source === "supabase" ? "متصل" : "غير متصل";
  const cairoNow = useMemo(() => clockText("Africa/Cairo"), [clockTick]);
  const utcNow = useMemo(() => clockText("UTC"), [clockTick]);
  const appLogoSrc = appLogo;
  const reportLogoSrc = appearance.reportLogoDataUrl || loadingLogo;
  const updateNoticeAction = availableUpdate && /تحديث جديد/.test(message)
    ? { label: updateActionLabel(availableUpdate), onClick: openAvailableUpdate }
    : null;
  const pendingUndoEntry = appHistoryRef.current.undo[appHistoryRef.current.undo.length - 1];
  const pendingRedoEntry = appHistoryRef.current.redo[appHistoryRef.current.redo.length - 1];
  const historyStatus = {
    canUndo: appHistoryRef.current.undo.length > 0 && !appHistoryRef.current.busy && !pendingUndoEntry?.pending,
    canRedo: appHistoryRef.current.redo.length > 0 && !appHistoryRef.current.busy && !pendingRedoEntry?.pending,
    undoLabel: historyEntryLabel(pendingUndoEntry),
    redoLabel: historyEntryLabel(pendingRedoEntry)
  };

  if (!currentUser) {
    return (
      <>
        {loading && (
          <LoadingLayer
            logoSrc={loadingLogo}
            stage={loadingStage}
            version={runtimeVersion}
            slow={loadingSlow}
            error={loadingFailure}
            onRetry={loadingFailure ? refresh : null}
          />
        )}
        <LoginView
          onLogin={handleLogin}
          onResetPassword={handleResetSupabasePassword}
          supabaseMode={hasSupabaseConfig()}
          message={message}
          onClearMessage={() => setMessage("")}
          busy={loading}
          logoSrc={appLogoSrc}
          version={runtimeVersion}
        />
        {passwordRecoveryOpen && <PasswordRecoveryModal busy={loading} onSave={completePasswordRecovery} onClose={closePasswordRecovery} />}
      </>
    );
  }

  return (
    <main className={mobileMenuOpen ? "app-shell mobile-nav-open" : "app-shell"} data-active-tab={activeTab} dir="rtl">
      {loading && (
        <LoadingLayer
          logoSrc={loadingLogo}
          stage={loadingStage}
          version={runtimeVersion}
          slow={loadingSlow}
          error={loadingFailure}
          onRetry={loadingFailure ? refresh : null}
        />
      )}
      <button type="button" className="mobile-drawer-backdrop" aria-label="إغلاق القائمة" onClick={() => setMobileMenuOpen(false)} />
      <aside className="sidebar">
        <button type="button" className="mobile-drawer-close" onClick={() => setMobileMenuOpen(false)}><XCircle size={18} />إغلاق</button>
        <div className="brand-card">
          <BrandMark small logoSrc={appLogoSrc} />
          <div className="brand-copy">
            <strong dir="ltr">{BRAND_NAME}</strong>
            <span>{SUB_NAME}</span>
          </div>
        </div>
        <nav>
          {TABS.map(([id, label, Icon]) => (
            <button key={id} className={activeTab === id ? "active" : ""} onClick={() => navigateToTab(id)}>
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-product-footer">
          <span>{PRODUCT_LINE}</span>
          <small dir="ltr">Version {runtimeVersion}</small>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <div className="mobile-title-row">
              <button type="button" className="icon-button mobile-menu-button" title="القائمة" onClick={() => setMobileMenuOpen(true)}><Layers size={18} /></button>
              <h1>{TABS.find(([id]) => id === activeTab)?.[1]}</h1>
            </div>
            <p dir="ltr">{connectionLabel}</p>
          </div>
          <div className="top-actions">
            <span className="time-chip cairo-time" dir="ltr">Cairo {cairoNow}</span>
            <span className="time-chip utc-time" dir="ltr">UTC {utcNow}</span>
            <span className="user-chip">Eng. {currentUser.display_name}</span>
            <button className="icon-button" title={`تراجع — Ctrl+Z${historyStatus.canUndo ? `: ${historyStatus.undoLabel}` : ""}`} disabled={!historyStatus.canUndo} onClick={undoAppState}><Undo2 size={18} /></button>
            <button className="icon-button" title={`إعادة — Ctrl+Y${historyStatus.canRedo ? `: ${historyStatus.redoLabel}` : ""}`} disabled={!historyStatus.canRedo} onClick={redoAppState}><Redo2 size={18} /></button>
            <button className="icon-button" title="تحديث" onClick={refresh}><RefreshCw size={18} /></button>
            <button className="primary" onClick={() => newOrder()}><Plus size={18} />طلب جديد</button>
            <button className="icon-button" title="خروج" onClick={logout}><LogOut size={18} /></button>
          </div>
        </header>
        {message && <Notice message={message} action={updateNoticeAction} onClose={() => setMessage("")} />}
        <SyncStatusBanner online={online} pending={pendingSyncCount} syncing={syncing} onSync={() => syncPendingChanges()} />

        {activeTab === "dashboard" && (
          <DashboardView
            data={data}
            pendingSyncCount={pendingSyncCount}
            online={online}
            onOpenOrders={() => navigateToTab("orders")}
            onNewOrder={() => newOrder()}
            onEditOrder={openOrder}
            canEditOrder={(order) => canCurrentUserEditOrder(currentUser, order)}
            onCheckUpdates={() => checkForUpdates()}
            onOpenUpdate={openAvailableUpdate}
            checkingUpdates={checkingUpdates}
            availableUpdate={availableUpdate}
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
            projectOptions={projectOptions}
            priceHistory={priceHistory}
            totals={totals}
            saving={loading}
            onSave={(validatedDraft) => saveDraft({ returnToOrigin: true, draftOverride: validatedDraft })}
            onPreview={previewDraftOrder}
            onExportPdf={exportDraftOrderPdf}
            onExportExcel={exportDraftOrderExcel}
            onCancel={cancelEntrySession}
            notify={setMessage}
            onLearnTableOption={rememberTableOption}
            recordHistory={pushAppHistory}
            onUndo={undoAppState}
            onRedo={redoAppState}
            historyStatus={historyStatus}
          />
        )}
        {activeTab === "orders" && (
          <OrdersStatusView
            data={data}
            currentUser={currentUser}
            logoSrc={reportLogoSrc}
            onOpen={openOrder}
            onUpdateOrder={updateOrderStatus}
            onDeleteOrder={(order, trigger) => {
              if (deleteOrderBusy) return;
              const row = trigger?.closest?.(".status-row");
              const nextRow = row?.nextElementSibling?.classList?.contains("status-row") ? row.nextElementSibling : null;
              const previousRow = row?.previousElementSibling?.classList?.contains("status-row") && !row.previousElementSibling.classList.contains("status-head")
                ? row.previousElementSibling
                : null;
              deleteOrderFocusRef.current = {
                trigger: trigger || document.activeElement,
                neighbor: (nextRow || previousRow)?.querySelector?.("button:not([disabled]), input:not([disabled]), select:not([disabled])") || null
              };
              cleanupRendererInteractionState();
              setDeleteOrderTarget(order);
            }}
            onPreview={(report) => setPreview({ type: "orderStatus", report })}
          />
        )}
        {activeTab === "customers" && (
          <CustomersView
            orders={data.orders}
            customers={data.customers}
            onOpen={openOrder}
            onCopy={copyOrder}
            onPreview={(order) => setPreview({ type: "order", order })}
            canEditOrder={(order) => canCurrentUserEditOrder(currentUser, order)}
            currentUser={currentUser}
            logoSrc={reportLogoSrc}
          />
        )}
        {activeTab === "suppliers" && (
          <SuppliersView
            data={data}
            onPayment={setSupplierPayment}
            onEditPayment={(supplier, payment) => setSupplierPayment({ ...supplier, payment })}
            onDeletePayment={deleteSupplierPayment}
            onPreview={(statement) => setPreview({ type: "supplier", statement })}
            onExportPdf={(statement) => exportSupplierPdf(statement, currentUser, reportLogoSrc)}
            onExportExcel={exportSupplierExcel}
            onOpen={openOrder}
            canEditOrder={(order) => canCurrentUserEditOrder(currentUser, order)}
          />
        )}
        {activeTab === "manufacturing" && (
          <ManufacturingView
            data={data}
            onNotify={setMessage}
            onOpen={openOrder}
            canEditOrder={(order) => canCurrentUserEditOrder(currentUser, order)}
          />
        )}
        {activeTab === "statements" && (
          <StatementsView
            data={data}
            onPreview={(statement) => setPreview({ type: "statement", statement })}
            onExportPdf={(statement) => exportStatementPdf(statement, currentUser, reportLogoSrc)}
            onExportExcel={exportStatementExcel}
            onOpen={openOrder}
            canEditOrder={(order) => canCurrentUserEditOrder(currentUser, order)}
          />
        )}
        {activeTab === "settings" && <SettingsView refreshAll={refresh} localStatus={localStatus} setMessage={setMessage} setLocalStatus={setLocalStatus} currentUser={currentUser} data={data} setData={setDataWithHistory} appearance={appearance} setAppearance={setAppearance} reportLogoSrc={reportLogoSrc} onCheckUpdates={() => checkForUpdates()} onOpenUpdate={openAvailableUpdate} checkingUpdates={checkingUpdates} availableUpdate={availableUpdate} appVersion={runtimeVersion} />}
      </section>

      {preview && (
        <PreviewModal
          preview={preview}
          currentUser={currentUser}
          logoSrc={reportLogoSrc}
          onClose={closePreview}
        />
      )}
      {supplierPayment && <PaymentModal supplier={supplierPayment} onClose={closeSupplierPayment} onSave={addSupplierPayment} />}
      {deleteOrderTarget && <DeleteOrderModal order={deleteOrderTarget} busy={deleteOrderBusy} onClose={closeDeleteOrderModal} onConfirm={confirmDeleteOrder} />}
      {passwordRecoveryOpen && <PasswordRecoveryModal busy={loading} onSave={completePasswordRecovery} onClose={closePasswordRecovery} />}
    </main>
  );
}

function Notice({ message, action, onClose }) {
  const tone = noticeTone(message);
  return (
    <div className={`notice ${tone}`} role="status">
      <span>{message}</span>
      {action && <button className="notice-action" type="button" onClick={action.onClick}>{action.label}</button>}
      <button className="notice-close" type="button" title="إغلاق" onClick={onClose}><XCircle size={16} /></button>
    </div>
  );
}

function DeleteOrderModal({ order, busy, onClose, onConfirm }) {
  const [confirmation, setConfirmation] = useState("");
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  closeRef.current = onClose;
  busyRef.current = busy;
  const canDelete = confirmation.trim() === "حذف";
  useEffect(() => {
    function handleEscape(event) {
      if (event.key !== "Escape" || busyRef.current) return;
      preventCancelableDefault(event);
      closeRef.current();
    }
    window.addEventListener("keydown", handleEscape, true);
    return () => {
      window.removeEventListener("keydown", handleEscape, true);
      cleanupRendererInteractionState();
    };
  }, []);
  return (
    <div
      className="hard-delete-backdrop"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <form
        className="hard-delete-modal"
        onSubmit={(event) => {
          preventCancelableDefault(event);
          if (canDelete && !busy) onConfirm(order);
        }}
      >
        <div className="hard-delete-warning">
          <Trash2 size={34} />
          <strong>سيتم حذف الملف نهائياً. هذه الخطوة للضرورة القصوى فقط.</strong>
        </div>
        <div className="hard-delete-summary">
          <span>رقم الطلب</span>
          <strong dir="ltr">{displayOrderNo(order.orderNo)}</strong>
          <span>العميل</span>
          <strong>{order.customerName || "بدون عميل"}</strong>
        </div>
        <p>سيتم حذف الطلب وكل صفوفه ورسوماته من قاعدة البيانات. لا تستخدم هذا الزر إلا عند الحاجة المؤكدة.</p>
        <label className="hard-delete-input">
          <span>اكتب كلمة حذف للتأكيد</span>
          <input autoFocus value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="حذف" />
        </label>
        <div className="actions modal-actions">
          <button type="button" onClick={onClose} disabled={busy}>إلغاء</button>
          <button type="submit" className="hard-delete-button" disabled={busy || !canDelete}>
            <Trash2 size={18} />حذف نهائي
          </button>
        </div>
      </form>
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
      <span>{online ? `بانتظار مزامنة ${pending} عملية.` : "لا يوجد اتصال بالإنترنت. ستتم المزامنة عند عودة الاتصال."}</span>
      {online && pending > 0 && <button type="button" className="tiny" onClick={onSync} disabled={syncing}>{syncing ? "جار المزامنة" : "مزامنة الآن"}</button>}
    </div>
  );
}

function DashboardView({ data, pendingSyncCount, online, onOpenOrders, onNewOrder, onEditOrder, canEditOrder = () => true, onCheckUpdates, onOpenUpdate, checkingUpdates, availableUpdate }) {
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
          <button type="button" onClick={availableUpdate ? onOpenUpdate : onCheckUpdates} disabled={checkingUpdates}>
            {checkingUpdates ? <Loader2 size={18} className="spin" /> : <Download size={18} />}
            {availableUpdate ? updateActionLabel(availableUpdate) : "فحص التحديث"}
          </button>
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
          <span>{pendingSyncCount ? `${pendingSyncCount} عملية في انتظار المزامنة` : "كل البيانات متزامنة"}</span>
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
              {canEditOrder(order) && (
                <button type="button" className="icon-button mini-order-edit" title="تعديل الطلب" aria-label={`تعديل الطلب ${displayOrderNo(order.orderNo)}`} onClick={() => onEditOrder(order)}>
                  <Pencil size={15} />
                </button>
              )}
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
      <img className="brand-logo-img" src={logoSrc} alt="Y.D Glass Manager" />
    </div>
  );
}

function LoadingLayer({
  logoSrc = loadingLogo,
  stage = "جاري تجهيز مساحة العمل...",
  version = VERSION,
  slow = false,
  error = "",
  onRetry = null
}) {
  const [showDetails, setShowDetails] = useState(false);
  return (
    <div className={error ? "loading-layer loading-failed" : "loading-layer"} dir="rtl" role={error ? "alert" : "status"} aria-live="polite">
      <div className="mask-blur" />
      <div className="loading-brand-art" aria-hidden="true">
        <img src={logoSrc} alt="" />
      </div>
      <div className="loading-copy">
        <strong dir="ltr">{BRAND_NAME}</strong>
        <span>{SUB_NAME}</span>
      </div>
      <div className="loading-stage">
        <span>{stage}</span>
        {!error && <i aria-hidden="true" />}
      </div>
      {slow && !error && <p className="loading-slow">يستغرق الاتصال وقتاً أطول من المعتاد...</p>}
      {error && (
        <div className="loading-recovery">
          <div className="loading-recovery-actions">
            {onRetry && <button type="button" className="primary" onClick={onRetry}>إعادة المحاولة</button>}
            <button type="button" onClick={() => setShowDetails((value) => !value)}>
              {showDetails ? "إخفاء التفاصيل" : "عرض التفاصيل"}
            </button>
          </div>
          {showDetails && <pre>{error}</pre>}
        </div>
      )}
      <footer>
        <span dir="ltr">{PRODUCT_LINE}</span>
        <small dir="ltr">Version {version}</small>
      </footer>
    </div>
  );
}

function LoginView({ onLogin, onResetPassword, supabaseMode, message, onClearMessage, busy, logoSrc, version = VERSION }) {
  const [username, setUsername] = useState(() => (
    localStorage.getItem("glassOrdersLastUsername")
    || localStorage.getItem("glassOrdersLastEmail")
    || ""
  ));
  const [email, setEmail] = useState(() => localStorage.getItem("glassOrdersLastEmail") || "");
  const [password, setPassword] = useState("");
  async function submit(event) {
    preventCancelableDefault(event);
    if (username) localStorage.setItem("glassOrdersLastUsername", username);
    if (username.includes("@")) localStorage.setItem("glassOrdersLastEmail", username);
    else if (email) localStorage.setItem("glassOrdersLastEmail", email);
    await onLogin({ username, email, password });
  }
  async function resetPassword() {
    localStorage.setItem("glassOrdersLastUsername", username);
    if (username.includes("@")) localStorage.setItem("glassOrdersLastEmail", username);
    else if (email) localStorage.setItem("glassOrdersLastEmail", email);
    await onResetPassword?.({ username, email: username.includes("@") ? username : email });
  }
  return (
    <main className="login-shell" dir="rtl">
      <section className="login-panel">
        <div className="login-brand">
          <BrandMark small logoSrc={logoSrc} />
          <div>
            <span>مرحباً بك في</span>
            <strong dir="ltr">{FULL_APP_NAME}</strong>
            <small>{SUB_NAME}</small>
          </div>
        </div>
        <p className="login-intro">منصة متكاملة لإدارة أوامر الزجاج، الموردين، الاستلام، التصنيع والتقارير.</p>
        <form className="login-form" onSubmit={submit}>
          <Field label={supabaseMode ? "اسم المستخدم أو البريد الإلكتروني" : "اسم المستخدم"}>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              required
            />
          </Field>
          <Field label="كلمة المرور">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </Field>
          <button className="primary" disabled={busy}>
            {busy ? <Loader2 className="spin" size={18} /> : <Database size={18} />}
            تسجيل الدخول
          </button>
          {supabaseMode && (
            <div className="login-secondary-actions">
              <button type="button" onClick={resetPassword} disabled={busy || !username}><KeyRound size={16} />إعادة تعيين كلمة المرور</button>
            </div>
          )}
        </form>
        <footer className="login-product-footer">
          <span dir="ltr">{PRODUCT_LINE}</span>
          <small dir="ltr">Version {version}</small>
        </footer>
        <div className="login-help">
          <span>{supabaseMode ? "تسجيل دخول آمن" : "إعداد الاتصال غير مكتمل. راجع مسؤول النظام."}</span>
        </div>
        {message && <Notice message={message} onClose={onClearMessage} />}
      </section>
    </main>
  );
}

function PasswordRecoveryModal({ busy, onSave, onClose }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const passwordValid = password.length >= 10 && password.length <= 256;
  const passwordsMatch = password === confirm;
  async function submit(event) {
    preventCancelableDefault(event);
    if (!passwordValid || !passwordsMatch) return;
    await onSave(password);
  }
  return (
    <div className="modal-backdrop">
      <form className="modal recovery-modal" onSubmit={submit}>
        <div className="panel-head">
          <h2><KeyRound size={18} /> تعيين كلمة مرور جديدة</h2>
          <button type="button" onClick={onClose} disabled={busy}><XCircle size={18} />إغلاق</button>
        </div>
        <div className="form-grid">
          <Field label="كلمة المرور الجديدة">
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={10} maxLength={256} required />
          </Field>
          <Field label="تأكيد كلمة المرور">
            <input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" minLength={10} maxLength={256} required />
          </Field>
          <p className={`hint${password && !passwordValid ? " danger-text" : ""}`} aria-live="polite">
            {password && !passwordValid ? "كلمة المرور يجب ألا تقل عن 10 أحرف." : confirm && !passwordsMatch ? "تأكيد كلمة المرور غير مطابق." : "استخدم 10 أحرف على الأقل."}
          </p>
        </div>
        <div className="actions modal-actions">
          <button className="primary" type="submit" disabled={busy || !passwordValid || !passwordsMatch}><Save size={18} />حفظ كلمة المرور</button>
        </div>
      </form>
    </div>
  );
}

function rowHasReportDrawing(row = {}) {
  if (rowHasPanels(row)) return true;
  const drawing = normalizeDrawing(row.drawing);
  return drawingHasContent({ ...drawing, panels: [] });
}

const ENTRY_TABLE_COLUMNS = [
  { key: "index", label: "#", width: 42, min: 42 },
  { key: "description", label: "البيان", width: 310, min: 180 },
  { key: "mode", label: "النظام", width: 118, min: 88 },
  { key: "layers", label: "الطبقات والأسعار", width: 1272, min: 720 },
  { key: "code", label: "الكود", width: 130, min: 90 },
  { key: "notes", label: "ملاحظات", width: 220, min: 120 },
  { key: "area", label: "م2", width: 82, min: 70 },
  { key: "invoice", label: "إجمالي الفاتورة", width: 108, min: 88 },
  { key: "supplier", label: "تكلفة المورد", width: 116, min: 88 },
  { key: "drawing", label: "الرسم", width: 86, min: 66 },
  { key: "copyDown", label: "نسخ لأسفل", width: 64, min: 52 },
  { key: "copyRow", label: "نسخ صف", width: 64, min: 52 },
  { key: "color", label: "لون", width: 46, min: 42 },
  { key: "alpha", label: "شفافية", width: 64, min: 56 },
  { key: "mirror", label: "Mirror", width: 76, min: 64 },
  { key: "delete", label: "", width: 48, min: 44 }
];

const LAYER_TABLE_COLUMNS = [
  { key: "index", label: "#", width: 28, min: 28 },
  { key: "width", label: "عرض سم", width: 76, min: 64 },
  { key: "height", label: "طول سم", width: 76, min: 64 },
  { key: "quantity", label: "العدد", width: 70, min: 58 },
  { key: "glassType", label: "نوع الزجاج", width: 142, min: 100 },
  { key: "company", label: "الشركة", width: 160, min: 110 },
  { key: "thickness", label: "السمك", width: 92, min: 72 },
  { key: "unitPrice", label: "سعر/م2", width: 92, min: 72 },
  { key: "supplierUnitPrice", label: "تكلفة/م2", width: 92, min: 72 },
  { key: "secure", label: "سيكوريت", width: 82, min: 66 }
];

function storedTableWidths(key, definitions) {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "[]");
    return definitions.map((column, index) => Math.max(column.min, numberValue(saved[index], column.width)));
  } catch {
    return definitions.map((column) => column.width);
  }
}

function EntryView({ draft, setDraft, customers, suppliers, learnedOptions, smartOptions, projectOptions, priceHistory, totals, saving = false, onSave, onPreview, onExportPdf, onExportExcel, onCancel, notify, onLearnTableOption = () => {}, recordHistory = () => {}, onUndo = () => {}, onRedo = () => {}, historyStatus = {} }) {
  const [tableFullScreen, setTableFullScreen] = useState(false);
  const [deleteRowIndexes, setDeleteRowIndexes] = useState(null);
  const [invalidRowIndex, setInvalidRowIndex] = useState(null);
  const [validationErrors, setValidationErrors] = useState([]);
  const [activeCell, setActiveCell] = useState(null);
  const [editingCell, setEditingCell] = useState(null);
  const [selectedRange, setSelectedRange] = useState(null);
  const [selectedRowIds, setSelectedRowIds] = useState([]);
  const [rowContextMenu, setRowContextMenu] = useState(null);
  const [pastePreferences, setPastePreferences] = useState(() => {
    try {
      return normalizePastePreferences(JSON.parse(localStorage.getItem(PASTE_PREFERENCES_STORAGE_KEY) || "{}"));
    } catch {
      return normalizePastePreferences();
    }
  });
  const [entryColumnWidths, setEntryColumnWidths] = useState(() => storedTableWidths("glassEntryColumnWidths", ENTRY_TABLE_COLUMNS));
  const [layerColumnWidths, setLayerColumnWidths] = useState(() => storedTableWidths("glassLayerColumnWidths", LAYER_TABLE_COLUMNS));
  const [entryRowHeights, setEntryRowHeights] = useState({});
  const tableScrollRef = useRef(null);
  const addRowButtonRef = useRef(null);
  const draftRef = useRef(draft);
  const pendingTableFocusRef = useRef(null);
  const rangeDragRef = useRef(null);
  const pointerGestureCleanupRef = useRef(new Set());
  const rowSelectionAnchorRef = useRef(null);
  const layersColumnIndex = ENTRY_TABLE_COLUMNS.findIndex((column) => column.key === "layers");
  const layerColumnTotal = layerColumnWidths.reduce((sum, width) => sum + width, 0);
  const effectiveEntryColumnWidths = entryColumnWidths.map((width, index) => index === layersColumnIndex ? layerColumnTotal : width);
  draftRef.current = draft;
  const currentRows = () => (draftRef.current || draft).rows || [];

  useEffect(() => {
    setValidationErrors([]);
  }, [draft.clientDocumentId]);

  useEffect(() => {
    if (!pendingTableFocusRef.current) return;
    const pending = pendingTableFocusRef.current;
    pendingTableFocusRef.current = null;
    if (!draft.rows.length || pending.empty) {
      focusAddRowControl();
      return;
    }
    const resolvedRow = pending.rowId
      ? draft.rows.findIndex((row) => row.id === pending.rowId)
      : pending.row;
    focusEntryTableControl(resolvedRow >= 0 ? resolvedRow : Math.min(pending.row || 0, draft.rows.length - 1), pending.column);
  }, [draft.rows]);

  useEffect(() => {
    const node = tableScrollRef.current;
    if (!node) return undefined;
    function handleWheel(event) {
      if (!event.shiftKey) return;
      preventCancelableDefault(event);
      node.scrollLeft += event.deltaY;
    }
    node.addEventListener("wheel", handleWheel, { passive: false });
    return () => node.removeEventListener("wheel", handleWheel);
  }, []);

  useEffect(() => localStorage.setItem("glassEntryColumnWidths", JSON.stringify(entryColumnWidths)), [entryColumnWidths]);
  useEffect(() => localStorage.setItem("glassLayerColumnWidths", JSON.stringify(layerColumnWidths)), [layerColumnWidths]);
  useEffect(() => {
    localStorage.setItem(PASTE_PREFERENCES_STORAGE_KEY, JSON.stringify(pastePreferences));
  }, [pastePreferences]);
  useEffect(() => {
    const requiredWidth = layerColumnWidths.reduce((sum, width) => sum + width, 0);
    setEntryColumnWidths((current) => current[layersColumnIndex] === requiredWidth ? current : current.map((width, index) => index === layersColumnIndex ? requiredWidth : width));
  }, [layerColumnWidths]);
  useEffect(() => {
    function cancelTrackedInteractions() {
      cancelEntryPointerGestures();
      rangeDragRef.current = null;
      setRowContextMenu(null);
    }
    window.addEventListener("glass-orders-cancel-interactions", cancelTrackedInteractions);
    return () => {
      window.removeEventListener("glass-orders-cancel-interactions", cancelTrackedInteractions);
      cancelEntryPointerGestures();
    };
  }, []);
  useEffect(() => {
    if (!rowContextMenu) return undefined;
    function closeContextMenu(event) {
      if (event?.target?.closest?.(".entry-row-context-menu")) return;
      setRowContextMenu(null);
    }
    function closeContextMenuWithKeyboard(event) {
      if (event.key !== "Escape") return;
      preventCancelableDefault(event);
      setRowContextMenu(null);
    }
    document.addEventListener("pointerdown", closeContextMenu, true);
    window.addEventListener("blur", closeContextMenu, true);
    window.addEventListener("scroll", closeContextMenu, true);
    window.addEventListener("keydown", closeContextMenuWithKeyboard, true);
    return () => {
      document.removeEventListener("pointerdown", closeContextMenu, true);
      window.removeEventListener("blur", closeContextMenu, true);
      window.removeEventListener("scroll", closeContextMenu, true);
      window.removeEventListener("keydown", closeContextMenuWithKeyboard, true);
    };
  }, [rowContextMenu]);

  function cancelEntryPointerGestures() {
    for (const cleanup of [...pointerGestureCleanupRef.current]) {
      try { cleanup(); } catch { /* Interaction cleanup must remain best-effort. */ }
    }
    pointerGestureCleanupRef.current.clear();
    document.body.classList.remove("row-resizing", "column-resizing", "drawing-dragging", "table-busy");
  }

  function registerEntryPointerGesture({ move, finish, target, pointerId, bodyClass }) {
    let complete = false;
    function cleanup() {
      if (complete) return;
      complete = true;
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", stop, true);
      window.removeEventListener("pointercancel", stop, true);
      window.removeEventListener("blur", stop, true);
      if (bodyClass) document.body.classList.remove(bodyClass);
      try {
        if (target?.hasPointerCapture?.(pointerId)) target.releasePointerCapture(pointerId);
      } catch { /* Capture may already have ended. */ }
      pointerGestureCleanupRef.current.delete(cleanup);
    }
    function stop(event) {
      cleanup();
      finish?.(event);
    }
    if (bodyClass) document.body.classList.add(bodyClass);
    try { target?.setPointerCapture?.(pointerId); } catch { /* Native capture is optional. */ }
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", stop, true);
    window.addEventListener("pointercancel", stop, true);
    window.addEventListener("blur", stop, true);
    pointerGestureCleanupRef.current.add(cleanup);
    return cleanup;
  }

  function widthsForRequestedTotal(currentWidths, definitions, requestedTotal) {
    const minTotal = definitions.reduce((sum, column) => sum + column.min, 0);
    const targetTotal = Math.max(minTotal, Math.round(numberValue(requestedTotal, minTotal)));
    const currentTotal = currentWidths.reduce((sum, width) => sum + width, 0) || minTotal;
    if (targetTotal === currentTotal) return currentWidths;
    let next;
    if (targetTotal > currentTotal) {
      const factor = targetTotal / currentTotal;
      next = currentWidths.map((width, index) => Math.max(definitions[index].min, Math.round(width * factor)));
    } else {
      const reduction = currentTotal - targetTotal;
      const flexTotal = currentWidths.reduce((sum, width, index) => sum + Math.max(0, width - definitions[index].min), 0);
      if (flexTotal <= 0) return definitions.map((column) => column.min);
      next = currentWidths.map((width, index) => {
        const flex = Math.max(0, width - definitions[index].min);
        return Math.max(definitions[index].min, Math.round(width - reduction * (flex / flexTotal)));
      });
    }
    let diff = targetTotal - next.reduce((sum, width) => sum + width, 0);
    let guard = 0;
    while (diff !== 0 && guard < 200) {
      const index = diff > 0
        ? next.findIndex(() => true)
        : next.findIndex((width, columnIndex) => width > definitions[columnIndex].min);
      if (index < 0) break;
      next[index] += diff > 0 ? 1 : -1;
      diff += diff > 0 ? -1 : 1;
      guard += 1;
    }
    return next;
  }

  function beginColumnResize(kind, columnIndex, event) {
    if (event.button !== 0) return;
    preventCancelableDefault(event);
    event.stopPropagation();
    const definitions = kind === "layer" ? LAYER_TABLE_COLUMNS : ENTRY_TABLE_COLUMNS;
    const widths = kind === "layer" ? layerColumnWidths : entryColumnWidths;
    const setter = kind === "layer" ? setLayerColumnWidths : setEntryColumnWidths;
    const startX = event.clientX;
    const isLayerParent = kind === "entry" && definitions[columnIndex]?.key === "layers";
    const startWidth = isLayerParent ? layerColumnTotal : widths[columnIndex];
    const resizedIndexes = selectedColumnDefinitionIndexes(kind, columnIndex);
    function move(moveEvent) {
      const delta = startX - moveEvent.clientX;
      const nextWidth = Math.max(definitions[columnIndex].min, Math.round(startWidth + delta));
      if (isLayerParent) {
        setLayerColumnWidths((current) => widthsForRequestedTotal(current, LAYER_TABLE_COLUMNS, nextWidth));
        return;
      }
      setter((current) => current.map((width, index) => resizedIndexes.includes(index) ? Math.max(definitions[index].min, nextWidth) : width));
    }
    registerEntryPointerGesture({
      move,
      target: event.currentTarget,
      pointerId: event.pointerId,
      bodyClass: "column-resizing"
    });
  }
  function rowHeightFor(rowIndex) {
    const rowId = rowIdAt(rowIndex);
    const savedHeight = Object.prototype.hasOwnProperty.call(entryRowHeights, rowId) ? entryRowHeights[rowId] : 68;
    return Math.max(48, Math.min(220, numberValue(savedHeight, 68)));
  }
  function selectedRowsForResize(rowIndex) {
    const bounds = tableRangeBounds();
    if (!bounds || rowIndex < bounds.rowStart || rowIndex > bounds.rowEnd) return [rowIndex];
    const rows = [];
    for (let index = bounds.rowStart; index <= bounds.rowEnd; index += 1) rows.push(index);
    return rows;
  }
  function beginRowResize(rowIndex, event) {
    if (event.button !== 0) return;
    preventCancelableDefault(event);
    event.stopPropagation();
    const startY = event.clientY;
    const targetRows = selectedRowsForResize(rowIndex);
    const startHeights = Object.fromEntries(targetRows.map((index) => [rowIdAt(index), rowHeightFor(index)]));
    function move(moveEvent) {
      const delta = moveEvent.clientY - startY;
      setEntryRowHeights((current) => {
        const next = { ...current };
        for (const [rowId, startHeight] of Object.entries(startHeights)) {
          if (!rowId) continue;
          next[rowId] = Math.max(48, Math.min(220, Math.round(startHeight + delta)));
        }
        return next;
      });
    }
    registerEntryPointerGesture({
      move,
      target: event.currentTarget,
      pointerId: event.pointerId,
      bodyClass: "row-resizing"
    });
  }

  function patch(patchValue) {
    setInvalidRowIndex(null);
    recordHistory("تعديل بيانات الطلب", { coalesceMs: 900, key: "draft-meta" });
    setDraft((current) => ({ ...current, ...patchValue }));
  }
  function selectedPartyPatch(parties, value, nameField, idField) {
    const normalized = cleanName(value).toLocaleLowerCase();
    const selected = (parties || []).find((party) => cleanName(party.name).toLocaleLowerCase() === normalized);
    patch({ [nameField]: value, [idField]: selected?.id || "" });
  }
  function rememberRows(rows, options = {}) {
    const editKey = editingCell ? `${editingCell.rowId || editingCell.row}:${editingCell.column}` : "";
    const label = options.label || (editKey ? "تعديل خلية" : "تعديل جدول الإدخال");
    const coalesceMs = Object.prototype.hasOwnProperty.call(options, "coalesceMs") ? options.coalesceMs : (editKey ? 900 : 0);
    const key = options.key || (editKey ? `cell:${editKey}` : label);
    recordHistory(label, { force: !!options.force, coalesceMs, key });
  }
  function setRowsWithHistory(mapper, options = {}) {
    setInvalidRowIndex(null);
    rememberRows(draft.rows, { force: true, label: options.label || "تعديل جدول الإدخال", key: options.key || options.label || "table-edit" });
    setDraft((current) => {
      return { ...current, rows: mapper(cloneOrderRows(current.rows), current) };
    });
  }
  function updateRow(index, updater, options = {}) {
    setInvalidRowIndex(null);
    const rowId = draft.rows[index]?.id || "";
    rememberRows(draft.rows, {
      label: options.label || "تعديل صف",
      coalesceMs: Object.prototype.hasOwnProperty.call(options, "coalesceMs") ? options.coalesceMs : 700,
      key: options.key || `row:${rowId || index}`
    });
    setDraft((current) => {
      const rows = [...(current.rows || [])];
      const currentRowIndex = rowId
        ? rows.findIndex((row) => row.id === rowId)
        : index;
      if (currentRowIndex < 0 || currentRowIndex >= rows.length) return current;
      rows[currentRowIndex] = typeof updater === "function"
        ? updater(rows[currentRowIndex])
        : { ...rows[currentRowIndex], ...updater };
      return { ...current, rows };
    });
  }
  function addRow() {
    const newRow = makeRow();
    setInvalidRowIndex(null);
    rememberRows(draft.rows, { force: true, label: "إضافة صف", key: "add-row" });
    pendingTableFocusRef.current = { row: draft.rows.length, rowId: newRow.id, column: "rowCode" };
    setDraft((current) => ({ ...current, rows: [...(current.rows || []), newRow] }));
  }
  function focusAddRowControl() {
    restoreRendererInputFocus({ preferredElement: addRowButtonRef.current });
  }
  function tableControlSelector(rowIndex, column = "rowCode") {
    const escapedColumn = window.CSS?.escape ? CSS.escape(String(column)) : String(column).replace(/["\\]/g, "\\$&");
    return `.table-control[data-row="${rowIndex}"][data-col="${escapedColumn}"]`;
  }
  function isDropdownCellColumn(column = "") {
    return column === "mode" ||
      column === "extraDirection" ||
      column === "doubleGap" ||
      column === "triplexPvb";
  }
  function openEntryTableDropdown(rowIndex, column, attempt = 0) {
    const target = document.querySelector(tableControlSelector(rowIndex, column));
    if (!target) {
      if (attempt < 8) window.setTimeout(() => openEntryTableDropdown(rowIndex, column, attempt + 1), 30);
      return false;
    }
    target.closest(".table-entry")?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    if (target.tagName === "SELECT") {
      target.focus?.();
      try {
        if (typeof target.showPicker === "function") target.showPicker();
        else target.click?.();
      } catch {
        target.click?.();
      }
      return true;
    }
    const combo = target.closest?.(".combo");
    if (combo) {
      target.focus?.();
      combo.dispatchEvent(new CustomEvent("glass-orders-open-combo", { bubbles: false }));
      return true;
    }
    restoreRendererInputFocus({ preferredElement: target });
    return true;
  }
  function activateDropdownCell(rowIndex, column) {
    const nextCell = makeTableCell(rowIndex, column);
    if (editingCell && !sameTableCell(editingCell, nextCell)) {
      commitEditingCell();
    }
    window.dispatchEvent(new Event("glass-orders-cancel-interactions"));
    setSelectedRowIds([]);
    setActiveCell(nextCell);
    setSelectedRange({ anchor: nextCell, focus: nextCell });
    setEditingCell(nextCell);
    window.requestAnimationFrame(() => openEntryTableDropdown(rowIndex, column));
  }
  function focusEntryTableControl(rowIndex, column = "rowCode", attempt = 0, options = {}) {
    const fallbackColumns = options.exact ? [column] : [column, "rowCode", "notes", "quantity", "mode"];
    const selectors = fallbackColumns.map((item) => tableControlSelector(rowIndex, item)).join(", ");
    const target = document.querySelector(selectors);
    if (target) {
      target.closest(".table-entry")?.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
      if (options.focus === false) return true;
      restoreRendererInputFocus({ preferredElement: target, select: options.select, caretEnd: options.caretEnd });
      return true;
    }
    if (attempt < 8) {
      window.setTimeout(() => focusEntryTableControl(rowIndex, column, attempt + 1, options), 35);
      return false;
    }
    if (options.focus !== false) restoreRendererInputFocus({ select: options.select, caretEnd: options.caretEnd });
    return false;
  }
  function cellRenderValue(_rowIndex, _column, fallback = "") {
    return fallback;
  }
  function applyEntryCellValueToRow(row, column, value) {
    const result = applyCellValueToRow(row, column, value);
    if (!result.ok) return result;
    let nextRow = result.row;
    const layerMatch = String(column || "").match(/^layer(\d+)-(.+)$/);
    if (layerMatch) {
      const layerIndex = Number(layerMatch[1]);
      const field = layerMatch[2];
      if (["glassType", "company", "thickness", "secure"].includes(field)) {
        const layers = normalizeLayers(nextRow.glassMode || "single", nextRow.layers || [makeLayer()]);
        const nextLayer = layers[layerIndex] || makeLayer();
        const latest = findLatestLayerPrice(priceHistory, draft.supplierName, nextLayer);
        if (latest) {
          layers[layerIndex] = {
            ...nextLayer,
            unitPrice: latest.unitPrice ?? nextLayer.unitPrice,
            supplierUnitPrice: latest.supplierUnitPrice ?? nextLayer.supplierUnitPrice
          };
          nextRow = makeRow({ ...nextRow, layers });
        }
      }
    }
    if (column === "doubleGap" || column === "triplexPvb") {
      const materialValue = column === "doubleGap" ? nextRow.doubleGap : nextRow.triplexPvb;
      if (materialValue) {
        const latest = findLatestMaterialPrice(priceHistory, draft.supplierName, nextRow.glassMode, materialValue);
        if (latest) {
          nextRow = makeRow({
            ...nextRow,
            materialUnitPrice: latest.materialUnitPrice ?? nextRow.materialUnitPrice,
            supplierMaterialUnitPrice: latest.supplierMaterialUnitPrice ?? nextRow.supplierMaterialUnitPrice
          });
        }
      }
    }
    return { row: nextRow, ok: true };
  }
  function commitEditingCell() {
    setEditingCell(null);
    return true;
  }
  function handleCellDraftChange(rowIndex, column, value, options = {}) {
    setCellValue(rowIndex, column, value, {
      label: options.label || "تعديل خلية",
      remember: options.remember
    });
    if (options.commit) setEditingCell(null);
  }
  function handleCellBlur(rowIndex, column) {
    if (isEditingCell(rowIndex, column)) {
      setEditingCell(null);
    }
  }
  function setCellValue(rowIndex, column, value, options = {}) {
    setInvalidRowIndex(null);
    if (options.remember !== false) rememberRows(draft.rows, { force: !!options.forceHistory, label: options.label || "تعديل خلية" });
    const stableRowId = rowIdAt(rowIndex);
    setDraft((current) => {
      const rows = [...(current.rows || [])];
      const currentRowIndex = stableRowId
        ? rows.findIndex((row) => row.id === stableRowId)
        : rowIndex;
      if (currentRowIndex < 0 || currentRowIndex >= rows.length) return current;
      const result = applyEntryCellValueToRow(rows[currentRowIndex], column, value);
      if (!result.ok) return current;
      rows[currentRowIndex] = result.row;
      const nextDraft = { ...current, rows };
      draftRef.current = nextDraft;
      return nextDraft;
    });
  }
  function requestRemoveRows(indexes) {
    const unique = [...new Set((Array.isArray(indexes) ? indexes : [indexes]).map(Number))]
      .filter((index) => Number.isInteger(index) && index >= 0 && index < draft.rows.length)
      .sort((a, b) => a - b);
    cleanupRendererInteractionState();
    if (!unique.length) {
      if (draft.rows.length) focusEntryTableControl(Math.max(0, Math.min(activeCell?.row || 0, draft.rows.length - 1)), "rowCode");
      else focusAddRowControl();
      return;
    }
    if (editingCell) commitEditingCell();
    setEditingCell(null);
    setRowContextMenu(null);
    setDeleteRowIndexes(unique);
  }
  function openRowContextMenu(index, event) {
    preventCancelableDefault(event);
    event.stopPropagation();
    cleanupRendererInteractionState();
    const rowId = draft.rows[index]?.id;
    const indexes = rowId && selectedRowIds.includes(rowId) ? selectedRowIndexes() : [index];
    if (rowId && !selectedRowIds.includes(rowId)) {
      setSelectedRowIds([rowId]);
      rowSelectionAnchorRef.current = rowId;
      setSelectedRange(null);
      setActiveCell(null);
    }
    setRowContextMenu({
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 190)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 76)),
      indexes
    });
  }
  function requestRemoveRow(index) {
    requestRemoveRows([index]);
  }
  function cancelRemoveRow() {
    const index = deleteRowIndexes?.[0] ?? 0;
    const rowId = draft.rows[index]?.id || "";
    setDeleteRowIndexes(null);
    cleanupRendererInteractionState();
    window.setTimeout(() => {
      const resolved = rowId ? draft.rows.findIndex((row) => row.id === rowId) : index;
      if (draft.rows.length) focusEntryTableControl(Math.max(0, resolved), "rowCode");
      else focusAddRowControl();
    }, 0);
  }
  function confirmRemoveRow() {
    const indexes = [...new Set((deleteRowIndexes || []).map(Number))]
      .filter((index) => Number.isInteger(index) && index >= 0 && index < draft.rows.length)
      .sort((a, b) => a - b);
    if (!indexes.length) {
      setDeleteRowIndexes(null);
      cleanupRendererInteractionState();
      if (draft.rows.length) focusEntryTableControl(0, "rowCode");
      else focusAddRowControl();
      return;
    }
    const removalIds = new Set(indexes.map((index) => draft.rows[index]?.id).filter(Boolean));
    const previewRows = draft.rows.filter((row) => !removalIds.has(row.id));
    const targetRow = Math.max(0, Math.min(indexes[0], previewRows.length - 1));
    const targetRowId = previewRows[targetRow]?.id || "";
    try {
      rememberRows(draft.rows, {
        force: true,
        label: indexes.length > 1 ? `حذف ${indexes.length} صفوف` : "حذف صف",
        key: "delete-rows"
      });
      pendingTableFocusRef.current = {
        row: targetRow,
        rowId: targetRowId,
        column: "rowCode",
        empty: previewRows.length === 0
      };
      setDeleteRowIndexes(null);
      setEditingCell(null);
      setActiveCell(null);
      setSelectedRange(null);
      setSelectedRowIds([]);
      rowSelectionAnchorRef.current = null;
      rangeDragRef.current = null;
      setInvalidRowIndex(null);
      setValidationErrors((current) => current.filter((error) => !removalIds.has(error.rowId)));
      setEntryRowHeights((current) => {
        const next = { ...current };
        for (const rowId of removalIds) delete next[rowId];
        return next;
      });
      setDraft((current) => {
        const originalIds = new Set((current.originalRowIds || []).map(String));
        const explicitlyDeleted = [...removalIds].filter((rowId) => originalIds.has(String(rowId)));
        return {
          ...current,
          deletedRowIds: [...new Set([...(current.deletedRowIds || []).map(String), ...explicitlyDeleted.map(String)])],
          rows: (current.rows || []).filter((row) => !removalIds.has(row.id))
        };
      });
      notify?.(indexes.length > 1 ? `تم حذف ${indexes.length} صفوف.` : `تم حذف الصف ${indexes[0] + 1}.`);
    } finally {
      cleanupRendererInteractionState();
    }
  }
  function copyFullRowToNew(index) {
    pendingTableFocusRef.current = { row: index + 1, column: "rowCode" };
    setRowsWithHistory((rows) => {
      const source = rows[index] || makeRow();
      rows.splice(index + 1, 0, duplicateOrderRow(source));
      return rows;
    }, { label: "نسخ صف" });
    notify?.(`تم نسخ الصف ${index + 1} إلى صف جديد.`);
    window.setTimeout(() => focusEntryTableControl(index + 1, "rowCode"), 60);
  }
  function copyRowToFollowingRows(index) {
    setRowsWithHistory((rows, current) => {
      if (index >= rows.length - 1) {
        notify?.("لا توجد صفوف أسفل هذا الصف لنسخ المواصفات إليها.");
        return rows;
      }
      const sourceRow = rows[index];
      const nextRows = rows.map((targetRow, rowIndex) => (
        rowIndex > index ? copyRowSpecToTarget(sourceRow, targetRow) : targetRow
      ));
      notify?.(`تم نسخ مواصفات الصف ${index + 1} إلى ${current.rows.length - index - 1} صف أسفله.`);
      return nextRows;
    }, { label: "نسخ مواصفات لأسفل" });
  }
  async function pasteMeasurementsFromClipboard() {
    try {
      const text = await navigator.clipboard?.readText?.();
      if (!text) throw new Error("clipboard-empty");
      const hasMeasurementAnchor = !!measurementMatrixColumnsFromAnchor(activeCell?.column);
      const selectedRows = selectedRowIndexes();
      const startRow = hasMeasurementAnchor
        ? rowIndexForCell(activeCell)
        : (selectedRows[0] ?? Math.max(0, rowIndexForCell(activeCell || { row: 0 })));
      const startColumn = hasMeasurementAnchor ? activeCell.column : "layer0-width";
      applyTableMatrixPaste(text, makeTableCell(startRow, startColumn), {
        measurementsOnly: true
      });
    } catch {
      notify?.("استخدم Ctrl+V داخل جدول الإدخال للصق المقاسات.");
    }
  }
  function maxVisibleLayerCount() {
    return Math.max(1, ...currentRows().map((row) => Math.max(1, row.layers?.length || 1)));
  }
  function columnExistsInRow(rowIndex, column = "") {
    const row = currentRows()[rowIndex];
    if (!row || !column) return false;
    if (["mode", "quantity", "rowCode", "notes"].includes(column)) return true;
    if (column === "doubleGap") return row.glassMode === "double";
    if (column === "triplexPvb") return row.glassMode === "triplex";
    if (["materialUnitPrice", "supplierMaterialUnitPrice"].includes(column)) return row.glassMode !== "single";
    if (column === "extraDirection") return row.layers?.length > 1 && rowHasLayerSizeDifference(row);
    const match = column.match(/^layer(\d+)-(.+)$/);
    if (!match) return false;
    const layerIndex = Number(match[1]);
    return layerIndex >= 0 && layerIndex < Math.max(1, row.layers?.length || 1);
  }
  function getColumnOrder(rowIndex = null) {
    const rows = currentRows();
    const maxLayers = Number.isInteger(rowIndex)
      ? Math.max(1, rows[rowIndex]?.layers?.length || 1)
      : maxVisibleLayerCount();
    const columns = ["mode"];
    for (let layerIndex = 0; layerIndex < maxLayers; layerIndex += 1) {
      columns.push(
        `layer${layerIndex}-width`,
        `layer${layerIndex}-height`
      );
      if (layerIndex === 0) columns.push("quantity");
      columns.push(
        `layer${layerIndex}-glassType`,
        `layer${layerIndex}-company`,
        `layer${layerIndex}-thickness`,
        `layer${layerIndex}-unitPrice`,
        `layer${layerIndex}-supplierUnitPrice`,
        `layer${layerIndex}-secure`
      );
      if (layerIndex === 0) {
        columns.push("doubleGap", "triplexPvb", "materialUnitPrice", "supplierMaterialUnitPrice");
      }
    }
    columns.push("extraDirection", "rowCode", "notes");
    for (let layerIndex = 0; layerIndex < maxLayers; layerIndex += 1) {
      columns.push(`layer${layerIndex}-color`, `layer${layerIndex}-alpha`, `layer${layerIndex}-mirror`);
    }
    const unique = [...new Set(columns)];
    return Number.isInteger(rowIndex) ? unique.filter((column) => columnExistsInRow(rowIndex, column)) : unique;
  }
  function measurementColumnsForRoute(route = "width-first", layerIndex = 0) {
    return route === "quantity-first"
      ? ["quantity", `layer${layerIndex}-height`, `layer${layerIndex}-width`]
      : [`layer${layerIndex}-width`, `layer${layerIndex}-height`, "quantity"];
  }
  function measurementMatrixColumnsFromAnchor(column = "") {
    const text = String(column || "");
    const widthMatch = text.match(/^layer(\d+)-width$/);
    if (widthMatch) {
      const layerIndex = Number(widthMatch[1]);
      return [`layer${layerIndex}-width`, `layer${layerIndex}-height`, "quantity"];
    }
    const heightMatch = text.match(/^layer(\d+)-height$/);
    if (heightMatch) {
      const layerIndex = Number(heightMatch[1]);
      return [`layer${layerIndex}-height`, "quantity"];
    }
    if (text === "quantity") return ["quantity", "layer0-height", "layer0-width"];
    return null;
  }
  function rowIdAt(rowIndex) {
    return currentRows()[rowIndex]?.id || "";
  }
  function rowIndexForCell(cell = {}) {
    const rows = currentRows();
    if (cell.rowId) {
      const byId = rows.findIndex((row) => row.id === cell.rowId);
      if (byId >= 0) return byId;
    }
    return Number.isInteger(cell.row) ? Math.max(0, Math.min(rows.length - 1, cell.row)) : -1;
  }
  function makeTableCell(rowIndex, column) {
    return { row: rowIndex, rowId: rowIdAt(rowIndex), column };
  }
  function sameTableCell(left, right) {
    if (!left || !right) return false;
    const leftRow = rowIndexForCell(left);
    const rightRow = rowIndexForCell(right);
    return leftRow === rightRow && left.column === right.column;
  }
  function isEditingCell(rowIndex, column) {
    return sameTableCell(editingCell, makeTableCell(rowIndex, column));
  }
  function focusTableShell() {
    try {
      tableScrollRef.current?.focus?.({ preventScroll: true });
    } catch {
      tableScrollRef.current?.focus?.();
    }
  }
  function revealTableCell(rowIndex, column, attempt = 0) {
    const container = tableScrollRef.current;
    const target = document.querySelector(tableControlSelector(rowIndex, column));
    if (!container || !target) {
      if (attempt < 8) window.setTimeout(() => revealTableCell(rowIndex, column, attempt + 1), 35);
      return false;
    }
    target.scrollIntoView({ block: "nearest", inline: "nearest" });
    window.requestAnimationFrame(() => {
      const containerRect = container.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const headHeight = [...container.querySelectorAll(".table-head, .table-subhead")]
        .reduce((sum, node) => sum + node.getBoundingClientRect().height, 0);
      const topLimit = containerRect.top + headHeight + 6;
      const bottomLimit = containerRect.bottom - 6;
      if (targetRect.top < topLimit) {
        container.scrollTop -= topLimit - targetRect.top;
      } else if (targetRect.bottom > bottomLimit) {
        container.scrollTop += targetRect.bottom - bottomLimit;
      }
    });
    return true;
  }
  function scrollTableCellIntoView(rowIndex, column) {
    revealTableCell(rowIndex, column);
  }
  function setSelectionToCell(nextCell, options = {}) {
    setSelectedRowIds([]);
    setActiveCell(nextCell);
    setSelectedRange((current) => {
      if (options.extend && current?.anchor) return { anchor: current.anchor, focus: nextCell };
      if (options.extend && activeCell) return { anchor: activeCell, focus: nextCell };
      return { anchor: nextCell, focus: nextCell };
    });
  }
  function focusTableCell(rowIndex, column, options = {}) {
    const nextCell = makeTableCell(rowIndex, column);
    setEditingCell(null);
    setSelectionToCell(nextCell, options);
    window.__glassSmartTableNavAt = Date.now();
    window.setTimeout(() => {
      scrollTableCellIntoView(rowIndex, column);
      focusTableShell();
    }, 0);
  }
  function startEditingCell(cell, options = {}) {
    const rowIndex = rowIndexForCell(cell);
    if (rowIndex < 0 || !cell?.column) return;
    const rows = currentRows();
    const nextCell = makeTableCell(rowIndex, cell.column);
    const hasInitialText = Object.prototype.hasOwnProperty.call(options, "initialText");
    const initialText = hasInitialText ? String(options.initialText ?? "") : String(readRowCellValue(rows[rowIndex], cell.column) ?? "");
    flushSync(() => {
      setSelectedRowIds([]);
      setActiveCell(nextCell);
      setSelectedRange({ anchor: nextCell, focus: nextCell });
      setEditingCell(nextCell);
    });
    if (hasInitialText) {
      flushSync(() => {
        setCellValue(rowIndex, cell.column, initialText, {
          forceHistory: true,
          label: "تعديل خلية"
        });
      });
    }
    focusEntryTableControl(rowIndex, cell.column, 0, {
      exact: true,
      select: false,
      caretEnd: true,
      immediate: true
    });
  }
  function selectedColumnDefinitionIndexes(kind, fallbackIndex) {
    const bounds = tableRangeBounds();
    if (!bounds) return [fallbackIndex];
    const definitions = kind === "layer" ? LAYER_TABLE_COLUMNS : ENTRY_TABLE_COLUMNS;
    const indexes = new Set();
    for (const column of bounds.columns.slice(bounds.colStart, bounds.colEnd + 1)) {
      const normalizedLayerKey = column.replace(/^layer\d+-/, "");
      const key = kind === "layer"
        ? normalizedLayerKey
        : column === "rowCode"
          ? "code"
          : ["color", "alpha", "mirror"].includes(normalizedLayerKey)
            ? normalizedLayerKey
            : column;
      const index = definitions.findIndex((definition) => definition.key === key);
      if (index >= 0) indexes.add(index);
    }
    return indexes.has(fallbackIndex) ? [...indexes] : [fallbackIndex];
  }
  function tableRangeBounds(range = selectedRange) {
    const fallback = activeCell ? { anchor: activeCell, focus: activeCell } : null;
    const resolved = range || fallback;
    if (!resolved?.anchor || !resolved?.focus) return null;
    const columns = getColumnOrder();
    const startColumnIndex = columns.indexOf(resolved.anchor.column);
    const endColumnIndex = columns.indexOf(resolved.focus.column);
    if (startColumnIndex < 0 || endColumnIndex < 0) return null;
    const anchorRow = rowIndexForCell(resolved.anchor);
    const focusRow = rowIndexForCell(resolved.focus);
    if (anchorRow < 0 || focusRow < 0) return null;
    return {
      rowStart: Math.min(anchorRow, focusRow),
      rowEnd: Math.max(anchorRow, focusRow),
      colStart: Math.min(startColumnIndex, endColumnIndex),
      colEnd: Math.max(startColumnIndex, endColumnIndex),
      columns
    };
  }
  function isCellSelected(rowIndex, column) {
    const bounds = tableRangeBounds();
    if (!bounds) return false;
    const columnIndex = bounds.columns.indexOf(column);
    return rowIndex >= bounds.rowStart && rowIndex <= bounds.rowEnd && columnIndex >= bounds.colStart && columnIndex <= bounds.colEnd;
  }
  function isCellActive(rowIndex, column) {
    return sameTableCell(activeCell, makeTableCell(rowIndex, column));
  }
  function selectedRowIndexes() {
    const selected = new Set(selectedRowIds);
    return draft.rows
      .map((row, index) => (selected.has(row.id) ? index : -1))
      .filter((index) => index >= 0);
  }
  function isRowSelected(rowIndex) {
    return selectedRowIds.includes(rowIdAt(rowIndex));
  }
  function rowSelectionColumns() {
    const columns = getColumnOrder();
    return columns.length ? columns : ["mode", "rowCode", "notes"];
  }
  function selectRowsByIndexes(indexes) {
    const ids = [...new Set(indexes.map((index) => rowIdAt(index)).filter(Boolean))];
    setSelectedRowIds(ids);
    const firstIndex = indexes[0] ?? 0;
    const firstColumn = rowSelectionColumns()[0] || "mode";
    const nextCell = makeTableCell(firstIndex, firstColumn);
    setEditingCell(null);
    setActiveCell(nextCell);
    setSelectedRange(null);
    window.setTimeout(() => {
      scrollTableCellIntoView(firstIndex, firstColumn);
      focusTableShell();
    }, 0);
  }
  function handleRowSelect(rowIndex, event) {
    if (event.button !== 0) return;
    preventCancelableDefault(event);
    event.stopPropagation();
    const rowId = rowIdAt(rowIndex);
    if (!rowId) return;
    let indexes;
    if (event.shiftKey && Number.isInteger(rowSelectionAnchorRef.current)) {
      const start = Math.min(rowSelectionAnchorRef.current, rowIndex);
      const end = Math.max(rowSelectionAnchorRef.current, rowIndex);
      indexes = Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
    } else if (event.ctrlKey || event.metaKey) {
      const selected = new Set(selectedRowIds);
      if (selected.has(rowId)) selected.delete(rowId);
      else selected.add(rowId);
      indexes = draft.rows.map((row, index) => selected.has(row.id) ? index : -1).filter((index) => index >= 0);
      rowSelectionAnchorRef.current = rowIndex;
    } else {
      indexes = [rowIndex];
      rowSelectionAnchorRef.current = rowIndex;
    }
    selectRowsByIndexes(indexes.length ? indexes : [rowIndex]);
  }
  function handleCellFocus(rowIndex, column, event) {
    const nextCell = makeTableCell(rowIndex, column);
    setSelectedRowIds([]);
    setActiveCell(nextCell);
    setSelectedRange((current) => {
      if (event?.shiftKey && current?.anchor) return { anchor: current.anchor, focus: nextCell };
      return { anchor: nextCell, focus: nextCell };
    });
  }
  function beginRangeDrag(rowIndex, column, event) {
    const anchor = activeCell && event.shiftKey ? activeCell : makeTableCell(rowIndex, column);
    const focus = makeTableCell(rowIndex, column);
    rangeDragRef.current = { anchor, focus };
    setSelectedRowIds([]);
    setActiveCell(focus);
    setSelectedRange({ anchor, focus });
    function pointerMove(moveEvent) {
      const hit = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest?.(".table-control");
      const hitRow = Number(hit?.dataset?.row);
      const hitColumn = hit?.dataset?.col;
      if (!Number.isInteger(hitRow) || !hitColumn) return;
      const nextFocus = makeTableCell(hitRow, hitColumn);
      rangeDragRef.current = { anchor, focus: nextFocus };
      setActiveCell(nextFocus);
      setSelectedRange({ anchor, focus: nextFocus });
    }
    registerEntryPointerGesture({
      move: pointerMove,
      target: event.currentTarget,
      pointerId: event.pointerId,
      finish: () => {
        rangeDragRef.current = null;
        focusTableShell();
      }
    });
  }
  function handleCellPointerDown(rowIndex, column, event) {
    if (event.button !== 0) return;
    const nextCell = makeTableCell(rowIndex, column);
    const eventTarget = event.target instanceof Element ? event.target : null;
    if (eventTarget && isEditableDomTarget(eventTarget) && sameTableCell(editingCell, nextCell)) {
      event.stopPropagation();
      return;
    }
    if (isDropdownCellColumn(column)) {
      event.stopPropagation();
      activateDropdownCell(rowIndex, column);
      return;
    }
    window.dispatchEvent(new Event("glass-orders-cancel-interactions"));
    if (editingCell && !sameTableCell(editingCell, nextCell)) {
      commitEditingCell();
    }
    preventCancelableDefault(event);
    event.stopPropagation();
    setEditingCell(null);
    beginRangeDrag(rowIndex, column, event);
    window.requestAnimationFrame(() => focusTableShell());
  }
  function handleCellDoubleClick(rowIndex, column, event) {
    preventCancelableDefault(event);
    event.stopPropagation();
    if (isDropdownCellColumn(column)) {
      activateDropdownCell(rowIndex, column);
      return;
    }
    window.dispatchEvent(new Event("glass-orders-cancel-interactions"));
    startEditingCell(makeTableCell(rowIndex, column));
  }
  function columnForRowNear(rowIndex, column, fallbackColumnIndex = 0) {
    if (columnExistsInRow(rowIndex, column)) return column;
    const rowColumns = getColumnOrder(rowIndex);
    if (!rowColumns.length) return column;
    return rowColumns[Math.max(0, Math.min(rowColumns.length - 1, fallbackColumnIndex))] || rowColumns[0] || column;
  }
  function findAdjacentRow(rowIndex, column, deltaRow) {
    if (!deltaRow) return rowIndex;
    const direction = deltaRow > 0 ? 1 : -1;
    let target = Math.max(0, Math.min(draft.rows.length - 1, rowIndex + direction));
    while (target >= 0 && target < draft.rows.length) {
      if (columnExistsInRow(target, column)) return target;
      target += direction;
    }
    return rowIndex;
  }
  function findCtrlArrowDestination(cell, direction) {
    const start = rowIndexForCell(cell);
    if (start < 0 || !cell?.column) return null;
    const columns = getColumnOrder(start);
    const currentColumnIndex = Math.max(0, columns.indexOf(cell.column));
    if (direction === "down" || direction === "up") {
      const step = direction === "down" ? 1 : -1;
      let targetRow = start;
      for (let rowIndex = start + step; rowIndex >= 0 && rowIndex < draft.rows.length; rowIndex += step) {
        if (columnExistsInRow(rowIndex, cell.column)) targetRow = rowIndex;
      }
      return makeTableCell(targetRow, columnForRowNear(targetRow, cell.column, currentColumnIndex));
    }
    const targetColumn = direction === "left"
      ? columns[columns.length - 1]
      : columns[0];
    return makeTableCell(start, targetColumn || cell.column);
  }
  function executeCtrlArrow(direction, extendSelection = false) {
    const started = performance.now();
    const destination = findCtrlArrowDestination(activeCell, direction);
    if (!destination) return false;
    setEditingCell(null);
    setSelectionToCell(destination, { extend: extendSelection });
    window.__glassSmartTableNavAt = Date.now();
    window.setTimeout(() => {
      scrollTableCellIntoView(rowIndexForCell(destination), destination.column);
      focusTableShell();
    }, 0);
    logSlowOperation("Ctrl+Arrow destination", started, 8, direction);
    return true;
  }
  function moveFromCell(rowIndex, column, deltaRow, deltaCol, extend = false, options = {}) {
    const columns = getColumnOrder(rowIndex);
    const columnIndex = Math.max(0, columns.indexOf(column));
    const nextColumn = columns[Math.max(0, Math.min(columns.length - 1, columnIndex + deltaCol))] || column;
    if (options.allowAddRow && deltaRow > 0 && rowIndex >= draft.rows.length - 1 && deltaCol === 0 && !extend) {
      const newRow = makeRow();
      setRowsWithHistory((rows) => [...rows, newRow], { label: "إضافة صف" });
      const nextCell = { row: draft.rows.length, rowId: newRow.id, column: nextColumn };
      setEditingCell(null);
      setActiveCell(nextCell);
      setSelectedRange({ anchor: nextCell, focus: nextCell });
      window.setTimeout(() => {
        scrollTableCellIntoView(draft.rows.length, nextColumn);
        focusTableShell();
      }, 60);
      return;
    }
    const nextRow = deltaRow ? findAdjacentRow(rowIndex, column, deltaRow) : rowIndex;
    const resolvedColumn = deltaRow ? columnForRowNear(nextRow, column, columnIndex) : nextColumn;
    window.__glassSmartTableNavAt = Date.now();
    focusTableCell(nextRow, resolvedColumn, { extend });
  }
  function undoTableEdit() {
    onUndo();
    return true;
  }
  function redoTableEdit() {
    onRedo();
    return true;
  }
  function copySelectionText() {
    const rowIndexes = selectedRowIndexes();
    if (rowIndexes.length) {
      const columns = rowSelectionColumns();
      return rowIndexes.map((rowIndex) => {
        const row = draft.rows[rowIndex] || makeRow();
        return columns.map((column) => readRowCellValue(row, column)).join("\t");
      }).join("\n");
    }
    const bounds = tableRangeBounds();
    if (!bounds) return "";
    const selectedColumns = bounds.columns.slice(bounds.colStart, bounds.colEnd + 1);
    const lines = [];
    for (let rowIndex = bounds.rowStart; rowIndex <= bounds.rowEnd; rowIndex += 1) {
      const row = draft.rows[rowIndex] || makeRow();
      lines.push(selectedColumns.map((column) => readRowCellValue(row, column)).join("\t"));
    }
    return lines.join("\n");
  }
  async function handleTableCopy(event) {
    if (!activeCell && !selectedRowIds.length) return;
    const text = copySelectionText();
    if (!text) return;
    preventCancelableDefault(event);
    event.clipboardData?.setData("text/plain", text);
    try { await navigator.clipboard?.writeText?.(text); } catch { /* Clipboard event data is enough in browsers that block async writes. */ }
  }
  function applyTableMatrixPaste(text, startCell, options = {}) {
    const started = performance.now();
    if (!startCell?.column) return false;
    cleanupRendererInteractionState();
    const measurementColumns = options.measurementsOnly
      ? (measurementMatrixColumnsFromAnchor(startCell.column) || measurementColumnsForRoute("width-first", 0))
      : measurementMatrixColumnsFromAnchor(startCell.column);
    const columns = measurementColumns || getColumnOrder();
    const startColumn = startCell.column;
    if (!columns.includes(startColumn)) return false;
    const sourceDraft = draftRef.current || draft;
    const sourceRows = sourceDraft.rows || [];
    const rowById = startCell.rowId ? sourceRows.findIndex((row) => row.id === startCell.rowId) : -1;
    const startRowIndex = rowById >= 0
      ? rowById
      : (Number.isInteger(startCell.row) ? Math.max(0, Math.min(Math.max(0, sourceRows.length - 1), startCell.row)) : -1);
    if (startRowIndex < 0) return false;

    const built = buildPastePatch({
      clipboardText: text,
      destinationFieldKeys: columns,
      startFieldKey: startColumn,
      startRow: startRowIndex,
      sourceDirection: pastePreferences.sourceDirection,
      measurementUnit: pastePreferences.measurementUnit,
      currentRows: sourceDraft.rows,
      readCurrentCell: ({ rowIndex, fieldKey }) => {
        const row = sourceDraft.rows[rowIndex];
        return row
          ? { exists: true, value: readRowCellValue(row, fieldKey) }
          : { exists: false, value: null };
      }
    });
    if (!built.ok) {
      const error = built.errors?.[0] || {};
      const errorRow = Number.isInteger(error.rowIndex) ? error.rowIndex : startRowIndex;
      const errorColumn = error.fieldKey || startColumn;
      setInvalidRowIndex(errorRow);
      if (error.code === "empty-clipboard") {
        notify?.("لا توجد صفوف صالحة للصق في الحافظة.");
      } else if (error.code === "column-overflow") {
        notify?.(`عدد أعمدة الحافظة أكبر من المساحة المتاحة ابتداءً من الصف ${errorRow + 1}.`);
      } else if (error.code === "invalid-measurement") {
        notify?.(`قيمة قياس غير صالحة في الصف ${errorRow + 1}.`);
      } else {
        notify?.(`تعذر لصق البيانات في الصف ${errorRow + 1}. راجع القيمة المحددة.`);
      }
      window.setTimeout(() => focusTableCell(errorRow, errorColumn), 35);
      cleanupRendererInteractionState();
      return false;
    }

    const plannedRows = [...sourceDraft.rows];
    let invalid = null;
    for (const change of built.patch.changes) {
      while (plannedRows.length <= change.rowIndex) plannedRows.push(makeRow());
      const result = applyEntryCellValueToRow(plannedRows[change.rowIndex], change.fieldKey, change.after.value);
      if (!result.ok) {
        invalid = { row: change.rowIndex, column: change.fieldKey };
        break;
      }
      plannedRows[change.rowIndex] = result.row;
    }
    if (invalid) {
      setInvalidRowIndex(invalid.row);
      notify?.(`قيمة غير صالحة في الصف ${invalid.row + 1}. لم يتم تغيير أي صف.`);
      window.setTimeout(() => focusTableCell(invalid.row, invalid.column), 35);
      cleanupRendererInteractionState();
      return false;
    }

    const rowCount = built.patch.source.rowCount;
    recordHistory(`لصق ${rowCount} صف`, {
      force: true,
      key: "paste-range",
      draftSnapshot: sourceDraft
    });
    setInvalidRowIndex(null);
    setEditingCell(null);
    setSelectedRowIds([]);
    setDraft((current) => {
      const nextDraft = { ...current, rows: plannedRows };
      draftRef.current = nextDraft;
      return nextDraft;
    });
    const firstChange = built.patch.changes[0];
    const lastChange = built.patch.changes[built.patch.changes.length - 1] || firstChange;
    const anchor = makeTableCell(firstChange.rowIndex, firstChange.fieldKey);
    const focus = makeTableCell(lastChange.rowIndex, lastChange.fieldKey);
    setSelectedRange({ anchor, focus });
    setActiveCell(anchor);
    window.setTimeout(() => focusTableCell(anchor.row, anchor.column), 35);
    notify?.(`تم لصق ${rowCount} صف داخل جدول الإدخال.`);
    logSlowOperation("Paste range", started, 30, `${rowCount} rows`);
    return true;
  }
  function pasteIntoSelectedRows(text) {
    const rowIndexes = selectedRowIndexes();
    if (!rowIndexes.length) return false;
    const firstColumn = rowSelectionColumns()[0];
    if (!firstColumn) return false;
    return applyTableMatrixPaste(text, makeTableCell(rowIndexes[0], firstColumn));
  }
  function clearSelectedCells() {
    const bounds = tableRangeBounds();
    if (!bounds) return false;
    const selectedColumns = bounds.columns.slice(bounds.colStart, bounds.colEnd + 1);
    setRowsWithHistory((rows) => {
      for (let rowIndex = bounds.rowStart; rowIndex <= bounds.rowEnd; rowIndex += 1) {
        let row = rows[rowIndex] || makeRow();
        for (const column of selectedColumns) {
          const result = applyEntryCellValueToRow(row, column, "");
          row = result.row;
        }
        rows[rowIndex] = row;
      }
      return rows;
    }, { label: "مسح نطاق" });
    window.setTimeout(() => focusTableCell(bounds.rowStart, bounds.columns[bounds.colStart]), 40);
    return true;
  }
  function copyDownSelection() {
    const started = performance.now();
    const bounds = tableRangeBounds();
    if (!bounds) return false;
    if (bounds.rowEnd <= bounds.rowStart) {
      notify?.("حدد نطاقاً يحتوي على صف مصدر وصفاً واحداً تحته على الأقل لاستخدام Ctrl+D.");
      return false;
    }
    const selectedColumns = bounds.columns.slice(bounds.colStart, bounds.colEnd + 1);
    rememberRows(draft.rows, { force: true, label: "تعبئة النطاق لأسفل", key: "fill-down-range" });
    flushSync(() => setDraft((current) => {
      const rows = [...(current.rows || [])];
      const selectedColumns = bounds.columns.slice(bounds.colStart, bounds.colEnd + 1);
      for (const column of selectedColumns) {
        const sourceValue = readRowCellValue(rows[bounds.rowStart], column);
        for (let rowIndex = bounds.rowStart + 1; rowIndex <= bounds.rowEnd; rowIndex += 1) {
          const result = applyEntryCellValueToRow(rows[rowIndex], column, sourceValue);
          rows[rowIndex] = result.row;
        }
      }
      return { ...current, rows };
    }));
    notify?.("تم تنفيذ Ctrl+D على النطاق المحدد.");
    window.setTimeout(() => focusTableCell(bounds.rowStart, bounds.columns[bounds.colStart]), 50);
    logSlowOperation("Ctrl+D", started, 20, `${selectedColumns.length}x${bounds.rowEnd - bounds.rowStart + 1}`);
    return true;
  }
  function copyCellValueDown(rowIndex, column, options = {}) {
    if (!column || rowIndex >= draft.rows.length - 1) {
      notify?.("لا توجد صفوف أسفل هذه الخلية للنسخ إليها.");
      return false;
    }
    if (options.confirm !== false) {
      const confirmed = window.confirm("نسخ قيمة هذه الخلية إلى نفس العمود في كل الصفوف التالية؟");
      restoreRendererInputFocus();
      if (!confirmed) return false;
    }
    const sourceValue = readRowCellValue(draft.rows[rowIndex], column);
    setRowsWithHistory((rows) => {
      for (let targetRow = rowIndex + 1; targetRow < rows.length; targetRow += 1) {
        const result = applyEntryCellValueToRow(rows[targetRow], column, sourceValue);
        rows[targetRow] = result.row;
      }
      return rows;
    }, { label: "نسخ قيمة خلية لأسفل" });
    notify?.(`تم نسخ قيمة الخلية إلى ${draft.rows.length - rowIndex - 1} صف.`);
    window.setTimeout(() => focusTableCell(rowIndex, column), 50);
    return true;
  }
  function selectColumnToBoundary(direction) {
    if (!activeCell) return false;
    const targetRow = direction > 0 ? draft.rows.length - 1 : 0;
    const focus = makeTableCell(targetRow, activeCell.column);
    setSelectedRange({ anchor: activeCell, focus });
    setActiveCell(focus);
    window.setTimeout(() => {
      scrollTableCellIntoView(targetRow, activeCell.column);
      focusTableShell();
    }, 20);
    return true;
  }
  function handleTableKeyDown(event) {
    if (event.isComposing || event.nativeEvent?.isComposing) return;
    const eventTarget = event.target instanceof Element ? event.target : null;
    if (eventTarget?.closest?.(".drawing-editor, .drawing-focus-editor, .drawing-focus-shell")) return;
    const target = eventTarget?.closest?.(".table-control");
    if (!target && isEditableDomTarget(eventTarget)) return;
    const sourceCell = target ? { row: Number(target.dataset.row), rowId: target.dataset.rowId || "", column: target.dataset.col } : activeCell;
    const rowIndex = rowIndexForCell(sourceCell);
    const column = sourceCell?.column;
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || !column) return;
    if (target?.closest(".combo.open") && !(event.ctrlKey || event.metaKey) && ["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(event.key)) return;
    const editing = isEditingCell(rowIndex, column);
    const shortcutModifier = event.ctrlKey || event.metaKey;
    const arrowDirection = event.key === "ArrowDown"
      ? "down"
      : event.key === "ArrowUp"
        ? "up"
        : event.key === "ArrowLeft"
          ? "left"
          : event.key === "ArrowRight"
            ? "right"
            : "";
    const claimKey = () => {
      preventCancelableDefault(event);
      event.stopPropagation();
    };
    const commitEditorForKey = () => commitEditingCell();
    const isShortcut = (code, key) => event.code === code || String(event.key || "").toLocaleLowerCase() === key;
    if (shortcutModifier && !event.shiftKey && isShortcut("KeyZ", "z")) {
      claimKey();
      if (event.repeat) return;
      undoTableEdit();
      return;
    }
    if ((shortcutModifier && !event.shiftKey && isShortcut("KeyY", "y")) || (shortcutModifier && event.shiftKey && isShortcut("KeyZ", "z"))) {
      claimKey();
      if (event.repeat) return;
      redoTableEdit();
      return;
    }
    if (shortcutModifier && !event.shiftKey && isShortcut("KeyD", "d")) {
      claimKey();
      if (event.repeat) return;
      if (editing) commitEditorForKey();
      copyDownSelection();
      return;
    }
    if (shortcutModifier && arrowDirection) {
      claimKey();
      if (event.repeat) return;
      if (editing) commitEditorForKey();
      executeCtrlArrow(arrowDirection, event.shiftKey);
      return;
    }
    if (target && isEditableDomTarget(target) && editing) {
      if (event.key === "Tab") {
        claimKey();
        setEditingCell(null);
        moveFromCell(rowIndex, column, 0, event.shiftKey ? -1 : 1, false, { allowAddRow: false });
      } else if (event.key === "Enter") {
        claimKey();
        event.__glassTableHandled = true;
        if (event.nativeEvent) event.nativeEvent.__glassTableHandled = true;
        setEditingCell(null);
        moveFromCell(rowIndex, column, 1, 0, false, { allowAddRow: true });
      }
      return;
    }
    if (!editing && event.key === "Delete" && selectedRowIds.length) {
      claimKey();
      requestRemoveRows(selectedRowIndexes());
      return;
    }
    if (!editing && isDropdownCellColumn(column) && (event.key === " " || event.code === "Space")) {
      claimKey();
      activateDropdownCell(rowIndex, column);
      return;
    }
    if (event.key === "Escape") {
      if (editing) {
        claimKey();
        setEditingCell(null);
        focusTableCell(rowIndex, column);
      }
      return;
    }
    if (editing) {
      if (event.key === "Enter") {
        claimKey();
        event.__glassTableHandled = true;
        if (event.nativeEvent) event.nativeEvent.__glassTableHandled = true;
        commitEditorForKey();
        moveFromCell(rowIndex, column, 1, 0, false, { allowAddRow: true });
        return;
      }
      if (arrowDirection && !event.altKey) {
        claimKey();
        commitEditorForKey();
        if (arrowDirection === "down") moveFromCell(rowIndex, column, 1, 0, event.shiftKey, { allowAddRow: false });
        else if (arrowDirection === "up") moveFromCell(rowIndex, column, -1, 0, event.shiftKey, { allowAddRow: false });
        else if (arrowDirection === "left") moveFromCell(rowIndex, column, 0, 1, event.shiftKey, { allowAddRow: false });
        else if (arrowDirection === "right") moveFromCell(rowIndex, column, 0, -1, event.shiftKey, { allowAddRow: false });
      }
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      claimKey();
      clearSelectedCells();
      return;
    }
    if (event.key === "F2") {
      claimKey();
      startEditingCell(makeTableCell(rowIndex, column));
      return;
    }
    if (event.key === "Enter") {
      claimKey();
      event.__glassTableHandled = true;
      if (event.nativeEvent) event.nativeEvent.__glassTableHandled = true;
      moveFromCell(rowIndex, column, 1, 0, event.shiftKey, { allowAddRow: true });
      return;
    }
    if (event.key === "Tab") {
      claimKey();
      moveFromCell(rowIndex, column, 0, event.shiftKey ? -1 : 1, false, { allowAddRow: false });
      return;
    }
    if (event.key === "ArrowDown") {
      claimKey();
      moveFromCell(rowIndex, column, 1, 0, event.shiftKey, { allowAddRow: false });
      return;
    }
    if (event.key === "ArrowUp") {
      claimKey();
      moveFromCell(rowIndex, column, -1, 0, event.shiftKey, { allowAddRow: false });
      return;
    }
    if (event.key === "ArrowRight" && !event.altKey) {
      claimKey();
      moveFromCell(rowIndex, column, 0, -1, event.shiftKey, { allowAddRow: false });
      return;
    }
    if (event.key === "ArrowLeft" && !event.altKey) {
      claimKey();
      moveFromCell(rowIndex, column, 0, 1, event.shiftKey, { allowAddRow: false });
      return;
    }
    if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1) {
      claimKey();
      startEditingCell(makeTableCell(rowIndex, column), { initialText: event.key });
    }
  }
  function handleTablePaste(event) {
    const eventTarget = event.target instanceof Element ? event.target : null;
    if (eventTarget?.closest?.(".drawing-editor, .drawing-focus-editor, .drawing-focus-shell")) return;
    if (!eventTarget?.closest?.(".table-control") && isEditableDomTarget(eventTarget)) return;
    const text = event.clipboardData?.getData("text/plain") || "";
    if (!text) return;
    if (isEditableDomTarget(eventTarget) && !/[\t\r\n]/.test(text)) return;
    if (selectedRowIds.length) {
      preventCancelableDefault(event);
      if (editingCell) commitEditingCell();
      pasteIntoSelectedRows(text);
      return;
    }
    const target = event.target?.closest?.(".table-control");
    const startCell = target ? { row: Number(target.dataset.row), rowId: target.dataset.rowId || "", column: target.dataset.col } : activeCell;
    if (startCell?.column) {
      preventCancelableDefault(event);
      if (editingCell) commitEditingCell();
      applyTableMatrixPaste(text, startCell);
      return;
    }
  }
  function rejectInvalidOrder(validation) {
    notify?.(validation.message);
    if (Number.isInteger(validation.rowIndex)) {
      setInvalidRowIndex(validation.rowIndex);
      focusEntryTableControl(validation.rowIndex, validation.column || "layer0-glassType");
    }
    return false;
  }
  function validationSummary(errors = []) {
    const uniqueMessages = [...new Set(errors.map((error) => error.message).filter(Boolean))];
    const details = uniqueMessages.slice(0, 4).join("\n");
    return [
      "تعذر حفظ الطلب لوجود بيانات مطلوبة غير مكتملة.",
      "برجاء استكمال الحقول المحددة ثم إعادة الحفظ.",
      details
    ].filter(Boolean).join("\n");
  }
  function revealFirstSaveValidationError(error) {
    if (!error) return;
    if (error.scope === "row" && Number.isInteger(error.rowIndex)) {
      setInvalidRowIndex(error.rowIndex);
      focusEntryTableControl(error.rowIndex, error.field || "layer0-glassType", 0, { exact: true });
      return;
    }
    const focusField = error.focusField || error.field;
    const target = document.querySelector(`[data-order-field="${focusField}"] input, [data-order-field="${focusField}"] select`);
    target?.closest?.(".field")?.scrollIntoView?.({ block: "center", inline: "nearest", behavior: "smooth" });
    restoreRendererInputFocus({ preferredElement: target });
  }
  function ensureOrderValidForSave() {
    const currentDraft = draftRef.current || draft;
    const result = validateOrderForSave(currentDraft, { customers, suppliers });
    if (result.isValid) {
      setValidationErrors([]);
      return { ok: true, draft: currentDraft };
    }
    setValidationErrors(result.errors);
    notify?.(validationSummary(result.errors));
    revealFirstSaveValidationError(result.errors[0]);
    return { ok: false, draft: currentDraft };
  }
  function ensureRowsValid() {
    const currentDraft = draftRef.current || draft;
    const validation = validateOrderRows(currentDraft);
    return validation.ok || rejectInvalidOrder(validation);
  }
  function ensureReportValid() {
    const currentDraft = draftRef.current || draft;
    const validation = validateOrderForReport(currentDraft);
    if (validation.ok) return true;
    if (Number.isInteger(validation.rowIndex)) return rejectInvalidOrder(validation);
    notify?.(validation.message);
    return false;
  }
  async function commitActiveEditorBeforeAction() {
    const active = document.activeElement;
    if (active?.classList?.contains("table-control")) {
      commitEditingCell();
      active.blur?.();
    } else {
      commitEditingCell();
    }
    await waitForPaint(0);
  }
  async function handleSave() {
    if (saving) return;
    await commitActiveEditorBeforeAction();
    const validation = ensureOrderValidForSave();
    if (validation.ok) onSave(validation.draft);
  }
  async function handlePreview() {
    if (saving) return;
    await commitActiveEditorBeforeAction();
    const currentDraft = draftRef.current || draft;
    if (ensureReportValid()) await Promise.resolve(onPreview(currentDraft));
  }
  async function handleExportPdf() {
    if (saving) return;
    await commitActiveEditorBeforeAction();
    if (ensureReportValid()) onExportPdf();
  }
  async function handleExportExcel() {
    if (saving) return;
    await commitActiveEditorBeforeAction();
    if (ensureReportValid()) onExportExcel();
  }
  const drawingFocusIndex = draft.rows.findIndex((row) => row.expanded);
  function closeDrawingFocus() {
    if (drawingFocusIndex < 0) return;
    updateRow(drawingFocusIndex, (row) => ({ ...row, expanded: false }));
    window.setTimeout(() => focusTableShell(), 40);
  }
  useEffect(() => {
    function handleEscape(event) {
      if (event.key !== "Escape") return;
      if (drawingFocusIndex >= 0) {
        preventCancelableDefault(event);
        closeDrawingFocus();
        return;
      }
      if (tableFullScreen) {
        preventCancelableDefault(event);
        setTableFullScreen(false);
        window.setTimeout(() => focusTableShell(), 40);
      }
    }
    window.addEventListener("keydown", handleEscape, true);
    return () => window.removeEventListener("keydown", handleEscape, true);
  }, [drawingFocusIndex, tableFullScreen]);
  const entryStackClass = [
    "stack",
    "entry-screen",
    tableFullScreen ? "table-fullscreen-active" : "",
    drawingFocusIndex >= 0 ? "drawing-mode-active" : ""
  ].filter(Boolean).join(" ");
  function isValidationErrorResolved(error = {}) {
    const currentDraft = draftRef.current || draft;
    if (error.scope === "order") {
      if (error.field === "customerId") return !!cleanName(currentDraft.customerName);
      if (error.field === "supplierId") return !!cleanName(currentDraft.supplierName);
      if (error.field === "date") return !!cleanName(currentDraft.date);
      return !!cleanName(currentDraft[error.field]);
    }
    const rows = currentDraft.rows || [];
    const rowIndex = rows.findIndex((row) => String(row.id || "") === String(error.rowId || ""));
    const resolvedIndex = rowIndex >= 0 ? rowIndex : error.rowIndex;
    const row = rows[resolvedIndex];
    if (!row) return false;
    const currentRowErrors = validateOrderRowForSave(row, resolvedIndex).map(validationErrorKey);
    return !currentRowErrors.includes(validationErrorKey({ ...error, rowId: row.id || error.rowId }));
  }
  const unresolvedValidationErrors = validationErrors.filter((error) => !isValidationErrorResolved(error));
  const validationKeys = new Set(unresolvedValidationErrors.map(validationErrorKey));
  const invalidRowIds = new Set(unresolvedValidationErrors.filter((error) => error.scope === "row").map((error) => error.rowId));
  const isValidationCellInvalid = (rowIndex, column) => {
    const rowId = draft.rows[rowIndex]?.id || `local-row-${rowIndex}`;
    return validationKeys.has(`${rowId}:${column}`);
  };
  return (
    <div className={entryStackClass}>
      {drawingFocusIndex < 0 && <section className="panel entry-order-panel">
        <div className="panel-head">
          <div>
            <h2>بيانات الطلب</h2>
            <p>أدخل بيانات العميل والمورد والمشروع، ثم أضف مقاسات الزجاج في الجدول.</p>
          </div>
          <div className="actions">
            <button className="danger" onClick={onCancel} disabled={saving}><XCircle size={18} />{draft.id ? "إلغاء التعديل" : "مسح الإدخال"}</button>
            <button onClick={handlePreview} disabled={saving}><Eye size={18} />معاينة</button>
            <button onClick={handleExportPdf} disabled={saving}><FileDown size={18} />PDF</button>
            <button onClick={handleExportExcel} disabled={saving}><Download size={18} />Excel</button>
            <button className="primary" onClick={handleSave} disabled={saving}><Save size={18} />{saving ? "جار الحفظ..." : "حفظ"}</button>
          </div>
        </div>
        {validationErrors.length > 0 && (
          <div className="order-validation-summary" role="alert" aria-live="assertive">
            <strong>تعذر حفظ الطلب لوجود بيانات مطلوبة غير مكتملة.</strong>
            <span>{unresolvedValidationErrors.length ? "استكمل الحقول المحددة. كل بند يتم إصلاحه سيظهر بعلامة صح." : "تم استكمال البنود المطلوبة. يمكنك الحفظ الآن."}</span>
            <ul>{validationErrors.map((error, index) => {
              const resolved = isValidationErrorResolved(error);
              return <li key={`${validationErrorKey(error)}-${index}`} className={resolved ? "resolved" : ""}>{resolved ? "✓" : "•"} {error.message}</li>;
            })}</ul>
          </div>
        )}
        <div className="form-grid">
          <Field label="رقم الطلب الداخلي"><input className="generated-id" dir="ltr" value={displayOrderNo(draft.orderNo)} readOnly title="رقم تلقائي لا يتكرر" /></Field>
          <Field label="التاريخ" fieldKey="date" invalid={validationKeys.has("order:date")}><input type="date" dir="ltr" value={draft.date} aria-invalid={validationKeys.has("order:date")} onChange={(e) => patch({ date: e.target.value })} /></Field>
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
          <Field label="العميل" fieldKey="customer" invalid={validationKeys.has("order:customerId")}><Combo value={draft.customerName} options={customers.map((c) => c.name)} aria-invalid={validationKeys.has("order:customerId")} onChange={(customerName) => selectedPartyPatch(customers, customerName, "customerName", "customerId")} /></Field>
          <Field label="المورد" fieldKey="supplier" invalid={validationKeys.has("order:supplierId")}><Combo value={draft.supplierName} options={suppliers.map((s) => s.name)} aria-invalid={validationKeys.has("order:supplierId")} onChange={(supplierName) => selectedPartyPatch(suppliers, supplierName, "supplierName", "supplierId")} /></Field>
          <Field label="المشروع"><Combo value={draft.project} options={projectOptions} onChange={(project) => patch({ project })} /></Field>
        </div>
      </section>}
      <section className={tableFullScreen || drawingFocusIndex >= 0 ? "panel table-panel fullscreen-table" : "panel table-panel"}>
        <div className="panel-head entry-table-toolbar">
          <div>
            <h2>جدول الادخال</h2>
            {drawingFocusIndex < 0 && <p>إعدادات الوحدة والاتجاه تطبق على البيانات الملصقة فقط.</p>}
          </div>
          <div className="actions">
            {drawingFocusIndex < 0 && (
              <div className="entry-paste-controls" aria-label="إعدادات لصق جدول الإدخال">
                <label title="تحدد هذه الوحدة طريقة تفسير القياسات المنسوخة عند اللصق فقط.">
                  <span>وحدة القياسات:</span>
                  <select
                    value={pastePreferences.measurementUnit}
                    onChange={(event) => setPastePreferences((current) => normalizePastePreferences({ ...current, measurementUnit: event.target.value }))}
                    aria-label="وحدة القياسات الملصقة"
                  >
                    {PASTE_MEASUREMENT_UNIT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label title="يحدد اتجاه أعمدة المصدر عند اللصق فقط، ولا يعكس ترتيب الصفوف.">
                  <span>اتجاه المصدر:</span>
                  <select
                    value={pastePreferences.sourceDirection}
                    onChange={(event) => setPastePreferences((current) => normalizePastePreferences({ ...current, sourceDirection: event.target.value }))}
                    aria-label="اتجاه مصدر النسخ"
                  >
                    {PASTE_SOURCE_DIRECTION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
              </div>
            )}
            {drawingFocusIndex < 0 && <button type="button" disabled={!historyStatus.canUndo} title={`تراجع — Ctrl+Z${historyStatus.canUndo ? `: ${historyStatus.undoLabel}` : ""}`} onClick={onUndo}><Undo2 size={18} />تراجع</button>}
            {drawingFocusIndex < 0 && <button type="button" disabled={!historyStatus.canRedo} title={`إعادة — Ctrl+Y${historyStatus.canRedo ? `: ${historyStatus.redoLabel}` : ""}`} onClick={onRedo}><Redo2 size={18} />إعادة</button>}
            {drawingFocusIndex < 0 && <button type="button" title="يلصق البيانات باستخدام الوحدة واتجاه المصدر المحددين." onClick={pasteMeasurementsFromClipboard}><ClipboardList size={18} />لصق القياسات</button>}
            {drawingFocusIndex < 0 && <button type="button" ref={addRowButtonRef} data-focus-fallback="entry-add-row" onClick={addRow}><Plus size={18} />إضافة صف</button>}
            {drawingFocusIndex >= 0 && <button onClick={closeDrawingFocus}><Minimize2 size={18} />رجوع للجدول</button>}
            {drawingFocusIndex < 0 && <button onClick={() => setTableFullScreen((value) => !value)}>
              {tableFullScreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
              {tableFullScreen ? "رجوع" : "ملء الشاشة"}
            </button>}
          </div>
        </div>
        {drawingFocusIndex >= 0 ? (
          <div className="drawing-focus-shell">
            <DrawingFocusEditor
              row={draft.rows[drawingFocusIndex]}
              index={drawingFocusIndex}
              updateRow={(updater) => updateRow(drawingFocusIndex, updater, { label: "تعديل الرسم", coalesceMs: 800, key: `drawing:${rowIdAt(drawingFocusIndex)}` })}
              onClose={closeDrawingFocus}
            />
          </div>
        ) : (
        <div className="table-scroll" ref={tableScrollRef} tabIndex={0} onPaste={handleTablePaste} onCopy={handleTableCopy} onKeyDownCapture={handleTableKeyDown}>
          <div className="smart-table" style={{
            "--entry-columns": effectiveEntryColumnWidths.map((width) => `${width}px`).join(" "),
            "--layer-columns": layerColumnWidths.map((width) => `${width}px`).join(" ")
          }}>
            <div className="table-row table-head">
              {ENTRY_TABLE_COLUMNS.map((column, columnIndex) => (
                <span className={columnIndex === 0 ? "row-index-head" : ""} key={column.key}>
                  {column.label}
                  {columnIndex > 0 && <button type="button" className="column-resize-handle" aria-label={`تغيير عرض عمود ${column.label || "الإجراءات"}`} onPointerDown={(event) => beginColumnResize("entry", columnIndex, event)} />}
                </span>
              ))}
            </div>
            <div className="table-row table-subhead">
              {ENTRY_TABLE_COLUMNS.map((column) => (
                <span className={column.key === "layers" ? "layers-subhead-cell" : "blank-subhead"} key={`sub-${column.key}`}>
                  {column.key === "layers" && (
                    <div className="layer-head">
                      {LAYER_TABLE_COLUMNS.map((layerColumn, layerColumnIndex) => (
                        <span key={layerColumn.key}>
                          {layerColumn.label}
                          {layerColumnIndex > 0 && <button type="button" className="column-resize-handle inner" aria-label={`تغيير عرض عمود ${layerColumn.label}`} onPointerDown={(event) => beginColumnResize("layer", layerColumnIndex, event)} />}
                        </span>
                      ))}
                    </div>
                  )}
                </span>
              ))}
            </div>
            {draft.rows.map((row, index) => (
              <GlassRowEditor
                key={row.id}
                row={row}
                index={index}
                rowHeight={rowHeightFor(index)}
                supplierName={draft.supplierName}
                drawingEnabled={draft.entryMode === "drawings"}
                learnedOptions={learnedOptions}
                smartOptions={smartOptions}
                priceHistory={priceHistory}
                updateRow={(updater) => updateRow(index, updater)}
                addRow={addRow}
                removeRow={() => requestRemoveRow(index)}
                copyFullRow={() => copyFullRowToNew(index)}
                copyToFollowingRows={() => copyRowToFollowingRows(index)}
                hasFollowingRows={index < draft.rows.length - 1}
                invalid={invalidRowIndex === index || invalidRowIds.has(row.id)}
                activeCell={activeCell}
                selectedRange={selectedRange}
                selectedRow={isRowSelected(index)}
                isCellActive={isCellActive}
                isCellSelected={isCellSelected}
                isCellEditing={isEditingCell}
                isCellInvalid={isValidationCellInvalid}
                cellValue={cellRenderValue}
                onCellValueChange={handleCellDraftChange}
                onCellBlur={handleCellBlur}
                onRowSelect={(event) => handleRowSelect(index, event)}
                onRowContextMenu={(event) => openRowContextMenu(index, event)}
                onCellFocus={handleCellFocus}
                onCellPointerDown={handleCellPointerDown}
                onCellDoubleClick={handleCellDoubleClick}
                onCellCommitMove={(rowIndex, column) => {
                  setEditingCell(null);
                  moveFromCell(rowIndex, column, 1, 0, false);
                }}
                onCopyDownCell={(column) => copyCellValueDown(index, column, { confirm: true })}
                onRowResize={(event) => beginRowResize(index, event)}
                onLearnTableOption={onLearnTableOption}
              />
            ))}
          </div>
        </div>
        )}
      </section>
      {drawingFocusIndex < 0 && <OrderTotalsPanel totals={totals} floating={tableFullScreen} />}
      {rowContextMenu && (
        <div
          className="entry-row-context-menu"
          role="menu"
          style={{ left: `${rowContextMenu.x}px`, top: `${rowContextMenu.y}px` }}
          onContextMenu={(event) => preventCancelableDefault(event)}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const indexes = rowContextMenu.indexes;
              setRowContextMenu(null);
              requestRemoveRows(indexes);
            }}
          >
            <Trash2 size={16} />
            {rowContextMenu.indexes.length > 1 ? `حذف ${rowContextMenu.indexes.length} صفوف` : "حذف الصف"}
          </button>
        </div>
      )}
      {deleteRowIndexes !== null && (
        <RowDeleteModal
          rows={deleteRowIndexes.map((index) => draft.rows[index]).filter(Boolean)}
          indexes={deleteRowIndexes}
          onClose={cancelRemoveRow}
          onConfirm={confirmRemoveRow}
        />
      )}
    </div>
  );
}

function RowDeleteModal({ rows = [], indexes = [], onClose, onConfirm }) {
  const multiple = indexes.length > 1;
  const firstRow = rows[0] || {};
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    function handleEscape(event) {
      if (event.key !== "Escape") return;
      preventCancelableDefault(event);
      closeRef.current();
    }
    window.addEventListener("keydown", handleEscape, true);
    return () => {
      window.removeEventListener("keydown", handleEscape, true);
      cleanupRendererInteractionState();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal row-delete-modal">
        <div className="panel-head">
          <h2><Trash2 size={18} /> {multiple ? "حذف صفوف من جدول الإدخال" : "حذف صف من جدول الإدخال"}</h2>
          <button type="button" onClick={onClose}><XCircle size={18} />إلغاء</button>
        </div>
        <p className="warning-text row-delete-warning">
          {multiple
            ? "سيتم حذف الصفوف المحددة نهائياً. هل تريد المتابعة؟"
            : `سيتم حذف الصف رقم ${(indexes[0] ?? 0) + 1} نهائياً. هل تريد المتابعة؟`}
        </p>
        <div className="hard-delete-summary">
          <span>الصفوف</span>
          <strong dir="ltr">{indexes.map((index) => index + 1).join(", ")}</strong>
          <span>البيان</span>
          <strong>{multiple ? `${indexes.length} صفوف محددة` : rowDescription(firstRow)}</strong>
        </div>
        <div className="actions modal-actions">
          <button type="button" autoFocus onClick={onClose}>البقاء</button>
          <button type="button" className="danger" onClick={onConfirm}><Trash2 size={18} />{multiple ? "حذف الصفوف" : "حذف الصف"}</button>
        </div>
      </div>
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

function FillDownCell({ column, onCopyDown, children, className = "" }) {
  return (
    <span className={["fillable-cell", className].filter(Boolean).join(" ")}>
      {children}
      <button
        type="button"
        className="cell-fill-down"
        tabIndex={-1}
        title="نسخ قيمة هذه الخلية للأسفل"
        aria-label="نسخ قيمة هذه الخلية للأسفل"
        onPointerDown={(event) => {
          preventCancelableDefault(event);
          event.stopPropagation();
          onCopyDown?.(column);
        }}
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <ArrowDownToLine size={12} />
      </button>
    </span>
  );
}

function formatPanelNumber(value) {
  return Number(numberValue(value).toFixed(2)).toString();
}

function DrawingFocusEditor({ row, index, updateRow, onClose }) {
  const workArea = rowWorkingAreaMm(row);
  const baseLayer = row.layers?.[0] || makeLayer();
  const widthInputValue = cleanName(baseLayer.width) ? formatPanelNumber(cmToMm(baseLayer.width)) : "";
  const heightInputValue = cleanName(baseLayer.height) ? formatPanelNumber(cmToMm(baseLayer.height)) : "";
  function updateRowSizeMm(field, value) {
    const text = String(value ?? "").replace(",", ".").trim();
    const parsedMm = text === "" ? null : Number(text);
    if (text !== "" && (!Number.isFinite(parsedMm) || parsedMm <= 0)) return;
    updateRow((currentRow) => {
      const layers = normalizeLayers(currentRow.glassMode || "single", currentRow.layers || [makeLayer()]);
      const cmValue = parsedMm === null ? "" : Number((parsedMm / 10).toFixed(3)).toString();
      const followKey = field === "width" ? "followBaseWidth" : "followBaseHeight";
      return {
        ...currentRow,
        layers: layers.map((layer, layerIndex) => (
          layerIndex === 0 || layer[followKey] === true
            ? { ...layer, [field]: cmValue, [followKey]: layerIndex === 0 ? false : layer[followKey] }
            : layer
        ))
      };
    });
  }
  return (
    <div className="drawing-focus-editor">
      <div className="drawing-focus-header">
        <div>
          <h3>رسم الصف {index + 1}</h3>
        </div>
        <div className="drawing-dimension-chips" aria-label="مقاسات اللوح المحدد">
          <label><Maximize2 size={15} />العرض <input dir="ltr" inputMode="decimal" value={widthInputValue || formatPanelNumber(workArea.width)} onChange={(event) => updateRowSizeMm("width", event.target.value)} /> مم</label>
          <label><Maximize2 size={15} />الارتفاع <input dir="ltr" inputMode="decimal" value={heightInputValue || formatPanelNumber(workArea.height)} onChange={(event) => updateRowSizeMm("height", event.target.value)} /> مم</label>
        </div>
        <div className="actions">
          <button type="button" className="drawing-collapse-button" onClick={onClose}><Minimize2 size={16} />طي الرسم</button>
          <button type="button" className="primary" onClick={onClose}><Save size={16} />حفظ والعودة</button>
          <button type="button" onClick={onClose}><Minimize2 size={16} />رجوع للجدول</button>
        </div>
      </div>
      <DrawingEditor row={row} updateRow={updateRow} />
    </div>
  );
}

function GlassRowEditor({ row, index, rowHeight = 68, supplierName, learnedOptions, smartOptions, priceHistory, drawingEnabled, updateRow, addRow, removeRow, copyFullRow, copyToFollowingRows, hasFollowingRows, invalid = false, selectedRow = false, isCellActive = () => false, isCellSelected = () => false, isCellEditing = () => false, isCellInvalid = () => false, cellValue = (_rowIndex, _column, fallback) => fallback, onCellValueChange = () => {}, onCellBlur = () => {}, onRowSelect = () => {}, onRowContextMenu = () => {}, onCellFocus = () => {}, onCellPointerDown = () => {}, onCellDoubleClick = () => {}, onCellCommitMove = () => {}, onCopyDownCell = () => {}, onRowResize = () => {}, onLearnTableOption = () => {} }) {
  const totals = rowTotals(row);
  const hasLayerSizeDifference = rowHasLayerSizeDifference(row);
  const composingCellRef = useRef("");
  const tableCellProps = (column) => {
    const classes = ["table-control"];
    if (isCellSelected(index, column)) classes.push("selected-cell");
    if (isCellActive(index, column)) classes.push("active-cell");
    if (isCellEditing(index, column)) classes.push("editing-cell");
    if (isCellInvalid(index, column)) classes.push("invalid-cell");
    return {
      className: classes.join(" "),
      "data-row": index,
      "data-row-id": row.id,
      "data-col": column,
      "data-editing": isCellEditing(index, column) ? "true" : "false",
      "aria-invalid": isCellInvalid(index, column) ? "true" : undefined,
      tabIndex: isCellEditing(index, column) ? 0 : -1,
      onFocus: (event) => onCellFocus(index, column, event),
      onPointerDown: (event) => onCellPointerDown(index, column, event),
      onDoubleClick: (event) => onCellDoubleClick(index, column, event),
      onBlur: (event) => onCellBlur(index, column, event),
      onCompositionStart: () => {
        composingCellRef.current = column;
      },
      onCompositionEnd: (event) => {
        composingCellRef.current = "";
        if ("value" in event.currentTarget) {
          onCellValueChange(index, column, event.currentTarget.value, { remember: false });
        }
      }
    };
  };
  function optionKindForColumn(column) {
    if (/^layer\d+-glassType$/.test(column)) return "glassTypes";
    if (/^layer\d+-company$/.test(column)) return "companies";
    if (/^layer\d+-thickness$/.test(column)) return "thicknesses";
    if (column === "doubleGap") return "gaps";
    if (column === "triplexPvb") return "pvb";
    return "";
  }
  function learnColumnValue(column, value) {
    const kind = optionKindForColumn(column);
    if (kind) onLearnTableOption(kind, value);
  }
  function comboCellProps(column) {
    const base = tableCellProps(column);
    return {
      ...base,
      onBlur: (event) => {
        base.onBlur?.(event);
        learnColumnValue(column, event.target.value);
      }
    };
  }
  function patch(patchValue) {
    updateRow({ ...row, ...patchValue });
  }
  function setMode(glassMode) {
    const started = performance.now();
    const drawing = glassMode === "single" ? row.drawing : { ...normalizeDrawing(row.drawing), panels: [] };
    updateRow({ ...row, glassMode, layers: normalizeLayers(glassMode, row.layers), drawing });
    logSlowOperation("Composition update", started, 20, "mode");
  }
  function updateLayer(layerIndex, patchValue) {
    const started = performance.now();
    const autoPriceKeys = ["glassType", "company", "thickness", "secure"];
    const baseBefore = row.layers[0] || makeLayer();
    const baseAfter = layerIndex === 0 ? { ...baseBefore, ...patchValue } : baseBefore;
    const firstWidthChanged = layerIndex === 0 && Object.prototype.hasOwnProperty.call(patchValue, "width");
    const firstHeightChanged = layerIndex === 0 && Object.prototype.hasOwnProperty.call(patchValue, "height");
    const layers = row.layers.map((layer, i) => {
      if (i !== layerIndex) return layer;
      const nextPatch = { ...patchValue };
      if (i > 0 && Object.prototype.hasOwnProperty.call(patchValue, "width")) nextPatch.followBaseWidth = false;
      if (i > 0 && Object.prototype.hasOwnProperty.call(patchValue, "height")) nextPatch.followBaseHeight = false;
      const nextLayer = { ...layer, ...nextPatch };
      if (autoPriceKeys.some((key) => Object.prototype.hasOwnProperty.call(patchValue, key))) {
        const latest = findLatestLayerPrice(priceHistory, supplierName, nextLayer);
        if (latest) {
          nextLayer.unitPrice = latest.unitPrice ?? nextLayer.unitPrice;
          nextLayer.supplierUnitPrice = latest.supplierUnitPrice ?? nextLayer.supplierUnitPrice;
        }
      }
      return nextLayer;
    }).map((layer, i) => {
      if (i === 0) return layer;
      return {
        ...layer,
        width: firstWidthChanged && layer.followBaseWidth !== false ? baseAfter.width : layer.width,
        height: firstHeightChanged && layer.followBaseHeight !== false ? baseAfter.height : layer.height
      };
    });
    updateRow({ ...row, layers });
    if (autoPriceKeys.some((key) => Object.prototype.hasOwnProperty.call(patchValue, key))) {
      logSlowOperation("Composition update", started, 20, Object.keys(patchValue).join(","));
    }
  }
  function patchMaterial(patchValue) {
    const started = performance.now();
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
    logSlowOperation("Composition update", started, 20, Object.keys(patchValue).join(","));
  }
  function moveToNextRow(column) {
    onCellCommitMove(index, column);
  }
  function commitSuggestionAndMove(column, nextValue, applyValue) {
    learnColumnValue(column, nextValue);
    onCellValueChange(index, column, nextValue, { buffer: true });
    applyValue(nextValue);
    window.requestAnimationFrame(() => moveToNextRow(column));
  }
  function handleEnter(event) {
    if (event.key !== "Enter") return;
    if (event.__glassTableHandled || event.nativeEvent?.__glassTableHandled) return;
    if (event.__glassComboCommitted || event.nativeEvent?.__glassComboCommitted) return;
    if (event.target?.tagName === "BUTTON" || event.target?.closest(".drawing-editor")) return;
    const column = event.target?.dataset?.col;
    if (!column) return;
    preventCancelableDefault(event);
    learnColumnValue(column, event.target?.value);
    moveToNextRow(column);
  }
  return (
    <div className={[invalid ? "invalid-row" : "", selectedRow ? "row-selected" : "", "table-entry"].filter(Boolean).join(" ")} style={{ "--entry-row-height": `${rowHeight}px` }} onKeyDown={handleEnter} onContextMenu={onRowContextMenu}>
      <div className="table-row">
        <button
          type="button"
          className="row-index-cell row-select-button"
          title={`تحديد الصف ${index + 1}`}
          aria-label={`تحديد الصف ${index + 1}`}
          aria-pressed={selectedRow}
          onPointerDown={onRowSelect}
        >
          <span aria-hidden="true">{index + 1}</span>
        </button>
        <div className="description" dir="auto">{rowDescription(row)}</div>
        <FillDownCell column="mode" onCopyDown={onCopyDownCell}>
          <select {...tableCellProps("mode")} value={row.glassMode} onChange={(e) => setMode(e.target.value)}>
            <option value="single">Single</option>
            <option value="double">Double</option>
            <option value="triplex">Triplex</option>
          </select>
        </FillDownCell>
          <div className="layers-cell">
          {row.layers.map((layer, layerIndex) => (
            <React.Fragment key={layerIndex}>
              <div className="layer-line">
                <span className="layer-index">{layerIndex + 1}</span>
                <FillDownCell column={`layer${layerIndex}-width`} onCopyDown={onCopyDownCell}>
                  <input {...tableCellProps(`layer${layerIndex}-width`)} inputMode="decimal" dir="ltr" value={cellValue(index, `layer${layerIndex}-width`, layer.width)} onChange={(e) => onCellValueChange(index, `layer${layerIndex}-width`, e.target.value)} placeholder="عرض سم" title="العرض بالسنتيمتر" />
                </FillDownCell>
                <FillDownCell column={`layer${layerIndex}-height`} onCopyDown={onCopyDownCell}>
                  <input {...tableCellProps(`layer${layerIndex}-height`)} inputMode="decimal" dir="ltr" value={cellValue(index, `layer${layerIndex}-height`, layer.height)} onChange={(e) => onCellValueChange(index, `layer${layerIndex}-height`, e.target.value)} placeholder="طول سم" title="الطول بالسنتيمتر" />
                </FillDownCell>
                {layerIndex === 0 ? (
                  <FillDownCell column="quantity" onCopyDown={onCopyDownCell}>
                    <input {...tableCellProps("quantity")} inputMode="decimal" dir="ltr" value={cellValue(index, "quantity", row.quantity)} onChange={(e) => onCellValueChange(index, "quantity", e.target.value)} title="عدد القطع لهذا البيان" />
                  </FillDownCell>
                ) : (
                  <span className="shared-quantity" dir="ltr">{row.quantity}</span>
                )}
                <FillDownCell column={`layer${layerIndex}-glassType`} onCopyDown={onCopyDownCell}>
                  <Combo {...comboCellProps(`layer${layerIndex}-glassType`)} editing={isCellEditing(index, `layer${layerIndex}-glassType`)} value={cellValue(index, `layer${layerIndex}-glassType`, layer.glassType)} options={smartOptions.glassTypes} onChange={(glassType) => onCellValueChange(index, `layer${layerIndex}-glassType`, glassType)} onSuggestionCommit={(glassType) => commitSuggestionAndMove(`layer${layerIndex}-glassType`, glassType, (nextValue) => updateLayer(layerIndex, { glassType: nextValue }))} />
                </FillDownCell>
                <FillDownCell column={`layer${layerIndex}-company`} onCopyDown={onCopyDownCell}>
                  <Combo {...comboCellProps(`layer${layerIndex}-company`)} editing={isCellEditing(index, `layer${layerIndex}-company`)} value={cellValue(index, `layer${layerIndex}-company`, layer.company)} options={smartOptions.companies} onChange={(company) => onCellValueChange(index, `layer${layerIndex}-company`, company)} onSuggestionCommit={(company) => commitSuggestionAndMove(`layer${layerIndex}-company`, company, (nextValue) => updateLayer(layerIndex, { company: nextValue }))} />
                </FillDownCell>
                <FillDownCell column={`layer${layerIndex}-thickness`} onCopyDown={onCopyDownCell}>
                  <Combo {...comboCellProps(`layer${layerIndex}-thickness`)} editing={isCellEditing(index, `layer${layerIndex}-thickness`)} value={cellValue(index, `layer${layerIndex}-thickness`, layer.thickness)} options={smartOptions.thicknesses} onChange={(thickness) => onCellValueChange(index, `layer${layerIndex}-thickness`, thickness)} onSuggestionCommit={(thickness) => commitSuggestionAndMove(`layer${layerIndex}-thickness`, thickness, (nextValue) => updateLayer(layerIndex, { thickness: nextValue }))} />
                </FillDownCell>
                <FillDownCell column={`layer${layerIndex}-unitPrice`} onCopyDown={onCopyDownCell}>
                  <input {...tableCellProps(`layer${layerIndex}-unitPrice`)} inputMode="decimal" dir="ltr" value={cellValue(index, `layer${layerIndex}-unitPrice`, layer.unitPrice)} onChange={(e) => onCellValueChange(index, `layer${layerIndex}-unitPrice`, e.target.value)} placeholder="سعر/م2" title="سعر هذه الطبقة لكل متر مربع" />
                </FillDownCell>
                <FillDownCell column={`layer${layerIndex}-supplierUnitPrice`} onCopyDown={onCopyDownCell}>
                  <input {...tableCellProps(`layer${layerIndex}-supplierUnitPrice`)} inputMode="decimal" dir="ltr" value={cellValue(index, `layer${layerIndex}-supplierUnitPrice`, layer.supplierUnitPrice)} onChange={(e) => onCellValueChange(index, `layer${layerIndex}-supplierUnitPrice`, e.target.value)} placeholder="تكلفة/م2" title="تكلفة المورد لهذه الطبقة لكل متر مربع" />
                </FillDownCell>
                <FillDownCell column={`layer${layerIndex}-secure`} onCopyDown={onCopyDownCell}>
                  <label className="check-cell"><input {...tableCellProps(`layer${layerIndex}-secure`)} type="checkbox" checked={layer.secure} onChange={(e) => updateLayer(layerIndex, { secure: e.target.checked })} onKeyDown={(e) => e.key === " " && updateLayer(layerIndex, { secure: !layer.secure })} />سيكوريت</label>
                </FillDownCell>
              </div>
              {layerIndex === 0 && row.glassMode !== "single" && (
                <div className="material-line">
                  <span className="layer-index">M</span>
                  <div className="material-choice">
                    {row.glassMode === "double" ? (
                      <FillDownCell column="doubleGap" onCopyDown={onCopyDownCell}>
                        <Combo {...comboCellProps("doubleGap")} editing={isCellEditing(index, "doubleGap")} value={cellValue(index, "doubleGap", row.doubleGap)} options={smartOptions.gaps || learnedOptions} onChange={(doubleGap) => onCellValueChange(index, "doubleGap", doubleGap)} onSuggestionCommit={(doubleGap) => commitSuggestionAndMove("doubleGap", doubleGap, (nextValue) => patchMaterial({ doubleGap: nextValue }))} />
                      </FillDownCell>
                    ) : (
                      <FillDownCell column="triplexPvb" onCopyDown={onCopyDownCell}>
                        <Combo {...comboCellProps("triplexPvb")} editing={isCellEditing(index, "triplexPvb")} value={cellValue(index, "triplexPvb", row.triplexPvb)} options={smartOptions.pvb} onChange={(triplexPvb) => onCellValueChange(index, "triplexPvb", triplexPvb)} onSuggestionCommit={(triplexPvb) => commitSuggestionAndMove("triplexPvb", triplexPvb, (nextValue) => patchMaterial({ triplexPvb: nextValue }))} />
                      </FillDownCell>
                    )}
                  </div>
                  <span className="material-note">{row.glassMode === "double" ? "اسبيسر / متر طولي" : "PVB / م2"}</span>
                  <FillDownCell column="materialUnitPrice" onCopyDown={onCopyDownCell}>
                    <input {...tableCellProps("materialUnitPrice")} inputMode="decimal" dir="ltr" value={cellValue(index, "materialUnitPrice", row.materialUnitPrice)} onChange={(e) => onCellValueChange(index, "materialUnitPrice", e.target.value)} placeholder="سعر المادة" />
                  </FillDownCell>
                  <FillDownCell column="supplierMaterialUnitPrice" onCopyDown={onCopyDownCell}>
                    <input {...tableCellProps("supplierMaterialUnitPrice")} inputMode="decimal" dir="ltr" value={cellValue(index, "supplierMaterialUnitPrice", row.supplierMaterialUnitPrice)} onChange={(e) => onCellValueChange(index, "supplierMaterialUnitPrice", e.target.value)} placeholder="تكلفة المادة" />
                  </FillDownCell>
                </div>
              )}
            </React.Fragment>
          ))}
          {row.layers.length > 1 && hasLayerSizeDifference && (
            <div className="layer-line compact">
              <FillDownCell column="extraDirection" onCopyDown={onCopyDownCell}>
                <select {...tableCellProps("extraDirection")} value={row.extraDirection} onChange={(e) => patch({ extraDirection: e.target.value })}>{EXTRA_DIRECTIONS.map((item) => <option key={item}>{item}</option>)}</select>
              </FillDownCell>
              <span className="hint">التموضع يؤثر على الطبقات والرسم عند اختلاف المقاسات.</span>
            </div>
          )}
        </div>
        <FillDownCell column="rowCode" onCopyDown={onCopyDownCell}>
          <input {...tableCellProps("rowCode")} value={cellValue(index, "rowCode", row.code || "")} onChange={(e) => onCellValueChange(index, "rowCode", e.target.value)} placeholder="P-105-A" dir="ltr" />
        </FillDownCell>
        <FillDownCell column="notes" onCopyDown={onCopyDownCell}>
          <input {...tableCellProps("notes")} value={cellValue(index, "notes", row.notes || "")} onChange={(e) => onCellValueChange(index, "notes", e.target.value)} placeholder="ملاحظات البيان" />
        </FillDownCell>
        <strong dir="ltr">{square(totals.area)}</strong>
        <strong dir="ltr">{money(totals.total)}</strong>
        <strong dir="ltr">{money(totals.supplierCost)}</strong>
        <button className={row.expanded ? "active tiny" : "tiny"} title="فتح محرر الرسم" onClick={() => patch({ expanded: !row.expanded })}><Palette size={16} />{drawingEnabled ? "رسم" : ""}</button>
        <button className="icon-button copy-down" title="نسخ مواصفات هذا الصف إلى كل الصفوف أسفله فقط" disabled={!hasFollowingRows} onClick={copyToFollowingRows}><ArrowDownToLine size={16} /></button>
        <button className="icon-button" title="نسخ الصف كاملاً إلى صف جديد" onClick={copyFullRow}><Copy size={16} /></button>
        <div className="layer-visual-stack color-stack">
          {row.layers.map((layer, layerIndex) => (
            <FillDownCell key={layerIndex} column={`layer${layerIndex}-color`} onCopyDown={onCopyDownCell}>
              <input {...tableCellProps(`layer${layerIndex}-color`)} type="color" value={layer.color} onChange={(e) => updateLayer(layerIndex, { color: e.target.value })} title={`لون الطبقة ${layerIndex + 1}`} />
            </FillDownCell>
          ))}
        </div>
        <div className="layer-visual-stack alpha-stack">
          {row.layers.map((layer, layerIndex) => (
            <FillDownCell key={layerIndex} column={`layer${layerIndex}-alpha`} onCopyDown={onCopyDownCell}>
              <input {...tableCellProps(`layer${layerIndex}-alpha`)} inputMode="numeric" dir="ltr" value={cellValue(index, `layer${layerIndex}-alpha`, layer.alpha ?? 45)} onChange={(e) => onCellValueChange(index, `layer${layerIndex}-alpha`, e.target.value)} title={`شفافية الطبقة ${layerIndex + 1} من 0 إلى 100`} />
            </FillDownCell>
          ))}
        </div>
        <div className="layer-visual-stack mirror-stack">
          {row.layers.map((layer, layerIndex) => (
            <FillDownCell key={layerIndex} column={`layer${layerIndex}-mirror`} onCopyDown={onCopyDownCell}>
              <label className="visual-check-cell"><input {...tableCellProps(`layer${layerIndex}-mirror`)} type="checkbox" checked={layer.mirror} onChange={(e) => updateLayer(layerIndex, { mirror: e.target.checked })} />{row.layers.length > 1 ? layerIndex + 1 : ""}</label>
            </FillDownCell>
          ))}
        </div>
        <button className="icon-button danger" onClick={removeRow}><Trash2 size={16} /></button>
      </div>
      <button type="button" className="row-resize-handle" aria-label="تغيير ارتفاع الصف" onPointerDown={onRowResize} />
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

function thicknessMmValue(value, fallback = 6) {
  const match = toLatinClipboardDigits(value).replace(",", ".").match(/\d+(?:\.\d+)?/);
  const parsed = match ? Number(match[0]) : fallback;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function glassCompositionParts(row = {}) {
  const layers = normalizeLayers(row.glassMode || "single", row.layers || [makeLayer()]);
  const first = layers[0] || makeLayer();
  const second = layers[1] || first;
  if ((row.glassMode || "single") === "double") {
    return [
      { kind: "glass", label: `زجاج 1 ${normalizeThicknessText(first.thickness || "")}`, value: thicknessMmValue(first.thickness), color: first.color || "#9fd3ff" },
      { kind: "spacer", label: `${row.doubleGap || "Spacer"} Spacer`, value: thicknessMmValue(row.doubleGap, 12), color: "#b6a16a" },
      { kind: "glass", label: `زجاج 2 ${normalizeThicknessText(second.thickness || "")}`, value: thicknessMmValue(second.thickness), color: second.color || "#9fd3ff" }
    ];
  }
  if ((row.glassMode || "single") === "triplex") {
    return [
      { kind: "glass", label: `زجاج 1 ${normalizeThicknessText(first.thickness || "")}`, value: thicknessMmValue(first.thickness), color: first.color || "#9fd3ff" },
      { kind: "pvb", label: `${row.triplexPvb || "PVB"} PVB`, value: thicknessMmValue(row.triplexPvb, 1.52), color: "#d8b4fe" },
      { kind: "glass", label: `زجاج 2 ${normalizeThicknessText(second.thickness || "")}`, value: thicknessMmValue(second.thickness), color: second.color || "#9fd3ff" }
    ];
  }
  return [
    { kind: "glass", label: `زجاج ${normalizeThicknessText(first.thickness || "")}`, value: thicknessMmValue(first.thickness), color: first.color || "#9fd3ff" }
  ];
}

function layerVisualDepthOffsets(row = {}) {
  const layers = normalizeLayers(row.glassMode || "single", row.layers || [makeLayer()]);
  if ((row.glassMode || "single") === "single" || layers.length <= 1) return layers.map(() => 0);
  const parts = glassCompositionParts(row);
  const layerDepths = [0];
  if ((row.glassMode || "single") === "double") {
    layerDepths[1] = (parts[0]?.value || 0) + (parts[1]?.value || 0);
  } else if ((row.glassMode || "single") === "triplex") {
    layerDepths[1] = (parts[0]?.value || 0) + (parts[1]?.value || 0);
  }
  const displayMultiplier = 2.1;
  return layers.map((_, index) => Math.round(Math.min(72, (layerDepths[index] || index * 10) * displayMultiplier)));
}

function DrawingEditor({ row, updateRow }) {
  if (isSingleGlassRow(row)) {
    return <MultiPanelDrawingEditor row={row} updateRow={updateRow} />;
  }
  return <SinglePanelDrawingEditor row={row} updateRow={updateRow} />;
}

function MultiPanelDrawingEditor({ row, updateRow }) {
  const [tool, setTool] = useState("select");
  const [drag, setDrag] = useState(null);
  const [selectedPanelId, setSelectedPanelId] = useState("");
  const [selectedShapeId, setSelectedShapeId] = useState(null);
  const [selectedOutlinePointId, setSelectedOutlinePointId] = useState(null);
  const stageRef = useRef(null);
  const svgRef = useRef(null);
  const drawing = normalizeDrawing(row.drawing);
  const workArea = rowWorkingAreaMm(row);
  const panels = rowDrawingPanels(row).map((panel, index) => clampDrawingPanelToWorkingArea(panel, row));
  const selectedPanel = panels.find((panel) => panel.id === selectedPanelId) || panels[0] || null;
  const selectedPanelIndex = Math.max(0, panels.findIndex((panel) => panel.id === selectedPanel?.id));
  const activeDrawing = normalizePanelDrawingData(selectedPanel?.drawing);
  const activeGeometry = selectedPanel ? { x: 0, y: 0, width: numberValue(selectedPanel.width), height: numberValue(selectedPanel.height) } : { x: 0, y: 0, width: 1000, height: 1000 };
  const activeOutlinePoints = visualOutlinePointsForDrawing(activeDrawing, activeGeometry);
  const activeBounds = boundsFromOutline(activeOutlinePoints, activeGeometry);
  const selectedShape = activeDrawing.shapes.find((shape) => shape.id === selectedShapeId) || null;
  const selectedOutlinePointIndex = activeOutlinePoints.findIndex((point) => point.id === selectedOutlinePointId);
  const selectedOutlinePoint = selectedOutlinePointIndex >= 0 ? activeOutlinePoints[selectedOutlinePointIndex] : null;
  const canDeleteSelectedOutlinePoint = !!selectedOutlinePoint && !selectedOutlinePoint.corner && activeOutlinePoints.length > 4;
  const pad = 520;
  const bounds = { x: 0, y: 0, right: workArea.width, bottom: workArea.height };
  const fullView = {
    x: bounds.x - pad,
    y: bounds.y - pad,
    width: Math.max(1200, bounds.right - bounds.x + pad * 2),
    height: Math.max(900, bounds.bottom - bounds.y + pad * 2)
  };
  const [view, setView] = useState(fullView);
  const zoomPercent = Math.round((fullView.width / Math.max(1, view.width)) * 100);

  useEffect(() => {
    if (!selectedPanelId && panels[0]) setSelectedPanelId(panels[0].id);
    if (selectedPanelId && !panels.some((panel) => panel.id === selectedPanelId) && panels[0]) setSelectedPanelId(panels[0].id);
  }, [panels, selectedPanelId]);

  useEffect(() => {
    if (selectedShapeId && !activeDrawing.shapes.some((shape) => shape.id === selectedShapeId)) setSelectedShapeId(null);
  }, [activeDrawing.shapes, selectedShapeId]);

  useEffect(() => {
    if (selectedOutlinePointId && !activeOutlinePoints.some((point) => point.id === selectedOutlinePointId)) setSelectedOutlinePointId(null);
  }, [activeOutlinePoints, selectedOutlinePointId]);

  useEffect(() => {
    setView((current) => {
      const currentZoom = fullView.width / Math.max(1, current.width);
      if (!Number.isFinite(currentZoom) || currentZoom < 0.25 || currentZoom > 6) return fullView;
      return clampedView(current);
    });
  }, [fullView.x, fullView.y, fullView.width, fullView.height]);

  useEffect(() => {
    if (!drag) return undefined;
    document.body.classList.add("drawing-dragging");
    const stopDragging = () => {
      try {
        if (drag.pointerTarget?.hasPointerCapture?.(drag.pointerId)) drag.pointerTarget.releasePointerCapture(drag.pointerId);
      } catch { /* Capture may already have ended. */ }
      setDrag(null);
    };
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
    window.addEventListener("blur", stopDragging);
    window.addEventListener("glass-orders-cancel-interactions", stopDragging);
    return () => {
      document.body.classList.remove("drawing-dragging");
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
      window.removeEventListener("blur", stopDragging);
      window.removeEventListener("glass-orders-cancel-interactions", stopDragging);
    };
  }, [drag]);

  useEffect(() => {
    function handleKey(event) {
      const activeTag = event.target?.tagName;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(activeTag)) return;
      if (!stageRef.current?.contains(document.activeElement) && !stageRef.current?.contains(event.target)) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        preventCancelableDefault(event);
        if (selectedShape) deleteSelectedShape();
        else if (canDeleteSelectedOutlinePoint) deleteSelectedPanelOutlinePoint();
        else if (selectedPanel) deleteSelectedPanel();
      } else if (event.key === "Escape") {
        preventCancelableDefault(event);
        setSelectedShapeId(null);
        setSelectedOutlinePointId(null);
        setTool("select");
      } else if (selectedShape && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
        preventCancelableDefault(event);
        const step = event.shiftKey ? 10 : 1;
        const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
        const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
        if (selectedShape.kind === "circle" || selectedShape.kind === "text") {
          selectedShapePatch({ x: numberValue(selectedShape.x) + dx, y: numberValue(selectedShape.y) + dy });
        } else if (selectedShape.kind === "rect") {
          selectedShapePatch({ x: numberValue(selectedShape.x) + dx, y: numberValue(selectedShape.y) + dy });
        } else if (selectedShape.kind === "arrow") {
          selectedShapePatch({
            x1: numberValue(selectedShape.x1) + dx,
            y1: numberValue(selectedShape.y1) + dy,
            x2: numberValue(selectedShape.x2) + dx,
            y2: numberValue(selectedShape.y2) + dy
          });
        }
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [selectedShape, selectedPanel, selectedOutlinePointId, canDeleteSelectedOutlinePoint, panels.length]);

  useEffect(() => {
    const node = stageRef.current;
    if (!node) return undefined;
    function handleWheel(event) {
      const rect = svgRef.current?.getBoundingClientRect?.();
      const scaleX = view.width / Math.max(1, rect?.width || 1);
      const scaleY = view.height / Math.max(1, rect?.height || 1);
      if (event.ctrlKey) {
        preventCancelableDefault(event);
        zoomCanvas(event.deltaY < 0 ? 1 : -1, event);
        return;
      }
      if (event.shiftKey && !event.ctrlKey) {
        preventCancelableDefault(event);
        const horizontalDelta = event.deltaX || event.deltaY;
        setView((current) => clampedView({ ...current, x: current.x + horizontalDelta * scaleX }));
        return;
      }
      preventCancelableDefault(event);
      setView((current) => clampedView({ ...current, y: current.y + event.deltaY * scaleY }));
    }
    node.addEventListener("wheel", handleWheel, { passive: false });
    return () => node.removeEventListener("wheel", handleWheel);
  }, [tool, view, fullView.x, fullView.y, fullView.width, fullView.height]);

  function clampedView(nextView) {
    const minZoom = 0.25;
    const maxZoom = 5;
    const minWidth = fullView.width / maxZoom;
    const maxWidth = fullView.width / minZoom;
    const width = Math.max(minWidth, Math.min(maxWidth, numberValue(nextView.width, fullView.width)));
    const height = width * (fullView.height / Math.max(1, fullView.width));
    const extraX = Math.max(0, (width - fullView.width) / 2);
    const extraY = Math.max(0, (height - fullView.height) / 2);
    const minX = fullView.x - extraX;
    const maxX = fullView.x + fullView.width - width + extraX;
    const minY = fullView.y - extraY;
    const maxY = fullView.y + fullView.height - height + extraY;
    return {
      x: Math.max(minX, Math.min(maxX, numberValue(nextView.x, fullView.x))),
      y: Math.max(minY, Math.min(maxY, numberValue(nextView.y, fullView.y))),
      width,
      height
    };
  }

  function svgPointFromEvent(event) {
    if (!svgRef.current) return { x: 0, y: 0 };
    const point = svgRef.current.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(svgRef.current.getScreenCTM().inverse());
  }

  function focusDrawingWorkspace() {
    try {
      stageRef.current?.focus?.({ preventScroll: true });
    } catch {
      stageRef.current?.focus?.();
    }
  }

  function setPanels(nextPanels, nextSelectedId = selectedPanel?.id) {
    const normalizedPanels = nextPanels.map((panel, index) => {
      const clampedPanel = clampDrawingPanelToWorkingArea(normalizeDrawingPanel(panel, index), row);
      return {
        ...clampedPanel,
        drawing: sanitizePanelDrawingGeometry(clampedPanel.drawing, clampedPanel)
      };
    });
    updateRow({ ...row, drawing: normalizeDrawing({ ...drawing, panels: normalizedPanels }) });
    if (nextSelectedId) setSelectedPanelId(nextSelectedId);
  }

  function updatePanel(panelId, patchValue) {
    const currentPanel = panels.find((panel) => panel.id === panelId);
    if (currentPanel && ("width" in patchValue || "height" in patchValue)) {
      const violation = panelFeatureResizeViolation(currentPanel, patchValue);
      if (violation) {
        window.alert(violation);
        return;
      }
    }
    setPanels(panels.map((panel) => panel.id === panelId ? { ...panel, ...patchValue } : panel), panelId);
  }

  function updatePanelDrawing(panelId, nextDrawing) {
    setPanels(panels.map((panel) => panel.id === panelId ? { ...panel, drawing: normalizePanelDrawingData(nextDrawing) } : panel), panelId);
  }

  function updateSelectedPanel(patchValue) {
    if (!selectedPanel) return;
    updatePanel(selectedPanel.id, patchValue);
  }

  function addPanel() {
    const size = firstLayerSizeMm(row);
    const width = Math.max(1, size.width);
    const height = Math.max(1, size.height);
    const label = panelLetter(panels.length);
    const newPanel = normalizeDrawingPanel({
      id: uid(),
      label,
      code: cleanName(row.code) ? `${cleanName(row.code)}-${label}` : label,
      width,
      height,
      x: 0,
      y: 0,
      notes: "",
      drawing: normalizePanelDrawingData()
    }, panels.length);
    setPanels([...panels, newPanel], newPanel.id);
    setSelectedShapeId(null);
    window.setTimeout(focusDrawingWorkspace, 0);
  }

  function duplicateSelectedPanel() {
    if (!selectedPanel) return;
    const clone = JSON.parse(JSON.stringify(selectedPanel));
    const label = panelLetter(panels.length);
    const duplicate = normalizeDrawingPanel({
      ...clone,
      id: uid(),
      label,
      code: cleanName(clone.code) ? `${cleanName(clone.code)}-${label}` : label,
      x: numberValue(selectedPanel.x) + 80,
      y: numberValue(selectedPanel.y) + 80
    }, panels.length);
    setPanels([...panels, duplicate], duplicate.id);
    setSelectedShapeId(null);
    window.setTimeout(focusDrawingWorkspace, 0);
  }

  function deleteSelectedPanel() {
    if (!selectedPanel) return;
    if (panels.length <= 1) {
      window.alert("لا يمكن حذف آخر لوح زجاج.");
      return;
    }
    if (!window.confirm(`حذف Panel ${panelDisplayName(selectedPanel, selectedPanelIndex)}؟`)) return;
    const nextPanels = panels.filter((panel) => panel.id !== selectedPanel.id);
    setSelectedShapeId(null);
    setPanels(nextPanels, nextPanels[0]?.id);
    window.setTimeout(focusDrawingWorkspace, 0);
  }

  function localPointForPanel(panel, event) {
    const point = svgPointFromEvent(event);
    return {
      x: Math.max(0, Math.min(numberValue(panel.width), point.x - numberValue(panel.x))),
      y: Math.max(0, Math.min(numberValue(panel.height), point.y - numberValue(panel.y)))
    };
  }

  function outlinePointForPanel(panel, event) {
    const point = svgPointFromEvent(event);
    const width = numberValue(panel.width);
    const height = numberValue(panel.height);
    return {
      x: Math.max(-320, Math.min(width + 320, point.x - numberValue(panel.x))),
      y: Math.max(-320, Math.min(height + 320, point.y - numberValue(panel.y)))
    };
  }

  function panelOutlinePoints(panel) {
    const panelDrawing = normalizePanelDrawingData(panel?.drawing);
    const geometry = { x: 0, y: 0, width: numberValue(panel?.width), height: numberValue(panel?.height) };
    return outlinePointsForGeometry(panelDrawing, geometry).map((point, index) => normalizeOutlinePoint(point, index));
  }

  function commitPanelOutlinePoints(panelId, points) {
    const panel = panels.find((item) => item.id === panelId);
    if (!panel) return;
    const panelDrawing = normalizePanelDrawingData(panel.drawing);
    updatePanelDrawing(panelId, {
      ...panelDrawing,
      outline: { points: points.map((point, index) => normalizeOutlinePoint(point, index)) }
    });
  }

  function addPanelPartialArch(panel, event, segmentIndex) {
    preventCancelableDefault(event);
    event.stopPropagation();
    if (tool !== "partialArch") return;
    const sourcePoints = panelOutlinePoints(panel);
    if (sourcePoints.length < 2) return;
    const safeIndex = ((Number(segmentIndex) % sourcePoints.length) + sourcePoints.length) % sourcePoints.length;
    const rotatedPoints = [...sourcePoints.slice(safeIndex), ...sourcePoints.slice(0, safeIndex)];
    const start = rotatedPoints[0];
    const end = rotatedPoints[1];
    if (!start || !end) return;
    const clickPoint = outlinePointForPanel(panel, event);
    const sx = numberValue(start.x);
    const sy = numberValue(start.y);
    const ex = numberValue(end.x);
    const ey = numberValue(end.y);
    const dx = ex - sx;
    const dy = ey - sy;
    const lengthSquared = Math.max(1, dx * dx + dy * dy);
    const splitRatio = Math.max(0.12, Math.min(0.82, ((numberValue(clickPoint.x) - sx) * dx + (numberValue(clickPoint.y) - sy) * dy) / lengthSquared));
    const split = {
      id: uid(),
      x: Math.round(sx + dx * splitRatio),
      y: Math.round(sy + dy * splitRatio),
      corner: false,
      mode: "free",
      halfDiameter: 0,
      curve: false
    };
    const archStartX = numberValue(split.x);
    const archStartY = numberValue(split.y);
    const archDx = ex - archStartX;
    const archDy = ey - archStartY;
    const archLength = Math.max(1, Math.hypot(archDx, archDy));
    const normal = { x: -archDy / archLength, y: archDx / archLength };
    const midpoint = { x: (archStartX + ex) / 2, y: (archStartY + ey) / 2 };
    const center = { x: numberValue(panel.width) / 2, y: numberValue(panel.height) / 2 };
    const depth = Math.max(24, Math.min(160, archLength * 0.22));
    const candidateA = { x: midpoint.x + normal.x * depth, y: midpoint.y + normal.y * depth };
    const candidateB = { x: midpoint.x - normal.x * depth, y: midpoint.y - normal.y * depth };
    const distanceA = Math.hypot(candidateA.x - center.x, candidateA.y - center.y);
    const distanceB = Math.hypot(candidateB.x - center.x, candidateB.y - center.y);
    const peak = distanceA >= distanceB ? candidateA : candidateB;
    const control = {
      id: uid(),
      x: Math.round(Math.max(-320, Math.min(numberValue(panel.width) + 320, peak.x))),
      y: Math.round(Math.max(-320, Math.min(numberValue(panel.height) + 320, peak.y))),
      corner: false,
      mode: "curve",
      halfDiameter: Math.round(depth),
      curve: true
    };
    const next = [rotatedPoints[0], split, control, ...rotatedPoints.slice(1)];
    commitPanelOutlinePoints(panel.id, next);
    setSelectedPanelId(panel.id);
    setSelectedShapeId(null);
    setSelectedOutlinePointId(split.id);
    setTool("edge");
  }

  function addPanelOutlinePoint(panel, event, segmentIndex) {
    preventCancelableDefault(event);
    event.stopPropagation();
    if (tool !== "edge") return;
    const point = outlinePointForPanel(panel, event);
    const next = panelOutlinePoints(panel);
    const pointIndex = segmentIndex + 1;
    next.splice(pointIndex, 0, {
      id: uid(),
      x: Math.round(point.x),
      y: Math.round(point.y),
      corner: false,
      mode: "free",
      halfDiameter: 0,
      curve: false
    });
    commitPanelOutlinePoints(panel.id, next);
    setSelectedPanelId(panel.id);
    setSelectedShapeId(null);
    setSelectedOutlinePointId(next[pointIndex].id);
    event.currentTarget?.setPointerCapture?.(event.pointerId);
    setDrag({ kind: "panelOutlinePoint", pointerId: event.pointerId, pointerTarget: event.currentTarget, panelId: panel.id, pointIndex });
  }

  function handlePanelOutlineSegmentPointerDown(panel, event, segmentIndex) {
    if (tool === "partialArch") {
      addPanelPartialArch(panel, event, segmentIndex);
      return;
    }
    addPanelOutlinePoint(panel, event, segmentIndex);
  }

  function startPanelOutlinePointDrag(panel, event, point, pointIndex) {
    preventCancelableDefault(event);
    event.stopPropagation();
    focusDrawingWorkspace();
    setSelectedPanelId(panel.id);
    setSelectedShapeId(null);
    setSelectedOutlinePointId(point.id);
    if (point.corner) return;
    event.currentTarget?.setPointerCapture?.(event.pointerId);
    setDrag({ kind: "panelOutlinePoint", pointerId: event.pointerId, pointerTarget: event.currentTarget, panelId: panel.id, pointIndex });
  }

  function panelSegmentHitPoints(segment, width = 46) {
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

  function addShapeToPanel(panel, event) {
    const point = localPointForPanel(panel, event);
    const currentDrawing = normalizePanelDrawingData(panel.drawing);
    const geometry = { width: numberValue(panel.width), height: numberValue(panel.height) };
    const draftShape = tool === "circle"
      ? { id: uid(), kind: "circle", x: Math.round(point.x), y: Math.round(point.y), r: 30 }
      : tool === "rect"
        ? { id: uid(), kind: "rect", rectType: "internal", x: Math.round(Math.max(0, point.x - 60)), y: Math.round(Math.max(0, point.y - 40)), w: 120, h: 80 }
        : tool === "cornerNotch"
          ? { id: uid(), kind: "rect", type: "cornerNotch", rectType: "corner", corner: nearestPanelCorner(point, { x: 0, y: 0, right: numberValue(panel.width), bottom: numberValue(panel.height) }), w: Math.min(120, Math.max(1, numberValue(panel.width) - 1)), h: Math.min(80, Math.max(1, numberValue(panel.height) - 1)) }
        : tool === "arrow"
          ? { id: uid(), kind: "arrow", x1: Math.round(point.x - 80), y1: Math.round(point.y), x2: Math.round(point.x + 80), y2: Math.round(point.y), text: "" }
          : { id: uid(), kind: "text", x: Math.round(point.x), y: Math.round(point.y), text: "ملاحظة" };
    const shape = ["circle", "rect", "cornerNotch"].includes(tool)
      ? clampFeatureShapeToPanel(draftShape, currentDrawing, geometry)
      : draftShape;
    updatePanelDrawing(panel.id, { ...currentDrawing, shapes: [...currentDrawing.shapes, shape] });
    setSelectedPanelId(panel.id);
    setSelectedShapeId(shape.id);
    setSelectedOutlinePointId(null);
  }

  function startPan(event) {
    preventCancelableDefault(event);
    event.stopPropagation();
    focusDrawingWorkspace();
    event.currentTarget?.setPointerCapture?.(event.pointerId);
    setDrag({ kind: "pan", pointerId: event.pointerId, pointerTarget: event.currentTarget, startClientX: event.clientX, startClientY: event.clientY, startView: view });
  }

  function handlePanelPointerDown(panel, event) {
    if (event.button === 1 || (tool === "pan" && event.button === 0)) {
      startPan(event);
      return;
    }
    if (event.button !== 0) return;
    preventCancelableDefault(event);
    event.stopPropagation();
    focusDrawingWorkspace();
    setSelectedPanelId(panel.id);
    setSelectedShapeId(null);
    setSelectedOutlinePointId(null);
    if (tool === "edge" || tool === "partialArch") return;
    if (tool !== "select") {
      addShapeToPanel(panel, event);
      return;
    }
    event.currentTarget?.setPointerCapture?.(event.pointerId);
    setDrag({ kind: "panel", pointerId: event.pointerId, pointerTarget: event.currentTarget, panelId: panel.id, startPoint: svgPointFromEvent(event), startX: numberValue(panel.x), startY: numberValue(panel.y) });
  }

  function handleShapePointerDown(panel, shape, event) {
    if (event.button === 1 || (tool === "pan" && event.button === 0)) {
      startPan(event);
      return;
    }
    if (event.button !== 0) return;
    preventCancelableDefault(event);
    event.stopPropagation();
    focusDrawingWorkspace();
    setSelectedPanelId(panel.id);
    setSelectedShapeId(shape.id);
    setSelectedOutlinePointId(null);
    event.currentTarget?.setPointerCapture?.(event.pointerId);
    setDrag({ kind: "shape", pointerId: event.pointerId, pointerTarget: event.currentTarget, panelId: panel.id, shapeId: shape.id, startPoint: svgPointFromEvent(event), startShape: { ...shape } });
  }

  function handlePointerMove(event) {
    if (!drag) return;
    preventCancelableDefault(event);
    if (drag.kind === "pan") {
      const rect = svgRef.current?.getBoundingClientRect?.();
      const scaleX = view.width / Math.max(1, rect?.width || 1);
      const scaleY = view.height / Math.max(1, rect?.height || 1);
      setView(clampedView({
        ...drag.startView,
        x: drag.startView.x - (event.clientX - drag.startClientX) * scaleX,
        y: drag.startView.y - (event.clientY - drag.startClientY) * scaleY
      }));
      return;
    }
    const point = svgPointFromEvent(event);
    const dx = point.x - drag.startPoint.x;
    const dy = point.y - drag.startPoint.y;
    if (drag.kind === "panel") {
      updatePanel(drag.panelId, { x: Math.round(drag.startX + dx), y: Math.round(drag.startY + dy) });
      return;
    }
    if (drag.kind === "shape") {
      const panel = panels.find((item) => item.id === drag.panelId);
      if (!panel) return;
      const panelDrawing = normalizePanelDrawingData(panel.drawing);
      const shapes = panelDrawing.shapes.map((shape) => {
        if (shape.id !== drag.shapeId) return shape;
        const base = drag.startShape;
        if (shape.kind === "circle") return clampFeatureShapeToPanel({ ...shape, x: Math.round(numberValue(base.x) + dx), y: Math.round(numberValue(base.y) + dy) }, panelDrawing, panel);
        if (shape.kind === "text") return { ...shape, x: Math.round(numberValue(base.x) + dx), y: Math.round(numberValue(base.y) + dy) };
        if (shape.kind === "rect") {
          const moved = { ...shape, x: Math.round(numberValue(base.x) + dx), y: Math.round(numberValue(base.y) + dy) };
          if (isCornerNotchShape(shape, { x: 0, y: 0, right: numberValue(panel.width), bottom: numberValue(panel.height) })) {
            moved.corner = nearestPanelCorner({ x: moved.x + numberValue(moved.w) / 2, y: moved.y + numberValue(moved.h) / 2 }, { x: 0, y: 0, right: numberValue(panel.width), bottom: numberValue(panel.height) });
          }
          return clampFeatureShapeToPanel(moved, panelDrawing, panel);
        }
        if (shape.kind === "arrow") return { ...shape, x1: Math.round(numberValue(base.x1) + dx), y1: Math.round(numberValue(base.y1) + dy), x2: Math.round(numberValue(base.x2) + dx), y2: Math.round(numberValue(base.y2) + dy) };
        return shape;
      });
      updatePanelDrawing(panel.id, { ...panelDrawing, shapes });
      return;
    }
    if (drag.kind === "panelOutlinePoint") {
      const panel = panels.find((item) => item.id === drag.panelId);
      if (!panel) return;
      const point = outlinePointForPanel(panel, event);
      const points = panelOutlinePoints(panel);
      if (!points[drag.pointIndex] || points[drag.pointIndex].corner) return;
      const next = points.map((outlinePoint, pointIndex) => pointIndex === drag.pointIndex
        ? {
            ...outlinePoint,
            x: Math.round(point.x),
            y: Math.round(point.y)
          }
        : outlinePoint);
      commitPanelOutlinePoints(panel.id, next);
    }
  }

  function zoomCanvas(direction, event = null) {
    const factor = direction > 0 ? 1 / 1.16 : 1.16;
    const pointer = event ? svgPointFromEvent(event) : { x: view.x + view.width / 2, y: view.y + view.height / 2 };
    const ratioX = (pointer.x - view.x) / view.width;
    const ratioY = (pointer.y - view.y) / view.height;
    const nextWidth = view.width * factor;
    const nextHeight = view.height * factor;
    setView(clampedView({
      x: pointer.x - nextWidth * ratioX,
      y: pointer.y - nextHeight * ratioY,
      width: nextWidth,
      height: nextHeight
    }));
  }

  function selectedShapePatch(patchValue) {
    if (!selectedPanel || !selectedShape) return;
    const nextDrawing = normalizePanelDrawingData(selectedPanel.drawing);
    const bounds = { x: 0, y: 0, width: numberValue(selectedPanel.width), height: numberValue(selectedPanel.height), right: numberValue(selectedPanel.width), bottom: numberValue(selectedPanel.height) };
    const currentIsCornerNotch = isCornerNotchShape(selectedShape, bounds);
    if (currentIsCornerNotch) {
      const nextWidth = Math.max(1, numberValue(patchValue.width ?? patchValue.w ?? selectedShape.width ?? selectedShape.w));
      const nextHeight = Math.max(1, numberValue(patchValue.height ?? patchValue.h ?? selectedShape.height ?? selectedShape.h));
      if (nextWidth >= bounds.width || nextHeight >= bounds.height) {
        window.alert("عرض الركنة أكبر من المساحة المتاحة داخل اللوح.");
        return;
      }
    }
    updatePanelDrawing(selectedPanel.id, {
      ...nextDrawing,
      shapes: nextDrawing.shapes.map((shape) => {
        if (shape.id !== selectedShape.id) return shape;
        const nextShape = { ...shape, ...patchValue };
        if (nextShape.kind === "circle" || nextShape.kind === "rect") {
          const clamped = clampFeatureShapeToPanel(nextShape, nextDrawing, selectedPanel);
          if (shape.kind === "circle" && "r" in patchValue && numberValue(clamped.r) < numberValue(patchValue.r)) {
            window.alert("قطر الثقب أكبر من المساحة المتاحة داخل اللوح.");
            return shape;
          }
          return clamped;
        }
        return nextShape;
      })
    });
  }

  function updateSelectedPanelEdge(edge, value) {
    if (!selectedPanel) return;
    const safeEdge = ["top", "right", "bottom", "left"].includes(edge) ? edge : "top";
    const nextDrawing = normalizePanelDrawingData(selectedPanel.drawing);
    updatePanelDrawing(selectedPanel.id, {
      ...nextDrawing,
      edges: { ...nextDrawing.edges, [safeEdge]: Math.max(0, numberValue(value)) }
    });
  }

  function deleteSelectedShape() {
    if (!selectedPanel || !selectedShape) return;
    const nextDrawing = normalizePanelDrawingData(selectedPanel.drawing);
    updatePanelDrawing(selectedPanel.id, { ...nextDrawing, shapes: nextDrawing.shapes.filter((shape) => shape.id !== selectedShape.id) });
    setSelectedShapeId(null);
  }

  function deleteSelectedPanelOutlinePoint() {
    if (!selectedPanel || !canDeleteSelectedOutlinePoint) return;
    commitPanelOutlinePoints(selectedPanel.id, activeOutlinePoints.filter((point) => point.id !== selectedOutlinePointId));
    setSelectedOutlinePointId(null);
  }

  function renderPanel(panel, panelIndex) {
    const panelDrawing = normalizePanelDrawingData(panel.drawing);
    const geometry = { x: 0, y: 0, width: numberValue(panel.width), height: numberValue(panel.height) };
    const outlinePoints = visualOutlinePointsForDrawing(panelDrawing, geometry);
    const outlineBounds = boundsFromOutline(outlinePoints, geometry);
    const isSelected = panel.id === selectedPanel?.id;
    const holeLabels = holeLeaderLabelItems(panelDrawing.shapes, outlineBounds);
    return (
      <g key={panel.id} className={isSelected ? "glass-panel selected-panel" : "glass-panel"} transform={`translate(${numberValue(panel.x)} ${numberValue(panel.y)})`} onPointerDown={(event) => handlePanelPointerDown(panel, event)}>
        <rect className="panel-hit-area" x="-180" y="-180" width={numberValue(panel.width) + 360} height={numberValue(panel.height) + 360} />
        <path className="glass-outline-fill" d={outlinePath(outlinePoints)} fill={row.layers?.[0]?.color || "#9fd3ff"} opacity=".22" stroke={isSelected ? "#0f62fe" : "#1f6fa8"} strokeWidth={isSelected ? 4 : 1.8} vectorEffect="non-scaling-stroke" />
        <text className="panel-title-label" x={numberValue(panel.width) / 2} y="-58" textAnchor="middle">{`Panel ${panelDisplayName(panel, panelIndex)} - ${Math.round(numberValue(panel.width))}×${Math.round(numberValue(panel.height))} mm`}</text>
        <g className="outline-total-dimensions">
          <line x1="0" y1="-28" x2={numberValue(panel.width)} y2="-28" />
          <line x1={numberValue(panel.width) + 28} y1="0" x2={numberValue(panel.width) + 28} y2={numberValue(panel.height)} />
          <text x={numberValue(panel.width) / 2} y="-42" textAnchor="middle">{`${Math.round(numberValue(panel.width))}مم`}</text>
          <text x={numberValue(panel.width) + 44} y={numberValue(panel.height) / 2} textAnchor="middle" transform={`rotate(90 ${numberValue(panel.width) + 44} ${numberValue(panel.height) / 2})`}>{`${Math.round(numberValue(panel.height))}مم`}</text>
        </g>
        {isSelected && (tool === "edge" || tool === "partialArch") && (
          <g className="outline-edit-guides">
            <path className="outline-active-path" d={outlinePath(outlinePoints)} />
            {outlinePoints.map((point, pointIndex) => {
              if (outlinePointMode(point) === "free" || pointIndex <= 0 || pointIndex >= outlinePoints.length - 1) return null;
              const previous = outlinePoints[pointIndex - 1];
              const next = outlinePoints[pointIndex + 1];
              return (
                <g className={outlinePointMode(point) === "arc" ? "outline-curve-guides arc" : "outline-curve-guides"} key={`panel-curve-${panel.id}-${point.id}`}>
                  <line x1={previous.x} y1={previous.y} x2={point.x} y2={point.y} />
                  <line x1={point.x} y1={point.y} x2={next.x} y2={next.y} />
                </g>
              );
            })}
            {outlineSegments(outlinePoints).map((segment) => {
              const midX = (numberValue(segment.start.x) + numberValue(segment.end.x)) / 2;
              const midY = (numberValue(segment.start.y) + numberValue(segment.end.y)) / 2;
              return (
                <g key={`panel-segment-${panel.id}-${segment.index}`}>
                  <polygon className="outline-segment-hit" points={panelSegmentHitPoints(segment)} onPointerDown={(event) => handlePanelOutlineSegmentPointerDown(panel, event, segment.index)} />
                  {!segment.start.corner && !segment.end.corner && <circle className="outline-segment-handle" cx={midX} cy={midY} r="12" />}
                </g>
              );
            })}
            {outlinePoints.map((point, pointIndex) => (
              <circle
                key={`panel-outline-point-${panel.id}-${point.id}`}
                className={`outline-control-point${point.corner ? " corner" : ""}${outlinePointMode(point) === "curve" ? " curve" : ""}${outlinePointMode(point) === "arc" ? " arc" : ""}${point.id === selectedOutlinePointId ? " selected-outline-point" : ""}`}
                cx={point.x}
                cy={point.y}
                r={point.corner ? 9 : 12}
                onPointerDown={(event) => startPanelOutlinePointDrag(panel, event, point, pointIndex)}
              >
                <title>{point.corner ? "ركن ثابت" : `أفقي ${Math.round(numberValue(point.x))}مم / رأسي ${Math.round(numberValue(point.y))}مم`}</title>
              </circle>
            ))}
          </g>
        )}
        {panelDrawing.shapes.map((shape) => {
          const isShapeSelected = isSelected && selectedShapeId === shape.id;
          const ref = measurementReference(shape, outlineBounds, outlinePoints);
          const centerX = ref.centerX;
          const centerY = ref.centerY;
          const measure = (
            <g className="measurement-lines">
              <line x1={ref.hStart} y1={centerY} x2={centerX} y2={centerY} />
              <line x1={centerX} y1={ref.vStart} x2={centerX} y2={centerY} />
              <text x={(ref.hStart + centerX) / 2} y={centerY - 12} textAnchor="middle">{`${Math.round(ref.horizontalDistance)}مم`}</text>
              <text x={centerX + 14} y={(ref.vStart + centerY) / 2} textAnchor="start">{`${Math.round(ref.verticalDistance)}مم`}</text>
            </g>
          );
          if (shape.kind === "circle") return <g key={shape.id} className={isShapeSelected ? "selected-shape" : ""} onPointerDown={(event) => handleShapePointerDown(panel, shape, event)}><circle className="shape-hit-area" cx={shape.x} cy={shape.y} r={Math.max(28, numberValue(shape.r) + 20)} />{measure}<circle cx={shape.x} cy={shape.y} r={shape.r} fill="#fff" stroke="#b42318" strokeWidth="1.2" vectorEffect="non-scaling-stroke" /></g>;
          if (shape.kind === "rect") {
            const cornerCut = cornerCutInfo(shape, outlineBounds);
            const notchInfo = cornerCut ? null : edgeCutInfo(shape, outlineBounds);
            const cornerDims = cornerCut ? cornerNotchDimensionItems(cornerCut, outlineBounds) : [];
            return <g key={shape.id} className={isShapeSelected ? "selected-shape" : ""} onPointerDown={(event) => handleShapePointerDown(panel, shape, event)}><rect className="shape-hit-area" x={numberValue(shape.x) - 24} y={numberValue(shape.y) - 24} width={numberValue(shape.w) + 48} height={numberValue(shape.h) + 48} />{cornerCut ? null : measure}{cornerCut ? <><rect className="corner-cut-hit" x={cornerCut.x} y={cornerCut.y} width={cornerCut.width} height={cornerCut.height} /><g className="corner-notch-dimensions">{cornerDims.map((item, itemIndex) => <g key={`corner-dim-${shape.id}-${itemIndex}`}><line x1={item.x1} y1={item.y1} x2={item.x2} y2={item.y2} /><text x={item.tx} y={item.ty} textAnchor="middle" transform={item.rotate || undefined}>{item.label}</text></g>)}</g></> : notchInfo ? <><rect className="edge-notch-fill" x={shape.x} y={shape.y} width={shape.w} height={shape.h} /><path className="edge-notch-cut" d={notchInfo.path} /></> : <rect x={shape.x} y={shape.y} width={shape.w} height={shape.h} fill="#fff" stroke="#087d45" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />}</g>;
          }
          if (shape.kind === "arrow") return <g key={shape.id} className={isShapeSelected ? "selected-shape drawing-arrow" : "drawing-arrow"} onPointerDown={(event) => handleShapePointerDown(panel, shape, event)}><line className="shape-hit-line" x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} /><line x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} /><text x={(numberValue(shape.x1) + numberValue(shape.x2)) / 2 + 12} y={(numberValue(shape.y1) + numberValue(shape.y2)) / 2 - 12}>{shape.text || `${Math.round(Math.hypot(numberValue(shape.x2) - numberValue(shape.x1), numberValue(shape.y2) - numberValue(shape.y1)))}مم`}</text></g>;
          return <g key={shape.id} className={isShapeSelected ? "selected-shape drawing-text-label" : "drawing-text-label"} onPointerDown={(event) => handleShapePointerDown(panel, shape, event)}><rect className="shape-hit-area" x={numberValue(shape.x) - 80} y={numberValue(shape.y) - 52} width="160" height="72" /><rect x={numberValue(shape.x) - 60} y={numberValue(shape.y) - 34} width="120" height="44" rx="8" fill="#fff" stroke="#334155" /><text x={shape.x} y={shape.y} textAnchor="middle" fontSize="26" fontWeight="800">{shape.text || "ملاحظة"}</text></g>;
        })}
        <g className="hole-leader-labels">
          {holeLabels.map((item) => (
            <g key={`panel-hole-label-${panel.id}-${item.shape.id}`}>
              {item.path ? <path d={item.path} fill="none" /> : <line x1={item.lineX1} y1={item.lineY1} x2={item.lineX2} y2={item.lineY2} />}
              <text x={item.textX} y={item.textY} textAnchor={item.textAnchor}>{item.label}</text>
            </g>
          ))}
        </g>
      </g>
    );
  }

  const selectedShapeNearest = selectedShape ? nearestShapeEdgeFields(selectedShape, activeBounds) : null;
  const selectedCornerCut = selectedShape?.kind === "rect" ? cornerCutInfo(selectedShape, activeBounds) : null;
  const selectedEdgeCut = selectedShape?.kind === "rect" && !selectedCornerCut ? edgeCutInfo(selectedShape, activeBounds) : null;
  const selectedPanelEdges = normalizePanelDrawingData(selectedPanel?.drawing).edges;

  return (
    <div className="drawing-editor multi-panel-editor" ref={stageRef} tabIndex={0}>
      <div className="drawing-top">
        <div className="drawing-tools">
          <button className="primary" type="button" title="إضافة لوح زجاج جديد" onClick={addPanel}><Plus size={16} />لوح</button>
          <button type="button" title="نسخ اللوح المحدد" disabled={!selectedPanel} onClick={duplicateSelectedPanel}><Copy size={16} />نسخ</button>
          <button type="button" className="danger" title="حذف اللوح المحدد" disabled={!selectedPanel} onClick={deleteSelectedPanel}><Trash2 size={16} />حذف</button>
          {[
            ["select", "تحديد", Sparkles],
            ["pan", "تحريك", Maximize2],
            ["circle", "ثقب", Circle],
            ["rect", "مستطيل", RectangleHorizontal],
            ["cornerNotch", "ركنة", RectangleHorizontal],
            ["text", "نص", Pencil],
            ["arrow", "أبعاد", Maximize2],
            ["edge", "نقاط", Sparkles],
            ["partialArch", "قوس جزئي", Sparkles]
          ].map(([value, label, Icon]) => <button key={value} type="button" title={label} className={tool === value ? "active" : ""} onClick={() => setTool(value)}><Icon size={16} />{label}</button>)}
          <button
            type="button"
            className="danger"
            title="حذف العنصر المحدد"
            disabled={!selectedShape && !canDeleteSelectedOutlinePoint}
            onClick={() => selectedShape ? deleteSelectedShape() : deleteSelectedPanelOutlinePoint()}
          >
            <Trash2 size={16} />عنصر
          </button>
        </div>
        <div className="outline-controls">
          <span className="drawing-size-chip"><Maximize2 size={14} />العرض <strong dir="ltr">{formatPanelNumber(workArea.width)} مم</strong></span>
          <span className="drawing-size-chip"><Maximize2 size={14} />الارتفاع <strong dir="ltr">{formatPanelNumber(workArea.height)} مم</strong></span>
          <button type="button" title="ملاءمة الرسم" onClick={() => setView(fullView)}><RefreshCw size={15} />ملاءمة</button>
          <button type="button" title="تكبير" onClick={() => zoomCanvas(1)}>+</button>
          <button type="button" title="تصغير" onClick={() => zoomCanvas(-1)}>-</button>
          <span className="zoom-chip">{zoomPercent}%</span>
        </div>
      </div>
      <div className="multi-panel-layout">
        <div className="drawing-stage">
          <svg
            ref={svgRef}
            className={`drawing-canvas tool-${tool} ${drag?.kind === "pan" ? "panning" : ""}`}
            viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
            onPointerDown={(event) => {
              focusDrawingWorkspace();
              if (event.button === 1 || (tool === "pan" && event.button === 0)) startPan(event);
              else if (event.target === event.currentTarget) setSelectedShapeId(null);
            }}
            onPointerMove={handlePointerMove}
          >
            <rect x={view.x} y={view.y} width={view.width} height={view.height} fill="#e9f4ff" onPointerDown={(event) => { if (event.button === 0) setSelectedShapeId(null); }} />
            <rect className="drawing-work-area" x="0" y="0" width={workArea.width} height={workArea.height} />
            <g className="multi-panel-grid">
              {Array.from({ length: 80 }).map((_, index) => {
                const x = Math.floor(view.x / 100) * 100 + index * 100;
                return <line key={`vx-${index}`} x1={x} y1={view.y} x2={x} y2={view.y + view.height} />;
              })}
              {Array.from({ length: 80 }).map((_, index) => {
                const y = Math.floor(view.y / 100) * 100 + index * 100;
                return <line key={`hy-${index}`} x1={view.x} y1={y} x2={view.x + view.width} y2={y} />;
              })}
            </g>
            {panels.map(renderPanel)}
          </svg>
        </div>
        <aside className="panel-properties">
          {selectedPanel && selectedShape ? (
            <>
              <h3>
                {selectedShape.kind === "circle"
                  ? "Hole Properties"
                  : selectedShape.kind === "rect"
                    ? selectedCornerCut
                      ? "Corner Notch Properties"
                      : selectedEdgeCut
                        ? "Edge Cut Properties"
                        : "Rectangle Properties"
                    : selectedShape.kind === "arrow"
                      ? "Dimension Properties"
                      : "Text Properties"}
              </h3>
              <div className="panel-property-group">
                <strong>{drawingShapeSummary(selectedShape)}</strong>
                {selectedShape.kind === "circle" && (
                  <>
                    <label>⌀ Diameter mm<input inputMode="decimal" value={Math.round(numberValue(selectedShape.r) * 2)} onChange={(event) => selectedShapePatch({ r: Math.max(1, numberValue(event.target.value) / 2) })} dir="ltr" /></label>
                    <label>X mm<input inputMode="decimal" value={Math.round(numberValue(selectedShape.x))} onChange={(event) => selectedShapePatch({ x: Math.max(0, numberValue(event.target.value)) })} dir="ltr" /></label>
                    <label>Y mm<input inputMode="decimal" value={Math.round(numberValue(selectedShape.y))} onChange={(event) => selectedShapePatch({ y: Math.max(0, numberValue(event.target.value)) })} dir="ltr" /></label>
                    {selectedShapeNearest && <><label>{selectedShapeNearest.horizontal.label} mm<input inputMode="decimal" value={Math.round(selectedShapeNearest.horizontal.value)} onChange={(event) => selectedShapePatch(shapePositionPatchFromNearestInput(selectedShape, activeBounds, "x", event.target.value))} dir="ltr" /></label><label>{selectedShapeNearest.vertical.label} mm<input inputMode="decimal" value={Math.round(selectedShapeNearest.vertical.value)} onChange={(event) => selectedShapePatch(shapePositionPatchFromNearestInput(selectedShape, activeBounds, "y", event.target.value))} dir="ltr" /></label></>}
                    <label>Hole type<select value={selectedShape.holeType || "through"} onChange={(event) => selectedShapePatch({ holeType: event.target.value })}><option value="through">Through hole</option><option value="counter">Counter bore</option><option value="slot">Slot / special</option></select></label>
                  </>
                )}
                {selectedShape.kind === "rect" && (
                  <>
                    {selectedCornerCut ? (
                      <>
                        <label>Corner<select value={selectedCornerCut.corner || "tl"} onChange={(event) => selectedShapePatch({ corner: event.target.value, rectType: "corner", type: "cornerNotch" })}><option value="tl">Top Left</option><option value="tr">Top Right</option><option value="br">Bottom Right</option><option value="bl">Bottom Left</option></select></label>
                        <label>Width mm<input inputMode="decimal" value={Math.round(selectedCornerCut.width)} onChange={(event) => selectedShapePatch({ w: Math.max(1, numberValue(event.target.value)), width: Math.max(1, numberValue(event.target.value)) })} dir="ltr" /></label>
                        <label>Height mm<input inputMode="decimal" value={Math.round(selectedCornerCut.height)} onChange={(event) => selectedShapePatch({ h: Math.max(1, numberValue(event.target.value)), height: Math.max(1, numberValue(event.target.value)) })} dir="ltr" /></label>
                        <span className="hint">{cornerDisplayName(selectedCornerCut.corner)} - measured from the real panel corner.</span>
                      </>
                    ) : (
                      <>
                        <label>Width mm<input inputMode="decimal" value={selectedShape.w} onChange={(event) => selectedShapePatch({ w: Math.max(1, numberValue(event.target.value)) })} dir="ltr" /></label>
                        <label>Height mm<input inputMode="decimal" value={selectedShape.h} onChange={(event) => selectedShapePatch({ h: Math.max(1, numberValue(event.target.value)) })} dir="ltr" /></label>
                        <label>X mm<input inputMode="decimal" value={Math.round(numberValue(selectedShape.x))} onChange={(event) => selectedShapePatch({ x: Math.max(0, numberValue(event.target.value)) })} dir="ltr" /></label>
                        <label>Y mm<input inputMode="decimal" value={Math.round(numberValue(selectedShape.y))} onChange={(event) => selectedShapePatch({ y: Math.max(0, numberValue(event.target.value)) })} dir="ltr" /></label>
                        <label>Corner radius<input inputMode="decimal" value={selectedShape.radius || 0} onChange={(event) => selectedShapePatch({ radius: Math.max(0, numberValue(event.target.value)) })} dir="ltr" /></label>
                        <label>Type<select value={selectedEdgeCut ? "edge" : selectedShape.rectType || "internal"} onChange={(event) => selectedShapePatch({ rectType: event.target.value })}><option value="internal">Internal rectangle</option><option value="edge">Edge cut</option><option value="corner">Corner notch</option></select></label>
                      </>
                    )}
                  </>
                )}
                {selectedShape.kind === "arrow" && (
                  <>
                    <label>Text<input value={selectedShape.text || ""} onChange={(event) => selectedShapePatch({ text: event.target.value })} /></label>
                    <label>Start X<input inputMode="decimal" value={Math.round(numberValue(selectedShape.x1))} onChange={(event) => selectedShapePatch({ x1: numberValue(event.target.value) })} dir="ltr" /></label>
                    <label>Start Y<input inputMode="decimal" value={Math.round(numberValue(selectedShape.y1))} onChange={(event) => selectedShapePatch({ y1: numberValue(event.target.value) })} dir="ltr" /></label>
                    <label>End X<input inputMode="decimal" value={Math.round(numberValue(selectedShape.x2))} onChange={(event) => selectedShapePatch({ x2: numberValue(event.target.value) })} dir="ltr" /></label>
                    <label>End Y<input inputMode="decimal" value={Math.round(numberValue(selectedShape.y2))} onChange={(event) => selectedShapePatch({ y2: numberValue(event.target.value) })} dir="ltr" /></label>
                  </>
                )}
                {selectedShape.kind === "text" && <label className="wide-field">Text<input value={selectedShape.text || ""} onChange={(event) => selectedShapePatch({ text: event.target.value })} /></label>}
                <button type="button" className="danger" onClick={deleteSelectedShape}><Trash2 size={14} />حذف العنصر</button>
              </div>
              <button type="button" onClick={() => setSelectedShapeId(null)}>عرض خصائص اللوح</button>
            </>
          ) : selectedPanel ? (
            <>
              <h3>Panel {panelDisplayName(selectedPanel, selectedPanelIndex)}</h3>
              <label>Panel name<input value={selectedPanel.label || ""} onChange={(event) => updateSelectedPanel({ label: event.target.value })} /></label>
              <label>Panel Code<input value={selectedPanel.code || ""} onChange={(event) => updateSelectedPanel({ code: event.target.value })} dir="ltr" /></label>
              <label>Width mm<input inputMode="decimal" value={selectedPanel.width} onChange={(event) => updateSelectedPanel({ width: event.target.value })} dir="ltr" /></label>
              <label>Height mm<input inputMode="decimal" value={selectedPanel.height} onChange={(event) => updateSelectedPanel({ height: event.target.value })} dir="ltr" /></label>
              <label>X<input inputMode="decimal" value={selectedPanel.x} onChange={(event) => updateSelectedPanel({ x: event.target.value })} dir="ltr" /></label>
              <label>Y<input inputMode="decimal" value={selectedPanel.y} onChange={(event) => updateSelectedPanel({ y: event.target.value })} dir="ltr" /></label>
              <label className="wide-field">Notes<textarea value={selectedPanel.notes || ""} onChange={(event) => updateSelectedPanel({ notes: event.target.value })} /></label>
              <div className="panel-stats">
                <span>المساحة <strong>{square(panelAreaM2(selectedPanel))} م2</strong></span>
                <span>الثقوب <strong>{activeDrawing.shapes.filter((shape) => shape.kind === "circle").length}</strong></span>
              </div>
              <div className="panel-property-group">
                <strong>Edge Settings</strong>
                <label>Top edge mm<input inputMode="decimal" value={selectedPanelEdges.top} onChange={(event) => updateSelectedPanelEdge("top", event.target.value)} dir="ltr" /></label>
                <label>Bottom edge mm<input inputMode="decimal" value={selectedPanelEdges.bottom} onChange={(event) => updateSelectedPanelEdge("bottom", event.target.value)} dir="ltr" /></label>
                <label>Left edge mm<input inputMode="decimal" value={selectedPanelEdges.left} onChange={(event) => updateSelectedPanelEdge("left", event.target.value)} dir="ltr" /></label>
                <label>Right edge mm<input inputMode="decimal" value={selectedPanelEdges.right} onChange={(event) => updateSelectedPanelEdge("right", event.target.value)} dir="ltr" /></label>
              </div>
              <div className="panel-property-actions">
                <button type="button" onClick={duplicateSelectedPanel}><Copy size={14} />Duplicate Panel</button>
                <button type="button" className="danger" onClick={deleteSelectedPanel}><Trash2 size={14} />Delete Panel</button>
              </div>
              <HoleDetailViews shapes={activeDrawing.shapes} />
            </>
          ) : <p>أضف Panel جديد للبدء.</p>}
        </aside>
      </div>
    </div>
  );
}

function SinglePanelDrawingEditor({ row, updateRow }) {
  const [tool, setTool] = useState("select");
  const [drag, setDrag] = useState(null);
  const [selectedShapeId, setSelectedShapeId] = useState(null);
  const [selectedOutlinePointId, setSelectedOutlinePointId] = useState(null);
  const editorRef = useRef(null);
  const stageRef = useRef(null);
  const svgRef = useRef(null);
  const drawing = normalizeDrawing(row.drawing);
  const shapes = drawing.shapes || [];
  const paths = drawing.paths || [];
  const selectedShape = shapes.find((shape) => shape.id === selectedShapeId) || null;
  const maxW = Math.max(200, ...row.layers.map((layer) => cmToMm(layer.width, 100)));
  const maxH = Math.max(200, ...row.layers.map((layer) => cmToMm(layer.height, 100)));
  const depthOffsets = layerVisualDepthOffsets(row);
  const pad = 360;
  const fullView = { x: -pad, y: -pad, width: maxW + pad * 2, height: maxH + pad * 2 };
  const [view, setView] = useState(fullView);
  const zoomPercent = Math.round((fullView.width / Math.max(1, view.width)) * 100);
  const viewBox = `${view.x} ${view.y} ${view.width} ${view.height}`;

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
    const visualOffset = depthOffsets[layerIndex] || 0;
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
  const outlinePoints = visualOutlinePointsForDrawing(drawing, baseGeometry);
  const outlineBounds = boundsFromOutline(outlinePoints, baseGeometry);
  const outlineDims = outlineDimensionItems(outlinePoints, baseGeometry);
  const curveDims = curveDepthItems(outlinePoints, baseGeometry);
  const holeLabels = holeLeaderLabelItems(shapes, outlineBounds);
  const selectedOutlinePointIndex = outlinePoints.findIndex((point) => point.id === selectedOutlinePointId);
  const selectedOutlinePoint = selectedOutlinePointIndex >= 0 ? outlinePoints[selectedOutlinePointIndex] : null;
  const canDeleteSelectedOutlinePoint = !!selectedOutlinePoint && !selectedOutlinePoint.corner && outlinePoints.length > 4;

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
    if (selectedOutlinePointId && !outlinePoints.some((point) => point.id === selectedOutlinePointId)) setSelectedOutlinePointId(null);
  }, [selectedOutlinePointId, outlinePoints]);

  useEffect(() => {
    document.body.classList.toggle("drawing-dragging", !!drag);
    return () => document.body.classList.remove("drawing-dragging");
  }, [drag]);

  useEffect(() => {
    setView((current) => {
      const currentZoom = fullView.width / Math.max(1, current.width);
      if (!Number.isFinite(currentZoom) || currentZoom < 0.2 || currentZoom > 8) return fullView;
      return {
        x: Math.min(fullView.x + fullView.width - current.width, Math.max(fullView.x, current.x)),
        y: Math.min(fullView.y + fullView.height - current.height, Math.max(fullView.y, current.y)),
        width: current.width,
        height: current.height
      };
    });
  }, [maxW, maxH]);

  useEffect(() => {
    if (!drag) return undefined;
    const stopDragging = () => {
      try {
        if (drag?.pan && svgRef.current?.hasPointerCapture?.(drag.pointerId)) svgRef.current.releasePointerCapture(drag.pointerId);
      } catch { /* Capture may already have ended. */ }
      setDrag(null);
    };
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
    window.addEventListener("blur", stopDragging);
    window.addEventListener("glass-orders-cancel-interactions", stopDragging);
    return () => {
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
      window.removeEventListener("blur", stopDragging);
      window.removeEventListener("glass-orders-cancel-interactions", stopDragging);
    };
  }, [drag]);

  useEffect(() => {
    const node = stageRef.current;
    if (!node) return undefined;
    function handleWheel(event) {
      const rect = svgRef.current?.getBoundingClientRect?.();
      const scaleX = view.width / Math.max(1, rect?.width || 1);
      const scaleY = view.height / Math.max(1, rect?.height || 1);
      if (event.ctrlKey) {
        preventCancelableDefault(event);
        zoomDrawing(event.deltaY < 0 ? 1 : -1, event);
        return;
      }
      if (event.shiftKey && !event.ctrlKey) {
        preventCancelableDefault(event);
        const horizontalDelta = event.deltaX || event.deltaY;
        setView((current) => clampedView({ ...current, x: current.x + horizontalDelta * scaleX }));
        return;
      }
      preventCancelableDefault(event);
      setView((current) => clampedView({ ...current, y: current.y + event.deltaY * scaleY }));
    }
    node.addEventListener("wheel", handleWheel, { passive: false });
    return () => node.removeEventListener("wheel", handleWheel);
  }, [tool, view, fullView.width, fullView.height]);

  useEffect(() => () => {
    document.body.classList.remove("drawing-dragging");
  }, []);

  useEffect(() => {
    function handleKey(event) {
      if (!editorRef.current?.contains(document.activeElement)) return;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(event.target?.tagName)) return;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && (key === "z" || key === "y")) return;
      if ((event.key === "Delete" || event.key === "Backspace") && (selectedShapeId || canDeleteSelectedOutlinePoint)) {
        preventCancelableDefault(event);
        if (selectedShapeId) deleteShape(selectedShapeId);
        else if (selectedOutlinePointId) deleteOutlinePoint(selectedOutlinePointId);
      } else if (event.key === "Escape") {
        preventCancelableDefault(event);
        setSelectedShapeId(null);
        setSelectedOutlinePointId(null);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  function setDrawing(next) {
    updateRow({ ...row, drawing: normalizeDrawing(next) });
  }
  function commitDrawing(next) {
    setDrawing(next);
  }
  function singleShapeToLocal(shape = {}) {
    if (shape.kind === "circle" || shape.kind === "text") return { ...shape, x: numberValue(shape.x) - baseGeometry.x, y: numberValue(shape.y) - baseGeometry.y };
    if (shape.kind === "rect") return { ...shape, x: numberValue(shape.x) - baseGeometry.x, y: numberValue(shape.y) - baseGeometry.y };
    return shape;
  }
  function singleShapeToGlobal(shape = {}) {
    if (shape.kind === "circle" || shape.kind === "text") return { ...shape, x: numberValue(shape.x) + baseGeometry.x, y: numberValue(shape.y) + baseGeometry.y };
    if (shape.kind === "rect") return { ...shape, x: numberValue(shape.x) + baseGeometry.x, y: numberValue(shape.y) + baseGeometry.y };
    return shape;
  }
  function localDrawingForValidation(nextShapes = shapes) {
    return { ...drawing, shapes: nextShapes.map(singleShapeToLocal) };
  }
  function isSinglePanelCornerNotch(shape = {}) {
    return isCornerNotchShape(singleShapeToLocal(shape), { x: 0, y: 0, right: baseGeometry.width, bottom: baseGeometry.height });
  }
  function clampSinglePanelFeature(shape = {}, nextShapes = shapes) {
    if (!["circle", "rect"].includes(shape.kind)) return shape;
    const localShape = singleShapeToLocal(shape);
    const localDrawing = localDrawingForValidation(nextShapes);
    const clamped = clampFeatureShapeToPanel(localShape, localDrawing, { width: baseGeometry.width, height: baseGeometry.height });
    return singleShapeToGlobal(clamped);
  }
  function updateShape(id, patchValue) {
    setSelectedOutlinePointId(null);
    setSelectedShapeId(id);
    const target = shapes.find((shape) => shape.id === id);
    if (target && isSinglePanelCornerNotch(target)) {
      const nextWidth = Math.max(1, numberValue(patchValue.width ?? patchValue.w ?? target.width ?? target.w));
      const nextHeight = Math.max(1, numberValue(patchValue.height ?? patchValue.h ?? target.height ?? target.h));
      if (nextWidth >= baseGeometry.width || nextHeight >= baseGeometry.height) {
        window.alert("عرض الركنة أكبر من المساحة المتاحة داخل اللوح.");
        return;
      }
    }
    commitDrawing({
      ...drawing,
      shapes: shapes.map((shape) => {
        if (shape.id !== id) return shape;
        const nextShape = { ...shape, ...patchValue };
        if (nextShape.kind === "circle" || nextShape.kind === "rect") {
          const clamped = clampSinglePanelFeature(nextShape, shapes);
          if (shape.kind === "circle" && "r" in patchValue && numberValue(clamped.r) < numberValue(patchValue.r)) {
            window.alert("قطر الثقب أكبر من المساحة المتاحة داخل اللوح.");
            return shape;
          }
          return clamped;
        }
        return nextShape;
      })
    });
  }
  function setOutlinePoints(points) {
    setDrawing({ ...drawing, outline: { points: points.map((point, index) => normalizeOutlinePoint(point, index)) } });
  }
  function commitOutlinePoints(points) {
    commitDrawing({ ...drawing, outline: { points: points.map((point, index) => normalizeOutlinePoint(point, index)) } });
  }
  function updateOutlinePoint(id, patchValue) {
    const next = outlinePoints.map((point, index) => point.id === id ? normalizeOutlinePoint({ ...point, ...patchValue }, index) : normalizeOutlinePoint(point, index));
    commitOutlinePoints(next);
    setSelectedShapeId(null);
    setSelectedOutlinePointId(id);
  }
  function nudgeOutlinePoint(id, dx = 0, dy = 0) {
    const point = outlinePoints.find((item) => item.id === id);
    if (!point || point.corner) return;
    updateOutlinePoint(id, {
      x: clamp(numberValue(point.x) + dx, baseGeometry.x - 320, baseGeometry.x + baseGeometry.width + 320),
      y: clamp(numberValue(point.y) + dy, baseGeometry.y - 320, baseGeometry.y + baseGeometry.height + 320)
    });
  }
  function outlineDepthAt(index) {
    if (index <= 0 || index >= outlinePoints.length - 1) return 0;
    const previous = outlinePoints[index - 1];
    const point = outlinePoints[index];
    const next = outlinePoints[index + 1];
    return Math.abs(chordDepth(previous, point, next));
  }
  function pointWithDepth(index, depthValue) {
    if (index <= 0 || index >= outlinePoints.length - 1) return outlinePoints[index];
    const previous = outlinePoints[index - 1];
    const point = outlinePoints[index];
    const next = outlinePoints[index + 1];
    const sx = numberValue(previous.x);
    const sy = numberValue(previous.y);
    const ex = numberValue(next.x);
    const ey = numberValue(next.y);
    const dx = ex - sx;
    const dy = ey - sy;
    const length = Math.max(1, Math.hypot(dx, dy));
    const sign = Math.sign(chordDepth(previous, point, next)) || 1;
    const depth = Math.max(0, numberValue(depthValue));
    const mid = { x: (sx + ex) / 2, y: (sy + ey) / 2 };
    const normal = { x: -dy / length, y: dx / length };
    return {
      ...point,
      x: Math.round(clamp(mid.x + normal.x * sign * depth, baseGeometry.x - 320, baseGeometry.x + baseGeometry.width + 320)),
      y: Math.round(clamp(mid.y + normal.y * sign * depth, baseGeometry.y - 320, baseGeometry.y + baseGeometry.height + 320)),
      halfDiameter: depth
    };
  }
  function updateOutlinePointMode(id, mode) {
    const index = outlinePoints.findIndex((point) => point.id === id);
    if (index < 0 || outlinePoints[index].corner) return;
    const safeMode = ["free", "curve", "arc"].includes(mode) ? mode : "free";
    const currentDepth = numberValue(outlinePoints[index].halfDiameter) || outlineDepthAt(index) || 80;
    const next = outlinePoints.map((point, pointIndex) => {
      if (pointIndex !== index) return normalizeOutlinePoint(point, pointIndex);
      const shapedPoint = safeMode === "free" ? point : pointWithDepth(index, currentDepth);
      return normalizeOutlinePoint({ ...shapedPoint, mode: safeMode, halfDiameter: safeMode === "free" ? 0 : currentDepth }, pointIndex);
    });
    commitOutlinePoints(next);
    setSelectedShapeId(null);
    setSelectedOutlinePointId(id);
  }
  function updateOutlinePointDepth(id, depthValue) {
    const index = outlinePoints.findIndex((point) => point.id === id);
    if (index < 0 || outlinePoints[index].corner || outlinePointMode(outlinePoints[index]) === "free") return;
    const next = outlinePoints.map((point, pointIndex) => {
      if (pointIndex !== index) return normalizeOutlinePoint(point, pointIndex);
      return normalizeOutlinePoint(pointWithDepth(index, depthValue), pointIndex);
    });
    commitOutlinePoints(next);
    setSelectedOutlinePointId(id);
  }
  function resetShape() {
    commitDrawing({
      ...drawing,
      outline: { points: [] },
      edges: { top: 0, right: 0, bottom: 0, left: 0 }
    });
  }
  function clampedView(nextView) {
    const minZoom = 0.35;
    const maxZoom = 5;
    const minWidth = fullView.width / maxZoom;
    const maxWidth = fullView.width / minZoom;
    const width = Math.max(minWidth, Math.min(maxWidth, nextView.width));
    const height = width * (fullView.height / fullView.width);
    const extraX = Math.max(0, (width - fullView.width) / 2);
    const extraY = Math.max(0, (height - fullView.height) / 2);
    const minX = fullView.x - extraX;
    const maxX = fullView.x + fullView.width - width + extraX;
    const minY = fullView.y - extraY;
    const maxY = fullView.y + fullView.height - height + extraY;
    return {
      x: Math.max(minX, Math.min(maxX, nextView.x)),
      y: Math.max(minY, Math.min(maxY, nextView.y)),
      width,
      height
    };
  }
  function fitDrawingView() {
    setView(fullView);
  }
  function resetDrawingView() {
    setView(fullView);
  }
  function standardDrawingView() {
    setView(clampedView({ x: fullView.x, y: fullView.y, width: fullView.width, height: fullView.height }));
  }
  function zoomDrawing(direction, event = null) {
    const factor = direction > 0 ? 1 / 1.16 : 1.16;
    const pointer = event ? svgPointFromEvent(event) : { x: view.x + view.width / 2, y: view.y + view.height / 2 };
    const ratioX = (pointer.x - view.x) / view.width;
    const ratioY = (pointer.y - view.y) / view.height;
    const nextWidth = view.width * factor;
    const nextHeight = view.height * factor;
    setView(clampedView({
      x: pointer.x - nextWidth * ratioX,
      y: pointer.y - nextHeight * ratioY,
      width: nextWidth,
      height: nextHeight
    }));
  }
  function startViewportPan(event) {
    preventCancelableDefault(event);
    event.stopPropagation();
    event.currentTarget?.setPointerCapture?.(event.pointerId);
    setDrag({
      pan: true,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      view
    });
  }
  function pointerDown(event) {
    if (![0, 1].includes(event.button)) return;
    preventCancelableDefault(event);
    editorRef.current?.focus();
    if (event.button === 1 || tool === "pan" || (tool === "select" && event.pointerType === "touch")) {
      startViewportPan(event);
      return;
    }
    if (tool === "edge" || tool === "partialArch") return;
    const point = tool === "arrow" || tool === "text" ? workspacePointFromEvent(event) : mmFromEvent(event);
    if (tool === "select") {
      setSelectedShapeId(null);
      setSelectedOutlinePointId(null);
      return;
    }
    const id = uid();
    if (tool === "circle") {
      const shape = clampSinglePanelFeature({ id, kind: "circle", x: point.x, y: point.y, r: 25, layer: 0 }, shapes);
      commitDrawing({ ...drawing, shapes: [...shapes, shape] });
    } else if (tool === "rect") {
      const shape = clampSinglePanelFeature({ id, kind: "rect", rectType: "internal", x: point.x, y: point.y, w: 80, h: 50, layer: 0 }, shapes);
      commitDrawing({ ...drawing, shapes: [...shapes, shape] });
    } else if (tool === "cornerNotch") {
      const localPoint = { x: point.x - baseGeometry.x, y: point.y - baseGeometry.y };
      const shape = clampSinglePanelFeature({
        id,
        kind: "rect",
        type: "cornerNotch",
        rectType: "corner",
        corner: nearestPanelCorner(localPoint, { x: 0, y: 0, right: baseGeometry.width, bottom: baseGeometry.height }),
        x: point.x,
        y: point.y,
        w: Math.min(120, Math.max(1, baseGeometry.width - 1)),
        h: Math.min(80, Math.max(1, baseGeometry.height - 1)),
        layer: 0
      }, shapes);
      commitDrawing({ ...drawing, shapes: [...shapes, shape] });
    } else if (tool === "text") {
      commitDrawing({ ...drawing, shapes: [...shapes, { id, kind: "text", x: point.x, y: point.y, text: "ملاحظة", layer: 0 }] });
    } else if (tool === "arrow") {
      commitDrawing({ ...drawing, shapes: [...shapes, { id, kind: "arrow", x1: point.x, y1: point.y, x2: clamp(point.x + 160, -pad + 40, maxW + pad - 40), y2: point.y, text: "", layer: 0 }] });
    }
    setSelectedShapeId(id);
    setSelectedOutlinePointId(null);
  }
  function pointerMove(event) {
    if (drag?.pan) {
      const rect = svgRef.current?.getBoundingClientRect?.();
      if (!rect) return;
      const dx = (event.clientX - drag.startX) * (drag.view.width / Math.max(1, rect.width));
      const dy = (event.clientY - drag.startY) * (drag.view.height / Math.max(1, rect.height));
      setView(clampedView({ ...drag.view, x: drag.view.x - dx, y: drag.view.y - dy }));
      return;
    }
    if (drag?.outlinePoint) {
      const point = outlinePointFromEvent(event, baseGeometry);
      const next = outlinePoints.map((outlinePoint, pointIndex) => {
        if (pointIndex !== drag.index) return outlinePoint;
        return {
          ...outlinePoint,
          x: Math.round(point.x),
          y: Math.round(point.y)
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
          mode: "free",
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
          return clampSinglePanelFeature({ ...shape, x: nextX, y: nextY }, shapes);
        }
        if (shape.kind === "rect") {
          const moved = { ...shape, x: nextX, y: nextY };
          if (isSinglePanelCornerNotch(shape)) {
            moved.corner = nearestPanelCorner({ x: nextX - baseGeometry.x + numberValue(shape.w) / 2, y: nextY - baseGeometry.y + numberValue(shape.h) / 2 }, { x: 0, y: 0, right: baseGeometry.width, bottom: baseGeometry.height });
          }
          return clampSinglePanelFeature(moved, shapes);
        }
        return shape;
      });
      setDrawing({ ...drawing, shapes: next });
    }
  }
  function pointerUp() {
    if (drag?.pan && svgRef.current?.hasPointerCapture?.(drag.pointerId)) {
      svgRef.current.releasePointerCapture?.(drag.pointerId);
    }
    setDrag(null);
  }
  function startShapeDrag(event, shape) {
    if (event.button === 1 || (tool === "pan" && event.button === 0)) {
      startViewportPan(event);
      return;
    }
    if (event.button !== 0) return;
    preventCancelableDefault(event);
    event.stopPropagation();
    editorRef.current?.focus();
    setSelectedShapeId(shape.id);
    setSelectedOutlinePointId(null);
    const point = shape.kind === "arrow" || shape.kind === "text" ? workspacePointFromEvent(event) : mmFromEvent(event);
    if (shape.kind === "arrow") {
      setDrag({ id: shape.id, anchorX: point.x, anchorY: point.y, x1: numberValue(shape.x1), y1: numberValue(shape.y1), x2: numberValue(shape.x2), y2: numberValue(shape.y2) });
      return;
    }
    setDrag({ id: shape.id, dx: point.x - shape.x, dy: point.y - shape.y });
  }
  function startArrowHandleDrag(event, shape, handle) {
    if (event.button === 1 || (tool === "pan" && event.button === 0)) {
      startViewportPan(event);
      return;
    }
    if (event.button !== 0) return;
    preventCancelableDefault(event);
    event.stopPropagation();
    editorRef.current?.focus();
    setSelectedShapeId(shape.id);
    setSelectedOutlinePointId(null);
    setDrag({ id: shape.id, handle });
  }
  function deleteShape(id) {
    commitDrawing({ ...drawing, shapes: shapes.filter((shape) => shape.id !== id), paths: paths.filter((path) => path.id !== id) });
    setSelectedShapeId(null);
  }
  function deleteOutlinePoint(id) {
    const target = outlinePoints.find((point) => point.id === id);
    if (!target || target.corner || outlinePoints.length <= 4) return;
    commitOutlinePoints(outlinePoints.filter((point) => point.id !== id));
    setSelectedOutlinePointId(null);
  }
  function addPartialArch(event, segmentIndex) {
    preventCancelableDefault(event);
    event.stopPropagation();
    if (tool !== "partialArch") return;
    const sourcePoints = outlinePoints.map((outlinePoint, index) => normalizeOutlinePoint(outlinePoint, index));
    if (sourcePoints.length < 2) return;
    const safeIndex = ((Number(segmentIndex) % sourcePoints.length) + sourcePoints.length) % sourcePoints.length;
    const rotatedPoints = [...sourcePoints.slice(safeIndex), ...sourcePoints.slice(0, safeIndex)];
    const start = rotatedPoints[0];
    const end = rotatedPoints[1];
    if (!start || !end) return;
    const clickPoint = outlinePointFromEvent(event, baseGeometry);
    const sx = numberValue(start.x);
    const sy = numberValue(start.y);
    const ex = numberValue(end.x);
    const ey = numberValue(end.y);
    const dx = ex - sx;
    const dy = ey - sy;
    const lengthSquared = Math.max(1, dx * dx + dy * dy);
    const splitRatio = Math.max(0.12, Math.min(0.82, ((numberValue(clickPoint.x) - sx) * dx + (numberValue(clickPoint.y) - sy) * dy) / lengthSquared));
    const split = {
      id: uid(),
      x: Math.round(sx + dx * splitRatio),
      y: Math.round(sy + dy * splitRatio),
      corner: false,
      mode: "free",
      halfDiameter: 0,
      curve: false
    };
    const archStartX = numberValue(split.x);
    const archStartY = numberValue(split.y);
    const archDx = ex - archStartX;
    const archDy = ey - archStartY;
    const archLength = Math.max(1, Math.hypot(archDx, archDy));
    const normal = { x: -archDy / archLength, y: archDx / archLength };
    const midpoint = { x: (archStartX + ex) / 2, y: (archStartY + ey) / 2 };
    const center = { x: baseGeometry.x + baseGeometry.width / 2, y: baseGeometry.y + baseGeometry.height / 2 };
    const depth = Math.max(24, Math.min(160, archLength * 0.22));
    const candidateA = { x: midpoint.x + normal.x * depth, y: midpoint.y + normal.y * depth };
    const candidateB = { x: midpoint.x - normal.x * depth, y: midpoint.y - normal.y * depth };
    const distanceA = Math.hypot(candidateA.x - center.x, candidateA.y - center.y);
    const distanceB = Math.hypot(candidateB.x - center.x, candidateB.y - center.y);
    const peak = distanceA >= distanceB ? candidateA : candidateB;
    const control = {
      id: uid(),
      x: Math.round(clamp(peak.x, baseGeometry.x - 320, baseGeometry.x + baseGeometry.width + 320)),
      y: Math.round(clamp(peak.y, baseGeometry.y - 320, baseGeometry.y + baseGeometry.height + 320)),
      corner: false,
      mode: "curve",
      halfDiameter: Math.round(depth),
      curve: true
    };
    const next = [rotatedPoints[0], split, control, ...rotatedPoints.slice(1)];
    commitOutlinePoints(next);
    setSelectedShapeId(null);
    setSelectedOutlinePointId(split.id);
    setTool("edge");
  }
  function addOutlinePoint(event, segmentIndex) {
    preventCancelableDefault(event);
    event.stopPropagation();
    if (tool !== "edge") return;
    const point = outlinePointFromEvent(event, baseGeometry);
    const next = outlinePoints.map((outlinePoint, index) => normalizeOutlinePoint(outlinePoint, index));
    const pointIndex = segmentIndex + 1;
    next.splice(pointIndex, 0, {
      id: uid(),
      x: Math.round(point.x),
      y: Math.round(point.y),
      corner: false,
      mode: "free",
      halfDiameter: 0,
      curve: false
    });
    setOutlinePoints(next);
    setSelectedShapeId(null);
    setSelectedOutlinePointId(next[pointIndex].id);
    setDrag({ outlinePoint: true, index: pointIndex, canCurve: canCurveOutlinePoint(next, pointIndex) });
  }
  function handleOutlineSegmentPointerDown(event, segmentIndex) {
    if (tool === "partialArch") {
      addPartialArch(event, segmentIndex);
      return;
    }
    addOutlinePoint(event, segmentIndex);
  }
  function startOutlinePointDrag(event, point, pointIndex) {
    preventCancelableDefault(event);
    event.stopPropagation();
    editorRef.current?.focus();
    setSelectedShapeId(null);
    setSelectedOutlinePointId(point.id);
    if (point.corner) return;
    setDrag({ outlinePoint: true, index: pointIndex, canCurve: canCurveOutlinePoint(outlinePoints, pointIndex) });
  }
  function startOutlineSegmentDrag(event, segment) {
    preventCancelableDefault(event);
    event.stopPropagation();
    if (segment.start.corner || segment.end.corner) return;
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
    if (shape.kind === "rect" && isSinglePanelCornerNotch(shape)) return "قص ركن";
    return shape.kind === "circle" ? "ثقب" : shape.kind === "rect" ? "مستطيل" : shape.kind === "arrow" ? "سهم" : "نص";
  }
  function shapeNearestPositionFields(shape) {
    const nearest = nearestShapeEdgeFields(shape, outlineBounds);
    return (
      <>
        <label>
          <span>{nearest.horizontal.label} mm</span>
          <input
            dir="ltr"
            inputMode="decimal"
            value={Math.round(nearest.horizontal.value)}
            onChange={(event) => updateShape(shape.id, shapePositionPatchFromNearestInput(shape, outlineBounds, "x", event.target.value))}
          />
        </label>
        <label>
          <span>{nearest.vertical.label} mm</span>
          <input
            dir="ltr"
            inputMode="decimal"
            value={Math.round(nearest.vertical.value)}
            onChange={(event) => updateShape(shape.id, shapePositionPatchFromNearestInput(shape, outlineBounds, "y", event.target.value))}
          />
        </label>
      </>
    );
  }
  return (
    <div className="drawing-editor" ref={editorRef} tabIndex={0}>
      <div className="drawing-top">
        <div className="drawing-tools">
          <button className={tool === "select" ? "active tiny" : "tiny"} title="تحديد العناصر، واسحب بزر العجلة للتحريك" onClick={() => setTool("select")}><Sparkles size={16} />تحديد</button>
          <button className={tool === "pan" ? "active tiny" : "tiny"} title="تحريك العرض: السحب للتحريك والعجلة للتمرير بدون تكبير" onClick={() => setTool("pan")}><Maximize2 size={16} />تحريك</button>
          <button className={tool === "circle" ? "active tiny" : "tiny"} title="رسم ثقب" onClick={() => setTool("circle")}><Circle size={16} />رسم</button>
          <button className={tool === "rect" ? "active tiny" : "tiny"} title="رسم قص مستطيل" onClick={() => setTool("rect")}><RectangleHorizontal size={16} />مستطيل</button>
          <button className={tool === "cornerNotch" ? "active tiny" : "tiny"} title="قص ركن من اللوح" onClick={() => setTool("cornerNotch")}><RectangleHorizontal size={16} />قص ركن</button>
          <button className={tool === "text" ? "active tiny" : "tiny"} title="إضافة نص" onClick={() => setTool("text")}><Pencil size={16} />نص</button>
          <button className={tool === "arrow" ? "active tiny" : "tiny"} title="إضافة سهم أبعاد" onClick={() => setTool("arrow")}><Maximize2 size={16} />أبعاد</button>
          <button className={tool === "edge" ? "active tiny" : "tiny"} title="تعديل نقاط وحواف اللوح" onClick={() => setTool("edge")}><Sparkles size={16} />تعديل النقاط</button>
          <button className={tool === "partialArch" ? "active tiny" : "tiny"} title="اضغط على الحافة لإضافة نقطة تقسيم ثم منحنى جزئي" onClick={() => setTool("partialArch")}><Sparkles size={16} />قوس جزئي</button>
          <button className="tiny" title="تكبير حول موضع المؤشر" onClick={() => zoomDrawing(1)}>+</button>
          <button className="tiny" title="تصغير حول منتصف العرض" onClick={() => zoomDrawing(-1)}>-</button>
          <button className="tiny" onClick={fitDrawingView}>ملاءمة</button>
          <button className="tiny" onClick={standardDrawingView}>100%</button>
          <button className="tiny" onClick={resetDrawingView}>Reset View</button>
          <span className="zoom-chip" dir="ltr">{zoomPercent}%</span>
          <button
            className="tiny danger"
            onClick={() => selectedShapeId ? deleteShape(selectedShapeId) : selectedOutlinePointId && deleteOutlinePoint(selectedOutlinePointId)}
            disabled={!selectedShapeId && !canDeleteSelectedOutlinePoint}
          >
            <Trash2 size={14} />حذف المحدد
          </button>
          <button className="tiny danger" onClick={resetShape}><RefreshCw size={15} />Reset Shape</button>
        </div>
        <div className="outline-controls">
          <span className="drawing-size-chip"><Maximize2 size={14} />العرض <strong dir="ltr">{formatPanelNumber(maxW)} مم</strong></span>
          <span className="drawing-size-chip"><Maximize2 size={14} />الارتفاع <strong dir="ltr">{formatPanelNumber(maxH)} مم</strong></span>
          <span className="outline-count">{outlinePoints.filter((point) => !point.corner).length} نقاط تعديل</span>
          <span className="outline-count">{outlinePoints.filter((point) => outlinePointMode(point) === "curve").length} منحنى</span>
          <span className="outline-count">{outlinePoints.filter((point) => outlinePointMode(point) === "arc").length} قوس</span>
        </div>
      </div>
      <div className="drawing-workspace">
      <div className="drawing-stage" ref={stageRef}>
        <svg
          ref={svgRef}
          className={`drawing-canvas tool-${tool}${drag?.pan ? " panning" : ""}`}
          viewBox={viewBox}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={pointerUp}
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
          <line x1="0" y1="-60" x2="0" y2={maxH + 80} stroke="#64748b" strokeWidth="1" strokeDasharray="6 6" />
          <line x1="-60" y1="0" x2={maxW + 80} y2="0" stroke="#64748b" strokeWidth="1" strokeDasharray="6 6" />
          <text x="-130" y="-84" fontSize="28" fill="#475569">0,0</text>
          {row.layers.map((layer, index) => {
            const geometry = layerGeometries[index];
            const opacity = Math.max(0.05, Math.min(1, numberValue(layer.alpha, 45) / 100));
            const layerOutline = index === 0 ? outlinePoints : defaultOutlinePoints(geometry);
            const layerPath = outlinePath(layerOutline);
            return (
              <g key={index} opacity={index === 0 ? 1 : 0.82}>
                <path className="glass-outline-fill" d={layerPath} fill={layer.color} fillOpacity={opacity} stroke={layer.mirror ? "#a67c1e" : "#2563a6"} strokeWidth="1.6" strokeDasharray={index ? "12 8" : "0"} />
                {layer.mirror && (
                  <>
                    <path d={`M ${geometry.x + geometry.width * .12} ${geometry.y} L ${geometry.x + geometry.width * .78} ${geometry.y + geometry.height}`} stroke="#ffffff" strokeWidth="10" opacity=".24" />
                    <path d={`M ${geometry.x + geometry.width * .34} ${geometry.y} L ${geometry.x + geometry.width * .94} ${geometry.y + geometry.height}`} stroke="#ffffff" strokeWidth="4" opacity=".28" />
                  </>
                )}
                {index === 0 && (tool === "edge" || tool === "partialArch") && (
                  <g className="outline-edit-guides">
                    <path className="outline-active-path" d={layerPath} />
                    {outlinePoints.map((point, pointIndex) => {
                      if (outlinePointMode(point) === "free" || pointIndex <= 0 || pointIndex >= outlinePoints.length - 1) return null;
                      const previous = outlinePoints[pointIndex - 1];
                      const next = outlinePoints[pointIndex + 1];
                      return (
                        <g className={outlinePointMode(point) === "arc" ? "outline-curve-guides arc" : "outline-curve-guides"} key={`curve-${point.id}`}>
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
                          <polygon className="outline-segment-hit" points={segmentHitPoints(segment)} onPointerDown={(event) => handleOutlineSegmentPointerDown(event, segment.index)} />
                          {segmentCanDrag && <circle className="outline-segment-handle" cx={midX} cy={midY} r="12" onPointerDown={(event) => startOutlineSegmentDrag(event, segment)} />}
                        </g>
                      );
                    })}
                    {outlinePoints.map((point, pointIndex) => (
                      <circle
                        key={point.id}
                        className={`outline-control-point${point.corner ? " corner" : ""}${outlinePointMode(point) === "curve" ? " curve" : ""}${outlinePointMode(point) === "arc" ? " arc" : ""}${point.id === selectedOutlinePointId ? " selected-outline-point" : ""}`}
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
                <text className="dimension-label" x={geometry.x + geometry.width / 2} y={geometry.y - 28} textAnchor="middle">{`${Math.round(geometry.width)}مم`}</text>
                <text className="dimension-label" x={geometry.x + geometry.width + 34} y={geometry.y + geometry.height / 2} textAnchor="middle" transform={`rotate(90 ${geometry.x + geometry.width + 34} ${geometry.y + geometry.height / 2})`}>{`${Math.round(geometry.height)}مم`}</text>
              </g>
            );
          })}
          <g className="outline-total-dimensions">
            <line x1={outlineBounds.x} y1={outlineBounds.y - 88} x2={outlineBounds.right} y2={outlineBounds.y - 88} />
            <line x1={outlineBounds.right + 88} y1={outlineBounds.y} x2={outlineBounds.right + 88} y2={outlineBounds.bottom} />
            <text x={outlineBounds.x + outlineBounds.width / 2} y={outlineBounds.y - 104} textAnchor="middle">{`إجمالي العرض ${Math.round(outlineBounds.width)}مم`}</text>
            <text x={outlineBounds.right + 106} y={outlineBounds.y + outlineBounds.height / 2} textAnchor="middle" transform={`rotate(90 ${outlineBounds.right + 106} ${outlineBounds.y + outlineBounds.height / 2})`}>{`إجمالي الارتفاع ${Math.round(outlineBounds.height)}مم`}</text>
          </g>
          <g className="edge-dimension-lines">
            {outlineDims.map((item, itemIndex) => (
              <g key={`outline-dim-${itemIndex}`}>
                {item.path ? <path d={item.path} fill="none" /> : <line x1={item.x1} y1={item.y1} x2={item.x2} y2={item.y2} />}
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
            <polyline key={path.id} points={path.points.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke="#111827" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" onDoubleClick={() => deleteShape(path.id)} />
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
                  <text x={(x1 + x2) / 2 + 12} y={(y1 + y2) / 2 - 12}>{shape.text || `${Math.round(length)}مم`}</text>
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
                  <rect x={numberValue(shape.x) - width / 2} y={numberValue(shape.y) - height / 2} width={width} height={height} rx="8" fill="#ffffff" stroke="#c3922c" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
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
            const cornerCut = shape.kind === "rect" ? cornerCutInfo(shape, outlineBounds) : null;
            const notchInfo = shape.kind === "rect" && !cornerCut ? edgeCutInfo(shape, outlineBounds) : null;
            const rectDims = shape.kind === "rect" && !cornerCut ? rectSideDimensionItems(shape, outlineBounds) : [];
            const cornerDims = cornerCut ? cornerNotchDimensionItems(cornerCut, outlineBounds) : [];
            const selected = shape.id === selectedShapeId;
            return (
              <g key={shape.id} className={selected ? "selected-shape" : ""}>
                {!cornerCut && <g className="measurement-lines">
                  <line x1={hStart} y1={centerY} x2={centerX} y2={centerY} />
                  <line x1={centerX} y1={vStart} x2={centerX} y2={centerY} />
                  <text x={hLabelX} y={centerY - 12} textAnchor="middle">{`${Math.round(ref.horizontalDistance)}مم`}</text>
                  <text x={centerX + 14} y={vLabelY} textAnchor="start">{`${Math.round(ref.verticalDistance)}مم`}</text>
                </g>}
                <g onPointerDown={(event) => startShapeDrag(event, shape)} onDoubleClick={() => deleteShape(shape.id)} cursor="move">
                  {shape.kind === "circle" ? (
                    <circle cx={shape.x} cy={shape.y} r={shape.r} fill="#ffffff" stroke="#b42318" strokeWidth="1.2" vectorEffect="non-scaling-stroke">
                      <title>{engineeringDiameterLabel(shape)}</title>
                    </circle>
                  ) : cornerCut ? (
                    <rect className="corner-cut-hit" x={cornerCut.x} y={cornerCut.y} width={cornerCut.width} height={cornerCut.height}>
                      <title>{`قص ركن ${Math.round(cornerCut.width)}مم × ${Math.round(cornerCut.height)}مم`}</title>
                    </rect>
                  ) : notchInfo ? (
                    <>
                      <rect className="edge-notch-fill" x={shape.x} y={shape.y} width={shape.w} height={shape.h}>
                        <title>{`قص حافة ${notchInfo.width}مم × عمق ${notchInfo.depth}مم`}</title>
                      </rect>
                      <path className="edge-notch-cut" d={notchInfo.path} />
                    </>
                  ) : (
                    <rect x={shape.x} y={shape.y} width={shape.w} height={shape.h} fill="#ffffff" stroke="#087d45" strokeWidth="1.2" vectorEffect="non-scaling-stroke">
                      <title>{`قص/بروز مستطيل ${shape.w}×${shape.h}مم`}</title>
                    </rect>
                  )}
                  {shape.kind === "rect" && (
                    <g className="rect-side-dimensions">
                      {[...cornerDims, ...rectDims].map((item, itemIndex) => (
                        <g key={`rect-side-${shape.id}-${itemIndex}`}>
                          <line x1={item.x1} y1={item.y1} x2={item.x2} y2={item.y2} />
                          <text x={item.tx} y={item.ty} textAnchor="middle" transform={item.rotate || undefined}>{item.label}</text>
                        </g>
                      ))}
                    </g>
                  )}
                </g>
              </g>
            );
          })}
          <g className="hole-leader-labels">
            {holeLabels.map((item) => (
              <g key={`hole-label-${item.shape.id}`}>
                {item.path ? <path d={item.path} fill="none" /> : <line x1={item.lineX1} y1={item.lineY1} x2={item.lineX2} y2={item.lineY2} />}
                <text x={item.textX} y={item.textY} textAnchor={item.textAnchor}>{item.label}</text>
              </g>
            ))}
          </g>
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
          {selectedOutlinePoint && (() => {
            const popoverX = clamp(numberValue(selectedOutlinePoint.x) + 34, -pad + 24, maxW + pad - 300);
            const popoverY = clamp(numberValue(selectedOutlinePoint.y) - 124, -pad + 24, maxH + pad - 138);
            return (
              <foreignObject className="shape-popover-object" x={popoverX} y={popoverY} width="270" height="112" onPointerDown={(event) => event.stopPropagation()} onPointerMove={(event) => event.stopPropagation()} onPointerUp={(event) => event.stopPropagation()}>
                <div className="shape-popover" dir="rtl" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
                  <strong>{selectedOutlinePoint.corner ? "ركن ثابت" : outlinePointMode(selectedOutlinePoint) === "arc" ? "نقطة قوس" : outlinePointMode(selectedOutlinePoint) === "curve" ? "نقطة منحنى" : "نقطة حرة"}</strong>
                  <span>{`X ${Math.round(numberValue(selectedOutlinePoint.x))} / Y ${Math.round(numberValue(selectedOutlinePoint.y))}`}</span>
                  <div className="shape-popover-actions">
                    <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setSelectedOutlinePointId(null); }}>إخفاء</button>
                    <button type="button" className="danger" disabled={!canDeleteSelectedOutlinePoint} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); deleteOutlinePoint(selectedOutlinePoint.id); }}>حذف</button>
                  </div>
                </div>
              </foreignObject>
            );
          })()}
        </svg>
      </div>
      </div>
      <div className="shape-list">
        {shapes.length === 0 && !selectedOutlinePoint && <span className="hint">اختر ثقب، مستطيل، نص، أو سهم ثم اضغط داخل الرسم لإضافته.</span>}
        {selectedOutlinePoint && (
          <div className="shape-control selected" key={selectedOutlinePoint.id}>
            <strong>{selectedOutlinePoint.corner ? "ركن ثابت" : outlinePointMode(selectedOutlinePoint) === "arc" ? "نقطة قوس" : outlinePointMode(selectedOutlinePoint) === "curve" ? "نقطة منحنى" : "نقطة حرة"}</strong>
            <label><span>من اليسار مم</span><input dir="ltr" inputMode="decimal" value={Math.round(numberValue(selectedOutlinePoint.x))} disabled={selectedOutlinePoint.corner} onChange={(event) => updateOutlinePoint(selectedOutlinePoint.id, { x: event.target.value })} /></label>
            <label><span>من الأعلى مم</span><input dir="ltr" inputMode="decimal" value={Math.round(numberValue(selectedOutlinePoint.y))} disabled={selectedOutlinePoint.corner} onChange={(event) => updateOutlinePoint(selectedOutlinePoint.id, { y: event.target.value })} /></label>
            <label><span>نوع النقطة</span><select value={outlinePointMode(selectedOutlinePoint)} disabled={selectedOutlinePoint.corner || !canCurveOutlinePoint(outlinePoints, selectedOutlinePointIndex)} onChange={(event) => updateOutlinePointMode(selectedOutlinePoint.id, event.target.value)}><option value="free">حرة</option><option value="curve">منحنى</option><option value="arc">قوس</option></select></label>
            <label><span>العمق من الحافة مم</span><input dir="ltr" inputMode="decimal" value={Math.round(numberValue(selectedOutlinePoint.halfDiameter) || outlineDepthAt(selectedOutlinePointIndex))} disabled={selectedOutlinePoint.corner || outlinePointMode(selectedOutlinePoint) === "free"} onChange={(event) => updateOutlinePointDepth(selectedOutlinePoint.id, event.target.value)} /></label>
            <div className="outline-nudge-buttons">
              <button className="tiny" type="button" disabled={selectedOutlinePoint.corner} onClick={() => nudgeOutlinePoint(selectedOutlinePoint.id, 0, -10)}>أعلى</button>
              <button className="tiny" type="button" disabled={selectedOutlinePoint.corner} onClick={() => nudgeOutlinePoint(selectedOutlinePoint.id, 0, 10)}>أسفل</button>
              <button className="tiny" type="button" disabled={selectedOutlinePoint.corner} onClick={() => nudgeOutlinePoint(selectedOutlinePoint.id, -10, 0)}>يسار</button>
              <button className="tiny" type="button" disabled={selectedOutlinePoint.corner} onClick={() => nudgeOutlinePoint(selectedOutlinePoint.id, 10, 0)}>يمين</button>
            </div>
            <button className="tiny danger" disabled={!canDeleteSelectedOutlinePoint} onClick={() => deleteOutlinePoint(selectedOutlinePoint.id)}><Trash2 size={14} />حذف النقطة</button>
          </div>
        )}
        {shapes.map((shape) => (
          <div className={shape.id === selectedShapeId ? "shape-control selected" : "shape-control"} key={shape.id} onPointerDown={() => { setSelectedOutlinePointId(null); setSelectedShapeId(shape.id); }}>
            <strong>{shapeTitle(shape)}</strong>
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
                {shape.kind === "rect" && isSinglePanelCornerNotch(shape) ? (
                  <>
                    {(() => {
                      const cut = cornerCutInfo(shape, outlineBounds);
                      return (
                        <>
                          <label><span>الركن</span><select value={cut?.corner || "tl"} onChange={(event) => updateShape(shape.id, { corner: event.target.value, rectType: "corner", type: "cornerNotch" })}><option value="tl">أعلى يسار</option><option value="tr">أعلى يمين</option><option value="br">أسفل يمين</option><option value="bl">أسفل يسار</option></select></label>
                          <label><span>عرض الركنة مم</span><input dir="ltr" inputMode="decimal" value={Math.round(numberValue(cut?.width ?? shape.w))} onChange={(event) => updateShape(shape.id, { w: event.target.value, width: event.target.value })} /></label>
                          <label><span>ارتفاع الركنة مم</span><input dir="ltr" inputMode="decimal" value={Math.round(numberValue(cut?.height ?? shape.h))} onChange={(event) => updateShape(shape.id, { h: event.target.value, height: event.target.value })} /></label>
                        </>
                      );
                    })()}
                  </>
                ) : (
                  <>
                    {shapeNearestPositionFields(shape)}
                    {shape.kind === "circle" ? (
                  <label><span>قطر مم</span><input dir="ltr" inputMode="decimal" value={numberValue(shape.r) * 2} onChange={(event) => updateShape(shape.id, { r: numberValue(event.target.value) / 2 })} /></label>
                    ) : (
                      <>
                <label><span>عرض مم</span><input dir="ltr" inputMode="decimal" value={shape.w} onChange={(event) => updateShape(shape.id, { w: event.target.value })} /></label>
                <label><span>طول مم</span><input dir="ltr" inputMode="decimal" value={shape.h} onChange={(event) => updateShape(shape.id, { h: event.target.value })} /></label>
                      </>
                    )}
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

function CustomersView({ orders, customers, onOpen, onCopy, onPreview, canEditOrder, currentUser, logoSrc }) {
  const [query, setQuery] = useState(() => sessionStorage.getItem("glassOrdersCustomersQuery") || "");
  useEffect(() => {
    sessionStorage.setItem("glassOrdersCustomersQuery", query);
  }, [query]);
  const grouped = useMemo(() => {
    const names = new Set([...customers.map((c) => c.name), ...orders.map((order) => order.customerName).filter(Boolean)]);
    return [...names].map((name) => {
      const customer = customers.find((item) => item.name === name) || {};
      const customerMatches = matchesQuery(query, name, customer.phone, customer.email, customer.address, customer.tax_no, customer.notes);
      const customerOrders = orders.filter((order) => order.customerName === name);
      const visibleOrders = customerOrders.filter((order) => customerMatches || matchesQuery(query, order.orderNo, order.documentId, order.project, order.code, order.supplierName, order.date, order.notes, ...(order.rows || []).map((row) => row.code)));
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
                  <button
                    data-editor-return-focus
                    title="تعديل الطلب"
                    disabled={!canEditOrder?.(order)}
                    onClick={() => onOpen(order)}
                  >
                    <Pencil size={16} />
                    {displayOrderNo(order.orderNo)} / {order.project || "بدون مشروع"}
                  </button>
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

const SUPPLIER_VIEW_SESSION_KEY = "glassOrdersSupplierViewState";

function defaultSupplierViewState() {
  const currentDate = today();
  return {
    query: "",
    supplierKey: "",
    statementMode: RANGE_STATEMENT_MODE,
    fromDate: `${currentDate.slice(0, 7)}-01`,
    toDate: currentDate,
    orderQuery: "",
    selectedOrderIds: []
  };
}

function readSupplierViewState() {
  const fallback = defaultSupplierViewState();
  try {
    const stored = JSON.parse(sessionStorage.getItem(SUPPLIER_VIEW_SESSION_KEY) || "{}");
    return {
      ...fallback,
      ...stored,
      statementMode: stored.statementMode === SELECTED_ORDERS_STATEMENT_MODE
        ? SELECTED_ORDERS_STATEMENT_MODE
        : RANGE_STATEMENT_MODE,
      selectedOrderIds: normalizeSelectedOrderIds(stored.selectedOrderIds)
    };
  } catch {
    return fallback;
  }
}

function writeSupplierViewState(state) {
  try {
    sessionStorage.setItem(SUPPLIER_VIEW_SESSION_KEY, JSON.stringify(state));
  } catch {
    // Session persistence is a convenience and must never block supplier work.
  }
}

function SuppliersView({
  data,
  onPayment,
  onEditPayment,
  onDeletePayment,
  onPreview,
  onExportPdf,
  onExportExcel,
  onOpen,
  canEditOrder = () => true
}) {
  const [viewState, setViewState] = useState(readSupplierViewState);
  const statementPanelRef = useRef(null);

  const allSuppliers = useMemo(() => {
    const names = new Set([
      ...(data.suppliers || []).map((supplier) => supplier.name),
      ...(data.orders || []).map((order) => order.supplierName).filter(Boolean)
    ]);
    return [...names].map((name) => {
      const supplierRecord = (data.suppliers || []).find((item) => item.name === name) || { id: "", name, opening_balance: 0 };
      const orders = (data.orders || []).filter((order) => order.supplierName === name);
      const payments = (data.payments || []).filter((payment) => payment.supplier_id === supplierRecord.id || payment.supplier_name === name);
      const debt = orders
        .filter(isOrderPayableForSupplier)
        .reduce((sum, order) => sum + orderTotals(order).supplierCost, numberValue(supplierRecord.opening_balance));
      const paid = payments.reduce((sum, payment) => sum + numberValue(payment.amount), 0);
      return { ...supplierRecord, name, orders, payments, debt, paid, balance: debt - paid };
    });
  }, [data.suppliers, data.orders, data.payments]);

  const selectedSupplier = useMemo(
    () => allSuppliers.find((supplier) => supplierSelectionKey(supplier) === viewState.supplierKey) || allSuppliers[0] || null,
    [allSuppliers, viewState.supplierKey]
  );

  useEffect(() => {
    writeSupplierViewState(viewState);
  }, [viewState]);

  useEffect(() => {
    if (!allSuppliers.length) return;
    const selectedExists = allSuppliers.some((supplier) => supplierSelectionKey(supplier) === viewState.supplierKey);
    if (selectedExists) return;
    setViewState((current) => ({
      ...current,
      supplierKey: supplierSelectionKey(allSuppliers[0]),
      orderQuery: "",
      selectedOrderIds: []
    }));
  }, [allSuppliers, viewState.supplierKey]);

  const suppliers = useMemo(() => allSuppliers.map((supplier) => {
    const supplierMatches = matchesQuery(
      viewState.query,
      supplier.name,
      supplier.phone,
      supplier.email,
      supplier.address,
      supplier.notes,
      supplier.opening_balance
    );
    const visibleOrders = supplier.orders.filter((order) => supplierMatches || matchesQuery(
      viewState.query,
      order.orderNo,
      order.documentId,
      order.customerName,
      order.project,
      order.code,
      order.date,
      order.notes,
      ...(order.rows || []).map((row) => row.code)
    ));
    const visiblePayments = supplier.payments.filter((payment) => supplierMatches || matchesQuery(
      viewState.query,
      payment.paid_at,
      payment.amount,
      payment.method,
      payment.reference,
      payment.notes
    ));
    return {
      ...supplier,
      orders: visibleOrders,
      payments: visiblePayments,
      matches: supplierMatches || visibleOrders.length > 0 || visiblePayments.length > 0
    };
  }).filter((supplier) => supplier.matches), [allSuppliers, viewState.query]);

  const statementOrderOptions = useMemo(() => selectedSupplier
    ? filterSupplierOrders({
        supplier: selectedSupplier,
        orders: data.orders || [],
        query: viewState.orderQuery,
        getOrderCost: supplierStatementOrderCost,
        isPayable: isOrderPayableForSupplier,
        orderKey: supplierStatementOrderKey
      })
    : [], [selectedSupplier, data.orders, viewState.orderQuery]);

  const statement = useMemo(() => selectedSupplier
    ? buildAppSupplierStatement({
        supplier: selectedSupplier,
        orders: data.orders || [],
        payments: data.payments || [],
        mode: viewState.statementMode,
        fromDate: viewState.fromDate,
        toDate: viewState.toDate,
        selectedOrderIds: viewState.selectedOrderIds
      })
    : null, [
      selectedSupplier,
      data.orders,
      data.payments,
      viewState.statementMode,
      viewState.fromDate,
      viewState.toDate,
      viewState.selectedOrderIds
    ]);

  const selectedOrderIdSet = useMemo(
    () => new Set(normalizeSelectedOrderIds(viewState.selectedOrderIds)),
    [viewState.selectedOrderIds]
  );
  const canOutputStatement = !!statement && (
    statement.mode === RANGE_STATEMENT_MODE ||
    statement.orders.length > 0
  );

  function patchViewState(patchValue) {
    setViewState((current) => ({ ...current, ...patchValue }));
  }

  function chooseStatementSupplier(supplier, { focus = false } = {}) {
    const supplierKey = supplierSelectionKey(supplier);
    setViewState((current) => ({
      ...current,
      supplierKey,
      orderQuery: current.supplierKey === supplierKey ? current.orderQuery : "",
      selectedOrderIds: current.supplierKey === supplierKey ? current.selectedOrderIds : []
    }));
    if (focus) {
      window.setTimeout(() => statementPanelRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" }), 0);
    }
  }

  function changeStatementMode(statementMode) {
    setViewState((current) => {
      if (current.statementMode === statementMode) return current;
      if (statementMode === RANGE_STATEMENT_MODE) {
        const rangeDefaults = defaultSupplierViewState();
        return {
          ...current,
          statementMode,
          fromDate: current.fromDate || rangeDefaults.fromDate,
          toDate: current.toDate || rangeDefaults.toDate,
          orderQuery: "",
          selectedOrderIds: []
        };
      }
      return {
        ...current,
        statementMode,
        fromDate: "",
        toDate: "",
        orderQuery: "",
        selectedOrderIds: []
      };
    });
  }

  function toggleStatementOrder(order) {
    const orderId = supplierStatementOrderKey(order);
    if (!orderId) return;
    patchViewState({
      selectedOrderIds: selectedOrderIdSet.has(orderId)
        ? removeSelectedOrderId(viewState.selectedOrderIds, orderId)
        : normalizeSelectedOrderIds([...viewState.selectedOrderIds, orderId])
    });
  }

  function selectAllFilteredStatementOrders() {
    patchViewState({
      selectedOrderIds: selectAllFilteredOrderIds(
        viewState.selectedOrderIds,
        statementOrderOptions,
        supplierStatementOrderKey
      )
    });
  }

  return (
    <div className="stack supplier-page">
      <section className="panel supplier-statement-workbench" ref={statementPanelRef}>
        <div className="panel-head">
          <div>
            <h2>كشف حساب المورد</h2>
            <p>اختر طريقة الحساب ثم عاين أو اطبع أو صدّر نفس النتيجة.</p>
          </div>
          <div className="actions">
            <button type="button" disabled={!canOutputStatement} onClick={() => onPreview(statement)}><Eye size={17} />معاينة</button>
            <button type="button" disabled={!canOutputStatement} onClick={() => onExportPdf(statement)}><FileDown size={17} />PDF</button>
            <button type="button" disabled={!canOutputStatement} onClick={() => onExportExcel(statement)}><FileSpreadsheet size={17} />Excel</button>
          </div>
        </div>

        <div className="supplier-statement-controls">
          <Field label="المورد">
            <select
              value={selectedSupplier ? supplierSelectionKey(selectedSupplier) : ""}
              onChange={(event) => {
                const supplier = allSuppliers.find((item) => supplierSelectionKey(item) === event.target.value);
                if (supplier) chooseStatementSupplier(supplier);
              }}
            >
              {allSuppliers.map((supplier) => (
                <option key={supplierSelectionKey(supplier)} value={supplierSelectionKey(supplier)}>{supplier.name}</option>
              ))}
            </select>
          </Field>
          <fieldset className="supplier-statement-mode">
            <legend>نوع كشف الحساب</legend>
            <label>
              <input
                type="radio"
                name="supplier-statement-mode"
                checked={viewState.statementMode === RANGE_STATEMENT_MODE}
                onChange={() => changeStatementMode(RANGE_STATEMENT_MODE)}
              />
              كشف حساب لفترة
            </label>
            <label>
              <input
                type="radio"
                name="supplier-statement-mode"
                checked={viewState.statementMode === SELECTED_ORDERS_STATEMENT_MODE}
                onChange={() => changeStatementMode(SELECTED_ORDERS_STATEMENT_MODE)}
              />
              كشف حساب لطلبات محددة
            </label>
          </fieldset>
        </div>

        {viewState.statementMode === RANGE_STATEMENT_MODE ? (
          <div className="supplier-statement-range">
            <Field label="من تاريخ">
              <input type="date" dir="ltr" value={viewState.fromDate} onChange={(event) => patchViewState({ fromDate: event.target.value })} />
            </Field>
            <Field label="إلى تاريخ">
              <input type="date" dir="ltr" value={viewState.toDate} onChange={(event) => patchViewState({ toDate: event.target.value })} />
            </Field>
            <p className="hint">يشمل الرصيد المرحل قبل بداية الفترة، وتؤثر دفعات الفترة في الرصيد الجاري والختامي.</p>
          </div>
        ) : (
          <div className="supplier-selected-orders">
            <details className="supplier-order-multiselect">
              <summary>
                <span>اختيار طلبات المورد</span>
                <strong>{statement?.orders.length || 0} محدد</strong>
              </summary>
              <div className="supplier-order-picker">
                <SearchBox value={viewState.orderQuery} onChange={(orderQuery) => patchViewState({ orderQuery })} placeholder="بحث برقم الطلب / العميل / المشروع" />
                <div className="supplier-order-picker-actions">
                  <button type="button" onClick={selectAllFilteredStatementOrders} disabled={!statementOrderOptions.length}>تحديد كل النتائج</button>
                  <button type="button" onClick={() => patchViewState({ selectedOrderIds: [] })} disabled={!viewState.selectedOrderIds.length}>مسح الاختيار</button>
                  <span>{statementOrderOptions.length} طلب مطابق</span>
                </div>
                <div className="supplier-order-options">
                  {statementOrderOptions.map((order) => {
                    const orderId = supplierStatementOrderKey(order);
                    return (
                      <label key={orderId}>
                        <input type="checkbox" checked={selectedOrderIdSet.has(orderId)} onChange={() => toggleStatementOrder(order)} />
                        <span dir="ltr">{displayOrderNo(order.orderNo)}</span>
                        <span dir="ltr">{formatStatusDate(order.date)}</span>
                        <span>{[order.customerName, order.project].filter(Boolean).join(" — ") || "بدون عميل / مشروع"}</span>
                        <strong>{money(supplierStatementOrderCost(order))}</strong>
                      </label>
                    );
                  })}
                  {!statementOrderOptions.length && <p className="hint padded">لا توجد طلبات مطابقة لهذا المورد والبحث.</p>}
                </div>
              </div>
            </details>
            {!!statement?.orders.length && (
              <div className="supplier-selected-order-chips">
                {statement.orders.map((order) => (
                  <span key={order.orderId}>
                    <bdi dir="ltr">{displayOrderNo(order.orderNo)}</bdi>
                    <button type="button" title={`إزالة ${displayOrderNo(order.orderNo)}`} onClick={() => patchViewState({ selectedOrderIds: removeSelectedOrderId(viewState.selectedOrderIds, order.orderId) })}><XCircle size={14} /></button>
                  </span>
                ))}
              </div>
            )}
            <p className="hint">لا تُعرض الدفعات ولا تُخصم من إجمالي الطلبات المحددة في هذا الوضع.</p>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>حسابات الموردين</h2>
          <SearchBox value={viewState.query} onChange={(query) => patchViewState({ query })} placeholder="بحث بالمورد / الطلب / الإذن / الدفعة" />
        </div>
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
                <button onClick={() => chooseStatementSupplier(supplier, { focus: true })}><Eye size={16} />إعداد كشف الحساب</button>
              </div>
              <div className="supplier-branches">
                <section>
                  <h3>أوامر المورد</h3>
                  {supplier.orders.length === 0 && <p className="hint">لا توجد أوامر لهذا المورد.</p>}
                  {supplier.orders.map((order) => {
                    const totals = orderTotals(order);
                    return (
                      <div className="supplier-branch-row supplier-order-row" key={order.id || order.orderNo}>
                        <span dir="ltr">{orderDocumentId(order)}</span>
                        <span dir="ltr">{formatStatusDate(order.date)}</span>
                        <span>{order.project || "بدون مشروع"}</span>
                        <strong>{isOrderPayableForSupplier(order) ? money(totals.supplierCost) : "غير مستحق"}</strong>
                        <span className={statusClassName(order.status)}>{statusLabel(order.status)}</span>
                        {canEditOrder(order) && <button className="tiny" type="button" title="تعديل الطلب" onClick={() => onOpen?.(order)}><Pencil size={14} />تعديل</button>}
                      </div>
                    );
                  })}
                </section>
                <section>
                  <h3>الدفعات</h3>
                  {supplier.payments.length === 0 && <p className="hint">لا توجد دفعات مسجلة.</p>}
                  {supplier.payments.map((payment) => (
                    <div className="supplier-branch-row payment-row" key={payment.id}>
                      <span dir="ltr">{formatStatusDate(payment.paid_at)}</span>
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
    </div>
  );
}

function StatementsView({ data, onPreview, onExportPdf, onExportExcel, onOpen, canEditOrder }) {
  const [period, setPeriod] = useState(() => sessionStorage.getItem("glassOrdersStatementPeriod") || "month");
  const availableYears = useMemo(() => uniqueValues(data.orders.map((order) => String(new Date(order.date || today()).getFullYear()))).sort((a, b) => Number(b) - Number(a)), [data.orders]);
  const [selectedYear, setSelectedYear] = useState(() => sessionStorage.getItem("glassOrdersStatementYear") || String(new Date().getFullYear()));
  const [selectedMonth, setSelectedMonth] = useState(() => sessionStorage.getItem("glassOrdersStatementMonth") || String(new Date().getMonth() + 1).padStart(2, "0"));
  useEffect(() => {
    if (availableYears.length && !availableYears.includes(selectedYear)) setSelectedYear(availableYears[0]);
  }, [availableYears, selectedYear]);
  useEffect(() => {
    sessionStorage.setItem("glassOrdersStatementPeriod", period);
    sessionStorage.setItem("glassOrdersStatementYear", selectedYear);
    sessionStorage.setItem("glassOrdersStatementMonth", selectedMonth);
  }, [period, selectedYear, selectedMonth]);
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
      <StatementTable statement={statement} onOpen={onOpen} canEditOrder={canEditOrder} />
    </section>
  );
}

function ManufacturingView({ data, onNotify, onOpen, canEditOrder }) {
  const [query, setQuery] = useState(() => sessionStorage.getItem("glassOrdersManufacturingQuery") || "");
  const [selectedOrderId, setSelectedOrderId] = useState(() => sessionStorage.getItem("glassOrdersManufacturingOrder") || "");
  const [settings, setSettings] = useState(readTicketSettings);
  const [printers, setPrinters] = useState([]);
  const [qrMap, setQrMap] = useState({});
  const [busy, setBusy] = useState(false);
  const orders = data.orders || [];
  const filteredOrders = useMemo(() => orders
    .filter((order) => matchesQuery(query, order.orderNo, order.documentId, order.customerName, order.supplierName, order.project, order.code, ...(order.rows || []).map((row) => row.code), ...(order.rows || []).map(rowDescription)))
    .slice(0, 80), [orders, query]);
  const selectedOrder = orders.find((order) => order.id === selectedOrderId || order.orderNo === selectedOrderId) || filteredOrders[0] || null;
  const tickets = useMemo(() => buildManufacturingTickets(selectedOrder), [selectedOrder]);
  const visibleFields = useMemo(() => ticketVisibleFields(settings), [settings]);
  const hiddenEnabledFields = useMemo(() => ticketHiddenEnabledFields(settings), [settings]);

  useEffect(() => { persistTicketSettings(settings); }, [settings]);
  useEffect(() => {
    sessionStorage.setItem("glassOrdersManufacturingQuery", query);
  }, [query]);
  useEffect(() => {
    if (selectedOrderId) sessionStorage.setItem("glassOrdersManufacturingOrder", selectedOrderId);
    else sessionStorage.removeItem("glassOrdersManufacturingOrder");
  }, [selectedOrderId]);

  useEffect(() => {
    let cancelled = false;
    async function loadPrinters() {
      try {
        const result = await window.glassOrdersDesktop?.getPrinters?.();
        if (!cancelled && Array.isArray(result?.printers)) setPrinters(result.printers);
      } catch {
        if (!cancelled) setPrinters([]);
      }
    }
    loadPrinters();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!settings.printerName) return;
    const printer = printers.find((item) => item.name === settings.printerName);
    const detected = detectedPrinterSizeMm(printer);
    if (detected?.widthMm && detected?.heightMm) {
      setSettings((current) => ({ ...current, widthMm: Math.round(detected.widthMm * 10) / 10, heightMm: Math.round(detected.heightMm * 10) / 10 }));
      onNotify?.(`تم قراءة مقاس التذكرة من تعريف الطابعة: ${Math.round(detected.widthMm)} × ${Math.round(detected.heightMm)} مم`);
    }
  }, [settings.printerName, printers]);

  useEffect(() => {
    let cancelled = false;
    async function buildQrCodes() {
      const entries = await Promise.all(tickets.map(async (ticket) => [ticket.id, await qrDataUrl(ticketQrTextForSettings(ticket, settings), settings)]));
      if (!cancelled) setQrMap(Object.fromEntries(entries));
    }
    if (tickets.length) buildQrCodes();
    else setQrMap({});
    return () => { cancelled = true; };
  }, [tickets, settings.widthMm, settings.heightMm, settings.fields]);

  function patchSettings(patchValue) {
    setSettings((current) => ({ ...current, ...patchValue }));
  }
  function patchTicketField(key, checked) {
    if (key === "pieceCode" || key === "measurements") return;
    setSettings((current) => ({
      ...current,
      fields: { ...normalizedTicketFields(current), [key]: checked, pieceCode: true, measurements: true }
    }));
  }

  async function savePdf() {
    if (!tickets.length) return onNotify?.("اختر طلباً يحتوي على قطع زجاج أولاً.");
    const validation = validateOrderForReport(selectedOrder);
    if (!validation.ok) return onNotify?.(validation.message);
    setBusy(true);
    try {
      await exportTicketsPdf(tickets, qrMap, settings, selectedOrder);
    } catch (error) {
      onNotify?.(`تعذر حفظ تذاكر التصنيع: ${safeErrorMessage(error)}`);
    } finally {
      setBusy(false);
      restoreRendererInputFocus();
    }
  }

  async function printTickets() {
    if (!tickets.length) return onNotify?.("اختر طلباً يحتوي على قطع زجاج أولاً.");
    const validation = validateOrderForReport(selectedOrder);
    if (!validation.ok) return onNotify?.(validation.message);
    setBusy(true);
    try {
      if (window.glassOrdersDesktop?.printHtml) {
        const result = await window.glassOrdersDesktop.printHtml({
          html: ticketPrintHtml(tickets, qrMap, settings),
          printerName: settings.printerName,
          widthMm: settings.widthMm,
          heightMm: settings.heightMm
        });
        if (!result?.ok) throw new Error(result?.error || "تعذر إرسال التذاكر للطابعة.");
      } else {
        window.print();
      }
      onNotify?.("تم إرسال تذاكر التصنيع للطباعة.");
    } catch (error) {
      onNotify?.(`تعذر طباعة تذاكر التصنيع: ${safeErrorMessage(error)}`);
    } finally {
      setBusy(false);
      restoreRendererInputFocus();
    }
  }

  return (
    <section className="panel manufacturing-panel">
      <div className="panel-head">
        <div><h2><Factory size={18} /> Manufacturing Tickets</h2><p>اختر طلباً محفوظاً وجهز Tickets لكل قطعة زجاج فعلية.</p></div>
        <div className="actions">
          <button className="primary" type="button" onClick={printTickets} disabled={busy || !tickets.length}><Printer size={18} />Print</button>
          <button type="button" onClick={savePdf} disabled={busy || !tickets.length}><FileDown size={18} />Save as PDF</button>
        </div>
      </div>
      <div className="manufacturing-layout">
        <aside className="manufacturing-sidebar">
          <SearchBox value={query} onChange={setQuery} placeholder="Search order, customer, supplier, code" />
          <div className="order-pick-list">
            {filteredOrders.map((order) => (
              <div key={order.id || order.orderNo} className={`order-pick-item ${selectedOrder && (selectedOrder.id === order.id || selectedOrder.orderNo === order.orderNo) ? "active" : ""}`}>
                <button className="order-pick-select" type="button" onClick={() => setSelectedOrderId(order.id || order.orderNo)}>
                  <strong dir="ltr">{displayOrderNo(order.orderNo)}</strong>
                  <span>{order.customerName || "اسم العميل"}</span>
                  <small>{order.project || "اسم المشروع"}</small>
                </button>
                {canEditOrder?.(order) && (
                  <button
                    className="order-pick-edit"
                    data-editor-return-focus
                    type="button"
                    title="تعديل الطلب"
                    aria-label={`تعديل الطلب ${displayOrderNo(order.orderNo)}`}
                    onClick={() => onOpen?.(order)}
                  >
                    <Pencil size={16} />
                  </button>
                )}
              </div>
            ))}
            {!filteredOrders.length && <p className="hint">No matching saved orders.</p>}
          </div>
        </aside>
        <div className="manufacturing-main">
          <div className="ticket-settings-grid">
            <Field label="Printer">
              <select value={settings.printerName} onChange={(event) => patchSettings({ printerName: event.target.value })}>
                <option value="">Default printer</option>
                {printers.map((printer) => <option key={printer.name} value={printer.name}>{printer.displayName || printer.name}</option>)}
              </select>
            </Field>
            <Field label="Ticket width (mm)"><input dir="ltr" inputMode="decimal" value={settings.widthMm} onChange={(event) => patchSettings({ widthMm: event.target.value })} /></Field>
            <Field label="Ticket height (mm)"><input dir="ltr" inputMode="decimal" value={settings.heightMm} onChange={(event) => patchSettings({ heightMm: event.target.value })} /></Field>
            <div className="ticket-summary"><span>{tickets.length} Tickets</span>{selectedOrder && <strong dir="ltr">{displayOrderNo(selectedOrder.orderNo)}</strong>}</div>
          </div>
          <div className="ticket-field-picker" aria-label="Ticket fields">
            <label className="ticket-field mandatory"><input type="checkbox" checked readOnly /> Piece code</label>
            <label className="ticket-field mandatory"><input type="checkbox" checked readOnly /> Measurements</label>
            {TICKET_FIELD_DEFS.map((field) => (
              <label key={field.key} className="ticket-field">
                <input
                  type="checkbox"
                  checked={!!normalizedTicketFields(settings)[field.key]}
                  onChange={(event) => patchTicketField(field.key, event.target.checked)}
                />
                {field.label}
              </label>
            ))}
          </div>
          {!!hiddenEnabledFields.length && (
            <div className="ticket-size-warning">
              تعذر إظهار بعض البيانات المحددة بسبب صغر مقاس التيكت: {hiddenEnabledFields.join(", ")}
            </div>
          )}
          {selectedOrder && (
            <div className="selected-order-strip">
              <span><b>Customer</b>{selectedOrder.customerName || "اسم العميل"}</span>
              <span><b>Supplier</b>{selectedOrder.supplierName || "اسم المورد"}</span>
              <span><b>Project</b>{selectedOrder.project || "اسم المشروع"}</span>
              <span><b>Date</b><strong dir="ltr">{formatStatusDate(resolveOrderIssueDate(selectedOrder))}</strong></span>
              {canEditOrder?.(selectedOrder) && (
                <button
                  className="selected-order-edit"
                  data-editor-return-focus
                  type="button"
                  title="تعديل الطلب"
                  onClick={() => onOpen?.(selectedOrder)}
                >
                  <Pencil size={16} />
                  تعديل الطلب
                </button>
              )}
            </div>
          )}
          <div className="ticket-preview-scroll">
            <TicketSheet tickets={tickets} qrMap={qrMap} settings={settings} visibleFields={visibleFields} />
          </div>
        </div>
      </div>
    </section>
  );
}

function TicketSheet({ tickets, qrMap, settings, visibleFields = ticketVisibleFields(settings) }) {
  const style = ticketLayoutStyle(settings);
  return (
    <div className="ticket-sheet" style={style}>
      {tickets.map((ticket) => <TicketCard key={ticket.id} ticket={ticket} qrSrc={visibleFields.qrCode ? qrMap[ticket.id] : ""} settings={settings} visibleFields={visibleFields} />)}
      {!tickets.length && <p className="hint">Select a saved order to preview tickets.</p>}
    </div>
  );
}

function ticketLayoutMetrics(settings = {}) {
  const widthMm = numberValue(settings.widthMm, 90);
  const heightMm = numberValue(settings.heightMm, 55);
  const minSide = Math.max(10, Math.min(widthMm, heightMm));
  const tier = ticketSizeTier(settings);
  const tiny = tier === "tiny";
  const compact = tier === "compact";
  return {
    widthMm,
    heightMm,
    qrMm: tiny ? 0 : compact ? Math.max(8.5, Math.min(12, heightMm * 0.55, widthMm * 0.24)) : Math.max(12, Math.min(22, minSide * 0.34)),
    codeMm: tiny ? Math.max(2.2, Math.min(3.4, heightMm * 0.2, widthMm * 0.095)) : Math.max(3.6, Math.min(7.2, minSide * 0.12)),
    bodyMm: tiny ? Math.max(0.95, Math.min(1.18, heightMm * 0.072)) : Math.max(1.75, Math.min(3.15, minSide * 0.05)),
    measurementMm: tiny ? Math.max(1.25, Math.min(1.7, heightMm * 0.105)) : Math.max(2.25, Math.min(4.65, minSide * 0.074)),
    labelMm: tiny ? Math.max(0.72, Math.min(0.95, heightMm * 0.058)) : Math.max(1.15, Math.min(1.9, minSide * 0.032)),
    gapMm: tiny ? Math.max(0.16, Math.min(0.32, minSide * 0.02)) : Math.max(0.45, Math.min(1.25, minSide * 0.022)),
    paddingMm: tiny ? Math.max(0.42, Math.min(0.65, minSide * 0.038)) : compact ? 0.95 : 1.45,
    tier,
    tiny
  };
}

function ticketLayoutStyle(settings = {}) {
  const metrics = ticketLayoutMetrics(settings);
  return {
    "--ticket-w": `${metrics.widthMm}mm`,
    "--ticket-h": `${metrics.heightMm}mm`,
    "--ticket-qr": `${metrics.qrMm}mm`,
    "--ticket-code-size": `${metrics.codeMm}mm`,
    "--ticket-body-size": `${metrics.bodyMm}mm`,
    "--ticket-measurement-size": `${metrics.measurementMm}mm`,
    "--ticket-label-size": `${metrics.labelMm}mm`,
    "--ticket-gap": `${metrics.gapMm}mm`,
    "--ticket-padding": `${metrics.paddingMm}mm`,
    "--ticket-counter-size": `${Math.max(0.82, metrics.bodyMm * (metrics.tiny ? 0.8 : 0.76))}mm`
  };
}

function ticketDescriptionForSettings(ticket, visibleFields) {
  if (!visibleFields.glassDescription) return "";
  if (visibleFields.glassManufacturer) return ticket.description;
  return rowDescriptionWithoutManufacturer(ticket.row || {});
}

function ticketExtraItems(ticket, visibleFields) {
  const payload = ticket.qrPayload || {};
  return [
    visibleFields.orderNo ? ["Order", payload.orderNo || displayOrderNo(ticket.order?.orderNo)] : null,
    visibleFields.customerName ? ["Customer", payload.customer || ticket.order?.customerName || ""] : null,
    visibleFields.supplierName ? ["Supplier", payload.supplier || ticket.order?.supplierName || ""] : null,
    visibleFields.projectName ? ["Project", payload.project || ticket.order?.project || ""] : null,
    visibleFields.orderDate ? ["Date", formatStatusDate(payload.documentIssueDate || resolveOrderIssueDate(ticket.order))] : null,
    visibleFields.rowQuantity ? ["Qty", ticket.rowQuantity] : null
  ].filter((item) => item && cleanName(item[1]));
}

function ticketExtraValueDir(label, value) {
  const text = String(value ?? "").trim();
  if (["Order", "Date", "Qty"].includes(label)) return "ltr";
  if (!text) return "ltr";
  return /[A-Za-z]/.test(text) || /^[\d\s\-_/.:×+()]+$/.test(text) ? "ltr" : "rtl";
}

function TicketCard({ ticket, qrSrc, settings, visibleFields = ticketVisibleFields(settings) }) {
  const tier = visibleFields.tier || ticketSizeTier(settings);
  const description = ticketDescriptionForSettings(ticket, visibleFields);
  const extras = ticketExtraItems(ticket, visibleFields);
  const hasCounters = visibleFields.orderCounter || visibleFields.rowCounter;
  return (
    <article className={["ticket-card", `ticket-${tier}`, qrSrc ? "" : "no-qr"].filter(Boolean).join(" ")} lang="ar" dir="rtl">
      <div className="ticket-top">
        {qrSrc && <div className="ticket-qr"><img src={qrSrc} alt="" /></div>}
        <div className="ticket-code-block">
          <strong className="ticket-code" lang="en" dir="ltr">{visibleFields.pieceCode ? ticket.code : ""}</strong>
        </div>
      </div>
      <div className="ticket-body">
        {description && <p className="ticket-description" dir="rtl"><bdi><ArabicMixedText value={description} /></bdi></p>}
        {visibleFields.measurements && <MeasurementMm className="ticket-measurement" width={ticket.widthMm} height={ticket.heightMm} />}
        {!!extras.length && (
          <div className="ticket-extra">
            {extras.map(([label, value]) => {
              const valueDir = ticketExtraValueDir(label, value);
              return (
                <span className="ticket-extra-item" key={label}>
                  <b className="ticket-extra-label" lang="en" dir="ltr">{label}</b>
                  <bdi className="ticket-extra-value" dir={valueDir} lang={valueDir === "ltr" ? "en" : "ar"}>{value}</bdi>
                </span>
              );
            })}
          </div>
        )}
      </div>
      {hasCounters && (
        <div className="ticket-counters">
          {visibleFields.orderCounter ? (
            <div className="ticket-counter order-counter">
              <span>إجمالي الطلب</span>
              <strong dir="rtl"><bdi dir="ltr">{ticket.orderPieceIndex + 1}</bdi><em>من</em><bdi dir="ltr">{ticket.totalPieces}</bdi></strong>
            </div>
          ) : <span />}
          {visibleFields.rowCounter ? (
            <div className="ticket-counter row-counter">
              <span>إجمالي البند</span>
              <strong dir="rtl"><bdi dir="ltr">{ticket.rowPieceIndex + 1}</bdi><em>من</em><bdi dir="ltr">{ticket.rowQuantity}</bdi></strong>
            </div>
          ) : <span />}
        </div>
      )}
    </article>
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

function StatementTable({ statement, onOpen, canEditOrder }) {
  return (
    <div className="report-table">
        <div className="report-row glass-statement-row head"><span>المورد</span><span>رقم الإذن</span><span>الطلبات</span><span>القطع</span><span>المساحة م2</span><span>التكلفة</span></div>
      {statement.suppliers.map((supplier) => (
        <React.Fragment key={supplier.supplier}>
          {supplier.documents.map((doc) => (
            <div className="report-row glass-statement-row" key={`${supplier.supplier}-${doc.documentId}`}>
              <span>{supplier.supplier}</span>
              <span className="keep-line" dir="ltr">{doc.documentId}</span>
              <span className="statement-orders">
                {(doc.orders || []).map((order) => canEditOrder?.(order) && onOpen ? (
                  <button
                    key={order.id || order.orderNo}
                    className="statement-order-edit"
                    data-editor-return-focus
                    type="button"
                    title="تعديل الطلب"
                    onClick={() => onOpen(order)}
                  >
                    <Pencil size={14} />
                    <bdi dir="ltr">{displayOrderNo(order.orderNo)}</bdi>
                  </button>
                ) : (
                  <span key={order.id || order.orderNo} dir="ltr">{displayOrderNo(order.orderNo)}</span>
                ))}
              </span>
              <span className="keep-line">{money(doc.pieces)}</span>
              <span className="keep-line">{square(doc.area)}</span>
              <span className="keep-line">{money(doc.cost)}</span>
            </div>
          ))}
          <div className="report-row glass-statement-row subtotal"><span className="statement-subtotal-label">إجمالي المورد {supplier.supplier}</span><span className="keep-line">{money(supplier.subtotal.pieces)}</span><span className="keep-line">{square(supplier.subtotal.area)}</span><span className="keep-line">{money(supplier.subtotal.cost)}</span></div>
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
      ? `كشف حساب ${preview.statement?.supplier?.name || "مورد"}`
      : preview.type === "orderStatus"
        ? "تقرير حالة الطلبات"
        : `طلب ${displayOrderNo(preview.order.orderNo)}`;
  const exportFileBase = preview.type === "order"
    ? orderExportFileBase(preview.order)
    : preview.type === "supplier"
      ? supplierStatementFileBase(preview.statement)
      : preview.type === "orderStatus"
        ? orderStatusReportFileBase(preview.report)
      : title;
  function handlePdfExport() {
    if (preview.type === "order") return exportOrderPdf(preview.order, currentUser, logoSrc);
    if (preview.type === "statement") return exportStatementPdf(preview.statement, currentUser, logoSrc);
    if (preview.type === "supplier") return exportSupplierPdf(preview.statement, currentUser, logoSrc);
    if (preview.type === "orderStatus") return exportOrderStatusPdf(preview.report, currentUser, logoSrc);
    return exportElementPdf(contentRef.current, `${safeFileName(exportFileBase)}.pdf`).catch(showExportError);
  }
  async function handlePrint() {
    if (!contentRef.current) return;
    try {
      await printBrowserReportPdf(contentRef.current, `${safeFileName(exportFileBase)}.pdf`);
    } catch (error) {
      showExportError(error);
    }
  }
  return (
    <div className="modal-backdrop">
      <div className="modal large report-preview-modal">
        <div className="panel-head report-preview-toolbar">
          <h2>{title}</h2>
          <div className="actions">
            {preview.type === "supplier" && <button onClick={handlePrint}><Printer size={16} />طباعة</button>}
            <button onClick={handlePdfExport}><FileDown size={16} />PDF</button>
            <button onClick={() => exportPreviewExcel(preview, currentUser)}><FileSpreadsheet size={16} />Excel</button>
            <button onClick={onClose}>إغلاق</button>
          </div>
        </div>
        <div className="report-preview-scroll">
          <div
            ref={contentRef}
            className={`preview-page report-preview-page ${preview.type === "orderStatus" ? "order-status-preview-page" : ""}`}
          >
            {preview.type === "order" && <OrderReport order={preview.order} currentUser={currentUser} logoSrc={logoSrc} />}
            {preview.type === "statement" && (
              <>
                <ReportHeader title="تقرير مساحات الزجاج" logoSrc={logoSrc} />
                <StatementTable statement={preview.statement} />
                <ReportFooter currentUser={currentUser} />
              </>
            )}
            {preview.type === "supplier" && (
              <SupplierReport
                statement={preview.statement}
                currentUser={currentUser}
                logoSrc={logoSrc}
              />
            )}
            {preview.type === "orderStatus" && (
              <OrderStatusReport
                report={sanitizeOrderStatusReportCosts(preview.report, currentUser)}
                currentUser={currentUser}
                logoSrc={logoSrc}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function OrderReport({ order, currentUser, logoSrc }) {
  const totals = orderTotals(order);
  const reportRows = activeOrderRows(order.rows || []);
  const includeDrawingPages = order.entryMode === "drawings" || reportRows.some(rowHasReportDrawing);
  const issueDate = resolveOrderIssueDate(order);
  const issueDateText = issueDate ? formatStatusDate(issueDate) : "تاريخ غير محدد";
  return (
    <div className="report">
      <ReportHeader title={`طلب شراء زجاج ${displayOrderNo(order.orderNo)}`} logoSrc={logoSrc} />
      <div className={issueDate ? "order-report-date" : "order-report-date missing-date"}>
        <span className="date-label">التاريخ:</span>
        <strong className="date-value" dir="ltr">{issueDateText}</strong>
      </div>
      <div className="report-meta">
        <span>العميل: {order.customerName}</span><span>المورد: {order.supplierName}</span><span>المشروع: {order.project}</span>
      </div>
      {!includeDrawingPages && (
        <div className="report-table order-report-table">
          <div className="report-row order-report-row head"><span>NO.</span><span className="description-header">البيان</span><span className="code-header">الكود</span><span>العرض سم</span><span>الطول سم</span><span>العدد</span><span>م2</span></div>
          {reportRows.map((row, index) => <OrderReportLineGroup key={row.id || `row-${index + 1}`} row={row} index={index} />)}
          <div className="report-row order-report-row subtotal"><span></span><span className="subtotal-label description-cell">الإجمالي</span><span className="code-cell"></span><span></span><span></span><span className="keep-line">{money(totals.pieces)}</span><span className="keep-line">{square(totals.area)}</span></div>
        </div>
      )}
      {includeDrawingPages && (
        <div className="drawing-report">
          {reportRows.map((row, index) => <DrawingReportPage key={row.id} row={row} index={index} order={order} issueDateText={issueDateText} />)}
        </div>
      )}
      <ReportFooter currentUser={currentUser} />
    </div>
  );
}

function OrderReportLineGroup({ row, index }) {
  const lines = orderReportLineItems(row, index);
  if (!lines.length) return null;
  if (!lines[0].split || lines.length === 1) {
    const line = lines[0];
    return (
      <div className="report-row order-report-row" key={line.key}>
        <span className="keep-line">{line.rowNumber}</span>
        <span className="report-description description-cell" dir="rtl"><bdi><ArabicMixedText value={line.description} /></bdi></span>
        <span dir="ltr" className="keep-line code-cell">{line.code}</span>
        <span className="keep-line">{line.width}</span>
        <span className="keep-line">{line.height}</span>
        <span className="keep-line">{line.quantity}</span>
        <span className="keep-line">{square(line.area)}</span>
      </div>
    );
  }
  const root = lines[0];
  return (
    <div
      className="report-row order-report-row split-layer-report-group"
      style={{ "--split-layer-count": lines.length }}
      key={root.key}
    >
      <span className="keep-line split-root-cell split-root-number">{root.rowNumber}</span>
      <span className="report-description description-cell split-root-cell split-root-description" dir="rtl">
        <bdi className="split-root-summary"><ArabicMixedText value={root.description} /></bdi>
        <span className="split-layer-list">
          {lines.map((line) => (
            <span className="split-layer-list-item" key={`${line.key}-description`}>
              <bdi className="split-layer-phrase" dir="rtl"><ArabicMixedText value={line.layerDescription} /></bdi>
            </span>
          ))}
        </span>
      </span>
      <span dir="ltr" className="keep-line code-cell split-root-cell split-root-code">{root.code}</span>
      {lines.map((line, layerIndex) => (
        <React.Fragment key={`${line.key}-values`}>
          <span className={`keep-line split-layer-value ${layerIndex === lines.length - 1 ? "last" : ""}`} style={{ gridColumn: 4, gridRow: layerIndex + 1 }}>{line.width}</span>
          <span className={`keep-line split-layer-value ${layerIndex === lines.length - 1 ? "last" : ""}`} style={{ gridColumn: 5, gridRow: layerIndex + 1 }}>{line.height}</span>
          <span className={`keep-line split-layer-value ${layerIndex === lines.length - 1 ? "last" : ""}`} style={{ gridColumn: 6, gridRow: layerIndex + 1 }}>{line.quantity}</span>
          <span className={`keep-line split-layer-value ${layerIndex === lines.length - 1 ? "last" : ""}`} style={{ gridColumn: 7, gridRow: layerIndex + 1 }}>{square(line.area)}</span>
        </React.Fragment>
      ))}
    </div>
  );
}

function DrawingReportPage({ row, index, order = {}, issueDateText = "" }) {
  const fabricationNotes = drawingFabricationNotes(row);
  const notes = fabricationNotes.length ? fabricationNotes : ["لوح مسطح بدون قص أو ثقوب إضافية."];
  const panels = rowHasPanels(row) ? rowDrawingPanels(row) : [];
  return (
    <div className="drawing-page">
      <div className="drawing-page-header">
        <strong>{displayOrderNo(order.orderNo)} / صف {index + 1}</strong>
        <span>التاريخ: <bdi dir="ltr">{issueDateText}</bdi></span>
      </div>
      <div className="report-table order-report-table drawing-item-table">
        <div className="report-row order-report-row head"><span>NO.</span><span className="description-header">البيان</span><span className="code-header">الكود</span><span>العرض سم</span><span>الطول سم</span><span>العدد</span><span>م2</span></div>
        <OrderReportLineGroup row={row} index={index} />
      </div>
      {panels.length ? (
        <>
          {panels.length > 1 && <PanelOverallLayoutPreview row={row} panels={panels} />}
          <div className={panels.length > 1 ? "panel-report-grid panel-detail-pages" : "panel-report-grid"}>
            {panels.map((panel, panelIndex) => <PanelReportCard key={panel.id} row={row} panel={panel} panelIndex={panelIndex} detailPage={panels.length > 1} />)}
          </div>
        </>
      ) : (
        <>
          <DrawingPreview row={row} />
          <HoleDetailViews shapes={normalizeDrawing(row.drawing).shapes} />
        </>
      )}
      <div className="layer-specs">
        {row.layers.map((layer, layerIndex) => (
          <p key={layerIndex}>{layerReportDescription(layer, layerIndex)}</p>
        ))}
      </div>
      <div className="fabrication-notes">
        {notes.map((note, noteIndex) => <p key={noteIndex}>{note}</p>)}
      </div>
    </div>
  );
}

function PanelOverallLayoutPreview({ row, panels = [] }) {
  const normalizedPanels = panels.map((panel, index) => clampDrawingPanelToWorkingArea(normalizeDrawingPanel(panel, index), row));
  const area = rowWorkingAreaMm(row);
  const pad = 280;
  return (
    <section className="panel-overall-layout">
      <div className="panel-report-head">
        <strong>Overall Layout</strong>
        <span dir="ltr">{`${Math.round(area.width)} × ${Math.round(area.height)} mm`}</span>
        <span>{normalizedPanels.length} Panels</span>
      </div>
      <svg className="drawing-preview panel-overall-preview" viewBox={`${-pad} ${-pad} ${area.width + pad * 2} ${area.height + pad * 2}`}>
        <rect x={-pad} y={-pad} width={area.width + pad * 2} height={area.height + pad * 2} fill="#fff" stroke="#d9e0e8" />
        <rect className="overall-work-area" x="0" y="0" width={area.width} height={area.height} />
        <g className="outline-total-dimensions">
          <line x1="0" y1="-78" x2={area.width} y2="-78" />
          <line x1={area.width + 78} y1="0" x2={area.width + 78} y2={area.height} />
          <text x={area.width / 2} y="-94" textAnchor="middle">{`Overall Width ${Math.round(area.width)} mm`}</text>
          <text x={area.width + 96} y={area.height / 2} textAnchor="middle" transform={`rotate(90 ${area.width + 96} ${area.height / 2})`}>{`Overall Height ${Math.round(area.height)} mm`}</text>
        </g>
        {normalizedPanels.map((panel, panelIndex) => {
          const drawing = normalizePanelDrawingData(panel.drawing);
          const geometry = { x: 0, y: 0, width: numberValue(panel.width), height: numberValue(panel.height) };
          const outlinePoints = visualOutlinePointsForDrawing(drawing, geometry);
          return (
            <g key={panel.id} transform={`translate(${numberValue(panel.x)} ${numberValue(panel.y)})`}>
              <path className="glass-outline-fill" d={outlinePath(outlinePoints)} fill={row.layers?.[0]?.color || "#9fd3ff"} opacity=".18" stroke="#2563a6" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
              <text className="panel-title-label" x={numberValue(panel.width) / 2} y={numberValue(panel.height) / 2} textAnchor="middle">{`Panel ${panelDisplayName(panel, panelIndex)}`}</text>
              {(drawing.shapes || []).filter((shape) => shape.kind === "circle").map((shape) => <circle key={shape.id} cx={shape.x} cy={shape.y} r={shape.r} fill="#fff" stroke="#b42318" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
              {(drawing.shapes || []).filter((shape) => shape.kind === "rect").map((shape) => {
                const bounds = { x: 0, y: 0, right: geometry.width, bottom: geometry.height, width: geometry.width, height: geometry.height };
                if (cornerCutInfo(shape, bounds)) return null;
                const notchInfo = edgeCutInfo(shape, bounds);
                return notchInfo ? <path key={shape.id} className="edge-notch-cut" d={notchInfo.path} /> : <rect key={shape.id} x={shape.x} y={shape.y} width={shape.w} height={shape.h} fill="none" stroke="#087d45" strokeWidth="1" vectorEffect="non-scaling-stroke" />;
              })}
            </g>
          );
        })}
      </svg>
    </section>
  );
}

function layerReportDescription(layer, index) {
  const names = ["الأولى", "الثانية", "الثالثة"];
  const secure = layer.secure ? " سيكوريت" : "";
  const company = cleanName(layer.company) ? ` ${cleanName(layer.company)}` : "";
  return cleanName(`الطبقة ${names[index] || index + 1}: زجاج ${layer.glassType || ""} ${normalizeThicknessText(layer.thickness || "")}${secure}${company} مقاس ${numberValue(layer.width)}سم × ${numberValue(layer.height)}سم`);
}

function DrawingPreview({ row }) {
  const drawing = normalizeDrawing(row.drawing);
  const maxW = Math.max(200, ...row.layers.map((layer) => cmToMm(layer.width, 100)));
  const maxH = Math.max(200, ...row.layers.map((layer) => cmToMm(layer.height, 100)));
  const pad = 360;
  const depthOffsets = layerVisualDepthOffsets(row);
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
    const visualOffset = depthOffsets[index] || 0;
    return {
      width,
      height,
      x: aligned.x + clamp(layer.offsetX, -freeX, freeX) + visualOffset,
      y: aligned.y + clamp(layer.offsetY, -freeY, freeY) + visualOffset
    };
  }
  const geometries = row.layers.map(previewGeometry);
  const baseGeometry = geometries[0] || { x: 0, y: 0, width: maxW, height: maxH };
  const outlinePoints = visualOutlinePointsForDrawing(drawing, baseGeometry);
  const outlineBounds = boundsFromOutline(outlinePoints, baseGeometry);
  const outlineDims = outlineDimensionItems(outlinePoints, baseGeometry);
  const curveDims = curveDepthItems(outlinePoints, baseGeometry);
  const holeLabels = holeLeaderLabelItems(drawing.shapes || [], outlineBounds);
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
            <path className="glass-outline-fill" d={outlinePath(layerOutline)} fill={layer.color} opacity={layer.mirror ? ".36" : ".2"} stroke={layer.mirror ? "#c3922c" : i ? "#a78b3e" : "#2563a6"} strokeWidth="1.6" strokeDasharray={i ? "12 8" : "0"} />
          </g>
        );
      })}
      <g className="outline-total-dimensions">
        <line x1={outlineBounds.x} y1={outlineBounds.y - 88} x2={outlineBounds.right} y2={outlineBounds.y - 88} />
        <line x1={outlineBounds.right + 88} y1={outlineBounds.y} x2={outlineBounds.right + 88} y2={outlineBounds.bottom} />
        <text x={outlineBounds.x + outlineBounds.width / 2} y={outlineBounds.y - 104} textAnchor="middle">{`إجمالي العرض ${Math.round(outlineBounds.width)}مم`}</text>
        <text x={outlineBounds.right + 106} y={outlineBounds.y + outlineBounds.height / 2} textAnchor="middle" transform={`rotate(90 ${outlineBounds.right + 106} ${outlineBounds.y + outlineBounds.height / 2})`}>{`إجمالي الارتفاع ${Math.round(outlineBounds.height)}مم`}</text>
      </g>
      <g className="edge-dimension-lines">
        {outlineDims.map((item, itemIndex) => (
          <g key={`preview-outline-dim-${itemIndex}`}>
            {item.path ? <path d={item.path} fill="none" /> : <line x1={item.x1} y1={item.y1} x2={item.x2} y2={item.y2} />}
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
      {(drawing.paths || []).map((path) => <polyline key={path.id} points={path.points.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#111" strokeWidth="2.4" vectorEffect="non-scaling-stroke" />)}
      {(drawing.shapes || []).map((shape) => {
        const centerX = shape.kind === "arrow" ? (numberValue(shape.x1) + numberValue(shape.x2)) / 2 : shape.kind === "rect" ? numberValue(shape.x) + numberValue(shape.w) / 2 : numberValue(shape.x);
        const centerY = shape.kind === "arrow" ? (numberValue(shape.y1) + numberValue(shape.y2)) / 2 : shape.kind === "rect" ? numberValue(shape.y) + numberValue(shape.h) / 2 : numberValue(shape.y);
        const ref = measurementReference(shape, outlineBounds, outlinePoints);
        const hStart = ref.hStart;
        const vStart = ref.vStart;
        const hLabelX = (hStart + centerX) / 2;
        const vLabelY = (vStart + centerY) / 2;
        const cornerCut = shape.kind === "rect" ? cornerCutInfo(shape, outlineBounds) : null;
        const notchInfo = shape.kind === "rect" && !cornerCut ? edgeCutInfo(shape, outlineBounds) : null;
        const rectDims = shape.kind === "rect" && !cornerCut ? rectSideDimensionItems(shape, outlineBounds) : [];
        const cornerDims = cornerCut ? cornerNotchDimensionItems(cornerCut, outlineBounds) : [];
        const measure = (
          <g className="measurement-lines">
            <line x1={hStart} y1={centerY} x2={centerX} y2={centerY} />
            <line x1={centerX} y1={vStart} x2={centerX} y2={centerY} />
            <text x={hLabelX} y={centerY - 12} textAnchor="middle">{`${Math.round(ref.horizontalDistance)}مم`}</text>
            <text x={centerX + 14} y={vLabelY} textAnchor="start">{`${Math.round(ref.verticalDistance)}مم`}</text>
          </g>
        );
        if (shape.kind === "circle") return <g key={shape.id}>{measure}<circle cx={shape.x} cy={shape.y} r={shape.r} fill="#fff" stroke="#b42318" strokeWidth="1.2" vectorEffect="non-scaling-stroke" /></g>;
        if (shape.kind === "rect") return <g key={shape.id}>{cornerCut ? null : measure}{cornerCut ? <rect className="corner-cut-hit" x={cornerCut.x} y={cornerCut.y} width={cornerCut.width} height={cornerCut.height} /> : notchInfo ? <><rect className="edge-notch-fill" x={shape.x} y={shape.y} width={shape.w} height={shape.h} /><path className="edge-notch-cut" d={notchInfo.path} /></> : <rect x={shape.x} y={shape.y} width={shape.w} height={shape.h} fill="#fff" stroke="#087d45" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />}<g className="rect-side-dimensions">{[...cornerDims, ...rectDims].map((item, itemIndex) => <g key={`preview-rect-side-${shape.id}-${itemIndex}`}><line x1={item.x1} y1={item.y1} x2={item.x2} y2={item.y2} /><text x={item.tx} y={item.ty} textAnchor="middle" transform={item.rotate || undefined}>{item.label}</text></g>)}</g></g>;
        if (shape.kind === "arrow") return <g key={shape.id}><line x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} stroke="#111827" strokeWidth="1.4" vectorEffect="non-scaling-stroke" markerStart={`url(#preview-arrow-head-${row.id})`} markerEnd={`url(#preview-arrow-head-${row.id})`} /><text className="shape-size-label" x={centerX + 12} y={centerY - 12}>{shape.text || `${Math.round(Math.hypot(numberValue(shape.x2) - numberValue(shape.x1), numberValue(shape.y2) - numberValue(shape.y1)))}مم`}</text></g>;
        return <text key={shape.id} x={shape.x} y={shape.y} textAnchor="middle" fontSize="32" fontWeight="800">{shape.text || "ملاحظة"}</text>;
      })}
      <g className="hole-leader-labels">
        {holeLabels.map((item) => (
          <g key={`preview-hole-label-${item.shape.id}`}>
            {item.path ? <path d={item.path} fill="none" /> : <line x1={item.lineX1} y1={item.lineY1} x2={item.lineX2} y2={item.lineY2} />}
            <text x={item.textX} y={item.textY} textAnchor={item.textAnchor}>{item.label}</text>
          </g>
        ))}
      </g>
    </svg>
  );
}

function PanelReportCard({ row, panel, panelIndex, detailPage = false }) {
  const panelDrawing = normalizePanelDrawingData(panel.drawing);
  return (
    <section className={detailPage ? "panel-report-card panel-detail-page" : "panel-report-card"}>
      <div className="panel-report-head">
        <strong>{`Panel ${panelDisplayName(panel, panelIndex)}`}</strong>
        <span dir="ltr">{panelCode(row, panel, panelIndex)}</span>
        <span dir="ltr">{`${Math.round(numberValue(panel.width))} × ${Math.round(numberValue(panel.height))} mm`}</span>
        <span>{square(panelAreaM2(panel))} م2</span>
      </div>
      <PanelDrawingPreview row={row} panel={panel} panelIndex={panelIndex} />
      <HoleDetailViews shapes={panelDrawing.shapes} />
      {panel.notes && <p className="panel-report-note">{panel.notes}</p>}
    </section>
  );
}

function PanelDrawingPreview({ row, panel, panelIndex }) {
  const drawing = normalizePanelDrawingData(panel.drawing);
  const width = Math.max(1, numberValue(panel.width));
  const height = Math.max(1, numberValue(panel.height));
  const pad = 260;
  const geometry = { x: 0, y: 0, width, height };
  const outlinePoints = visualOutlinePointsForDrawing(drawing, geometry);
  const outlineBounds = boundsFromOutline(outlinePoints, geometry);
  const outlineDims = outlineDimensionItems(outlinePoints, geometry);
  const curveDims = curveDepthItems(outlinePoints, geometry);
  const holeLabels = holeLeaderLabelItems(drawing.shapes || [], outlineBounds);
  return (
    <svg className="drawing-preview panel-drawing-preview" viewBox={`${-pad} ${-pad} ${width + pad * 2} ${height + pad * 2}`}>
      <rect x={-pad} y={-pad} width={width + pad * 2} height={height + pad * 2} fill="#fff" stroke="#d9e0e8" />
      <path className="glass-outline-fill" d={outlinePath(outlinePoints)} fill={row.layers?.[0]?.color || "#9fd3ff"} opacity=".2" stroke="#2563a6" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      <text className="panel-title-label" x={width / 2} y={-82} textAnchor="middle">{`Panel ${panelDisplayName(panel, panelIndex)} - ${panelCode(row, panel, panelIndex)}`}</text>
      <g className="outline-total-dimensions">
        <line x1={outlineBounds.x} y1={outlineBounds.y - 58} x2={outlineBounds.right} y2={outlineBounds.y - 58} />
        <line x1={outlineBounds.right + 58} y1={outlineBounds.y} x2={outlineBounds.right + 58} y2={outlineBounds.bottom} />
        <text x={outlineBounds.x + outlineBounds.width / 2} y={outlineBounds.y - 74} textAnchor="middle">{`${Math.round(outlineBounds.width)}مم`}</text>
        <text x={outlineBounds.right + 76} y={outlineBounds.y + outlineBounds.height / 2} textAnchor="middle" transform={`rotate(90 ${outlineBounds.right + 76} ${outlineBounds.y + outlineBounds.height / 2})`}>{`${Math.round(outlineBounds.height)}مم`}</text>
      </g>
      <g className="edge-dimension-lines">
        {outlineDims.map((item, itemIndex) => (
          <g key={`panel-outline-dim-${panel.id}-${itemIndex}`}>
            {item.path ? <path d={item.path} fill="none" /> : <line x1={item.x1} y1={item.y1} x2={item.x2} y2={item.y2} />}
            <text x={item.tx} y={item.ty} textAnchor="middle" transform={item.rotate || undefined}>{item.label}</text>
          </g>
        ))}
        {curveDims.map((item, itemIndex) => (
          <g key={`panel-curve-dim-${panel.id}-${itemIndex}`}>
            <line x1={item.x1} y1={item.y1} x2={item.x2} y2={item.y2} />
            <text x={item.tx} y={item.ty} textAnchor="middle">{item.label}</text>
          </g>
        ))}
      </g>
      {(drawing.shapes || []).map((shape) => {
        const ref = measurementReference(shape, outlineBounds, outlinePoints);
        const centerX = ref.centerX;
        const centerY = ref.centerY;
        const measure = (
          <g className="measurement-lines">
            <line x1={ref.hStart} y1={centerY} x2={centerX} y2={centerY} />
            <line x1={centerX} y1={ref.vStart} x2={centerX} y2={centerY} />
            <text x={(ref.hStart + centerX) / 2} y={centerY - 12} textAnchor="middle">{`${Math.round(ref.horizontalDistance)}مم`}</text>
            <text x={centerX + 14} y={(ref.vStart + centerY) / 2} textAnchor="start">{`${Math.round(ref.verticalDistance)}مم`}</text>
          </g>
        );
        if (shape.kind === "circle") return <g key={shape.id}>{measure}<circle cx={shape.x} cy={shape.y} r={shape.r} fill="#fff" stroke="#b42318" strokeWidth="1.2" vectorEffect="non-scaling-stroke" /></g>;
        if (shape.kind === "rect") {
          const cornerCut = cornerCutInfo(shape, outlineBounds);
          const notchInfo = cornerCut ? null : edgeCutInfo(shape, outlineBounds);
          const rectDims = cornerCut ? [] : rectSideDimensionItems(shape, outlineBounds);
          const cornerDims = cornerCut ? cornerNotchDimensionItems(cornerCut, outlineBounds) : [];
          return <g key={shape.id}>{cornerCut ? null : measure}{cornerCut ? <rect className="corner-cut-hit" x={cornerCut.x} y={cornerCut.y} width={cornerCut.width} height={cornerCut.height} /> : notchInfo ? <><rect className="edge-notch-fill" x={shape.x} y={shape.y} width={shape.w} height={shape.h} /><path className="edge-notch-cut" d={notchInfo.path} /></> : <rect x={shape.x} y={shape.y} width={shape.w} height={shape.h} fill="#fff" stroke="#087d45" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />}<g className="rect-side-dimensions">{[...cornerDims, ...rectDims].map((item, itemIndex) => <g key={`panel-rect-side-${shape.id}-${itemIndex}`}><line x1={item.x1} y1={item.y1} x2={item.x2} y2={item.y2} /><text x={item.tx} y={item.ty} textAnchor="middle" transform={item.rotate || undefined}>{item.label}</text></g>)}</g></g>;
        }
        if (shape.kind === "arrow") return <g key={shape.id} className="drawing-arrow"><line x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} /><text x={(numberValue(shape.x1) + numberValue(shape.x2)) / 2 + 12} y={(numberValue(shape.y1) + numberValue(shape.y2)) / 2 - 12}>{shape.text || `${Math.round(Math.hypot(numberValue(shape.x2) - numberValue(shape.x1), numberValue(shape.y2) - numberValue(shape.y1)))}مم`}</text></g>;
        return <text key={shape.id} x={shape.x} y={shape.y} textAnchor="middle" fontSize="32" fontWeight="800">{shape.text || "ملاحظة"}</text>;
      })}
      <g className="hole-leader-labels">
        {holeLabels.map((item) => (
          <g key={`panel-preview-hole-label-${panel.id}-${item.shape.id}`}>
            {item.path ? <path d={item.path} fill="none" /> : <line x1={item.lineX1} y1={item.lineY1} x2={item.lineX2} y2={item.lineY2} />}
            <text x={item.textX} y={item.textY} textAnchor={item.textAnchor}>{item.label}</text>
          </g>
        ))}
      </g>
    </svg>
  );
}

const ORDERS_STATUS_UI_STATE_KEY = "glassOrders.ordersStatus.ui.v1";

function readOrdersStatusUiState() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(ORDERS_STATUS_UI_STATE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function GlassTypeBreakdown({ order, compact = false }) {
  const groups = orderGlassTypeGroups(order);
  if (!groups.length) return <span className="hint">لا يوجد بيان زجاج</span>;
  return (
    <div className={compact ? "glass-type-breakdown compact" : "glass-type-breakdown"}>
      {groups.map((group) => (
        <div className="glass-type-entry" key={group.key}>
          <strong>{group.description}</strong>
          <span>
            المطلوب: {money(group.orderedQuantity)}
            {" — "}المستلم: {money(group.previouslyReceivedQuantity)}
            {" — "}المتبقي: {money(group.remainingQuantity)}
          </span>
        </div>
      ))}
    </div>
  );
}

function receiptHistoryUserLabel(value) {
  if (!value) return "مستخدم غير محدد";
  if (typeof value === "string") return value;
  return value.displayName || value.display_name || value.username || value.name || value.id || "مستخدم غير محدد";
}

function formatReceiptHistoryTime(value) {
  const date = new Date(value || "");
  return Number.isNaN(date.getTime()) ? String(value || "-") : date.toLocaleString("ar-EG");
}

function OrdersStatusView({ data, currentUser, logoSrc, onOpen, onUpdateOrder, onDeleteOrder, onPreview }) {
  const initialUiState = useMemo(readOrdersStatusUiState, []);
  const supplierNames = useMemo(() => uniqueValues([...data.suppliers.map((supplier) => supplier.name), ...data.orders.map((order) => order.supplierName || "بدون مورد")]), [data]);
  const statusScrollRef = useRef(null);
  const [query, setQuery] = useState(initialUiState.query || "");
  const [selectedSuppliers, setSelectedSuppliers] = useState(Array.isArray(initialUiState.selectedSuppliers) ? initialUiState.selectedSuppliers : []);
  const [selectedStatuses, setSelectedStatuses] = useState(Array.isArray(initialUiState.selectedStatuses) ? initialUiState.selectedStatuses : ["ordered", "fabrication", "ready", "partial"]);
  const [dateFrom, setDateFrom] = useState(initialUiState.dateFrom || "");
  const [dateTo, setDateTo] = useState(initialUiState.dateTo || "");
  const [showCosts, setShowCosts] = useState(initialUiState.showCosts === true);
  const [selectedOrderKey, setSelectedOrderKey] = useState(initialUiState.selectedOrderKey || "");
  const [collectedDrafts, setCollectedDrafts] = useState({});
  const [documentDrafts, setDocumentDrafts] = useState({});
  const [receiptDialogOrder, setReceiptDialogOrder] = useState(null);
  const [receiptCorrectionTarget, setReceiptCorrectionTarget] = useState(null);
  const [pendingWorkflowChange, setPendingWorkflowChange] = useState(null);
  const selectedSupplierSet = useMemo(() => new Set(selectedSuppliers), [selectedSuppliers]);
  const selectedStatusSet = useMemo(() => new Set(selectedStatuses), [selectedStatuses]);
  const canViewCosts = canCurrentUserViewCosts(currentUser);
  const costsVisible = canViewCosts && showCosts;
  const visibleOrders = useMemo(() => data.orders.filter((order) => {
    const status = normalizeOrderStatus(order.status);
    const supplierAllowed = selectedSupplierSet.size === 0 || selectedSupplierSet.has(order.supplierName || "بدون مورد");
    const statusAllowed = selectedStatusSet.size === 0 || selectedStatusSet.has(status);
    const dateAllowed = (!dateFrom || String(order.date || "") >= dateFrom) && (!dateTo || String(order.date || "") <= dateTo);
    return supplierAllowed
      && statusAllowed
      && dateAllowed
      && matchesQuery(query, order.orderNo, order.documentId, order.supplierName, order.customerName, order.project, order.code, order.notes, statusLabel(status), ...(order.rows || []).flatMap((row) => [row.code, rowDescription(row)]));
  }), [data.orders, query, selectedSupplierSet, selectedStatusSet, dateFrom, dateTo]);
  const report = useMemo(() => buildOrderStatusReport(visibleOrders, selectedSuppliers, { showCosts: costsVisible }), [visibleOrders, selectedSuppliers, costsVisible]);
  const costSummary = useMemo(() => costsVisible
    ? buildFilteredSupplierCostSubtotals(visibleOrders, {
      getCost: (order) => orderTotals(order).supplierCost,
      filter: isOrderPayableForSupplier
    })
    : null, [visibleOrders, costsVisible]);
  const receiptHistoryGroups = useMemo(() => visibleOrders.map((order) => ({
    order,
    items: (order.rows || [])
      .flatMap((row) => normalizeReceiptHistory(row.receiptHistory).map((item, historyIndex) => ({
        ...item,
        rowId: item.rowId || row.id,
        description: item.description || rowDescription(row),
        historyIndex
      })))
      .sort((first, second) => String(second.recordedAt || "").localeCompare(String(first.recordedAt || "")))
  })).filter((group) => group.items.length > 0), [visibleOrders]);

  useEffect(() => {
    sessionStorage.setItem(ORDERS_STATUS_UI_STATE_KEY, JSON.stringify({
      query,
      selectedSuppliers,
      selectedStatuses,
      dateFrom,
      dateTo,
      showCosts,
      selectedOrderKey,
      scrollLeft: statusScrollRef.current?.scrollLeft || 0,
      scrollTop: statusScrollRef.current?.scrollTop || 0
    }));
  }, [query, selectedSuppliers, selectedStatuses, dateFrom, dateTo, showCosts, selectedOrderKey]);

  useEffect(() => {
    const node = statusScrollRef.current;
    if (!node) return undefined;
    node.scrollLeft = numberValue(initialUiState.scrollLeft);
    node.scrollTop = numberValue(initialUiState.scrollTop);
    function handleWheel(event) {
      if (!event.shiftKey) return;
      preventCancelableDefault(event);
      node.scrollLeft += event.deltaY;
    }
    function rememberScroll() {
      const current = readOrdersStatusUiState();
      sessionStorage.setItem(ORDERS_STATUS_UI_STATE_KEY, JSON.stringify({
        ...current,
        scrollLeft: node.scrollLeft,
        scrollTop: node.scrollTop
      }));
    }
    node.addEventListener("wheel", handleWheel, { passive: false });
    node.addEventListener("scroll", rememberScroll, { passive: true });
    return () => {
      node.removeEventListener("wheel", handleWheel);
      node.removeEventListener("scroll", rememberScroll);
    };
  }, [initialUiState]);

  function updateStatus(order, patchValue) {
    return onUpdateOrder(order, patchValue);
  }

  function setSpecialStatus(order, enabled, status) {
    changeWorkflowStatus(order, enabled ? status : "ordered");
  }

  function setCollectedPieces(order, value) {
    updateStatus(order, applyAbsoluteOrderReceiptPatch(order, value, currentUser));
  }

  function persistWorkflowStatus(order, nextStatus) {
    if (selectedStatuses.length > 0 && !selectedStatusSet.has(nextStatus)) {
      setSelectedStatuses((current) => [...new Set([...current, nextStatus])]);
    }
    return updateStatus(order, { status: nextStatus });
  }

  function changeWorkflowStatus(order, nextStatus) {
    const receipt = orderReceiptSummary(order);
    if (nextStatus === "collected" && receipt.remainingQuantity > 0) {
      setPendingWorkflowChange({
        order,
        nextStatus,
        remainingQuantity: receipt.remainingQuantity
      });
      return;
    }
    persistWorkflowStatus(order, nextStatus);
  }

  async function confirmMultiGlassReceipt(order, rowBatch) {
    try {
      const patch = applyOrderReceiptBatchPatch(order, rowBatch, currentUser);
      return await updateStatus(order, patch);
    } catch (error) {
      if (error instanceof ReceiptValidationError) throw error;
      throw error;
    }
  }

  async function confirmReceiptCorrection(order, item, correctedQuantityReceived) {
    const patch = applyReceiptHistoryCorrectionPatch(
      order,
      item,
      correctedQuantityReceived,
      currentUser
    );
    return updateStatus(order, patch);
  }

  function openOrderEditor(order) {
    setSelectedOrderKey(rowKeyForOrder(order));
    const current = readOrdersStatusUiState();
    sessionStorage.setItem(ORDERS_STATUS_UI_STATE_KEY, JSON.stringify({
      ...current,
      scrollLeft: statusScrollRef.current?.scrollLeft || 0,
      scrollTop: statusScrollRef.current?.scrollTop || 0,
      selectedOrderKey: rowKeyForOrder(order)
    }));
    onOpen(order);
  }

  function rowKeyForOrder(order) {
    return order.id || order.orderNo;
  }

  function editCollectedDraft(order, value) {
    const key = rowKeyForOrder(order);
    setCollectedDrafts((current) => ({ ...current, [key]: value }));
  }

  function editDocumentDraft(order, value) {
    const key = rowKeyForOrder(order);
    setDocumentDrafts((current) => ({ ...current, [key]: value }));
  }

  function commitDocumentDraft(order, valueOverride) {
    const key = rowKeyForOrder(order);
    const hasDraft = Object.prototype.hasOwnProperty.call(documentDrafts, key);
    if (!hasDraft && valueOverride === undefined) return;
    const value = cleanName(valueOverride ?? documentDrafts[key]);
    if (value === cleanName(order.documentId)) {
      setDocumentDrafts((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      return;
    }
    setDocumentDrafts((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    updateStatus(order, { documentId: value });
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

  return (
    <div className="stack orders-status-stack">
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>متابعة حالة الطلبات</h2>
            <p>فلترة الموردين متعددة الاختيار، وتحديث حالة كل طلب من نفس المكان.</p>
          </div>
          <div className="actions">
            <button onClick={() => onPreview(report)}><Eye size={18} />معاينة التقرير</button>
            <button onClick={() => exportOrderStatusPdf(report, currentUser, logoSrc)}><FileDown size={18} />PDF</button>
            <button onClick={() => exportOrderStatusExcel(report, currentUser)}><FileSpreadsheet size={18} />Excel</button>
          </div>
        </div>
        <div className="status-filters">
          <SearchBox value={query} onChange={setQuery} placeholder="بحث بالمورد / العميل / رقم الطلب / رقم الإذن" />
          <MultiChoice label="الموردين" options={supplierNames.length ? supplierNames : ["بدون مورد"]} selected={selectedSuppliers} onChange={setSelectedSuppliers} allLabel="كل الموردين" />
          <MultiChoice label="الحالات" options={ORDER_STATUS_DEFS.map((status) => status.value)} optionLabel={statusLabel} selected={selectedStatuses} onChange={setSelectedStatuses} allLabel="كل الحالات" />
          <label className="status-date-filter">من<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
          <label className="status-date-filter">إلى<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
          {canViewCosts && (
            <label className="status-cost-toggle" title="يؤثر على العرض والتقارير الحالية فقط ولا يغيّر بيانات الطلب">
              <input type="checkbox" checked={showCosts} onChange={(event) => setShowCosts(event.target.checked)} />
              إظهار التكلفة
            </label>
          )}
        </div>
      </section>

      <section className="panel status-table-panel">
        <div className="status-table-scroll" ref={statusScrollRef}>
          <div className={`status-table ${costsVisible ? "with-cost" : "without-cost"}`}>
            <div className="status-row status-head">
              <span>رقم داخلي</span><span>رقم إذن المورد</span><span>المورد</span><span>العميل / المشروع</span><span>نوع الزجاج / البيان</span><span>التاريخ</span><span>الحالة</span><span>المستلم / المتبقي</span><span>اختصارات</span>{costsVisible && <span>تكلفة المورد</span>}<span>إجراءات</span>
            </div>
            {visibleOrders.length === 0 && <p className="hint padded">لا توجد طلبات مطابقة للفلاتر.</p>}
            {visibleOrders.map((order) => {
              const status = normalizeOrderStatus(order.status);
              const rowKey = rowKeyForOrder(order);
              const totals = orderTotals(order);
              const glassGroups = orderGlassTypeGroups(order);
              const collectedPieces = orderCollectedPieces(order);
              const remainingPieces = orderRemainingPieces(order);
              const collectionLocked = ["pricing", "cancelled"].includes(status);
              const collectedDraftValue = Object.prototype.hasOwnProperty.call(collectedDrafts, rowKey) ? collectedDrafts[rowKey] : (collectedPieces || "");
              const documentDraftValue = Object.prototype.hasOwnProperty.call(documentDrafts, rowKey) ? documentDrafts[rowKey] : (order.documentId || "");
              return (
                <div className={selectedOrderKey === rowKey ? "status-row selected" : "status-row"} key={rowKey}>
                  <strong dir="ltr">{displayOrderNo(order.orderNo)}</strong>
                  <input
                    className="status-document-input"
                    dir="ltr"
                    value={documentDraftValue}
                    onChange={(event) => editDocumentDraft(order, event.target.value)}
                    onBlur={(event) => commitDocumentDraft(order, event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                    placeholder={displayOrderNo(order.orderNo)}
                  />
                  <span>{order.supplierName || "بدون مورد"}</span>
                  <span>{order.customerName || "بدون عميل"} / {order.project || "بدون مشروع"}</span>
                  <GlassTypeBreakdown order={order} />
                  <span className="status-date" dir="ltr">{formatStatusDate(order.date)}</span>
                  <select value={status} onChange={(event) => changeWorkflowStatus(order, event.target.value)}>
                    {ORDER_STATUS_DEFS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                  <div className="collection-control">
                    {glassGroups.length > 1 ? (
                      <button type="button" className="tiny receipt-open-button" disabled={collectionLocked || remainingPieces <= 0} onClick={() => setReceiptDialogOrder(order)}>
                        استلام جزئي من المورد
                      </button>
                    ) : (
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
                    )}
                    <span>مستلم {money(collectedPieces)}</span>
                    <span>متبقي {money(remainingPieces)}</span>
                  </div>
                  <div className="status-checks">
                    <label><input type="checkbox" checked={status === "collected"} onChange={(event) => setSpecialStatus(order, event.target.checked, "collected")} />تم الاستلام</label>
                    <label><input type="checkbox" checked={status === "pricing"} onChange={(event) => setSpecialStatus(order, event.target.checked, "pricing")} />تسعير فقط</label>
                    <label><input type="checkbox" checked={status === "cancelled"} onChange={(event) => setSpecialStatus(order, event.target.checked, "cancelled")} />ملغي</label>
                  </div>
                  {costsVisible && <span className={isOrderPayableForSupplier(order) ? "payable yes" : "payable no"}>{isOrderPayableForSupplier(order) ? money(totals.supplierCost) : "غير مستحق"}</span>}
                  <div className="status-actions">
                    {canCurrentUserEditOrder(currentUser, order) && <button className="tiny" title="تعديل الطلب" onClick={() => openOrderEditor(order)}><Pencil size={14} />تعديل الطلب</button>}
                    <button className="tiny danger solid-danger" onClick={(event) => onDeleteOrder(order, event.currentTarget)}><Trash2 size={14} />حذف</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {costsVisible && costSummary && (
        <section className="panel status-cost-summary">
          <div className="panel-head">
            <div><h2>ملخص تكلفة النتائج الظاهرة</h2><p>تُحسب مرة واحدة لكل طلب مطابق للفلاتر الحالية.</p></div>
            <span>{costSummary.orderCount} طلب</span>
          </div>
          <div className="status-cost-supplier-list">
            {costSummary.suppliers.map((supplier) => <div key={supplier.supplier}><span>{supplier.supplier}</span><strong>{money(supplier.subtotal)}</strong></div>)}
            {costSummary.showGrandTotal && <div className="grand-total"><span>الإجمالي الكلي</span><strong>{money(costSummary.grandTotal)}</strong></div>}
          </div>
        </section>
      )}

      {receiptHistoryGroups.length > 0 && (
        <section className="panel receipt-history-section">
          <div className="panel-head">
            <div><h2>سجل الاستلام</h2><p>عمليات الاستلام المرتبطة بالطلبات الظاهرة فقط، مرتبة من الأحدث.</p></div>
            <span>{receiptHistoryGroups.reduce((sum, group) => sum + group.items.length, 0)} عملية/نوع</span>
          </div>
          <div className="receipt-history-groups">
            {receiptHistoryGroups.map(({ order, items }) => (
              <article className="receipt-history-order" key={rowKeyForOrder(order)}>
                <header>
                  <div><strong dir="ltr">{displayOrderNo(order.orderNo)}</strong><span>{order.supplierName || "بدون مورد"}</span></div>
                  {canCurrentUserEditOrder(currentUser, order) && (
                    <button type="button" className="tiny receipt-history-edit" title="تعديل الطلب" onClick={() => openOrderEditor(order)}><Pencil size={14} />تعديل الطلب</button>
                  )}
                </header>
                <div className="receipt-history-table">
                  <div className="receipt-history-row head"><span>نوع الزجاج</span><span>المستلم بهذه العملية</span><span>المستلم قبل ← بعد</span><span>المتبقي قبل ← بعد</span><span>التاريخ والوقت</span><span>المستخدم</span></div>
                  {items.map((item, index) => (
                    <div className="receipt-history-row" key={`${item.operationId || "receipt"}-${item.rowId}-${index}`}>
                      <strong>{item.description}</strong>
                      <span className="receipt-history-quantity">
                        <bdi dir="ltr">{money(item.quantityReceived)}</bdi>
                        {item.correctedAt && (
                          <small>
                            صُححت بواسطة {receiptHistoryUserLabel(item.correctedBy)}
                            {" — "}{formatReceiptHistoryTime(item.correctedAt)}
                          </small>
                        )}
                        {orderGlassTypeGroups(order).length > 1 && canCurrentUserCorrectReceipt(currentUser, order) && (
                          <button
                            type="button"
                            className="tiny receipt-correction-button"
                            onClick={() => setReceiptCorrectionTarget({ order, item })}
                          >
                            <Pencil size={12} />تصحيح العملية
                          </button>
                        )}
                      </span>
                      <span>{money(item.previousReceivedQuantity)} ← {money(item.newReceivedQuantity)}</span>
                      <span>{money(item.previousRemainingQuantity)} ← {money(item.newRemainingQuantity)}</span>
                      <span dir="ltr">{formatReceiptHistoryTime(item.recordedAt)}</span>
                      <span>{receiptHistoryUserLabel(item.recordedBy)}</span>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>ملخص تقرير الحالة الحالي</h2>
            <p>يعكس نفس البحث والفلاتر والتواريخ الظاهرة أعلاه.</p>
          </div>
          <span className="status-chip warning">{report.rows.length} بند</span>
        </div>
        <OrderStatusMiniTable report={report} currentUser={currentUser} />
      </section>
      {receiptDialogOrder && (
        <MultiGlassReceiptDialog
          order={receiptDialogOrder}
          onCancel={() => setReceiptDialogOrder(null)}
          onConfirm={async (rowBatch) => {
            const saved = await confirmMultiGlassReceipt(receiptDialogOrder, rowBatch);
            if (saved) setReceiptDialogOrder(null);
            return saved;
          }}
        />
      )}
      {receiptCorrectionTarget && (
        <ReceiptCorrectionDialog
          order={receiptCorrectionTarget.order}
          item={receiptCorrectionTarget.item}
          onCancel={() => setReceiptCorrectionTarget(null)}
          onConfirm={async (correctedQuantityReceived) => {
            const saved = await confirmReceiptCorrection(
              receiptCorrectionTarget.order,
              receiptCorrectionTarget.item,
              correctedQuantityReceived
            );
            if (saved) setReceiptCorrectionTarget(null);
            return saved;
          }}
        />
      )}
      {pendingWorkflowChange && (
        <WorkflowStatusConfirmationDialog
          order={pendingWorkflowChange.order}
          nextStatus={pendingWorkflowChange.nextStatus}
          remainingQuantity={pendingWorkflowChange.remainingQuantity}
          onCancel={() => setPendingWorkflowChange(null)}
          onConfirm={async () => {
            const saved = await persistWorkflowStatus(
              pendingWorkflowChange.order,
              pendingWorkflowChange.nextStatus
            );
            if (saved) setPendingWorkflowChange(null);
            return saved;
          }}
        />
      )}
    </div>
  );
}

function WorkflowStatusConfirmationDialog({ order, nextStatus, remainingQuantity, onCancel, onConfirm }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const saved = await onConfirm();
      if (!saved) setError("تعذر تحديث الحالة. لم تتغير بيانات الاستلام ويمكنك المحاولة مرة أخرى.");
    } catch (submitError) {
      setError(safeErrorMessage(submitError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="receipt-dialog-layer" role="presentation" onMouseDown={() => !busy && onCancel()}>
      <section
        className="receipt-dialog workflow-status-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workflow-status-confirmation-title"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) onCancel();
        }}
      >
        <div className="receipt-dialog-head">
          <div>
            <h2 id="workflow-status-confirmation-title">تأكيد تغيير حالة الطلب</h2>
            <p>الطلب: <bdi dir="ltr">{displayOrderNo(order.orderNo)}</bdi></p>
          </div>
          <button type="button" className="icon-button" disabled={busy} onClick={onCancel} aria-label="إلغاء"><XCircle size={20} /></button>
        </div>
        <div className="workflow-status-warning">
          <strong>الحالة الجديدة: {statusLabel(nextStatus)}</strong>
          <span>ما زال هناك {money(remainingQuantity)} من الكمية المطلوبة لم يُسجل استلامها.</span>
          <p>سيتم تغيير حالة الطلب فقط، ولن تتغير كميات الاستلام أو صفوف الطلب.</p>
        </div>
        {error && <div className="receipt-dialog-errors" role="alert"><p>{error}</p></div>}
        <div className="receipt-dialog-actions">
          <button type="button" disabled={busy} autoFocus onClick={submit}>{busy ? "جاري الحفظ..." : "تأكيد تغيير الحالة"}</button>
          <button type="button" className="secondary" disabled={busy} onClick={onCancel}>إلغاء</button>
        </div>
      </section>
    </div>
  );
}

function MultiGlassReceiptDialog({ order, onCancel, onConfirm }) {
  const groups = useMemo(() => orderGlassTypeGroups(order), [order]);
  const [drafts, setDrafts] = useState({});
  const [errors, setErrors] = useState([]);
  const [busy, setBusy] = useState(false);

  function updateGroup(groupKey, patch) {
    setDrafts((current) => ({
      ...current,
      [groupKey]: { selected: false, receivedNow: "", ...(current[groupKey] || {}), ...patch }
    }));
    setErrors([]);
  }

  async function submit() {
    const batch = groups.map((group) => ({
      rowId: group.key,
      selected: !!drafts[group.key]?.selected,
      receivedNow: drafts[group.key]?.receivedNow
    }));
    const validation = validateReceiptBatch(groups.map((group) => ({
      rowId: group.key,
      description: group.description,
      orderedQuantity: group.orderedQuantity,
      previouslyReceivedQuantity: group.previouslyReceivedQuantity,
      remainingQuantity: group.remainingQuantity
    })), batch);
    if (!validation.valid) {
      setErrors(validation.errors.map((error) => error.message));
      return;
    }
    const selectedByKey = new Map(validation.selected.map((item) => [item.rowId, item.receivedNow]));
    const rowBatch = [];
    for (const group of groups) {
      let remainingToAllocate = selectedByKey.get(group.key) || 0;
      for (const entry of group.entries) {
        if (remainingToAllocate <= 0) break;
        const receivedNow = Math.min(entry.remainingQuantity, remainingToAllocate);
        if (receivedNow > 0) rowBatch.push({ rowId: entry.rowId, selected: true, receivedNow });
        remainingToAllocate -= receivedNow;
      }
    }
    setBusy(true);
    try {
      const saved = await onConfirm(rowBatch);
      if (!saved) setErrors(["تعذر حفظ الاستلام. راجع رسالة التطبيق ثم أعد المحاولة."]);
    } catch (error) {
      const receiptErrors = error instanceof ReceiptValidationError
        ? error.errors.map((item) => item.message)
        : [safeErrorMessage(error)];
      setErrors(receiptErrors);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="receipt-dialog-layer" role="presentation" onMouseDown={() => !busy && onCancel()}>
      <section className="receipt-dialog" role="dialog" aria-modal="true" aria-labelledby="multi-receipt-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="receipt-dialog-head">
          <div>
            <h2 id="multi-receipt-title">استلام جزئي من المورد</h2>
            <p>الطلب: <bdi dir="ltr">{displayOrderNo(order.orderNo)}</bdi></p>
          </div>
          <button type="button" className="icon-button" disabled={busy} onClick={onCancel} aria-label="إلغاء"><XCircle size={20} /></button>
        </div>
        <p className="receipt-dialog-instruction">حدد أنواع الزجاج المستلمة وأدخل كمية مستقلة لكل نوع.</p>
        <div className="receipt-dialog-list">
          {groups.map((group) => {
            const selected = !!drafts[group.key]?.selected;
            return (
              <div className={selected ? "receipt-glass-option selected" : "receipt-glass-option"} key={group.key}>
                <label className="receipt-glass-title">
                  <input type="checkbox" checked={selected} onChange={(event) => updateGroup(group.key, { selected: event.target.checked })} />
                  <strong>{group.description}</strong>
                </label>
                <span className="receipt-glass-metrics">
                  المطلوب: {money(group.orderedQuantity)}
                  {" — "}المستلم سابقاً: {money(group.previouslyReceivedQuantity)}
                  {" — "}المتبقي: {money(group.remainingQuantity)}
                </span>
                <span className="receipt-now-field">
                  المستلم الآن
                  <input
                    dir="ltr"
                    inputMode="decimal"
                    disabled={!selected || busy}
                    value={drafts[group.key]?.receivedNow || ""}
                    onChange={(event) => updateGroup(group.key, { receivedNow: event.target.value })}
                    placeholder="0"
                  />
                </span>
              </div>
            );
          })}
        </div>
        {errors.length > 0 && <div className="receipt-dialog-errors" role="alert">{errors.map((error) => <p key={error}>{error}</p>)}</div>}
        <div className="receipt-dialog-actions">
          <button type="button" disabled={busy} onClick={submit}>{busy ? "جاري الحفظ..." : "تأكيد الاستلام"}</button>
          <button type="button" className="secondary" disabled={busy} onClick={onCancel}>إلغاء</button>
        </div>
      </section>
    </div>
  );
}

function ReceiptCorrectionDialog({ order, item, onCancel, onConfirm }) {
  const entry = useMemo(
    () => orderReceiptSummary(order).entries.find((candidate) => String(candidate.rowId) === String(item.rowId)),
    [order, item.rowId]
  );
  const [quantity, setQuantity] = useState(String(item.quantityReceived ?? ""));
  const [errors, setErrors] = useState([]);
  const [busy, setBusy] = useState(false);
  const description = item.description || entry?.description || "نوع الزجاج المحدد";
  const correctedTotal = entry
    ? entry.previouslyReceivedQuantity - numberValue(item.quantityReceived) + numberValue(quantity)
    : 0;

  async function submit() {
    const numericQuantity = numberValue(quantity, Number.NaN);
    if (!Number.isFinite(numericQuantity) || numericQuantity <= 0) {
      setErrors([`الكمية المصححة ل${description} يجب أن تكون أكبر من صفر.`]);
      return;
    }
    setBusy(true);
    setErrors([]);
    try {
      const saved = await onConfirm(numericQuantity);
      if (!saved) setErrors(["تعذر حفظ تصحيح الاستلام. راجع رسالة التطبيق ثم أعد المحاولة."]);
    } catch (error) {
      setErrors(error instanceof ReceiptValidationError
        ? error.errors.map((receiptError) => receiptError.message)
        : [safeErrorMessage(error)]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="receipt-dialog-layer" role="presentation" onMouseDown={() => !busy && onCancel()}>
      <section className="receipt-dialog receipt-correction-dialog" role="dialog" aria-modal="true" aria-labelledby="receipt-correction-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="receipt-dialog-head">
          <div>
            <h2 id="receipt-correction-title">تصحيح عملية استلام</h2>
            <p>الطلب: <bdi dir="ltr">{displayOrderNo(order.orderNo)}</bdi></p>
          </div>
          <button type="button" className="icon-button" disabled={busy} onClick={onCancel} aria-label="إلغاء"><XCircle size={20} /></button>
        </div>
        <div className="receipt-correction-summary">
          <strong>{description}</strong>
          <span>المطلوب: {money(entry?.orderedQuantity)}</span>
          <span>إجمالي المستلم حالياً: {money(entry?.previouslyReceivedQuantity)}</span>
          <span>كمية العملية قبل التصحيح: {money(item.quantityReceived)}</span>
          <span>إجمالي المستلم بعد التصحيح: {money(correctedTotal)}</span>
        </div>
        <label className="receipt-now-field">
          الكمية المستلمة المصححة لهذه العملية
          <input
            autoFocus
            dir="ltr"
            inputMode="decimal"
            disabled={busy}
            value={quantity}
            onChange={(event) => {
              setQuantity(event.target.value);
              setErrors([]);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
              if (event.key === "Escape" && !busy) onCancel();
            }}
          />
        </label>
        <p className="hint">سيُعاد حساب ما قبل/بعد للعمليات اللاحقة لهذا النوع فقط، مع الاحتفاظ بالمستخدم والتوقيت الأصليين وسجل التصحيح.</p>
        {errors.length > 0 && <div className="receipt-dialog-errors" role="alert">{errors.map((error) => <p key={error}>{error}</p>)}</div>}
        <div className="receipt-dialog-actions">
          <button type="button" disabled={busy} onClick={submit}>{busy ? "جاري الحفظ..." : "حفظ التصحيح"}</button>
          <button type="button" className="secondary" disabled={busy} onClick={onCancel}>إلغاء</button>
        </div>
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
      <summary><strong>{label}</strong><span>{selected.length ? `${selected.length} محدد` : allLabel}</span></summary>
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

function buildOrderStatusReport(orders, selectedSuppliers = [], options = {}) {
  const selected = new Set(selectedSuppliers);
  const showCosts = !!options.showCosts;
  const rows = (orders || [])
    .filter((order) => selected.size === 0 || selected.has(order.supplierName || "بدون مورد"))
    .map((order) => {
    const receipt = orderReceiptSummary(order);
    const glassEntries = orderGlassTypeGroups(order).map((group) => ({
      description: group.description,
      orderedQuantity: group.orderedQuantity,
      previouslyReceivedQuantity: group.previouslyReceivedQuantity,
      remainingQuantity: group.remainingQuantity
    }));
    const totals = orderTotals(order);
    return {
      orderId: String(order.id || order.orderNo),
      sourceOrder: order,
      supplier: order.supplierName || "بدون مورد",
      documentId: orderDocumentId(order),
      orderNo: displayOrderNo(order.orderNo),
      date: order.date || "",
      customer: order.customerName || "",
      project: order.project || "",
      glass: glassEntries.map((item) => `${item.description} — المطلوب: ${money(item.orderedQuantity)} — المستلم: ${money(item.previouslyReceivedQuantity)} — المتبقي: ${money(item.remainingQuantity)}`).join("\n"),
      glassEntries,
      quantity: receipt.orderedQuantity,
      receivedQuantity: receipt.receivedQuantity,
      remainingQuantity: receipt.remainingQuantity,
      area: totals.area,
      status: normalizeOrderStatus(order.status),
      statusText: statusLabel(order.status),
      notes: [order.notes, ...(order.rows || []).map((row) => row.notes)].filter(Boolean).join(" | "),
      ...(showCosts ? { cost: isOrderPayableForSupplier(order) ? totals.supplierCost : 0 } : {})
    };
  }).sort((a, b) => a.supplier.localeCompare(b.supplier, "ar") || String(b.date).localeCompare(String(a.date)) || a.orderNo.localeCompare(b.orderNo, "en", { numeric: true }));
  const suppliers = Object.values(rows.reduce((groups, row) => {
    groups[row.supplier] ||= { supplier: row.supplier, rows: [], subtotal: { quantity: 0, receivedQuantity: 0, remainingQuantity: 0, area: 0, ...(showCosts ? { cost: 0 } : {}) } };
    groups[row.supplier].rows.push(row);
    groups[row.supplier].subtotal.quantity += numberValue(row.quantity);
    groups[row.supplier].subtotal.receivedQuantity += numberValue(row.receivedQuantity);
    groups[row.supplier].subtotal.remainingQuantity += numberValue(row.remainingQuantity);
    groups[row.supplier].subtotal.area += numberValue(row.area);
    if (showCosts) groups[row.supplier].subtotal.cost += numberValue(row.cost);
    return groups;
  }, {}));
  const total = rows.reduce((sum, row) => {
    sum.quantity += numberValue(row.quantity);
    sum.receivedQuantity += numberValue(row.receivedQuantity);
    sum.remainingQuantity += numberValue(row.remainingQuantity);
    sum.area += numberValue(row.area);
    if (showCosts) sum.cost += numberValue(row.cost);
    return sum;
  }, { quantity: 0, receivedQuantity: 0, remainingQuantity: 0, area: 0, ...(showCosts ? { cost: 0 } : {}) });
  return { generatedAt: new Date().toISOString(), selectedSuppliers, rows, suppliers, total, singleSupplier: suppliers.length === 1, showCosts };
}

function ReportGlassBreakdown({ entries = [] }) {
  return (
    <div className="report-glass-breakdown">
      {entries.map((entry, index) => (
        <div key={`${entry.description}-${index}`}>
          <strong><ArabicMixedText value={entry.description} /></strong>
          <span>المطلوب {money(entry.orderedQuantity)} — المستلم {money(entry.previouslyReceivedQuantity)} — المتبقي {money(entry.remainingQuantity)}</span>
        </div>
      ))}
    </div>
  );
}

function OrderStatusMiniTable({ report, currentUser }) {
  const showCosts = !!report.showCosts && canCurrentUserViewCosts(currentUser);
  return (
    <div className={`report-table order-status-report-table compact-report ${showCosts ? "with-cost" : "without-cost"}`}>
      <div className="report-row order-status-mini-row head"><span>المورد</span><span>رقم الطلب</span><span>نوع الزجاج / البيان</span><span>المطلوب</span><span>المستلم</span><span>المتبقي</span><span>الحالة</span>{showCosts && <span>التكلفة</span>}</div>
      {report.rows.slice(0, 16).map((row) => (
        <div className="report-row order-status-mini-row" key={row.orderId}>
          <span>{row.supplier}</span><span dir="ltr" className="keep-line">{row.orderNo}</span><ReportGlassBreakdown entries={row.glassEntries} /><span className="keep-line">{money(row.quantity)}</span><span className="keep-line">{money(row.receivedQuantity)}</span><span className="keep-line">{money(row.remainingQuantity)}</span><span>{row.statusText}</span>{showCosts && <span>{money(row.cost)}</span>}
        </div>
      ))}
      {report.rows.length > 16 && <p className="hint padded">والمزيد في التصدير الكامل: {report.rows.length - 16}</p>}
    </div>
  );
}

function OrderStatusReport({ report, currentUser, logoSrc }) {
  const showCosts = !!report.showCosts && canCurrentUserViewCosts(currentUser);
  return (
    <div className="report order-status-report">
      <ReportHeader title="تقرير حالة طلبات الزجاج" logoSrc={logoSrc} />
      <ReportTiming items={[{ label: "تاريخ الإصدار", value: report.generatedAt, exact: true }]} />
      <div className="report-meta">
        <span>المورد: {report.selectedSuppliers.length ? report.selectedSuppliers.join(" / ") : "كل الموردين"}</span>
        <span>عدد الطلبات: {report.rows.length}</span>
        <span>إجمالي المساحة: {square(report.total.area)} م2</span>
        <span>إجمالي القطع: {money(report.total.quantity)}</span>
        {showCosts && report.suppliers.length > 1 && <span>الإجمالي الكلي للتكلفة: {money(report.total.cost)}</span>}
      </div>
      <div className={`report-table order-status-report-table ${showCosts ? "with-cost" : "without-cost"}`}>
        <div className="report-row order-status-report-row head"><span>رقم الإذن</span><span>العميل / المشروع</span><span>رقم الطلب</span><span>التاريخ</span><span>نوع الزجاج / البيان</span><span>المطلوب</span><span>المستلم</span><span>المتبقي</span><span>المساحة</span><span>الحالة</span>{showCosts && <span>التكلفة</span>}</div>
        {report.suppliers.map((supplier) => (
          <React.Fragment key={supplier.supplier}>
            {supplier.rows.map((row) => (
              <div className="report-row order-status-report-row" key={row.orderId}>
                <span dir="ltr" className="keep-line">{row.documentId}</span><span>{[row.customer, row.project].filter(Boolean).join(" / ")}</span><span className="report-order-number-cell"><bdi dir="ltr">{row.orderNo}</bdi></span><span dir="ltr" className="keep-line">{formatStatusDate(row.date)}</span><ReportGlassBreakdown entries={row.glassEntries} /><span className="keep-line">{money(row.quantity)}</span><span className="keep-line">{money(row.receivedQuantity)}</span><span className="keep-line">{money(row.remainingQuantity)}</span><span className="keep-line">{square(row.area)}</span><span>{row.statusText}</span>{showCosts && <span>{money(row.cost)}</span>}
              </div>
            ))}
            <div className="report-row order-status-report-row subtotal supplier-subtotal">
              <span className="subtotal-label">إجمالي المورد {supplier.supplier}</span><span>{money(supplier.subtotal.quantity)}</span><span>{money(supplier.subtotal.receivedQuantity)}</span><span>{money(supplier.subtotal.remainingQuantity)}</span><span>{square(supplier.subtotal.area)}</span><span></span>{showCosts && <span>{money(supplier.subtotal.cost)}</span>}
            </div>
          </React.Fragment>
        ))}
        <div className="report-row order-status-report-row total">
          <span className="subtotal-label">{report.suppliers.length > 1 ? "الإجمالي الكلي" : "إجمالي النتائج"}</span><span>{money(report.total.quantity)}</span><span>{money(report.total.receivedQuantity)}</span><span>{money(report.total.remainingQuantity)}</span><span>{square(report.total.area)}</span><span></span>{showCosts && <span>{report.suppliers.length > 1 ? money(report.total.cost) : ""}</span>}
        </div>
      </div>
      <ReportFooter currentUser={currentUser} />
    </div>
  );
}

function SupplierStatementOrderBlock({ order, showRunningBalance = false }) {
  return (
    <section className="supplier-statement-order-block">
      <div className="supplier-statement-order-title">
        <div>
          <strong>الطلب <bdi dir="ltr">{displayOrderNo(order.orderNo)}</bdi></strong>
          <span>إذن <bdi dir="ltr">{order.documentId || orderDocumentId(order.order)}</bdi></span>
        </div>
        {showRunningBalance && <div><span>الرصيد بعد الطلب: <strong>{money(order.balanceAfter)}</strong></span></div>}
      </div>
      <div className="report-table supplier-statement-order-table">
        <div className="report-row supplier-statement-order-summary-row head">
          <span>رقم الطلب</span>
          <span>التاريخ</span>
          <span>رقم الإذن</span>
          <span>العميل / المشروع</span>
          <span>الحالة</span>
          <span>إجمالي الطلب</span>
        </div>
        <div className="report-row supplier-statement-order-summary-row">
          <span className="keep-line" dir="ltr">{displayOrderNo(order.orderNo)}</span>
          <span className="keep-line" dir="ltr">{formatStatusDate(order.date)}</span>
          <span className="keep-line" dir="ltr">{order.documentId || orderDocumentId(order.order)}</span>
          <span>{[order.customerName, order.project].filter(Boolean).join(" / ") || "بدون عميل / مشروع"}</span>
          <span>{statusLabel(order.status)}</span>
          <span className="keep-line">{money(order.cost)}</span>
        </div>
        <div className="report-row supplier-statement-detail-row head">
          <span>البيان</span>
          <span>الكود</span>
          <span>العدد</span>
          <span>المساحة م2</span>
          <span>تكلفة البند</span>
        </div>
        {order.rows.map((row) => (
          <div className="report-row supplier-statement-detail-row" key={row.id}>
            <span className="report-description"><ArabicMixedText value={row.description} /></span>
            <span className="keep-line" dir="ltr">{row.code || "-"}</span>
            <span className="keep-line">{money(row.quantity)}</span>
            <span className="keep-line">{square(row.area)}</span>
            <span className="keep-line">{money(row.cost)}</span>
          </div>
        ))}
        {!order.rows.length && (
          <div className="report-row supplier-statement-detail-row">
            <span className="supplier-statement-empty">لا توجد تفاصيل بنود محفوظة لهذا الطلب.</span>
          </div>
        )}
        <div className="report-row supplier-statement-detail-row subtotal">
          <span className="subtotal-label">إجمالي الطلب</span>
          <span className="keep-line">{money(order.cost)}</span>
        </div>
      </div>
    </section>
  );
}

function SupplierReport({ statement, currentUser, logoSrc }) {
  if (!statement) return null;
  const isRange = statement.mode === RANGE_STATEMENT_MODE;
  const supplier = statement.supplier || {};
  return (
    <div className="report supplier-statement-report">
      <ReportHeader title={`كشف حساب ${supplier.name || "مورد"}`} logoSrc={logoSrc} />
      {statement.generatedAt && <ReportTiming items={[{ label: "تاريخ الإصدار", value: statement.generatedAt, exact: true }]} />}
      <div className="report-meta">
        <span>المورد: {supplier.name || "بدون مورد"}</span>
        <span>نوع الكشف: {isRange ? "كشف حساب لفترة" : "كشف حساب لطلبات محددة"}</span>
        {isRange ? (
          <span>الفترة: <bdi dir="ltr">{statement.fromDate ? formatStatusDate(statement.fromDate) : "البداية"}</bdi> — <bdi dir="ltr">{statement.toDate ? formatStatusDate(statement.toDate) : "الآن"}</bdi></span>
        ) : (
          <span>عدد الطلبات المحددة: {statement.orders.length}</span>
        )}
      </div>

      {isRange ? (
        <>
          <div className="report-table supplier-statement-opening-table">
            <div className="report-row supplier-report-row head">
              <span>بداية الفترة</span>
              <span>البيان</span>
              <span>مدين</span>
              <span>دائن</span>
              <span>الرصيد</span>
            </div>
            <div className="report-row supplier-report-row">
              <span className="keep-line" dir="ltr">{statement.fromDate ? formatStatusDate(statement.fromDate) : "—"}</span>
              <span>{statement.openingRow.label}</span>
              <span className="keep-line">{statement.openingRow.debit ? money(statement.openingRow.debit) : ""}</span>
              <span className="keep-line">{statement.openingRow.credit ? money(statement.openingRow.credit) : ""}</span>
              <span className="keep-line">{money(statement.openingRow.balance)}</span>
            </div>
          </div>

          <div className="supplier-statement-groups">
            {statement.groups.map((group) => (
              <section className="supplier-statement-group" key={group.id}>
                <div className="supplier-statement-group-title">
                  <strong>{group.date ? formatStatusDate(group.date) : "بدون تاريخ"}</strong>
                  <span>طلبات: {money(group.orderCost)}</span>
                  <span>دفعات: {money(group.paymentTotal)}</span>
                  <span>الرصيد: {money(group.closingBalance)}</span>
                </div>
                {group.entries.map((entry) => entry.type === "order" ? (
                  <SupplierStatementOrderBlock
                    key={`order-${entry.id}`}
                    order={entry}
                    showRunningBalance
                  />
                ) : (
                  <div className="report-table supplier-statement-payment-table" key={`payment-${entry.id}`}>
                    <div className="report-row supplier-statement-payment-row head">
                      <span>التاريخ</span>
                      <span>بيان الدفعة</span>
                      <span>المرجع</span>
                      <span>المدفوع</span>
                      <span>الرصيد بعد الدفعة</span>
                    </div>
                    <div className="report-row supplier-statement-payment-row">
                      <span className="keep-line" dir="ltr">{formatStatusDate(entry.date)}</span>
                      <span>{[entry.method, entry.notes].filter(Boolean).join(" — ") || "دفعة مورد"}</span>
                      <span className="keep-line" dir="ltr">{entry.reference || "—"}</span>
                      <span className="keep-line">{money(entry.amount)}</span>
                      <span className="keep-line">{money(entry.balanceAfter)}</span>
                    </div>
                  </div>
                ))}
              </section>
            ))}
            {!statement.groups.length && <p className="supplier-statement-empty">لا توجد طلبات أو دفعات خلال الفترة المحددة.</p>}
          </div>

          <div className="report-table supplier-statement-totals">
            <div className="report-row supplier-report-row total">
              <span className="subtotal-label">إجمالي أوامر الفترة</span>
              <span className="keep-line">{money(statement.totals.orderCost)}</span>
              <span className="keep-line">{money(statement.totals.payments)}</span>
              <span className="keep-line">{money(statement.totals.closingBalance)}</span>
            </div>
            <div className="report-row supplier-selected-final-row total">
              <span>{statement.finalTotal.label}</span>
              <span className="keep-line">{money(statement.finalTotal.value)}</span>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="supplier-statement-groups selected-orders-statement">
            {statement.orders.map((order) => (
              <SupplierStatementOrderBlock
                key={`selected-${order.id}`}
                order={order}
              />
            ))}
            {!statement.orders.length && <p className="supplier-statement-empty">لم يتم اختيار طلبات لهذا الكشف.</p>}
          </div>
          <div className="report-table supplier-statement-totals">
            <div className="report-row supplier-selected-final-row total">
              <span>{statement.finalTotal.label}</span>
              <span className="keep-line">{money(statement.finalTotal.value)}</span>
            </div>
          </div>
        </>
      )}
      <ReportFooter currentUser={currentUser} />
    </div>
  );
}

function ReportHeader({ title, logoSrc = loadingLogo }) {
  return (
    <header className="report-header">
      <img className="report-logo-main" src={logoSrc || loadingLogo} alt={FULL_APP_NAME} />
      <div>
        <strong>{COMPANY.nameEn}</strong>
        <span>{COMPANY.nameAr}</span>
        <h2>{title}</h2>
      </div>
      <img className="report-logo-app" src={appLogo} alt={FULL_APP_NAME} />
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
      onDragOver={(event) => { preventCancelableDefault(event); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        preventCancelableDefault(event);
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
          <button type="button" className="tiny" onClick={onReset}>استعادة شعار التطبيق</button>
        </div>
      </div>
    </div>
  );
}

function SettingsView({ refreshAll, localStatus, setLocalStatus, setMessage, currentUser, data, setData, appearance, setAppearance, reportLogoSrc, onCheckUpdates, onOpenUpdate, checkingUpdates, availableUpdate, appVersion = VERSION }) {
  const isAdmin = currentUser?.role === "admin";
  const [localApi, setLocalApi] = useState(localApiBase());
  const [useLocalServer, setUseLocalServer] = useState(localServerEnabled());
  const [sourceMode, setSourceMode] = useState(dataSourceMode());
  const [supabaseForm, setSupabaseForm] = useState(() => supabaseConfig());
  const [users, setUsers] = useState(data.users || []);
  const [newUser, setNewUser] = useState({ username: "", display_name: "", email: "", password: "", role: "user", can_view_costs: false, is_active: true });
  const [editingUserId, setEditingUserId] = useState(null);
  const [editingUser, setEditingUser] = useState({});
  const [passwordDraft, setPasswordDraft] = useState({ current_password: "", new_password: "" });
  const [browserServerStatus, setBrowserServerStatus] = useState({ state: "stopped", url: "http://127.0.0.1:5174/", logs: [] });
  const [browserServerBusy, setBrowserServerBusy] = useState(false);
  const [botStatus, setBotStatus] = useState({ running: false });
  const [botSettings, setBotSettings] = useState(() => readBrowserBotSettings());
  const [reportSaveSettings, setReportSaveSettings] = useState(readReportSaveSettings);
  const [busy, setBusy] = useState(false);

  useEffect(() => setUsers(data.users || []), [data.users]);

  useEffect(() => {
    persistReportSaveSettings(reportSaveSettings);
  }, [reportSaveSettings]);

  useEffect(() => {
    readBrowserServerStatus();
    readTelegramBotSettings();
    readTelegramBotStatus();
    const timer = window.setInterval(() => {
      readBrowserServerStatus();
      readTelegramBotStatus();
    }, 1800);
    return () => window.clearInterval(timer);
  }, []);

  function patchAppearance(patchValue, options = {}) {
    setAppearance((current) => normalizeReportPalette({ ...current, ...patchValue }));
    if (options.globalLogo && isAdmin && Object.prototype.hasOwnProperty.call(patchValue, "reportLogoDataUrl")) {
      persistGlobalAppearancePatch({ reportLogoDataUrl: patchValue.reportLogoDataUrl || "" })
        .then(() => setMessage(patchValue.reportLogoDataUrl ? "تم حفظ شعار التقارير لجميع المستخدمين." : "تم حذف شعار التقارير العام."))
        .catch((error) => setMessage(`تعذر حفظ الشعار العام: ${safeErrorMessage(error)}`));
    }
  }

  async function refreshUsers() {
    try {
      const client = hasSupabaseConfig() ? getSupabaseClient() : null;
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

  function applyBrowserServerStatus(status = {}) {
    setBrowserServerStatus({
      state: status.state || (status.ok ? "running" : "stopped"),
      ok: status.ok === true,
      url: status.url || "http://127.0.0.1:5174/",
      error: status.error || "",
      logs: status.logs || []
    });
  }

  async function readBrowserServerStatus() {
    if (!window.glassOrdersDesktop?.browserServerStatus) {
      applyBrowserServerStatus({
        state: "unavailable",
        error: "تشغيل التطبيق في المتصفح متاح من نسخة سطح المكتب فقط.",
        logs: ["هذه الوظيفة متاحة من تطبيق سطح المكتب فقط."]
      });
      return;
    }
    try {
      applyBrowserServerStatus(await window.glassOrdersDesktop.browserServerStatus());
    } catch (error) {
      applyBrowserServerStatus({ state: "error", error: safeErrorMessage(error) });
    }
  }

  async function startBrowserServerFromSettings() {
    if (!window.glassOrdersDesktop?.startBrowserServer) {
      setMessage("تشغيل التطبيق في المتصفح متاح من نسخة سطح المكتب فقط.");
      return;
    }
    setBrowserServerBusy(true);
    try {
      const status = await window.glassOrdersDesktop.startBrowserServer();
      applyBrowserServerStatus(status);
      setMessage(status?.ok ? `تم تشغيل التطبيق في المتصفح: ${status.url}` : `تعذر تشغيل التطبيق في المتصفح: ${status?.error || "خطأ غير معروف"}`);
    } catch (error) {
      setMessage(`تعذر تشغيل التطبيق في المتصفح: ${safeErrorMessage(error)}`);
    } finally {
      setBrowserServerBusy(false);
    }
  }

  async function openBrowserServerFromSettings() {
    if (!window.glassOrdersDesktop?.openBrowserServer) {
      setMessage("فتح التطبيق في المتصفح متاح من نسخة سطح المكتب فقط.");
      return;
    }
    setBrowserServerBusy(true);
    try {
      const status = await window.glassOrdersDesktop.openBrowserServer();
      applyBrowserServerStatus(status);
      setMessage(status?.ok ? `تم فتح المتصفح على ${status.url}` : `تعذر فتح التطبيق في المتصفح: ${status?.error || "خطأ غير معروف"}`);
    } catch (error) {
      setMessage(`تعذر فتح التطبيق في المتصفح: ${safeErrorMessage(error)}`);
    } finally {
      setBrowserServerBusy(false);
    }
  }

  async function stopBrowserServerFromSettings() {
    if (!window.glassOrdersDesktop?.stopBrowserServer) {
      setMessage("إيقاف خادم المتصفح متاح من نسخة سطح المكتب فقط.");
      return;
    }
    setBrowserServerBusy(true);
    try {
      const status = await window.glassOrdersDesktop.stopBrowserServer();
      applyBrowserServerStatus(status);
      setMessage("تم إيقاف خادم المتصفح المحلي.");
    } catch (error) {
      setMessage(`تعذر إيقاف خادم المتصفح: ${safeErrorMessage(error)}`);
    } finally {
      setBrowserServerBusy(false);
    }
  }

  async function copyBrowserServerLink() {
    try {
      await navigator.clipboard?.writeText?.(browserServerStatus.url || "http://127.0.0.1:5174/");
      setMessage("تم نسخ رابط التطبيق في المتصفح.");
    } catch {
      setMessage(browserServerStatus.url || "http://127.0.0.1:5174/");
    }
  }

  async function startLocalServerFromDesktop() {
    if (!window.glassOrdersDesktop?.startLocalServer) return null;
    const result = await window.glassOrdersDesktop.startLocalServer();
    await new Promise((resolve) => window.setTimeout(resolve, 1200));
    return result;
  }

  async function stopLocalServerFromDesktop() {
    if (!window.glassOrdersDesktop?.stopLocalServer) return null;
    const result = await window.glassOrdersDesktop.stopLocalServer();
    setLocalStatus(null);
    setMessage("تم إيقاف الخادم المحلي.");
    return result;
  }

  function applyTelegramBotSettings(settings) {
    const normalized = normalizePublicBotSettings(settings);
    setBotSettings(normalized);
    return normalized;
  }

  function applyTelegramBotStatus(status) {
    const safeStatus = status || { running: false };
    setBotStatus(safeStatus);
    if (safeStatus.settings) {
      applyTelegramBotSettings(safeStatus.settings);
    }
  }

  async function readTelegramBotSettings() {
    if (!window.glassOrdersDesktop?.telegramBotSettings) {
      applyTelegramBotSettings(readBrowserBotSettings());
      return;
    }
    try {
      applyTelegramBotSettings(await window.glassOrdersDesktop.telegramBotSettings());
    } catch {
      applyTelegramBotSettings(readBrowserBotSettings());
    }
  }

  async function readTelegramBotStatus() {
    if (window.glassOrdersDesktop?.telegramBotStatus) {
      try {
        applyTelegramBotStatus(await window.glassOrdersDesktop.telegramBotStatus());
        return;
      } catch {
        applyTelegramBotStatus({ running: false });
      }
    }
    applyTelegramBotStatus({ running: false, state: "stopped" });
  }

  function requireAdminBotControl() {
    if (isAdmin) return true;
    setMessage("تشغيل وإيقاف بوت Telegram متاح للمدير فقط.");
    return false;
  }

  async function saveBotStartupSettings(patch = {}) {
    if (!requireAdminBotControl()) return;
    if (!window.glassOrdersDesktop) {
      setMessage("إعدادات البوت متاحة من تطبيق Windows.");
      return;
    }
    const nextPatch = { ...patch };
    if (nextPatch.openAtLogin === true) {
      nextPatch.enabled = true;
      nextPatch.startHiddenAtLogin = true;
    }
    if (nextPatch.enabled === false) nextPatch.openAtLogin = false;
    if ((nextPatch.enabled || nextPatch.openAtLogin) && window.glassOrdersDesktop && !botSettings.hasBotToken) {
      setMessage("إعداد البوت غير مكتمل. أعد تشغيل البرنامج، وإن استمرت المشكلة راجع مسؤول النظام.");
      return;
    }
    setBusy(true);
    try {
      let settings;
      if (window.glassOrdersDesktop?.updateTelegramBotSettings) {
        settings = await window.glassOrdersDesktop.updateTelegramBotSettings(nextPatch);
        if (settings.enabled) {
          const session = await currentTelegramSupabaseSession();
          const status = await window.glassOrdersDesktop.syncTelegramBotSession(session);
          applyTelegramBotStatus(status);
          settings = status?.settings || settings;
        }
      } else {
        settings = saveBrowserBotSettings(nextPatch);
      }
      const normalized = applyTelegramBotSettings(settings);
      setBotStatus((current) => ({ ...current, settings: normalized }));
      setMessage("تم حفظ إعدادات تشغيل بوت Telegram.");
    } catch (error) {
      setMessage(`تعذر حفظ إعدادات البوت: ${safeErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function startTelegramBotFromSettings() {
    if (!requireAdminBotControl()) return;
    if (!window.glassOrdersDesktop) {
      setMessage("تشغيل البوت متاح من تطبيق Windows.");
      return;
    }
    if (window.glassOrdersDesktop && !botSettings.hasBotToken) {
      setMessage("إعداد البوت غير مكتمل. أعد تشغيل البرنامج، وإن استمرت المشكلة راجع مسؤول النظام.");
      return;
    }
    setBusy(true);
    try {
      const session = await currentTelegramSupabaseSession();
      const result = await window.glassOrdersDesktop.startTelegramBot({ ...session, remember: true });
      if (result?.state === "failed") {
        throw new Error("تعذر بدء البوت.");
      }
      applyTelegramBotStatus(result || { running: true, settings: { ...botSettings, enabled: true, hasSupabaseSession: true } });
      setMessage("تم تشغيل بوت Telegram وتذكر الاختيار.");
    } catch (error) {
      setMessage(`تعذر تشغيل بوت Telegram. ${/جلسة|سجل الدخول/.test(safeErrorMessage(error)) ? safeErrorMessage(error) : "أعد تشغيل البرنامج وحاول مرة أخرى."}`);
    } finally {
      setBusy(false);
      await readTelegramBotStatus();
    }
  }

  async function stopTelegramBotFromSettings() {
    if (!requireAdminBotControl()) return;
    if (!window.glassOrdersDesktop) {
      setMessage("إيقاف البوت متاح من تطبيق Windows.");
      return;
    }
    setBusy(true);
    try {
      const result = await window.glassOrdersDesktop.stopTelegramBot({ remember: true });
      applyTelegramBotStatus(result || { running: false, settings: { ...botSettings, enabled: false, openAtLogin: false } });
      setMessage("تم إيقاف بوت Telegram وإلغاء تشغيله التلقائي.");
    } catch (error) {
      setMessage(`تعذر إيقاف بوت Telegram: ${safeErrorMessage(error)}`);
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
      setMessage(`القاعدة المحلية تعمل. تم تجهيز ${result.importedOrders} طلب و ${result.importedRows} صف من ملف الإكسل.`);
    } catch (error) {
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
    if (window.glassOrdersDesktop?.authRecoveryRedirectUrl === DESKTOP_AUTH_RECOVERY_REDIRECT_URL) {
      localStorage.removeItem("glassOrdersSupabaseRedirectUrl");
    } else {
      localStorage.setItem("glassOrdersSupabaseRedirectUrl", supabaseForm.redirectUrl.trim());
    }
    resetSupabaseClientCache();
    setDataSourceMode("supabase");
    setSourceMode("supabase");
    setUseLocalServer(false);
    setMessage("تم حفظ إعدادات الاتصال.");
  }

  async function checkSupabaseConnection() {
    setBusy(true);
    try {
      saveSupabaseSettings();
      const client = getSupabaseClient();
      if (!client) throw new Error("بيانات الاتصال غير مكتملة.");
      const [orders, usersResult] = await Promise.all([
        client.from("glass_orders").select("id", { count: "exact", head: true }),
        client.from("users").select("id", { count: "exact", head: true })
      ]);
      if (orders.error) throw orders.error;
      if (usersResult.error) throw usersResult.error;
      await refreshAll();
      await refreshUsers();
      setMessage(`الاتصال يعمل. الطلبات: ${orders.count ?? 0}، المستخدمون: ${usersResult.count ?? 0}.`);
    } catch (error) {
      setMessage(`تعذر الاتصال: ${safeErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function addUser(event) {
    preventCancelableDefault(event);
    setBusy(true);
    try {
      let user;
      const client = hasSupabaseConfig() ? getSupabaseClient() : null;
      if (client) {
        const payload = {
          username: cleanName(newUser.username),
          display_name: cleanName(newUser.display_name),
          email: cleanName(newUser.email).toLocaleLowerCase() || null,
          role: newUser.role === "admin" ? "admin" : "user",
          can_view_costs: newUser.role === "admin" || newUser.can_view_costs === true,
          is_active: newUser.is_active === false ? false : true
        };
        const password = String(newUser.password || "");
        if (!payload.username || !payload.display_name || !payload.email || password.length < 10) {
          throw new Error("اكتب اسم الدخول والاسم والبريد وكلمة مرور لا تقل عن 10 أحرف.");
        }
        const result = await invokeGlassAuth("admin-create-user", { profile: payload, password });
        user = result.profile;
        if (!user?.id) throw new Error("لم تُرجع خدمة المستخدمين ملفاً صالحاً.");
      } else {
        user = await localRequest("/api/users", { method: "POST", body: JSON.stringify(newUser) }, 8000);
      }
      setUsers((current) => [...current, user]);
      setData((current) => ({ ...current, users: [...(current.users || []), user] }));
      setNewUser({ username: "", display_name: "", email: "", password: "", role: "user", can_view_costs: false, is_active: true });
      setMessage(client
        ? "تم إنشاء المستخدم، ويمكنه تسجيل الدخول باسم المستخدم وكلمة المرور."
        : "تم إضافة المستخدم.");
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
      const client = hasSupabaseConfig() ? getSupabaseClient() : null;
      if (client) {
        const patch = { ...editingUser };
        if (patch.username !== undefined) patch.username = cleanName(patch.username);
        if (patch.display_name !== undefined) patch.display_name = cleanName(patch.display_name);
        if (patch.email !== undefined) patch.email = cleanName(patch.email).toLocaleLowerCase() || null;
        const newPassword = String(patch.password || "");
        delete patch.password;
        if (newPassword && newPassword.length < 10) throw new Error("كلمة المرور الجديدة يجب ألا تقل عن 10 أحرف.");
        const result = await invokeGlassAuth("admin-update-user", {
          profileId: userId,
          patch,
          newPassword
        });
        updated = result.profile;
        if (!updated?.id) throw new Error("لم تُرجع خدمة المستخدمين ملفاً صالحاً.");
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
    const confirmed = window.confirm("إيقاف هذا المستخدم؟");
    restoreRendererInputFocus();
    if (!confirmed) return;
    setBusy(true);
    try {
      const client = hasSupabaseConfig() ? getSupabaseClient() : null;
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
      restoreRendererInputFocus();
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
    const confirmed = window.confirm(`حذف المستخدم ${user.username} نهائياً من قاعدة التطبيق؟`);
    restoreRendererInputFocus();
    if (!confirmed) return;
    setBusy(true);
    try {
      const client = hasSupabaseConfig() ? getSupabaseClient() : null;
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
      restoreRendererInputFocus();
    }
  }

  async function changeMyPassword(event) {
    preventCancelableDefault(event);
    if (!currentUser?.id) return;
    setBusy(true);
    try {
      const client = hasSupabaseConfig() ? getSupabaseClient() : null;
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

  async function chooseReportDirectory() {
    if (!window.glassOrdersDesktop?.selectDirectory) {
      setMessage("اختيار مجلد الحفظ متاح في نسخة سطح المكتب.");
      return;
    }
    setBusy(true);
    try {
      const result = await window.glassOrdersDesktop.selectDirectory({ defaultPath: reportSaveSettings.directory || reportSaveSettings.lastDirectory || "" });
      if (result?.canceled) return;
      if (!result?.directory) throw new Error("لم يتم اختيار مجلد.");
      const validation = await window.glassOrdersDesktop.validateDirectory({ directory: result.directory });
      if (!validation?.ok) throw new Error(validation?.error || "المجلد غير قابل للكتابة.");
      setReportSaveSettings((current) => ({ ...current, directory: result.directory }));
      setMessage(`تم اختيار مجلد حفظ التقارير: ${result.directory}`);
    } catch (error) {
      setMessage(`تعذر اختيار مجلد التقارير: ${safeErrorMessage(error)}`);
    } finally {
      setBusy(false);
      restoreRendererInputFocus();
    }
  }

  function clearReportDirectory() {
    setReportSaveSettings((current) => ({ ...current, directory: "" }));
    setMessage("تم إلغاء مجلد الحفظ الافتراضي. سيظهر مربع حفظ الملفات عند التصدير.");
    restoreRendererInputFocus();
  }

  const browserServerStateLabel = {
    stopped: "متوقف",
    starting: "جاري التشغيل",
    running: "يعمل",
    stopping: "جاري الإيقاف",
    error: "حدث خطأ",
    unavailable: "غير متاح"
  }[browserServerStatus.state] || "متوقف";
  const browserServerRunning = browserServerStatus.state === "running";
  const browserServerTransitioning = browserServerBusy || ["starting", "stopping"].includes(browserServerStatus.state);

  return (
    <div className="settings-stack">
      <section className="panel update-panel">
        <div className="panel-head">
          <div>
            <h2><Download size={18} /> تحديث البرنامج</h2>
            <p dir="ltr">{FULL_APP_NAME} — Version {appVersion}</p>
          </div>
          <div className="actions">
            <button className="primary" type="button" onClick={onCheckUpdates} disabled={checkingUpdates}>
              {checkingUpdates ? <Loader2 size={18} className="spin" /> : <RefreshCw size={18} />}
              فحص التحديث
            </button>
            {availableUpdate && (
              <button className="primary" type="button" onClick={onOpenUpdate}>
                <Download size={18} />{updateActionLabel(availableUpdate)}
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2><FolderOpen size={18} /> حفظ التقارير</h2>
            <p>اختر مكان حفظ التقارير وإعدادات الحفظ.</p>
          </div>
          <div className="actions">
            <button type="button" onClick={chooseReportDirectory} disabled={busy}><FolderOpen size={18} />اختيار مجلد</button>
            {reportSaveSettings.directory && <button type="button" onClick={clearReportDirectory} disabled={busy}><XCircle size={18} />إلغاء المجلد</button>}
          </div>
        </div>
        <div className="settings-grid">
          <Field label="مجلد حفظ التقارير">
            <input dir="ltr" value={reportSaveSettings.directory || "سيظهر مربع الحفظ عند التصدير"} readOnly />
          </Field>
          <label className="check-setting">
            <input type="checkbox" checked={reportSaveSettings.openPdfAfterSave} onChange={(event) => setReportSaveSettings((current) => ({ ...current, openPdfAfterSave: event.target.checked }))} />
            فتح PDF بعد الحفظ للمراجعة
          </label>
          <SupplierSubfolderPicker
            suppliers={data.suppliers}
            selectedIds={reportSaveSettings.supplierSubfolderIds}
            selectedNames={reportSaveSettings.supplierSubfolderNames}
            onChange={({ ids, names }) => setReportSaveSettings((current) => ({ ...current, supplierSubfolderIds: ids, supplierSubfolderNames: names }))}
          />
          <p className="hint">تُحفظ تقارير الموردين المحددين في مجلدات منفصلة.</p>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2><Monitor size={18} /> الوصول من المتصفح</h2>
            <p>افتح البرنامج في المتصفح على هذا الجهاز عند الحاجة.</p>
          </div>
          {browserServerTransitioning && <Loader2 size={20} className="spin" />}
        </div>
        <div className="settings-grid">
          <div className="server-card">
            <Monitor size={22} />
            <div>
              <strong>الحالة: {browserServerStateLabel}</strong>
              <span>{browserServerRunning ? "جاهز للاستخدام" : (browserServerStatus.error || "متاح من تطبيق Windows")}</span>
            </div>
          </div>
          <div className="actions">
            <button className="primary" type="button" onClick={startBrowserServerFromSettings} disabled={browserServerTransitioning}>
              {browserServerTransitioning && browserServerStatus.state === "starting" ? <Loader2 size={18} className="spin" /> : <Monitor size={18} />}
              تشغيل التطبيق في المتصفح
            </button>
            <button type="button" onClick={openBrowserServerFromSettings} disabled={browserServerTransitioning || !browserServerRunning}><FolderOpen size={18} />فتح في المتصفح</button>
            <button type="button" onClick={copyBrowserServerLink} disabled={!browserServerRunning}><Copy size={18} />نسخ الرابط</button>
            <button type="button" onClick={stopBrowserServerFromSettings} disabled={browserServerTransitioning || !browserServerRunning}><PowerOff size={18} />إيقاف الوصول</button>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2><Palette size={18} /> المظهر والهوية</h2>
          <div className="actions">
            <button type="button" onClick={() => patchAppearance(DEFAULT_REPORT_PALETTE)}>
              <RefreshCw size={16} />استعادة الألوان الافتراضية
            </button>
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
            description="هذا الشعار يظهر في رأس تقارير PDF والطباعة."
            onLogo={(reportLogoDataUrl) => patchAppearance({ reportLogoDataUrl }, { globalLogo: true })}
            onReset={() => patchAppearance({ reportLogoDataUrl: "" }, { globalLogo: true })}
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
          <Field label="خلفية التقرير">
            <input type="color" value={appearance.reportPageBackground || DEFAULT_REPORT_PALETTE.reportPageBackground} onChange={(event) => patchAppearance({ reportPageBackground: event.target.value })} />
          </Field>
          <Field label="لون نص التقرير">
            <input type="color" value={appearance.reportTextColor || DEFAULT_REPORT_PALETTE.reportTextColor} onChange={(event) => patchAppearance({ reportTextColor: event.target.value })} />
          </Field>
          <Field label="خلفية رأس التقرير">
            <input type="color" value={appearance.reportHeaderBg || DEFAULT_REPORT_PALETTE.reportHeaderBg} onChange={(event) => patchAppearance({ reportHeaderBg: event.target.value })} />
          </Field>
          <Field label="لون نص رأس التقرير">
            <input type="color" value={appearance.reportHeaderColor || DEFAULT_REPORT_PALETTE.reportHeaderColor} onChange={(event) => patchAppearance({ reportHeaderColor: event.target.value })} />
          </Field>
          <Field label="لون حدود التقرير">
            <input type="color" value={appearance.reportBorderColor || DEFAULT_REPORT_PALETTE.reportBorderColor} onChange={(event) => patchAppearance({ reportBorderColor: event.target.value })} />
          </Field>
          <Field label="خلفية صفوف التقرير">
            <input type="color" value={appearance.reportRowBackground || DEFAULT_REPORT_PALETTE.reportRowBackground} onChange={(event) => patchAppearance({ reportRowBackground: event.target.value })} />
          </Field>
          <Field label="خلفية الصف البديل">
            <input type="color" value={appearance.reportAlternateRowBackground || DEFAULT_REPORT_PALETTE.reportAlternateRowBackground} onChange={(event) => patchAppearance({ reportAlternateRowBackground: event.target.value })} />
          </Field>
          <Field label="خلفية الإجمالي">
            <input type="color" value={appearance.reportTotalBackground || DEFAULT_REPORT_PALETTE.reportTotalBackground} onChange={(event) => patchAppearance({ reportTotalBackground: event.target.value })} />
          </Field>
          <Field label="لون تمييز التقرير">
            <input type="color" value={appearance.reportAccentColor || DEFAULT_REPORT_PALETTE.reportAccentColor} onChange={(event) => patchAppearance({ reportAccentColor: event.target.value })} />
          </Field>
        </div>
      </section>

      {isAdmin && <section className="panel">
        <div className="panel-head">
          <div>
            <h2>مصدر بيانات الطلبات</h2>
            <p>استخدم الاتصال المباشر في الوضع المعتاد، أو اختر البيانات المحلية عند الحاجة.</p>
          </div>
        </div>
        <div className="settings-grid">
          <Field label="مصدر البيانات">
            <select value={sourceMode} onChange={(event) => {
              const mode = event.target.value;
              setSourceMode(mode);
              setUseLocalServer(mode === "local");
              setDataSourceMode(mode);
            }}>
              <option value="supabase">اتصال مباشر</option>
              <option value="local" disabled={!localServerAllowed()}>بيانات محلية</option>
              <option value="browser">بيانات محفوظة في المتصفح</option>
            </select>
          </Field>
          <Field label="عنوان البيانات المحلية">
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
              <strong>{localStatus?.ok ? "البيانات المحلية جاهزة" : "البيانات المحلية متوقفة"}</strong>
              <span>{localStatus?.ok ? "جاهزة للاستخدام" : "اختيارية"}</span>
            </div>
          </div>
          <div className="actions">
            <button className="primary" onClick={saveLocalAndPrepare} disabled={busy || !localServerAllowed()}><Save size={18} />حفظ وتشغيل</button>
            <button onClick={stopLocalServerFromDesktop} disabled={busy || !localServerAllowed()}><PowerOff size={18} />إيقاف</button>
            <button onClick={checkLocalServer} disabled={busy || !localServerAllowed()}><RefreshCw size={18} />فحص الاتصال</button>
          </div>
        </div>
      </section>}

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2><Bot size={18} /> بوت Telegram</h2>
            <p>{isAdmin ? "شغّل البوت لمتابعة الطلبات والتقارير عبر Telegram." : "يمكنك متابعة حالة البوت هنا."}</p>
          </div>
          {isAdmin ? (
            <div className="actions">
              <button className="primary" type="button" onClick={startTelegramBotFromSettings} disabled={busy || botStatus?.running || !window.glassOrdersDesktop}>
                <Power size={18} />تشغيل البوت
              </button>
              <button className="danger" type="button" onClick={stopTelegramBotFromSettings} disabled={busy || !botStatus?.running || !window.glassOrdersDesktop}>
                <PowerOff size={18} />إيقاف البوت
              </button>
            </div>
          ) : null}
        </div>
        <div className="settings-grid">
          <div className="server-card">
            <Bot size={22} />
            <div>
              <strong>{telegramBotStateLabel(botStatus)}</strong>
              <span>
                {botStatus?.running
                  ? "يستقبل الطلبات عبر Telegram."
                  : !window.glassOrdersDesktop
                    ? "تشغيل البوت متاح من تطبيق Windows."
                    : !botSettings.hasBotToken
                      ? "إعداد البوت غير مكتمل. راجع مسؤول النظام."
                      : botStatus?.state === "waiting_for_session"
                        ? "سجل الدخول لتشغيل البوت."
                        : "اضغط تشغيل البوت للبدء."}
              </span>
            </div>
          </div>
          {isAdmin ? (
            <>
              <label className="toggle-line">
                <input
                  type="checkbox"
                  checked={botSettings.enabled}
                  disabled={busy || !window.glassOrdersDesktop}
                  onChange={(event) => saveBotStartupSettings(event.target.checked ? { enabled: true } : { enabled: false })}
                />
                تذكر تشغيل البوت عند فتح البرنامج
              </label>
              <label className="toggle-line">
                <input
                  type="checkbox"
                  checked={botSettings.openAtLogin}
                  disabled={busy || !window.glassOrdersDesktop || !botSettings.canOpenAtLogin || !botSettings.enabled}
                  onChange={(event) => saveBotStartupSettings({ openAtLogin: event.target.checked })}
                />
                تشغيل مع Windows في الخلفية
              </label>
            </>
          ) : (
            <div className="server-card">
              <KeyRound size={22} />
              <div>
                <strong>تحكم المدير فقط</strong>
                <span>سجل الدخول بحساب مدير لتشغيل أو إيقاف بوت Telegram.</span>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>إعدادات الاتصال</h2></div>
        <div className="settings-grid">
          <Field label="رابط الاتصال">
            <input type="password" dir="ltr" value={supabaseForm.url} onChange={(event) => setSupabaseForm((current) => ({ ...current, url: event.target.value }))} autoComplete="off" placeholder="https://***.supabase.co" />
          </Field>
          <Field label="مفتاح الاتصال">
            <input type="password" dir="ltr" value={supabaseForm.key} onChange={(event) => setSupabaseForm((current) => ({ ...current, key: event.target.value }))} autoComplete="off" placeholder="eyJ..." />
          </Field>
          <Field label="رابط استعادة كلمة المرور">
            <input
              type="text"
              dir="ltr"
              value={window.glassOrdersDesktop?.authRecoveryRedirectUrl === DESKTOP_AUTH_RECOVERY_REDIRECT_URL ? DESKTOP_AUTH_RECOVERY_REDIRECT_URL : supabaseForm.redirectUrl}
              readOnly={window.glassOrdersDesktop?.authRecoveryRedirectUrl === DESKTOP_AUTH_RECOVERY_REDIRECT_URL}
              onChange={(event) => setSupabaseForm((current) => ({ ...current, redirectUrl: event.target.value }))}
              autoComplete="off"
              placeholder="اختياري في المتصفح"
            />
          </Field>
          <div className="actions">
            <button onClick={saveSupabaseSettings}><Save size={18} />حفظ الاتصال</button>
            <button onClick={checkSupabaseConnection} disabled={busy}><RefreshCw size={18} />فحص الاتصال</button>
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
                <input type="email" dir="ltr" value={newUser.email} onChange={(event) => setNewUser({ ...newUser, email: event.target.value })} required={hasSupabaseConfig()} />
              </Field>
              <Field label="الاسم في التقارير">
                <input value={newUser.display_name} onChange={(event) => setNewUser({ ...newUser, display_name: event.target.value })} placeholder="John Doe" required />
              </Field>
              <Field label="كلمة المرور">
                <input type="password" minLength={10} value={newUser.password} onChange={(event) => setNewUser({ ...newUser, password: event.target.value })} required />
              </Field>
              <Field label="الدور">
                <select value={newUser.role} onChange={(event) => setNewUser({ ...newUser, role: event.target.value })}>
                  <option value="user">مستخدم</option>
                  <option value="admin">مدير</option>
                </select>
              </Field>
              <Field label="صلاحية التكلفة">
                <select value={String(newUser.role === "admin" || newUser.can_view_costs)} disabled={newUser.role === "admin"} onChange={(event) => setNewUser({ ...newUser, can_view_costs: event.target.value === "true" })}>
                  <option value="false">بدون تكلفة</option>
                  <option value="true">عرض التكلفة</option>
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
                    <th>عرض التكلفة</th>
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
                            <select value={String((editingUser.role ?? user.role) === "admin" || (editingUser.can_view_costs ?? user.can_view_costs) === true)} disabled={(editingUser.role ?? user.role) === "admin"} onChange={(event) => setEditingUser({ ...editingUser, can_view_costs: event.target.value === "true" })}>
                              <option value="false">لا</option>
                              <option value="true">نعم</option>
                            </select>
                          </td>
                          <td>
                            <select value={String(editingUser.is_active ?? user.is_active)} onChange={(event) => setEditingUser({ ...editingUser, is_active: event.target.value === "true" })}>
                              <option value="true">نشط</option>
                              <option value="false">موقوف</option>
                            </select>
                          </td>
                          <td>
                            <input
                              type="password"
                              minLength={10}
                              value={editingUser.password || ""}
                              onChange={(event) => setEditingUser({ ...editingUser, password: event.target.value })}
                              required={hasSupabaseConfig() && !user.auth_user_id}
                              placeholder={hasSupabaseConfig() && !user.auth_user_id ? "مطلوبة لربط الحساب" : "اتركها فارغة دون تغيير"}
                            />
                          </td>
                          <td dir="ltr">{user.last_login_at ? formatReceiptHistoryTime(user.last_login_at) : "—"}</td>
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
                          <td>{canCurrentUserViewCosts(user) ? "نعم" : "لا"}</td>
                          <td>{user.is_active === false ? "موقوف" : "نشط"}</td>
                           <td>{hasSupabaseConfig()
                            ? user.auth_user_id
                              ? "الحساب جاهز"
                              : "يحتاج كلمة مرور جديدة"
                            : ""}</td>
                          <td dir="ltr">{user.last_login_at ? formatReceiptHistoryTime(user.last_login_at) : "—"}</td>
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

function Field({ label, children, fieldKey = "", invalid = false }) {
  return <label className={invalid ? "field invalid-field" : "field"} {...(fieldKey ? { "data-order-field": fieldKey } : {})}><span>{label}</span>{children}</label>;
}

function SupplierSubfolderPicker({ suppliers = [], selectedIds = [], selectedNames = [], onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selectedIdSet = useMemo(() => new Set((selectedIds || []).map(String)), [selectedIds]);
  const selectedNameSet = useMemo(() => new Set((selectedNames || []).map((name) => cleanName(name).toLocaleLowerCase())), [selectedNames]);
  const options = useMemo(() => {
    const seen = new Set();
    return (suppliers || [])
      .map((supplier) => ({ id: supplier.id || "", name: cleanName(supplier.name || supplier.supplierName || "") }))
      .filter((supplier) => {
        if (!supplier.name) return false;
        const key = supplier.id || supplier.name.toLocaleLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }, [suppliers]);
  const filtered = options.filter((supplier) => !query || supplier.name.toLocaleLowerCase().includes(cleanName(query).toLocaleLowerCase()));
  const selectedCount = options.filter((supplier) => selectedIdSet.has(String(supplier.id)) || selectedNameSet.has(supplier.name.toLocaleLowerCase())).length;
  function emit(nextOptions) {
    onChange?.({
      ids: nextOptions.filter((supplier) => supplier.id).map((supplier) => String(supplier.id)),
      names: nextOptions.map((supplier) => supplier.name)
    });
  }
  function selectedSupplierOptions() {
    return options.filter((supplier) => selectedIdSet.has(String(supplier.id)) || selectedNameSet.has(supplier.name.toLocaleLowerCase()));
  }
  function toggleSupplier(supplier) {
    const keyId = String(supplier.id || "");
    const keyName = supplier.name.toLocaleLowerCase();
    const exists = selectedIdSet.has(keyId) || selectedNameSet.has(keyName);
    const current = selectedSupplierOptions();
    emit(exists
      ? current.filter((item) => String(item.id || "") !== keyId && item.name.toLocaleLowerCase() !== keyName)
      : [...current, supplier]);
  }
  return (
    <div className="supplier-folder-picker">
      <button type="button" className="supplier-folder-trigger" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span>مجلدات منفصلة للموردين</span>
        <strong>{selectedCount ? `تم تحديد ${selectedCount}` : "لا يوجد موردون محددون"}</strong>
      </button>
      {open && (
        <div className="supplier-folder-menu">
          <div className="supplier-folder-actions">
            <button type="button" onClick={() => emit(options)}>تحديد الكل</button>
            <button type="button" onClick={() => emit([])}>إلغاء تحديد الكل</button>
          </div>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="بحث عن مورد" />
          <div className="supplier-folder-options">
            {filtered.map((supplier) => {
              const checked = selectedIdSet.has(String(supplier.id || "")) || selectedNameSet.has(supplier.name.toLocaleLowerCase());
              return (
                <label key={supplier.id || supplier.name} className="supplier-folder-option">
                  <input type="checkbox" checked={checked} onChange={() => toggleSupplier(supplier)} />
                  <span>{supplier.name}</span>
                </label>
              );
            })}
            {!filtered.length && <p className="hint">لا توجد موردون مطابقون.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function Combo({ value, options, onChange, className = "", onSuggestionCommit, editing = true, ...inputProps }) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [placement, setPlacement] = useState("down");
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const optionRefs = useRef([]);
  const openTimerRef = useRef(null);
  const inputClass = [inputProps.className, className].filter(Boolean).join(" ");
  const cleanOptions = useMemo(() => uniqueValues(options), [options]);
  const query = cleanName(value).toLocaleLowerCase();
  const visibleOptions = useMemo(() => {
    const filtered = query
      ? cleanOptions.filter((option) => cleanName(option).toLocaleLowerCase().includes(query))
      : cleanOptions;
    return filtered.slice(0, 90);
  }, [cleanOptions, query]);
  useEffect(() => {
    function close(event) {
      if (!wrapRef.current?.contains(event.target)) setOpen(false);
    }
    function cancelTransientInteraction() {
      window.clearTimeout(openTimerRef.current);
      setOpen(false);
    }
    document.addEventListener("pointerdown", close);
    window.addEventListener("glass-orders-cancel-interactions", cancelTransientInteraction);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("glass-orders-cancel-interactions", cancelTransientInteraction);
    };
  }, []);
  useEffect(() => {
    setActiveIndex(0);
  }, [query, cleanOptions]);
  useEffect(() => {
    if (!open) return;
    const active = optionRefs.current[activeIndex];
    active?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, open]);
  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return undefined;
    function forceOpenCombo() {
      window.clearTimeout(openTimerRef.current);
      setOpen(true);
      window.requestAnimationFrame(() => inputRef.current?.focus?.());
    }
    node.addEventListener("glass-orders-open-combo", forceOpenCombo);
    return () => node.removeEventListener("glass-orders-open-combo", forceOpenCombo);
  }, []);
  useEffect(() => {
    if (!open) return undefined;
    function updatePlacement() {
      const rect = wrapRef.current?.getBoundingClientRect?.();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom;
      setPlacement(below < 260 && rect.top > below ? "up" : "down");
    }
    updatePlacement();
    window.addEventListener("resize", updatePlacement);
    window.addEventListener("scroll", updatePlacement, true);
    return () => {
      window.removeEventListener("resize", updatePlacement);
      window.removeEventListener("scroll", updatePlacement, true);
    };
  }, [open]);
  useEffect(() => () => window.clearTimeout(openTimerRef.current), []);
  function openWithNavigationDelay(event) {
    inputProps.onFocus?.(event);
    if (!editing) return;
    window.clearTimeout(openTimerRef.current);
    if (Date.now() < Number(window.__glassSuppressAutocompleteUntil || 0)) {
      setOpen(false);
      return;
    }
    const lastNavAt = Number(window.__glassSmartTableNavAt || 0);
    const delay = Date.now() - lastNavAt < 220 ? 3000 : 0;
    if (!delay) {
      setOpen(true);
      return;
    }
    openTimerRef.current = window.setTimeout(() => setOpen(true), delay);
  }
  function commit(nextValue, options = {}) {
    const shouldMoveAfterCommit = !!options.moveAfterCommit;
    if (inputRef.current) {
      inputRef.current.value = nextValue;
      if (typeof inputRef.current.setSelectionRange === "function") {
        const length = String(nextValue || "").length;
        inputRef.current.setSelectionRange(length, length);
      }
    }
    window.clearTimeout(openTimerRef.current);
    flushSync(() => setOpen(false));
    if (shouldMoveAfterCommit && onSuggestionCommit) {
      onSuggestionCommit(nextValue);
      return;
    }
    onChange(nextValue);
    window.setTimeout(() => {
      inputRef.current?.focus?.();
      if (typeof inputRef.current?.setSelectionRange === "function") {
        const length = String(nextValue || "").length;
        inputRef.current.setSelectionRange(length, length);
      }
    }, 0);
  }
  function handleKeyDown(event) {
    if (!editing) {
      inputProps.onKeyDown?.(event);
      return;
    }
    if (event.key === "Escape") {
      if (open) {
        preventCancelableDefault(event);
        setOpen(false);
      }
      return;
    }
    if (event.key === "ArrowDown") {
      preventCancelableDefault(event);
      setOpen(true);
      setActiveIndex((current) => visibleOptions.length ? Math.min(visibleOptions.length - 1, current + 1) : 0);
      return;
    }
    if (event.key === "ArrowUp") {
      preventCancelableDefault(event);
      setOpen(true);
      setActiveIndex((current) => Math.max(0, current - 1));
      return;
    }
    if (event.key === "Enter" && open && visibleOptions[activeIndex]) {
      preventCancelableDefault(event);
      event.__glassComboCommitted = true;
      if (event.nativeEvent) event.nativeEvent.__glassComboCommitted = true;
      commit(visibleOptions[activeIndex], { moveAfterCommit: true });
      return;
    }
    inputProps.onKeyDown?.(event);
  }
  return (
    <div className={open ? `combo open ${placement}` : "combo"} ref={wrapRef}>
      <input
        {...inputProps}
        ref={inputRef}
        className={inputClass}
        value={value || ""}
        onChange={(e) => {
          window.clearTimeout(openTimerRef.current);
        onChange(e.target.value);
          if (editing) setOpen(true);
        }}
        onFocus={openWithNavigationDelay}
        onBlur={(event) => {
          inputProps.onBlur?.(event);
          window.setTimeout(() => {
            if (!wrapRef.current?.contains(document.activeElement)) setOpen(false);
          }, 0);
        }}
        onKeyDown={handleKeyDown}
        dir={inputProps.dir || "auto"}
        autoComplete="off"
        aria-expanded={open}
        aria-autocomplete="list"
      />
      <button
        type="button"
        className="combo-toggle"
        tabIndex={-1}
        onPointerDown={(event) => {
          preventCancelableDefault(event);
          event.stopPropagation();
          if (!editing) return;
          window.clearTimeout(openTimerRef.current);
          setOpen((current) => !current);
          window.requestAnimationFrame(() => inputRef.current?.focus?.());
        }}
        onClick={(event) => {
          event.stopPropagation();
        }}
        aria-label="فتح القائمة"
      >
        ▾
      </button>
      {open && (
        <div className="combo-menu" role="listbox">
          {visibleOptions.length === 0 && (
            <button
              type="button"
              className="combo-option muted"
              onPointerDown={(event) => {
                preventCancelableDefault(event);
                event.stopPropagation();
              }}
              onClick={(event) => event.stopPropagation()}
            >
              لا توجد قيم مطابقة
            </button>
          )}
          {visibleOptions.map((option, optionIndex) => (
            <button
              key={option}
              type="button"
              ref={(node) => { optionRefs.current[optionIndex] = node; }}
              className={optionIndex === activeIndex ? "combo-option active" : "combo-option"}
              onMouseEnter={() => setActiveIndex(optionIndex)}
              onPointerDown={(event) => {
                preventCancelableDefault(event);
                event.stopPropagation();
                commit(option, { moveAfterCommit: false });
              }}
              onClick={(event) => event.stopPropagation()}
            >
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

function absoluteAssetUrl(value = "") {
  const source = String(value || "");
  if (!source || /^(data:|blob:|https?:|file:)/i.test(source)) return source;
  try {
    return new URL(source, window.location.href).toString();
  } catch {
    return source;
  }
}

function normalizePrintReportImages(root) {
  root.querySelectorAll("img").forEach((image) => {
    image.setAttribute("src", absoluteAssetUrl(image.getAttribute("src") || ""));
    image.removeAttribute("loading");
  });
}

function reportPrintCss() {
  const palette = normalizeReportPalette(readAppearanceSettings());
  return `
    @page { size: A4 portrait; margin: 12mm; }
    :root {
      --report-page-background: ${palette.reportPageBackground};
      --report-text: ${palette.reportTextColor};
      --report-muted-text: ${palette.reportMutedTextColor};
      --report-border: ${palette.reportBorderColor};
      --report-header-background: ${palette.reportHeaderBg};
      --report-header-text: ${palette.reportHeaderColor};
      --report-row-background: ${palette.reportRowBackground};
      --report-alternate-row-background: ${palette.reportAlternateRowBackground};
      --report-accent: ${palette.reportAccentColor};
      --report-total-background: ${palette.reportTotalBackground};
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: var(--report-page-background);
      color: var(--report-text);
      direction: rtl;
      font-family: "GlassOrdersCairo", "Segoe UI", Tahoma, Arial, sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    body {
      min-width: 0;
      font-size: 13px;
      line-height: 1.45;
    }
    .preview-page,
    .pdf-export-root,
    .report {
      width: 100%;
      max-width: 100%;
      background: var(--report-page-background);
      color: var(--report-text);
    }
    .report {
      position: relative;
      font-size: 13px;
      line-height: 1.45;
    }
    .report-header {
      direction: ltr;
      display: grid;
      grid-template-columns: 64px minmax(0, 1fr) 86px;
      grid-template-areas: "app copy main";
      align-items: center;
      gap: 16px;
      border-bottom: 2px solid var(--report-accent);
      padding-bottom: 12px;
      margin-bottom: 12px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .report-logo-main { grid-area: main; width: 82px; height: 82px; object-fit: contain; justify-self: end; }
    .report-logo-app { grid-area: app; width: 54px; height: 54px; object-fit: contain; justify-self: start; }
    .report-header > div { grid-area: copy; direction: rtl; text-align: right; min-width: 0; }
    .report-header strong,
    .report-header span {
      display: block;
      color: var(--report-accent);
      font-family: Georgia, "Times New Roman", serif;
      font-weight: 800;
    }
    .report-header h2 {
      margin: 6px 0 0;
      color: var(--report-text);
      font-family: "GlassOrdersCairo", "Segoe UI", Tahoma, Arial, sans-serif;
      font-size: 21px;
      line-height: 1.25;
    }
    .order-report-date {
      min-width: 210px;
      width: max-content;
      max-width: 100%;
      margin: -4px auto 10px 0;
      border: 1px solid var(--report-border);
      border-radius: 6px;
      background: var(--report-row-background);
      color: var(--report-text);
      padding: 6px 10px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      text-align: center;
      direction: rtl;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .order-report-date .date-label {
      color: var(--report-muted-text);
      font-size: 11px;
      font-weight: 800;
    }
    .order-report-date .date-value {
      color: var(--report-text);
      font-size: 12.5px;
      font-weight: 900;
      line-height: 1;
      direction: ltr;
      unicode-bidi: isolate;
      white-space: nowrap;
    }
    .report-timing {
      margin: 0 0 12px;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      color: var(--report-text);
      font-size: 11px;
      line-height: 1.25;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .order-status-report .report-timing {
      grid-template-columns: minmax(0, 1fr);
    }
    .report-date-card {
      min-width: 0;
      border: 1px solid var(--report-border);
      border-radius: 6px;
      padding: 7px 9px;
      background: var(--report-row-background);
      display: grid;
      grid-template-columns: 86px minmax(0, 1fr);
      gap: 4px 10px;
      align-items: center;
      direction: rtl;
    }
    .report-date-card strong {
      grid-row: 1 / span 2;
      color: var(--report-accent);
      white-space: nowrap;
    }
    .report-date-card span {
      min-width: 0;
      display: grid;
      grid-template-columns: minmax(0, 1fr) 54px;
      gap: 8px;
      align-items: center;
      direction: ltr;
    }
    .report-date-card bdi,
    .report-date-card small {
      white-space: nowrap;
      font-weight: 800;
    }
    .report-date-card bdi { justify-self: end; }
    .report-date-card small {
      justify-self: start;
      color: var(--report-muted-text);
    }
    .report-meta {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      margin-bottom: 12px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .report-meta span,
    .layer-specs p {
      border: 1px solid var(--report-border);
      border-radius: 6px;
      padding: 8px;
      background: var(--report-row-background);
      color: var(--report-text);
      text-align: right;
      font-weight: 700;
    }
    .report-table {
      display: grid;
      width: 100%;
      max-width: 100%;
      min-width: 0;
      border: 1px solid var(--report-border);
      border-radius: 6px;
      overflow: hidden;
      background: var(--report-row-background);
      color: var(--report-text);
      font-size: 12.5px;
      break-inside: auto;
      page-break-inside: auto;
    }
    .report-row {
      display: grid;
      width: 100%;
      max-width: 100%;
      min-width: 0;
      grid-template-columns: 1.2fr 1fr .7fr .8fr .8fr;
      background: var(--report-row-background);
      color: var(--report-text);
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .report-row:nth-child(even):not(.head):not(.subtotal):not(.total) {
      background: var(--report-alternate-row-background);
    }
    .report-row > span {
      min-width: 0;
      box-sizing: border-box;
      padding: 8px 9px;
      border-inline-start: 0;
      border-left: 1px solid var(--report-border);
      border-bottom: 1px solid var(--report-border);
      overflow-wrap: break-word;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      color: inherit;
    }
    .report-row:last-child > span { border-bottom: 0; }
    .report-row > span:first-child { border-inline-start: 0; }
    .report-row.head {
      background: var(--report-header-background);
      color: var(--report-header-text);
      font-weight: 900;
    }
    .report-row.subtotal,
    .report-row.total {
      background: var(--report-total-background);
      color: var(--report-text);
      font-weight: 900;
    }
    .order-report-row {
      grid-template-columns:
        minmax(40px, .42fr)
        minmax(0, 4.2fr)
        minmax(44px, .46fr)
        minmax(62px, .64fr)
        minmax(62px, .64fr)
        minmax(46px, .46fr)
        minmax(72px, .74fr);
    }
    .split-layer-report-group {
      grid-template-rows: repeat(var(--split-layer-count, 2), minmax(44px, auto));
      background: color-mix(in srgb, var(--report-row-background) 92%, #eaf3ff);
    }
    .split-layer-report-group > span {
      background: transparent;
    }
    .split-root-cell {
      grid-row: 1 / calc(var(--split-layer-count, 2) + 1);
      border-bottom: 2px solid var(--report-border);
      background: color-mix(in srgb, var(--report-row-background) 97%, #edf6ff);
    }
    .split-root-number {
      grid-column: 1;
      font-weight: 900;
    }
    .split-root-description {
      grid-column: 2;
      display: flex;
      flex-direction: column;
      align-items: stretch;
      justify-content: flex-start;
      text-align: right;
      gap: 0;
      padding: 0;
      line-height: 1.35;
      overflow-wrap: normal;
      word-break: normal;
    }
    .split-root-summary {
      display: block;
      width: 100%;
      padding: 7px 10px 6px;
      border-bottom: 0;
      color: var(--report-text);
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .split-root-code { grid-column: 3; }
    .split-layer-list {
      display: grid;
      grid-template-rows: repeat(var(--split-layer-count, 2), minmax(36px, 1fr));
      width: 100%;
      margin-top: 0;
      border-top: 0;
      color: #35506b;
      font-size: .82em;
      font-weight: 800;
      line-height: 1.25;
    }
    .split-layer-list-item {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      min-height: 36px;
      padding: 5px 10px;
      white-space: normal;
      overflow-wrap: anywhere;
      text-align: right;
      direction: rtl;
    }
    .split-layer-phrase {
      display: block;
      width: 100%;
      white-space: normal;
      overflow-wrap: anywhere;
      word-break: normal;
    }
    .split-layer-list-item:not(:last-child),
    .split-layer-value:not(.last) {
      border-bottom: 1px solid color-mix(in srgb, var(--report-border) 36%, transparent);
    }
    .split-layer-value {
      min-height: 44px;
      border-bottom-color: color-mix(in srgb, var(--report-border) 36%, transparent);
      background: color-mix(in srgb, var(--report-row-background) 95%, #eef7ff);
    }
    .split-layer-value.last {
      border-bottom-width: 2px;
      border-bottom-color: var(--report-border);
    }
    .order-status-report {
      min-width: 0;
      max-width: 100%;
    }
    .order-status-report-table.without-cost .order-status-report-row {
      grid-template-columns:
        minmax(0, .78fr)
        minmax(0, 1.38fr)
        minmax(0, .82fr)
        minmax(0, .74fr)
        minmax(0, 2.14fr)
        repeat(3, minmax(0, .54fr))
        minmax(0, .62fr)
        minmax(0, .82fr);
      font-size: 9.5px;
      line-height: 1.32;
    }
    .order-status-report-table.with-cost .order-status-report-row {
      grid-template-columns:
        minmax(0, .74fr)
        minmax(0, 1.28fr)
        minmax(0, .76fr)
        minmax(0, .7fr)
        minmax(0, 1.94fr)
        repeat(3, minmax(0, .5fr))
        minmax(0, .58fr)
        minmax(0, .74fr)
        minmax(0, .72fr);
      font-size: 9px;
      line-height: 1.3;
    }
    .order-status-report-row > span,
    .order-status-report-row > .report-glass-breakdown {
      padding: 6px 4px;
      overflow-wrap: break-word;
      word-break: normal;
      white-space: normal;
      letter-spacing: 0;
      border-inline-start: 1px solid var(--report-border);
      border-bottom: 1px solid var(--report-border);
    }
    .order-status-report-row.head > span,
    .order-status-report-row .keep-line {
      white-space: nowrap;
      overflow-wrap: normal;
      word-break: normal;
    }
    .report-order-number-cell {
      min-width: 0;
      justify-content: center;
    }
    .report-glass-breakdown {
      min-width: 0;
      display: grid !important;
      align-content: center;
      gap: 4px;
      white-space: normal;
    }
    .report-glass-breakdown > div {
      min-width: 0;
      display: grid;
      gap: 2px;
      padding-block: 3px;
    }
    .report-glass-breakdown > div + div {
      border-top: 1px dashed var(--report-border);
    }
    .report-glass-breakdown strong,
    .report-glass-breakdown span {
      min-width: 0;
      overflow-wrap: break-word;
      word-break: normal;
      letter-spacing: 0;
    }
    .report-glass-breakdown span {
      color: var(--report-muted-text);
      font-size: .9em;
    }
    .compact-report .order-status-report-row { grid-template-columns: 150px 112px minmax(190px, 1.25fr) 128px 72px 88px 116px; }
    .supplier-report-row { grid-template-columns: 118px minmax(230px, 1fr) 104px 104px 112px; }
    .order-status-report-row.subtotal .subtotal-label,
    .order-status-report-row.total .subtotal-label {
      grid-column: span 5;
      justify-content: center;
      text-align: center;
    }
    .order-status-report-row.supplier-subtotal {
      border-block: 1.5px solid var(--report-accent);
      background: color-mix(in srgb, var(--report-total-background) 82%, var(--report-row-background));
    }
    .supplier-report-row.total .subtotal-label,
    .statement-subtotal-label { grid-column: 1 / 3; justify-content: center; }
    .supplier-statement-opening-table { margin-bottom: 14px; }
    .supplier-statement-groups { display: grid; gap: 16px; }
    .supplier-statement-group {
      min-width: 0;
      display: grid;
      gap: 10px;
      break-inside: auto;
      page-break-inside: auto;
    }
    .supplier-statement-group-title {
      padding: 8px 10px;
      border: 1px solid var(--report-border);
      border-inline-start: 4px solid var(--report-accent);
      border-radius: 6px;
      display: grid;
      grid-template-columns: minmax(120px, 1fr) repeat(3, auto);
      gap: 12px;
      align-items: center;
      background: var(--report-total-background);
      color: var(--report-text);
      font-weight: 800;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .supplier-statement-group-title span { white-space: nowrap; }
    .supplier-statement-order-block {
      min-width: 0;
      break-inside: auto;
      page-break-inside: auto;
    }
    .supplier-statement-order-title {
      margin-bottom: 5px;
      padding: 7px 9px;
      border: 1px solid var(--report-border);
      border-radius: 6px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px 12px;
      background: var(--report-row-background);
      color: var(--report-text);
      font-weight: 700;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .supplier-statement-order-title > div {
      min-width: 0;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 12px;
    }
    .supplier-statement-order-summary-row {
      grid-template-columns: 112px 104px 112px minmax(180px, 1.5fr) 112px 110px;
    }
    .supplier-statement-detail-row {
      grid-template-columns: minmax(260px, 2fr) 135px 80px 100px 112px;
    }
    .supplier-statement-detail-row.subtotal .subtotal-label {
      grid-column: 1 / 5;
      justify-content: center;
    }
    .supplier-statement-detail-row .supplier-statement-empty {
      grid-column: 1 / -1;
      justify-content: center;
    }
    .supplier-statement-payment-row {
      grid-template-columns: 112px minmax(230px, 1.5fr) 135px 110px 126px;
    }
    .supplier-statement-payment-table,
    .supplier-statement-totals {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .supplier-statement-totals { margin-top: 16px; }
    .supplier-selected-final-row {
      grid-template-columns: minmax(240px, 1fr) 150px;
    }
    .supplier-selected-final-row > span:first-child {
      justify-content: flex-start;
      font-weight: 900;
    }
    .supplier-statement-empty {
      margin: 0;
      padding: 14px;
      border: 1px dashed var(--report-border);
      border-radius: 6px;
      background: var(--report-row-background);
      color: var(--report-muted-text);
      text-align: center;
      font-weight: 700;
    }
    .selected-orders-statement .supplier-statement-order-block {
      border-inline-start: 3px solid var(--report-accent);
      padding-inline-start: 8px;
    }
    .report button,
    .report-order-edit,
    .statement-order-edit,
    .supplier-statement-edit,
    [data-report-edit-order] { display: none !important; }
    .description-header,
    .description-cell,
    .code-header,
    .code-cell {
      border-color: var(--report-border);
    }
    .report-description {
      justify-content: flex-start;
      text-align: right;
      direction: rtl;
      unicode-bidi: plaintext;
      line-height: 1.45;
    }
    .keep-line,
    .report-row.head span {
      white-space: nowrap;
      overflow-wrap: normal;
      word-break: normal;
    }
    .thickness-mm {
      direction: rtl;
      unicode-bidi: isolate;
      display: inline-flex;
      flex-direction: row;
      align-items: baseline;
      gap: 0;
      white-space: nowrap;
      letter-spacing: 0 !important;
      word-spacing: 0 !important;
    }
    .thickness-number { direction: ltr; unicode-bidi: isolate; }
    .thickness-unit { direction: rtl; unicode-bidi: isolate; }
    .report-footer {
      margin-top: 18px;
      padding-top: 10px;
      border-top: 1px solid var(--report-border);
      display: flex;
      justify-content: space-between;
      gap: 12px;
      color: var(--report-accent);
      font-size: 12px;
      font-weight: 800;
      direction: ltr;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .drawing-report { display: grid; gap: 16px; margin-top: 18px; }
    .drawing-page {
      break-before: page;
      border-top: 2px solid var(--report-border);
      padding-top: 12px;
      background: var(--report-page-background);
      color: var(--report-text);
      break-inside: auto;
      page-break-inside: auto;
    }
    .drawing-page:first-child { break-before: auto; }
    .drawing-page-header {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      margin-bottom: 8px;
      color: var(--report-text);
      font-weight: 900;
    }
    .drawing-item-table {
      margin-bottom: 10px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .drawing-preview {
      width: 100%;
      max-height: 620px;
      border: 1px solid var(--report-border);
      background: #fff;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .panel-report-grid {
      display: grid;
      gap: 12px;
    }
    .panel-overall-layout {
      border: 1px solid var(--report-border);
      border-radius: 8px;
      padding: 10px;
      background: var(--report-row-background);
      color: var(--report-text);
      break-inside: avoid;
      page-break-inside: avoid;
      margin-bottom: 12px;
    }
    .panel-report-card {
      border: 1px solid var(--report-border);
      border-radius: 8px;
      padding: 10px;
      background: var(--report-row-background);
      color: var(--report-text);
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .panel-detail-page {
      break-before: page;
      page-break-before: always;
    }
    .panel-report-head {
      display: grid;
      grid-template-columns: 1fr auto auto auto;
      gap: 8px;
      align-items: center;
      margin-bottom: 8px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--report-border);
      font-weight: 900;
    }
    .panel-report-head span {
      color: var(--report-muted-text);
    }
    .panel-drawing-preview {
      max-height: 460px;
    }
    .panel-overall-preview {
      max-height: 520px;
    }
    .panel-report-note {
      margin: 8px 0 0;
      border: 1px solid var(--report-border);
      border-radius: 6px;
      padding: 7px 9px;
      background: #fff;
      color: var(--report-text);
      font-weight: 700;
    }
    .panel-title-label {
      fill: #0f172a;
      font-size: 26px;
      font-weight: 900;
      paint-order: stroke;
      stroke: rgba(255,255,255,.9);
      stroke-width: 5px;
      stroke-linejoin: round;
    }
    .drawing-work-area,
    .overall-work-area {
      fill: rgba(255,255,255,.18);
      stroke: rgba(37,99,166,.55);
      stroke-width: 1.2;
      stroke-dasharray: 12 10;
      vector-effect: non-scaling-stroke;
    }
    .hole-leader-labels line,
    .hole-leader-labels path,
    .detail-dimension line {
      stroke: #334155;
      stroke-width: 1;
      vector-effect: non-scaling-stroke;
    }
    .outline-total-dimensions line,
    .edge-dimension-lines line,
    .edge-dimension-lines path,
    .rect-side-dimensions line,
    .measurement-lines line {
      stroke: #a87827;
      stroke-width: 1;
      stroke-dasharray: 5 4;
      vector-effect: non-scaling-stroke;
    }
    .measurement-lines line {
      stroke: #475569;
    }
    .edge-notch-cut {
      fill: none;
      stroke: #087d45;
      stroke-width: 1.6;
      stroke-linecap: round;
      stroke-linejoin: round;
      vector-effect: non-scaling-stroke;
    }
    .hole-leader-labels text,
    .detail-dimension text {
      fill: #111827;
      font-weight: 900;
      paint-order: stroke;
      stroke: rgba(255,255,255,.9);
      stroke-width: 5px;
      stroke-linejoin: round;
    }
    .hole-leader-labels text { font-size: 24px; }
    .detail-dimension text { font-size: 18px; }
    .hole-detail-views {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 10px;
      margin-top: 10px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .hole-detail {
      border: 1px solid var(--report-border);
      border-radius: 6px;
      padding: 8px;
      background: #fff;
    }
    .hole-detail strong {
      display: block;
      margin-bottom: 6px;
      color: var(--report-text);
    }
    .hole-detail svg {
      width: 100%;
      max-height: 180px;
    }
    .layer-specs {
      display: grid;
      gap: 6px;
      margin-top: 10px;
      color: var(--report-text);
      font-size: 13px;
      font-weight: 700;
    }
    img { max-width: 100%; }
    svg { max-width: 100%; }
  `;
}

const REPORT_EDIT_CONTROL_SELECTOR = [
  ".report-order-edit",
  ".statement-order-edit",
  ".supplier-statement-edit",
  "[data-report-edit-order]",
  'button[title="تعديل الطلب"]'
].join(",");

function removeReportEditControls(root) {
  root?.querySelectorAll?.(REPORT_EDIT_CONTROL_SELECTOR).forEach((control) => control.remove());
}

function reportPrintDocumentHtml(element, fileName) {
  const clone = element.cloneNode(true);
  removeReportEditControls(clone);
  normalizePrintReportImages(clone);
  const title = String(fileName || `${FULL_APP_NAME} Report`).replace(/\.pdf$/i, "");
  return `<!doctype html>
    <html dir="rtl">
      <head>
        <meta charset="utf-8">
        <meta name="author" content="Y.D Software">
        <meta name="subject" content="Glass Purchase Order">
        <meta name="creator" content="${FULL_APP_NAME}">
        <title>${escapeHtml(title)}</title>
        <style>${reportPrintCss()}</style>
      </head>
      <body><main class="preview-page pdf-export-root">${clone.innerHTML}</main></body>
    </html>`;
}

function waitForFrameLoad(frame) {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => reject(new Error("تعذر تجهيز صفحة الطباعة.")), 8000);
    frame.onload = () => {
      window.clearTimeout(timeoutId);
      resolve();
    };
  });
}

async function printBrowserReportPdf(element, fileName) {
  const frame = document.createElement("iframe");
  frame.title = String(fileName || `${FULL_APP_NAME} PDF`);
  frame.style.position = "fixed";
  frame.style.left = "-200vw";
  frame.style.top = "0";
  frame.style.width = "1024px";
  frame.style.height = "1440px";
  frame.style.border = "0";
  document.body.appendChild(frame);
  try {
    const loadPromise = waitForFrameLoad(frame);
    frame.srcdoc = reportPrintDocumentHtml(element, fileName);
    await loadPromise;
    const printWindow = frame.contentWindow;
    const printDocument = frame.contentDocument;
    if (printDocument?.fonts?.ready) await printDocument.fonts.ready.catch(() => null);
    await Promise.all([...printDocument.querySelectorAll("img")].map((image) => image.complete ? Promise.resolve() : new Promise((resolve) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", resolve, { once: true });
    })));
    printWindow.focus();
    printWindow.print();
    const result = { ok: true, printDialog: true, filePath: "نافذة طباعة المتصفح" };
    emitSaveResult(result);
    return result;
  } catch (error) {
    emitSaveResult(null, error);
    throw error;
  } finally {
    window.setTimeout(() => frame.remove(), 60000);
  }
}

async function exportDesktopReportPdf(element, fileName, saveOptions = {}) {
  if (!window.glassOrdersDesktop?.printPdfHtml) return null;
  const outputName = safeFileName(fileName);
  const saveSettings = readReportSaveSettings();
  const reportType = saveOptions.reportType || "";
  const supplierId = cleanName(saveOptions.supplierId || "");
  const supplierName = cleanName(saveOptions.supplierName || "");
  const result = await window.glassOrdersDesktop.printPdfHtml({
    fileName: outputName,
    html: reportPrintDocumentHtml(element, outputName),
    reportType,
    supplierId,
    supplierName,
    saveSettings
  });
  if (result?.ok) {
    if (!saveSettings.directory && result.directory) persistReportSaveSettings({ ...saveSettings, lastDirectory: result.directory });
    emitSaveResult(result);
  } else if (!result?.canceled) {
    emitSaveResult(null, new Error(result?.error || "تعذر تصدير PDF."));
  }
  return result;
}

async function exportElementPdf(element, fileName, saveOptions = {}) {
  if (!element) return null;
  const { html2canvas, jsPDF } = await loadPdfExportModules();
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
  const avoidRanges = pdfAvoidRanges(element, canvas.height);
  const pageCanvas = document.createElement("canvas");
  pageCanvas.width = canvas.width;
  const context = pageCanvas.getContext("2d");
  function addCanvasSlice(sourceTop, sourceHeight) {
    pageCanvas.height = Math.max(1, Math.ceil(sourceHeight));
    context.clearRect(0, 0, pageCanvas.width, pageCanvas.height);
    context.drawImage(canvas, 0, sourceTop, canvas.width, sourceHeight, 0, 0, canvas.width, sourceHeight);
    pdf.addImage(pageCanvas.toDataURL("image/png"), "PNG", margin, margin, drawableWidth, sourceHeight * imageScale);
  }
  let sourceY = 0;
  let pageIndex = 0;
  const sourcePageHeight = Math.max(1, Math.floor(drawableHeight / imageScale));
  function bestSliceHeight(pageTop) {
    const remaining = canvas.height - pageTop;
    const naturalHeight = Math.min(sourcePageHeight, remaining);
    if (naturalHeight >= remaining) return naturalHeight;
    const desiredEnd = pageTop + naturalHeight;
    const minimumUsefulSlice = Math.max(120, sourcePageHeight * 0.18);
    const crossingRange = avoidRanges
      .filter((range) => (
        range.top < desiredEnd - 2 &&
        range.bottom > desiredEnd + 2 &&
        range.bottom - range.top < sourcePageHeight - 8
      ))
      .sort((a, b) => a.top - b.top)[0];
    if (!crossingRange) return naturalHeight;
    const beforeCrossing = Math.floor(crossingRange.top - pageTop);
    if (beforeCrossing >= minimumUsefulSlice) return beforeCrossing;
    const previousBoundary = avoidRanges
      .filter((range) => range.bottom <= desiredEnd - 2 && range.bottom > pageTop + minimumUsefulSlice)
      .sort((a, b) => b.bottom - a.bottom)[0];
    if (previousBoundary) return Math.floor(previousBoundary.bottom - pageTop);
    return naturalHeight;
  }
  while (sourceY < canvas.height) {
    const sliceHeight = Math.max(1, bestSliceHeight(sourceY));
    if (pageIndex > 0) pdf.addPage();
    addCanvasSlice(sourceY, sliceHeight);
    sourceY += sliceHeight;
    pageIndex += 1;
  }
  return saveBinaryFile(fileName, pdf.output("arraybuffer"), "application/pdf", saveOptions);
}

function pdfElementScale(element, canvasHeight) {
  const elementRect = element.getBoundingClientRect();
  return canvasHeight / Math.max(1, element.scrollHeight || elementRect.height);
}

function pdfElementRange(element, child, scale) {
  const elementRect = element.getBoundingClientRect();
  const rect = child.getBoundingClientRect();
  return {
    top: Math.max(0, Math.floor((rect.top - elementRect.top + element.scrollTop) * scale)),
    bottom: Math.max(0, Math.ceil((rect.bottom - elementRect.top + element.scrollTop) * scale)),
    kind: child.classList?.contains("report-row") ? "row" : child.classList?.contains("ticket-card") ? "ticket" : "block"
  };
}

function pdfAvoidRanges(element, canvasHeight) {
  const scale = pdfElementScale(element, canvasHeight);
  return [...element.querySelectorAll(".report-row:not(.head), .drawing-preview, .panel-overall-layout, .panel-report-card, .ticket-card")]
    .map((row) => pdfElementRange(element, row, scale))
    .filter((range) => range.bottom > range.top && range.top > 0)
    .sort((a, b) => a.top - b.top);
}

function preparePdfClone(clonedDocument, clonedElement) {
  clonedElement?.classList?.add("pdf-export-root");
  removeReportEditControls(clonedElement);
  const style = clonedDocument.createElement("style");
  const rootStyle = getComputedStyle(document.documentElement);
  const reportVar = (name, fallback) => rootStyle.getPropertyValue(name).trim() || fallback;
  style.textContent = `
    .pdf-export-root,
    .pdf-host {
      --report-page-background: ${reportVar("--report-page-background", "#ffffff")};
      --report-text: ${reportVar("--report-text", "#111827")};
      --report-muted-text: ${reportVar("--report-muted-text", "#475569")};
      --report-border: ${reportVar("--report-border", "#274761")};
      --report-header-background: ${reportVar("--report-header-background", "#0b1f2e")};
      --report-header-text: ${reportVar("--report-header-text", "#ffffff")};
      --report-row-background: ${reportVar("--report-row-background", "#ffffff")};
      --report-alternate-row-background: ${reportVar("--report-alternate-row-background", "#f5f7fa")};
      --report-accent: ${reportVar("--report-accent", "#9a6b16")};
      --report-total-background: ${reportVar("--report-total-background", "#f6efdf")};
    }
    .pdf-export-root *,
    .pdf-host * {
      box-shadow: none !important;
      text-shadow: none !important;
      filter: none !important;
      background-image: none !important;
    }
    .pdf-export-root, .pdf-export-root .preview-page, .pdf-export-root .report,
    .pdf-host, .pdf-host .preview-page, .pdf-host .report {
      background: var(--report-page-background) !important;
      background-color: var(--report-page-background) !important;
      color: var(--report-text) !important;
    }
    .pdf-export-root .report-row.head, .pdf-export-root .report-row.head *,
    .pdf-host .report-row.head, .pdf-host .report-row.head * {
      background: var(--report-header-background) !important;
      background-color: var(--report-header-background) !important;
      color: var(--report-header-text) !important;
    }
    .pdf-export-root .report-row.subtotal, .pdf-export-root .report-row.total,
    .pdf-export-root .report-row.subtotal *, .pdf-export-root .report-row.total *,
    .pdf-host .report-row.subtotal, .pdf-host .report-row.total,
    .pdf-host .report-row.subtotal *, .pdf-host .report-row.total * {
      background: var(--report-total-background) !important;
      background-color: var(--report-total-background) !important;
      color: var(--report-text) !important;
    }
    .pdf-export-root .report-row:not(.head):not(.subtotal):not(.total),
    .pdf-host .report-row:not(.head):not(.subtotal):not(.total) {
      background: var(--report-row-background) !important;
      color: var(--report-text) !important;
    }
    .pdf-export-root .report-row:nth-child(even):not(.head):not(.subtotal):not(.total),
    .pdf-host .report-row:nth-child(even):not(.head):not(.subtotal):not(.total) {
      background: var(--report-alternate-row-background) !important;
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
      color: var(--report-accent) !important;
    }
    .pdf-export-root .report-date-card,
    .pdf-export-root .order-report-date,
    .pdf-export-root .report-meta span,
    .pdf-export-root .layer-specs p,
    .pdf-host .report-date-card,
    .pdf-host .order-report-date,
    .pdf-host .report-meta span,
    .pdf-host .layer-specs p {
      background: var(--report-row-background) !important;
      background-color: var(--report-row-background) !important;
    }
    .pdf-export-root .order-report-date .date-value,
    .pdf-host .order-report-date .date-value {
      color: var(--report-text) !important;
      direction: ltr !important;
      unicode-bidi: isolate !important;
    }
    .pdf-export-root .order-report-date .date-label,
    .pdf-host .order-report-date .date-label {
      color: var(--report-muted-text) !important;
    }
    .pdf-export-root .report-row,
    .pdf-host .report-row {
      break-inside: avoid !important;
      page-break-inside: avoid !important;
      border-bottom: 0 !important;
      width: 100% !important;
      max-width: 100% !important;
      min-width: 0 !important;
    }
    .pdf-export-root .report-table,
    .pdf-host .report-table {
      break-inside: auto !important;
      page-break-inside: auto !important;
      width: 100% !important;
      max-width: 100% !important;
      min-width: 0 !important;
      border: 1px solid var(--report-border) !important;
    }
    .pdf-export-root .order-report-row,
    .pdf-host .order-report-row {
      grid-template-columns:
        minmax(40px, .42fr)
        minmax(0, 4.2fr)
        minmax(44px, .46fr)
        minmax(62px, .64fr)
        minmax(62px, .64fr)
        minmax(46px, .46fr)
        minmax(72px, .74fr) !important;
    }
    .pdf-export-root .split-layer-report-group,
    .pdf-host .split-layer-report-group {
      grid-template-rows: repeat(var(--split-layer-count, 2), minmax(44px, auto)) !important;
    }
    .pdf-export-root .split-root-cell,
    .pdf-host .split-root-cell {
      grid-row: 1 / calc(var(--split-layer-count, 2) + 1) !important;
      border-bottom: 2px solid var(--report-border) !important;
      background: color-mix(in srgb, var(--report-row-background) 97%, #edf6ff) !important;
    }
    .pdf-export-root .split-root-number,
    .pdf-host .split-root-number {
      grid-column: 1 !important;
      font-weight: 900 !important;
    }
    .pdf-export-root .split-root-description,
    .pdf-host .split-root-description {
      grid-column: 2 !important;
      display: flex !important;
      flex-direction: column !important;
      align-items: stretch !important;
      gap: 0 !important;
      padding: 0 !important;
      overflow-wrap: normal !important;
      word-break: normal !important;
    }
    .pdf-export-root .split-root-summary,
    .pdf-host .split-root-summary {
      display: block !important;
      width: 100% !important;
      padding: 7px 10px 6px !important;
      border-bottom: 0 !important;
      white-space: normal !important;
      overflow-wrap: anywhere !important;
    }
    .pdf-export-root .split-root-code,
    .pdf-host .split-root-code { grid-column: 3 !important; }
    .pdf-export-root .split-layer-list,
    .pdf-host .split-layer-list {
      grid-template-rows: repeat(var(--split-layer-count, 2), minmax(36px, 1fr)) !important;
      margin-top: 0 !important;
      border-top: 0 !important;
      line-height: 1.25 !important;
    }
    .pdf-export-root .split-layer-list-item,
    .pdf-host .split-layer-list-item {
      min-height: 36px !important;
      padding: 5px 10px !important;
      white-space: normal !important;
      overflow-wrap: anywhere !important;
      text-align: right !important;
      direction: rtl !important;
    }
    .pdf-export-root .split-layer-phrase,
    .pdf-host .split-layer-phrase {
      display: block !important;
      width: 100% !important;
      white-space: normal !important;
      overflow-wrap: anywhere !important;
      word-break: normal !important;
    }
    .pdf-export-root .split-layer-value:not(.last),
    .pdf-host .split-layer-value:not(.last) {
      border-bottom-color: color-mix(in srgb, var(--report-border) 36%, transparent) !important;
      border-bottom-width: 1px !important;
    }
    .pdf-export-root .split-layer-value.last,
    .pdf-host .split-layer-value.last {
      border-bottom-color: var(--report-border) !important;
      border-bottom-width: 2px !important;
    }
    .pdf-export-root .report-row > span,
    .pdf-host .report-row > span {
      box-sizing: border-box !important;
      border-inline-start: 0 !important;
      border-left: 1px solid var(--report-border) !important;
      border-bottom: 1px solid var(--report-border) !important;
    }
    .pdf-export-root .split-root-cell,
    .pdf-host .split-root-cell,
    .pdf-export-root .split-layer-value.last,
    .pdf-host .split-layer-value.last {
      border-bottom-color: var(--report-border) !important;
      border-bottom-width: 2px !important;
    }
    .pdf-export-root .split-layer-value:not(.last),
    .pdf-host .split-layer-value:not(.last) {
      border-bottom-color: color-mix(in srgb, var(--report-border) 36%, transparent) !important;
      border-bottom-width: 1px !important;
    }
    .pdf-export-root .report-row > span:first-child,
    .pdf-host .report-row > span:first-child {
      border-inline-start: 0 !important;
    }
    .pdf-export-root .report-row:last-child > span,
    .pdf-host .report-row:last-child > span {
      border-bottom: 0 !important;
    }
    .pdf-export-root .description-header,
    .pdf-export-root .description-cell,
    .pdf-export-root .code-header,
    .pdf-export-root .code-cell,
    .pdf-host .description-header,
    .pdf-host .description-cell,
    .pdf-host .code-header,
    .pdf-host .code-cell {
      border-color: var(--report-border) !important;
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
  return String(fileName || "YDGlassManager-export")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function orderExportFileBase(order) {
  const customer = cleanName(order?.customerName) || "بدون عميل";
  return `طلب شراء زجاج رقم ${displayOrderNo(order?.orderNo)} - ${customer}`;
}

function supplierStatementOrderKey(order = {}) {
  return String(order.id || order.orderNo || order.order_no || "").trim();
}

function supplierStatementOrderCost(order = {}) {
  return orderTotals(order).supplierCost;
}

function supplierStatementRowDetails(row, rowIndex, order) {
  const totals = rowTotals(row);
  return {
    id: row.id || `${supplierStatementOrderKey(order)}-row-${rowIndex + 1}`,
    line: rowIndex + 1,
    description: rowDescription(row),
    code: row.code || "",
    quantity: rowPanelPhysicalCount(row),
    area: totals.area,
    cost: totals.supplierCost
  };
}

function buildAppSupplierStatement({
  supplier,
  orders,
  payments,
  mode,
  fromDate,
  toDate,
  selectedOrderIds
}) {
  return {
    ...buildSupplierStatement({
      supplier,
      orders,
      payments,
      mode,
      fromDate,
      toDate,
      selectedOrderIds,
      getOrderCost: supplierStatementOrderCost,
      getOrderRows: (order) => activeOrderRows(order.rows || []),
      getRowDetails: supplierStatementRowDetails,
      isPayable: isOrderPayableForSupplier,
      orderKey: supplierStatementOrderKey
    }),
    generatedAt: new Date().toISOString()
  };
}

function supplierStatementFileBase(statementOrSupplier) {
  const statement = statementOrSupplier?.mode ? statementOrSupplier : null;
  const supplier = statement?.supplier || statementOrSupplier || {};
  const suffix = statement?.mode === SELECTED_ORDERS_STATEMENT_MODE
    ? " - طلبات محددة"
    : statement && (statement.fromDate || statement.toDate)
      ? ` - ${statement.fromDate || "البداية"} إلى ${statement.toDate || "الآن"}`
      : "";
  return `كشف حساب مورد ${cleanName(supplier.name) || "مورد"}${suffix}`;
}

function orderStatusReportFileBase(report = {}) {
  const suppliers = (report.suppliers || []).map((supplier) => cleanName(supplier.supplier)).filter(Boolean);
  const selectedSuppliers = (report.selectedSuppliers || []).map(cleanName).filter(Boolean);
  const sourceSuppliers = selectedSuppliers.length ? selectedSuppliers : suppliers;
  const supplierPart = sourceSuppliers.length === 1
    ? sourceSuppliers[0]
    : sourceSuppliers.length > 1
      ? `${sourceSuppliers.length} موردين`
      : "كل الموردين";
  const statuses = [...new Set((report.rows || []).map((row) => cleanName(row.statusText || statusLabel(row.status))).filter(Boolean))];
  const statusPart = statuses.length === 1
    ? statuses[0]
    : statuses.length > 1
      ? `${statuses.length} حالات`
      : "كل الحالات";
  return `تقرير حالة الطلبات - ${supplierPart} - ${statusPart}`;
}

function readJsonSetting(key, fallback) {
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(key) || "{}") };
  } catch {
    return { ...fallback };
  }
}

function writeJsonSetting(key, value) {
  localStorage.setItem(key, JSON.stringify(value || {}));
  return value;
}

function readReportSaveSettings() {
  const settings = readJsonSetting(REPORT_SAVE_SETTINGS_KEY, {
    directory: "",
    openPdfAfterSave: false,
    supplierSubfolderIds: [],
    supplierSubfolderNames: [],
    lastDirectory: ""
  });
  return {
    ...settings,
    supplierSubfolderIds: Array.isArray(settings.supplierSubfolderIds) ? settings.supplierSubfolderIds : [],
    supplierSubfolderNames: Array.isArray(settings.supplierSubfolderNames) ? settings.supplierSubfolderNames : []
  };
}

function persistReportSaveSettings(settings) {
  return writeJsonSetting(REPORT_SAVE_SETTINGS_KEY, settings);
}

function readTicketSettings() {
  const settings = readJsonSetting(TICKET_SETTINGS_KEY, {
    printerName: "",
    widthMm: 90,
    heightMm: 55,
    fields: DEFAULT_TICKET_FIELDS
  });
  return {
    ...settings,
    widthMm: Math.max(25, numberValue(settings.widthMm, 90)),
    heightMm: Math.max(12, numberValue(settings.heightMm, 55)),
    fields: { ...DEFAULT_TICKET_FIELDS, ...(settings.fields || {}), pieceCode: true, measurements: true }
  };
}

function persistTicketSettings(settings) {
  return writeJsonSetting(TICKET_SETTINGS_KEY, settings);
}

function detectedPrinterSizeMm(printer) {
  const options = printer?.options || {};
  const candidate = options["media-size"] || options.mediaSize || options.PageSize || printer?.mediaSize;
  if (!candidate) return null;
  if (typeof candidate === "object") {
    const width = numberValue(candidate.width || candidate.Width || candidate.x);
    const height = numberValue(candidate.height || candidate.Height || candidate.y);
    if (width && height) return { widthMm: width > 1000 ? width / 1000 : width, heightMm: height > 1000 ? height / 1000 : height };
  }
  const text = String(candidate);
  const match = text.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i);
  if (match) return { widthMm: numberValue(match[1]), heightMm: numberValue(match[2]) };
  return null;
}

function rowPhysicalQuantity(row) {
  if (rowHasPanels(row)) return rowDrawingPanels(row).length;
  return Math.max(0, Math.floor(numberValue(row.quantity, 1)));
}

function ticketSizeTier(settings = {}) {
  const widthMm = numberValue(settings.widthMm, 90);
  const heightMm = numberValue(settings.heightMm, 55);
  const area = widthMm * heightMm;
  if (widthMm <= 35) return "tiny";
  if (widthMm <= 52 || area <= 1200 || Math.min(widthMm, heightMm) <= 24) return "compact";
  if (widthMm <= 78 || area <= 2600 || Math.min(widthMm, heightMm) <= 38) return "standard";
  return "full";
}

function isTinyTicket(settings = {}) {
  return ticketSizeTier(settings) === "tiny";
}

function normalizedTicketFields(settings = {}) {
  return { ...DEFAULT_TICKET_FIELDS, ...(settings.fields || {}), pieceCode: true, measurements: true };
}

function ticketVisibleFields(settings = {}) {
  const widthMm = numberValue(settings.widthMm, 90);
  const heightMm = numberValue(settings.heightMm, 55);
  const tier = ticketSizeTier(settings);
  const fields = normalizedTicketFields(settings);
  const tiny = tier === "tiny";
  const compact = tier === "compact";
  const canUseExtraHeight = heightMm > 50;
  const canUseExtendedWidth = widthMm >= 72;
  const canUseFullExtras = widthMm >= 90 && canUseExtraHeight;
  return {
    tier,
    qrCode: !!fields.qrCode && !tiny && widthMm > 35,
    pieceCode: true,
    measurements: true,
    glassDescription: !!fields.glassDescription && widthMm >= 28,
    glassManufacturer: !!fields.glassManufacturer && !tiny,
    rowCounter: !!fields.rowCounter && heightMm >= 13,
    orderCounter: !!fields.orderCounter && (!tiny || heightMm >= 18),
    rowQuantity: !!fields.rowQuantity && !tiny && canUseExtendedWidth,
    orderNo: !!fields.orderNo && !compact && canUseExtendedWidth,
    customerName: !!fields.customerName && canUseFullExtras,
    supplierName: !!fields.supplierName && canUseFullExtras,
    projectName: !!fields.projectName && canUseFullExtras,
    orderDate: !!fields.orderDate && !compact && canUseExtendedWidth && canUseExtraHeight
  };
}

function ticketHiddenEnabledFields(settings = {}) {
  const fields = normalizedTicketFields(settings);
  const visible = ticketVisibleFields(settings);
  const names = {
    qrCode: "QR code",
    orderNo: "Order number",
    customerName: "Customer name",
    supplierName: "Supplier name",
    projectName: "Project name",
    orderDate: "Order date",
    glassDescription: "Glass description",
    glassManufacturer: "Glass manufacturer",
    rowQuantity: "Row quantity",
    orderCounter: "Order counter",
    rowCounter: "Row counter"
  };
  return Object.entries(names)
    .filter(([key]) => fields[key] && !visible[key])
    .map(([, label]) => label);
}

function rowMaxWidthCm(row) {
  if (rowHasPanels(row)) return Math.max(0, ...rowDrawingPanels(row).map((panel) => numberValue(panel.width) / 10));
  return Math.max(0, ...(row.layers || []).map((layer) => numberValue(layer.width)));
}

function rowMaxHeightCm(row) {
  if (rowHasPanels(row)) return Math.max(0, ...rowDrawingPanels(row).map((panel) => numberValue(panel.height) / 10));
  return Math.max(0, ...(row.layers || []).map((layer) => numberValue(layer.height)));
}

function ticketCode(row, rowIndex, pieceIndex) {
  return cleanName(row.code) || `R${rowIndex + 1}-${pieceIndex + 1}`;
}

function rowTicketItems(row, rowIndex) {
  if (rowHasPanels(row)) {
    return rowDrawingPanels(row).map((panel, panelIndex) => ({
      panel,
      panelIndex,
      rowPieceIndex: panelIndex,
      rowQuantity: rowDrawingPanels(row).length,
      code: panelCode(row, panel, panelIndex),
      width: Math.round(numberValue(panel.width)),
      height: Math.round(numberValue(panel.height)),
      panelLabel: panelDisplayName(panel, panelIndex)
    }));
  }
  return Array.from({ length: rowPhysicalQuantity(row) }).map((_, rowPieceIndex) => ({
    panel: null,
    panelIndex: -1,
    rowPieceIndex,
    rowQuantity: rowPhysicalQuantity(row),
    code: ticketCode(row, rowIndex, rowPieceIndex),
    width: cmToMm(rowMaxWidthCm(row)),
    height: cmToMm(rowMaxHeightCm(row)),
    panelLabel: ""
  }));
}

function ticketQrPayload(order, row, rowIndex, ticketItem, orderPieceIndex, totalPieces) {
  return {
    orderId: order.id || "",
    orderNo: displayOrderNo(order.orderNo),
    customer: order.customerName || "",
    supplier: order.supplierName || "",
    project: order.project || "",
    documentIssueDate: resolveOrderIssueDate(order),
    rowId: row.id || "",
    panel: ticketItem.panelLabel || "",
    panelCode: ticketItem.panel ? ticketItem.code : "",
    pieceCode: ticketItem.code,
    glassDescription: rowDescription(row),
    width: ticketItem.width,
    height: ticketItem.height,
    rowQuantity: ticketItem.rowQuantity,
    rowPieceNumber: ticketItem.rowPieceIndex + 1,
    orderPieceNumber: orderPieceIndex + 1,
    totalOrderPieces: totalPieces
  };
}

function buildManufacturingTickets(order) {
  if (!order) return [];
  const totalPieces = (order.rows || []).reduce((sum, row, rowIndex) => sum + rowTicketItems(row, rowIndex).length, 0);
  const tickets = [];
  for (const [rowIndex, row] of (order.rows || []).entries()) {
    const items = rowTicketItems(row, rowIndex);
    for (const item of items) {
      const orderPieceIndex = tickets.length;
      const payload = ticketQrPayload(order, row, rowIndex, item, orderPieceIndex, totalPieces);
      tickets.push({
        id: `${row.id || rowIndex}-${item.panel?.id || item.rowPieceIndex}`,
        order,
        row,
        panel: item.panel,
        panelIndex: item.panelIndex,
        rowIndex,
        rowPieceIndex: item.rowPieceIndex,
        orderPieceIndex,
        totalPieces,
        code: payload.pieceCode,
        description: payload.glassDescription,
        widthMm: payload.width,
        heightMm: payload.height,
        rowQuantity: item.rowQuantity,
        qrPayload: payload,
        qrText: ticketReadableQrText(payload)
      });
    }
  }
  return tickets;
}

function ticketReadableQrText(payload) {
  return [
    `Order: ${payload.orderNo}`,
    `Panel: ${payload.panel || "-"}`,
    `Panel Code: ${payload.panelCode || payload.pieceCode || "-"}`,
    `Glass: ${payload.glassDescription || "-"}`,
    `Width: ${Math.round(numberValue(payload.width))} mm`,
    `Height: ${Math.round(numberValue(payload.height))} mm`,
    `Quantity: 1`,
    `Supplier: ${payload.supplier || "-"}`,
    `Customer: ${payload.customer || "-"}`,
    `Project: ${payload.project || "-"}`,
    `Issue Date: ${formatStatusDate(payload.documentIssueDate)}`,
    `Order Piece: ${payload.orderPieceNumber} of ${payload.totalOrderPieces}`
  ].join("\n");
}

function ticketCompactQrText(ticket) {
  const payload = ticket.qrPayload || {};
  return [
    `اوردر: ${payload.orderNo || "-"}`,
    `Panel: ${payload.panel || "-"}`,
    `كود: ${payload.panelCode || payload.pieceCode || ticket.code || "-"}`,
    `بيان: ${payload.glassDescription || ticket.description || "-"}`,
    `مقاس: ${dimensionMmText(payload.width || ticket.widthMm, payload.height || ticket.heightMm)}`,
    `قطعة: ${payload.orderPieceNumber || ticket.orderPieceIndex + 1} من ${payload.totalOrderPieces || ticket.totalPieces}`
  ].join("\n");
}

function ticketStandardQrText(ticket) {
  const payload = ticket.qrPayload || {};
  return [
    `رقم الأوردر: ${payload.orderNo || "-"}`,
    `Panel: ${payload.panel || "-"}`,
    `كود القطعة: ${payload.panelCode || payload.pieceCode || ticket.code || "-"}`,
    `البيان: ${payload.glassDescription || ticket.description || "-"}`,
    `المقاس: ${dimensionMmText(payload.width || ticket.widthMm, payload.height || ticket.heightMm)}`,
    `داخل البند: ${payload.rowPieceNumber || ticket.rowPieceIndex + 1} من ${payload.rowQuantity || ticket.rowQuantity}`,
    `داخل الطلب: ${payload.orderPieceNumber || ticket.orderPieceIndex + 1} من ${payload.totalOrderPieces || ticket.totalPieces}`
  ].join("\n");
}

function ticketQrTextForSettings(ticket, settings = {}) {
  const tier = ticketSizeTier(settings);
  const fields = normalizedTicketFields(settings);
  if (tier === "tiny" || !fields.qrCode) return "";
  if (tier === "compact") return ticketCompactQrText(ticket);
  if (tier === "standard") return ticketStandardQrText(ticket);
  return ticket.qrText || ticketStandardQrText(ticket);
}

function ticketPdfFileBase(order) {
  return `تيكتات اوردر رقم ${displayOrderNo(order?.orderNo)} - ${cleanName(order?.customerName) || "بدون عميل"}`;
}

async function qrDataUrl(text, settings = {}) {
  if (!text) return "";
  const QRCode = await loadQrCodeModule();
  const tier = ticketSizeTier(settings);
  const metrics = ticketLayoutMetrics(settings);
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: tier === "compact" ? "L" : "M",
    margin: tier === "compact" ? 1 : 2,
    width: Math.max(180, Math.round(metrics.qrMm * 16)),
    color: { dark: "#06152b", light: "#ffffff" }
  });
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

function browserSaveFileType(mimeType) {
  const extension = mimeType === "application/pdf" ? "pdf" : "xlsx";
  const description = mimeType === "application/pdf" ? "PDF document" : "Excel workbook";
  return { extension, description };
}

async function prepareBrowserSaveTarget(fileName, mimeType) {
  if (window.glassOrdersDesktop?.saveFile || !window.showSaveFilePicker || !window.isSecureContext) return null;
  const outputName = safeFileName(fileName);
  const { extension, description } = browserSaveFileType(mimeType);
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: outputName,
      types: [{ description, accept: { [mimeType]: [`.${extension}`] } }]
    });
    return { handle, fileName: outputName };
  } catch (error) {
    if (error?.name === "AbortError") return { canceled: true };
    console.warn("Browser save picker failed, falling back to download link.", error);
    return null;
  }
}

async function writeBrowserSaveHandle(target, buffer, mimeType) {
  const writable = await target.handle.createWritable();
  await writable.write(new Blob([buffer], { type: mimeType }));
  await writable.close();
  return { ok: true, fallback: true, fileName: target.fileName };
}

async function browserDownload(fileName, buffer, mimeType) {
  const outputName = safeFileName(fileName);
  const blob = new Blob([buffer], { type: mimeType });
  if (window.showSaveFilePicker && window.isSecureContext) {
    const extension = mimeType === "application/pdf" ? "pdf" : "xlsx";
    const description = mimeType === "application/pdf" ? "PDF document" : "Excel workbook";
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: outputName,
        types: [{ description, accept: { [mimeType]: [`.${extension}`] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { ok: true, fallback: true, fileName: outputName };
    } catch (error) {
      if (error?.name === "AbortError") return { ok: false, canceled: true };
      console.warn("Browser save picker failed, falling back to download link.", error);
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = outputName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  return { ok: true, fallback: true, fileName: outputName };
}

function supplierSelectionKey(supplier = {}) {
  return supplier.id || (supplier.name ? `name:${cleanName(supplier.name).toLocaleLowerCase()}` : "");
}

function supplierFolderPayloadForOrder(order = {}) {
  return {
    supplierId: order.supplierId || order.supplier_id || "",
    supplierName: cleanName(order.supplierName || order.supplier_name || "")
  };
}

function supplierFolderPayloadForSupplier(supplier = {}) {
  return {
    supplierId: supplier.id || supplier.supplierId || supplier.supplier_id || "",
    supplierName: cleanName(supplier.name || supplier.supplierName || supplier.supplier_name || "")
  };
}

function emitSaveResult(result, error) {
  window.dispatchEvent(new CustomEvent("glass-orders-save-result", { detail: { result, error: error ? safeErrorMessage(error) : "" } }));
}

function isAndroidRuntime() {
  try {
    return Capacitor?.getPlatform?.() === "android" || window.Capacitor?.getPlatform?.() === "android" || /Android/i.test(navigator.userAgent || "");
  } catch {
    return /Android/i.test(navigator.userAgent || "");
  }
}

async function saveAndroidPdfFile(fileName, buffer, options = {}) {
  const outputName = safeFileName(fileName);
  const stamp = Date.now();
  const tempPath = `pdf-cache/${stamp}-${outputName}.tmp`;
  const finalPath = `pdf-cache/${outputName}`;
  const base64 = arrayBufferToBase64(buffer);
  try {
    await Filesystem.writeFile({
      path: tempPath,
      data: base64,
      directory: Directory.Cache,
      recursive: true
    });
    const tempStat = await Filesystem.stat({ path: tempPath, directory: Directory.Cache });
    if (!numberValue(tempStat?.size)) throw new Error("Generated PDF file is empty.");
    await Filesystem.deleteFile({ path: finalPath, directory: Directory.Cache }).catch(() => null);
    await Filesystem.rename({
      from: tempPath,
      to: finalPath,
      directory: Directory.Cache,
      toDirectory: Directory.Cache
    });
    const finalStat = await Filesystem.stat({ path: finalPath, directory: Directory.Cache });
    if (!numberValue(finalStat?.size)) throw new Error("Generated PDF file is empty.");
    const uriResult = await Filesystem.getUri({ path: finalPath, directory: Directory.Cache });
    const result = {
      ok: true,
      androidCache: true,
      fileName: outputName,
      filePath: finalPath,
      uri: uriResult?.uri || "",
      size: finalStat.size
    };
    if (options.androidShare) {
      if (!result.uri) throw new Error("تعذر تجهيز رابط مشاركة PDF.");
      await CapacitorShare.share({
        title: outputName,
        text: outputName,
        url: result.uri,
        dialogTitle: "مشاركة ملف PDF"
      });
      result.shared = true;
    }
    return result;
  } catch (error) {
    await Filesystem.deleteFile({ path: tempPath, directory: Directory.Cache }).catch(() => null);
    throw error;
  }
}

async function saveBinaryFile(fileName, buffer, mimeType, options = {}) {
  const outputName = safeFileName(fileName);
  if (options.browserSaveTarget?.handle) {
    const result = await writeBrowserSaveHandle(options.browserSaveTarget, buffer, mimeType);
    emitSaveResult(result);
    return result;
  }
  if (mimeType === "application/pdf" && isAndroidRuntime()) {
    try {
      const result = await saveAndroidPdfFile(outputName, buffer, options);
      emitSaveResult(result);
      return result;
    } catch (error) {
      emitSaveResult(null, error);
      throw error;
    }
  }
  if (window.glassOrdersDesktop?.saveFile) {
    const saveSettings = readReportSaveSettings();
    const reportType = options.reportType || "";
    const supplierId = cleanName(options.supplierId || "");
    const supplierName = cleanName(options.supplierName || "");
    try {
      const result = await window.glassOrdersDesktop.saveFile({
        fileName: outputName,
        mimeType,
        data: arrayBufferToBase64(buffer),
        reportType,
        supplierId,
        supplierName,
        saveSettings
      });
      if (result?.ok || result?.canceled) {
        if (result?.ok) {
          if (!saveSettings.directory && result.directory) persistReportSaveSettings({ ...saveSettings, lastDirectory: result.directory });
          emitSaveResult(result);
        }
        return result;
      }
    } catch (error) {
      console.warn("Desktop save failed, falling back to browser download.", error);
      emitSaveResult(null, error);
      if (saveSettings.directory) return { ok: false, error: safeErrorMessage(error) };
    }
  }
  const result = await browserDownload(outputName, buffer, mimeType);
  emitSaveResult(result);
  return result;
}

function showExportError(error) {
  console.error(error);
  emitSaveResult(null, new Error(`تعذر تصدير الملف: ${safeErrorMessage(error)}`));
  restoreRendererInputFocus();
}

function cleanupRendererInteractionState() {
  try {
    window.dispatchEvent(new CustomEvent("glass-orders-cancel-interactions"));
  } catch {
    try { window.dispatchEvent(new Event("glass-orders-cancel-interactions")); } catch { /* Ignore unsupported event APIs. */ }
  }
  const lockClasses = [
    "drawing-dragging",
    "column-resizing",
    "row-resizing",
    "table-busy",
    "grid-disabled",
    "ui-busy",
    "modal-open",
    "pointer-locked"
  ];
  document.body?.classList?.remove(...lockClasses);
  const root = document.getElementById("root");
  const interactionRoots = [document.documentElement, document.body, root].filter(Boolean);
  for (const node of interactionRoots) {
    node.removeAttribute("inert");
    if (node.getAttribute("aria-hidden") === "true") node.removeAttribute("aria-hidden");
    if (node.style?.pointerEvents === "none") node.style.removeProperty("pointer-events");
  }
  const blockingOverlayPresent = !!document.querySelector(".modal-backdrop, .hard-delete-backdrop, .loading-layer");
  if (!blockingOverlayPresent) {
    document.body?.removeAttribute?.("data-scroll-locked");
    if (document.body?.style?.overflow === "hidden") document.body.style.removeProperty("overflow");
    for (const node of interactionRoots) {
      node.removeAttribute("aria-busy");
      node.removeAttribute("data-busy");
    }
  }
  const active = document.activeElement;
  if (active && active !== document.body && !document.contains(active)) {
    try { active.blur?.(); } catch { /* A detached editor may no longer support blur. */ }
  }
  try { window.getSelection?.()?.removeAllRanges?.(); } catch { /* Selection cleanup is best-effort. */ }
}

function restoreRendererInputFocus(options = {}) {
  const preferredElement = options.preferredElement || null;
  const preferredSelector = options.preferredSelector || "";
  const shouldSelect = options.select === true;
  const shouldPlaceCaretAtEnd = !!options.caretEnd;
  const immediate = options.immediate === true;
  const suppressAutocomplete = options.suppressAutocomplete !== false;
  logFocusDiagnostics("restore-start");
  cleanupRendererInteractionState();
  if (suppressAutocomplete) window.__glassSuppressAutocompleteUntil = Date.now() + 650;
  if (!preferredElement && !preferredSelector && document.hasFocus() && isEditableDomTarget(document.activeElement)) {
    logFocusDiagnostics("restore-keep-active-editor");
    return;
  }
  const rendererWasInactive = !document.hasFocus();
  try { window.focus?.(); } catch { /* Browser focus may require desktop mediation. */ }
  let desktopFocusResult = null;
  if (rendererWasInactive) {
    try {
      desktopFocusResult = window.glassOrdersDesktop?.forceFocusReset?.()
        || window.glassOrdersDesktop?.restoreFocus?.()
        || null;
    } catch {
      desktopFocusResult = null;
    }
  }

  function focusAttempt(attempt = 0) {
    if (!document.hasFocus()) {
      if (attempt < 5) window.setTimeout(() => focusAttempt(attempt + 1), 60);
      else logFocusDiagnostics("restore-window-inactive");
      return;
    }
    const preferred = preferredElement && document.contains(preferredElement)
      ? preferredElement
      : preferredSelector
        ? document.querySelector(preferredSelector)
        : null;
    const active = document.activeElement;
    const shouldFocus = preferred || !active || active === document.body || active === document.documentElement;
    if (shouldFocus) {
      const target = preferred || document.querySelector("[data-focus-fallback]:not([disabled]), button:not([disabled])");
      try {
        target?.focus?.({ preventScroll: true });
      } catch {
        target?.focus?.();
      }
      if (target && shouldPlaceCaretAtEnd && typeof target.setSelectionRange === "function" && /^(INPUT|TEXTAREA)$/.test(target.tagName || "")) {
        const length = String(target.value || "").length;
        target.setSelectionRange(length, length);
      } else if (target && shouldSelect && typeof target.select === "function" && /^(INPUT|TEXTAREA)$/.test(target.tagName || "")) {
        target.select();
      }
    }
    logFocusDiagnostics("restore-end");
  }

  if (immediate) focusAttempt(0);
  else window.setTimeout(() => focusAttempt(0), 35);
  if (desktopFocusResult && typeof desktopFocusResult.then === "function") {
    Promise.resolve(desktopFocusResult)
      .catch(() => null)
      .finally(() => window.setTimeout(() => focusAttempt(0), 0));
  }
}

function logFocusDiagnostics(reason) {
  try {
    if (localStorage.getItem("glassOrdersFocusDebug") !== "1") return;
    const active = document.activeElement;
    const tag = active ? `${active.tagName || ""}${active.id ? `#${active.id}` : ""}${active.className ? `.${String(active.className).split(/\s+/).slice(0, 3).join(".")}` : ""}` : "none";
    const overlays = document.querySelectorAll(".modal-backdrop, .hard-delete-backdrop, .loading-layer").length;
    console.debug("[GlassOrders focus]", {
      reason,
      active: tag,
      overlays,
      htmlInert: document.documentElement.hasAttribute("inert"),
      bodyInert: document.body.hasAttribute("inert"),
      bodyClass: document.body.className || ""
    });
  } catch {
    // Diagnostics must never break UI recovery.
  }
}

async function renderReportPdf(children, fileName, saveOptions = {}) {
  const host = document.createElement("div");
  host.className = "pdf-host";
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    root.render(<div className="preview-page">{children}</div>);
    await waitForPaint(220);
    const desktopResult = await exportDesktopReportPdf(host, fileName, saveOptions);
    if (desktopResult) return desktopResult;
    if (isAndroidRuntime() || saveOptions.androidCache || saveOptions.androidShare) {
      return await exportElementPdf(host, fileName, saveOptions);
    }
    return await printBrowserReportPdf(host, fileName);
  } finally {
    root.unmount();
    host.remove();
  }
}

function mmToPt(value) {
  return numberValue(value) * 2.8346456693;
}

async function exportTicketsPdf(tickets, qrMap, settings, order) {
  const validation = validateOrderForReport(order);
  if (!validation.ok) throw new Error(validation.message);
  const { html2canvas, jsPDF } = await loadPdfExportModules();
  const fileName = `${ticketPdfFileBase(order)}.pdf`;
  const browserSaveTarget = await prepareBrowserSaveTarget(fileName, "application/pdf");
  if (browserSaveTarget?.canceled) return { ok: false, canceled: true };
  const widthPt = mmToPt(settings.widthMm);
  const heightPt = mmToPt(settings.heightMm);
  const pdf = new jsPDF({ orientation: widthPt > heightPt ? "l" : "p", unit: "pt", format: [widthPt, heightPt] });
  const host = document.createElement("div");
  host.className = "pdf-host ticket-pdf-host";
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    root.render(<TicketSheet tickets={tickets} qrMap={qrMap} settings={settings} />);
    await waitForPaint(420);
    const cards = [...host.querySelectorAll(".ticket-card")];
    for (let index = 0; index < cards.length; index += 1) {
      const canvas = await html2canvas(cards[index], { scale: 3, backgroundColor: "#ffffff", useCORS: true, logging: false });
      if (index > 0) pdf.addPage([widthPt, heightPt], widthPt > heightPt ? "l" : "p");
      pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, widthPt, heightPt);
    }
    return saveBinaryFile(fileName, pdf.output("arraybuffer"), "application/pdf", {
      reportType: "tickets",
      browserSaveTarget,
      ...supplierFolderPayloadForOrder(order)
    });
  } finally {
    root.unmount();
    host.remove();
  }
}

function ticketPrintHtml(tickets, qrMap, settings) {
  const metrics = ticketLayoutMetrics(settings);
  const visibleFields = ticketVisibleFields(settings);
  const css = `
    @page { size: ${metrics.widthMm}mm ${metrics.heightMm}mm; margin: 0; }
    body { margin: 0; background: #fff; direction: rtl; font-family: "Segoe UI", Tahoma, Arial, sans-serif; }
    .ticket-sheet { display: block; }
    .ticket-card { width: ${metrics.widthMm}mm; height: ${metrics.heightMm}mm; box-sizing: border-box; page-break-after: always; padding: ${metrics.paddingMm}mm; overflow: hidden; color: #06152b; background: #fff; border: 0; display: grid; grid-template-rows: auto minmax(0,1fr) auto; gap: ${metrics.gapMm}mm; direction: rtl; unicode-bidi: isolate; }
    .ticket-card [lang="en"], .ticket-card [dir="ltr"], .ticket-code, .ticket-date, .ticket-dimensions { direction: ltr; text-align: left; unicode-bidi: isolate; }
    .ticket-card [lang="ar"], .ticket-card [dir="rtl"] { direction: rtl; text-align: right; unicode-bidi: isolate; }
    .ticket-card.ticket-tiny { grid-template-rows: auto minmax(0,1fr) auto; }
    .ticket-top { display: grid; grid-template-columns: ${metrics.qrMm}mm minmax(0, 1fr); direction: ltr; align-items: start; gap: ${metrics.gapMm}mm; min-width: 0; }
    .ticket-card.no-qr .ticket-top { grid-template-columns: minmax(0, 1fr); }
    .ticket-card.no-qr .ticket-code-block { justify-items: center; text-align: center; }
    .ticket-qr { width: ${metrics.qrMm}mm; height: ${metrics.qrMm}mm; display: grid; place-items: center; overflow: hidden; }
    .ticket-qr img { width: 100%; height: 100%; object-fit: contain; }
    .ticket-code-block { min-width: 0; display: grid; align-content: center; justify-items: end; }
    .ticket-code { color: #06152b; font-size: ${metrics.codeMm}mm; line-height: .95; font-weight: 950; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; direction: ltr; text-align: left; unicode-bidi: isolate; }
    .ticket-body { min-width: 0; display: grid; align-content: center; justify-items: stretch; align-self: stretch; gap: ${Math.max(0.12, metrics.gapMm * 0.65)}mm; }
    .ticket-description { margin: 0; color: #06152b; font-size: ${metrics.bodyMm}mm; line-height: 1.15; font-weight: 800; overflow: hidden; display: -webkit-box; -webkit-line-clamp: ${metrics.tiny ? 1 : 2}; -webkit-box-orient: vertical; direction: rtl; unicode-bidi: plaintext; text-align: right; }
    .ticket-measurement { color: #06152b; font-size: ${metrics.measurementMm}mm; line-height: 1.05; font-weight: 1000; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center; direction: ltr; unicode-bidi: isolate; }
    .measurement-mm { display: inline-flex; direction: ltr; unicode-bidi: isolate; align-items: baseline; justify-content: center; gap: .55mm; white-space: nowrap; }
    .thickness-mm { direction: rtl; unicode-bidi: isolate; display: inline-flex; flex-direction: row; align-items: baseline; gap: 0; white-space: nowrap; letter-spacing: 0 !important; word-spacing: 0 !important; font-kerning: normal; text-rendering: optimizeLegibility; }
    .thickness-number { direction: ltr; unicode-bidi: isolate; }
    .thickness-unit { direction: rtl; unicode-bidi: isolate; }
    .measurement-mm bdi { direction: ltr; unicode-bidi: isolate; }
    .measurement-unit { direction: rtl; unicode-bidi: isolate; white-space: nowrap; letter-spacing: 0 !important; word-spacing: 0 !important; font-kerning: normal; text-rendering: optimizeLegibility; }
    .ticket-extra { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: .4mm ${metrics.gapMm}mm; font-size: ${Math.max(1.05, metrics.labelMm)}mm; line-height: 1.05; }
    .ticket-extra span { min-width: 0; display: flex; gap: .8mm; justify-content: space-between; overflow: hidden; white-space: nowrap; direction: ltr; unicode-bidi: isolate; }
    .ticket-extra-label { direction: ltr; text-align: left; unicode-bidi: isolate; }
    .ticket-extra-value[dir="ltr"] { direction: ltr; text-align: left; unicode-bidi: isolate; }
    .ticket-extra-value[dir="rtl"] { direction: rtl; text-align: right; unicode-bidi: isolate; }
    .ticket-extra b, .ticket-extra bdi { overflow: hidden; text-overflow: ellipsis; }
    .ticket-counters { min-width: 0; display: flex; direction: ltr; justify-content: space-between; align-items: flex-end; align-self: end; gap: ${metrics.gapMm}mm; }
    .ticket-counter { min-width: 0; display: grid; gap: .2mm; direction: rtl; line-height: 1.05; }
    .order-counter { justify-items: start; text-align: left; }
    .row-counter { justify-items: end; text-align: right; }
    .ticket-counter span { color: #506174; font-size: ${metrics.labelMm}mm; font-weight: 800; }
    .ticket-counter strong { color: #06152b; font-size: ${Math.max(0.82, metrics.bodyMm * (metrics.tiny ? 0.8 : 0.76))}mm; font-weight: 900; display: inline-flex; align-items: baseline; gap: .55mm; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ticket-counter strong em { font-style: normal; font-weight: 900; }
    .ticket-tiny .ticket-counter span { display: none; }
  `;
  const rows = tickets.map((ticket) => ticketCardPrintHtml(ticket, visibleFields.qrCode ? qrMap[ticket.id] : "", settings, visibleFields)).join("");
  return `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><style>${css}</style></head><body><div class="ticket-sheet">${rows}</div></body></html>`;
}

function ticketCardPrintHtml(ticket, qrSrc, settings, visibleFields = ticketVisibleFields(settings)) {
  const tier = visibleFields.tier || ticketSizeTier(settings);
  const description = ticketDescriptionForSettings(ticket, visibleFields);
  const extras = ticketExtraItems(ticket, visibleFields);
  const hasCounters = visibleFields.orderCounter || visibleFields.rowCounter;
  return `
    <article class="ticket-card ticket-${tier}${qrSrc ? "" : " no-qr"}" lang="ar" dir="rtl">
      <div class="ticket-top">
        ${qrSrc ? `<div class="ticket-qr"><img src="${qrSrc}" /></div>` : ""}
        <div class="ticket-code-block"><strong class="ticket-code" lang="en" dir="ltr">${visibleFields.pieceCode ? escapeHtml(ticket.code) : ""}</strong></div>
      </div>
      <div class="ticket-body">
        ${description ? `<p class="ticket-description" dir="rtl"><bdi>${arabicMixedHtml(description)}</bdi></p>` : ""}
        ${visibleFields.measurements ? `<strong class="ticket-measurement">${measurementMmHtml(ticket.widthMm, ticket.heightMm)}</strong>` : ""}
        ${extras.length ? `<div class="ticket-extra">${extras.map(([label, value]) => {
          const valueDir = ticketExtraValueDir(label, value);
          return `<span class="ticket-extra-item"><b class="ticket-extra-label" lang="en" dir="ltr">${escapeHtml(label)}</b><bdi class="ticket-extra-value" dir="${valueDir}" lang="${valueDir === "ltr" ? "en" : "ar"}">${escapeHtml(value)}</bdi></span>`;
        }).join("")}</div>` : ""}
      </div>
      ${hasCounters ? `<div class="ticket-counters">
        ${visibleFields.orderCounter ? `<div class="ticket-counter order-counter"><span>إجمالي الطلب</span><strong dir="rtl"><bdi dir="ltr">${ticket.orderPieceIndex + 1}</bdi><em>من</em><bdi dir="ltr">${ticket.totalPieces}</bdi></strong></div>` : "<span></span>"}
        ${visibleFields.rowCounter ? `<div class="ticket-counter row-counter"><span>إجمالي البند</span><strong dir="rtl"><bdi dir="ltr">${ticket.rowPieceIndex + 1}</bdi><em>من</em><bdi dir="ltr">${ticket.rowQuantity}</bdi></strong></div>` : "<span></span>"}
      </div>` : ""}
    </article>
  `;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]));
}

function workbookToArrayBuffer(XLSX, workbook) {
  return XLSX.write(workbook, { bookType: "xlsx", type: "array", cellStyles: true });
}

async function saveWorkbook(XLSX, workbook, fileName, saveOptions = {}) {
  return saveBinaryFile(fileName, workbookToArrayBuffer(XLSX, workbook), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", saveOptions);
}

function hexToArgb(hex = "#ffffff") {
  const rgb = hexToRgb(hex) || { r: 255, g: 255, b: 255 };
  return `FF${[rgb.r, rgb.g, rgb.b].map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function applyReportWorksheetStyle(XLSX, ws, headerRowIndex = 0, totalRowIndex = null) {
  if (!ws?.["!ref"]) return;
  const palette = normalizeReportPalette(readAppearanceSettings());
  const range = XLSX.utils.decode_range(ws["!ref"]);
  for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
    for (let colIndex = range.s.c; colIndex <= range.e.c; colIndex += 1) {
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
      if (!ws[address]) ws[address] = { t: "s", v: "" };
      const isHeader = rowIndex === headerRowIndex;
      const isTotal = totalRowIndex !== null && rowIndex === totalRowIndex;
      const fillColor = isHeader
        ? palette.reportHeaderBg
        : isTotal
          ? palette.reportTotalBackground
          : rowIndex % 2 === 0
            ? palette.reportAlternateRowBackground
            : palette.reportRowBackground;
      ws[address].s = {
        font: { bold: isHeader || isTotal, color: { rgb: hexToArgb(isHeader ? palette.reportHeaderColor : palette.reportTextColor) } },
        fill: { fgColor: { rgb: hexToArgb(fillColor) } },
        border: {
          top: { style: "thin", color: { rgb: hexToArgb(palette.reportBorderColor) } },
          bottom: { style: "thin", color: { rgb: hexToArgb(palette.reportBorderColor) } },
          left: { style: "thin", color: { rgb: hexToArgb(palette.reportBorderColor) } },
          right: { style: "thin", color: { rgb: hexToArgb(palette.reportBorderColor) } }
        },
        alignment: { horizontal: "center", vertical: "center", wrapText: true, readingOrder: 2 }
      };
    }
  }
}

async function exportOrderPdf(order, currentUser, logoSrc, saveOptions = {}) {
  try {
    const validation = validateOrderForReport(order);
    if (!validation.ok) throw new Error(validation.message);
    return await renderReportPdf(<OrderReport order={order} currentUser={currentUser} logoSrc={logoSrc} />, `${orderExportFileBase(order)}.pdf`, { reportType: "order", ...supplierFolderPayloadForOrder(order), ...saveOptions });
  } catch (error) {
    showExportError(error);
    return null;
  }
}

async function exportOrderExcel(order) {
  try {
    const XLSX = await loadSpreadsheetModule();
    const validation = validateOrderForReport(order);
    if (!validation.ok) throw new Error(validation.message);
    const itemRows = order.rows.map((row, index) => {
      const totals = rowTotals(row);
      return [
        index + 1,
        rowDescription(row),
        row.code || "",
        rowHasPanels(row) ? Number(rowMaxWidthCm(row).toFixed(1)) : Math.max(...row.layers.map((layer) => numberValue(layer.width))),
        rowHasPanels(row) ? Number(rowMaxHeightCm(row).toFixed(1)) : Math.max(...row.layers.map((layer) => numberValue(layer.height))),
        rowPanelPhysicalCount(row),
        Number(totals.area.toFixed(3))
      ];
    });
    const totals = orderTotals(order);
    const orderTitle = orderExportFileBase(order);
    const sheetRows = [
      [COMPANY.nameAr],
      [orderTitle],
      [],
      ["رقم الطلب", displayOrderNo(order.orderNo), "التاريخ", formatStatusDate(resolveOrderIssueDate(order))],
      ["العميل", order.customerName || "", "المورد", order.supplierName || ""],
      ["المشروع", order.project || "", "نوع الطلب", order.entryMode === "drawings" ? "طلب شراء برسم" : "طلب زجاج عادي"],
      [],
      ["م", "البيان", "الكود", "العرض سم", "الطول سم", "العدد", "المساحة م2"],
      ...itemRows,
      [],
      ["الإجمالي", "", "", "", "", totals.pieces, Number(totals.area.toFixed(3))]
    ];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(sheetRows);
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 6 } },
      { s: { r: sheetRows.length - 1, c: 0 }, e: { r: sheetRows.length - 1, c: 4 } }
    ];
    ws["!cols"] = [
      { wch: 8 },
      { wch: 58 },
      { wch: 18 },
      { wch: 12 },
      { wch: 12 },
      { wch: 10 },
      { wch: 12 }
    ];
    ws["!dir"] = "rtl";
    ws["!rows"] = sheetRows.map((_, rowIndex) => ({ hpt: rowIndex < 2 ? 26 : rowIndex === 7 ? 22 : 30 }));
    ws["!margins"] = { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 };
    applyReportWorksheetStyle(XLSX, ws, 7, sheetRows.length - 1);
    XLSX.utils.book_append_sheet(wb, ws, "طلب الشراء");
    if (order.entryMode === "drawings" || order.rows.some(rowHasReportDrawing)) {
      const drawingRows = [
        ["رقم الصف", "Panel", "Panel Code", "البيان", "المقاس", "الطبقات", "الحواف", "ملاحظات الرسم"],
        ...order.rows.flatMap((row, index) => {
          const notes = drawingFabricationNotes(row);
          if (rowHasPanels(row)) {
            return rowDrawingPanels(row).map((panel, panelIndex) => [
              index + 1,
              panelDisplayName(panel, panelIndex),
              panelCode(row, panel, panelIndex),
              rowDescription(row),
              `${Math.round(numberValue(panel.width))} × ${Math.round(numberValue(panel.height))} mm`,
              row.layers.map((layer, layerIndex) => layerReportDescription(layer, layerIndex)).join(" | "),
              drawingOutlineSummary({ panels: [panel] }),
              notes.filter((note) => note.includes(`Panel ${panelDisplayName(panel, panelIndex)}`)).join(" | ") || panel.notes || "لوح مسطح بدون قص أو ثقوب إضافية."
            ]);
          }
          return [[
            index + 1,
            "",
            row.code || "",
            rowDescription(row),
            `${Math.round(rowMaxWidthCm(row) * 10)} × ${Math.round(rowMaxHeightCm(row) * 10)} mm`,
            row.layers.map((layer, layerIndex) => layerReportDescription(layer, layerIndex)).join(" | "),
            drawingOutlineSummary(row.drawing),
            notes.length ? notes.join(" | ") : "لوح مسطح بدون قص أو ثقوب إضافية."
          ]];
        })
      ];
      const drawingSheet = XLSX.utils.aoa_to_sheet(drawingRows);
      drawingSheet["!cols"] = [{ wch: 10 }, { wch: 12 }, { wch: 18 }, { wch: 42 }, { wch: 22 }, { wch: 58 }, { wch: 44 }, { wch: 72 }];
      applyReportWorksheetStyle(XLSX, drawingSheet, 0, null);
      XLSX.utils.book_append_sheet(wb, drawingSheet, "رسومات");
    }
    return await saveWorkbook(XLSX, wb, `${orderTitle}.xlsx`, { reportType: "order", ...supplierFolderPayloadForOrder(order) });
  } catch (error) {
    showExportError(error);
    return null;
  }
}

async function exportStatementExcel(statement) {
  try {
    const XLSX = await loadSpreadsheetModule();
    const rows = [];
    for (const supplier of statement.suppliers) {
      for (const doc of supplier.documents) rows.push({ "المورد": supplier.supplier, "رقم الإذن": doc.documentId, "القطع": doc.pieces, "المساحة م2": doc.area, "التكلفة": doc.cost });
      rows.push({ "المورد": `إجمالي المورد ${supplier.supplier}`, "القطع": supplier.subtotal.pieces, "المساحة م2": supplier.subtotal.area, "التكلفة": supplier.subtotal.cost });
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Glass Statement");
    return await saveWorkbook(XLSX, wb, "GlassStatement.xlsx", { reportType: "statement" });
  } catch (error) {
    showExportError(error);
    return null;
  }
}

async function exportSupplierExcel(statement) {
  try {
    const XLSX = await loadSpreadsheetModule();
    const wb = XLSX.utils.book_new();
    let rows;
    let columns;
    if (statement.mode === RANGE_STATEMENT_MODE) {
      columns = [
        "التاريخ",
        "النوع",
        "رقم الطلب",
        "رقم الإذن",
        "العميل / المشروع",
        "البيان",
        "المرجع / الكود",
        "العدد",
        "المساحة م2",
        "تكلفة البند",
        "مدين",
        "دائن",
        "الرصيد"
      ];
      rows = [[
        statement.fromDate || "",
        "رصيد مرحل",
        "",
        "",
        "",
        statement.openingRow.label,
        "",
        "",
        "",
        "",
        statement.openingRow.debit || "",
        statement.openingRow.credit || "",
        statement.openingRow.balance
      ]];
      for (const transaction of statement.transactions) {
        if (transaction.type === "order") {
          rows.push([
            transaction.date,
            "طلب مورد",
            displayOrderNo(transaction.orderNo),
            transaction.documentId || orderDocumentId(transaction.order),
            [transaction.customerName, transaction.project].filter(Boolean).join(" / "),
            statusLabel(transaction.status),
            "",
            "",
            "",
            "",
            transaction.cost,
            "",
            transaction.balanceAfter
          ]);
          for (const row of transaction.rows) {
            rows.push([
              "",
              "تفصيل طلب",
              "",
              "",
              "",
              row.description,
              row.code,
              row.quantity,
              Number(numberValue(row.area).toFixed(3)),
              row.cost,
              "",
              "",
              ""
            ]);
          }
        } else {
          rows.push([
            transaction.date,
            "دفعة",
            "",
            "",
            "",
            [transaction.method, transaction.notes].filter(Boolean).join(" — ") || "دفعة مورد",
            transaction.reference,
            "",
            "",
            "",
            "",
            transaction.amount,
            transaction.balanceAfter
          ]);
        }
      }
      rows.push([
        "",
        "",
        "",
        "",
        "",
        statement.finalTotal.label,
        "",
        "",
        "",
        "",
        statement.totals.orderCost,
        statement.totals.payments,
        statement.finalTotal.value
      ]);
    } else {
      columns = [
        "التاريخ",
        "رقم الطلب",
        "رقم الإذن",
        "العميل / المشروع",
        "البيان",
        "الكود",
        "العدد",
        "المساحة م2",
        "تكلفة البند",
        "إجمالي الطلب"
      ];
      rows = [];
      for (const order of statement.orders) {
        rows.push([
          order.date,
          displayOrderNo(order.orderNo),
          order.documentId || orderDocumentId(order.order),
          [order.customerName, order.project].filter(Boolean).join(" / "),
          `حالة الطلب: ${statusLabel(order.status)}`,
          "",
          "",
          "",
          "",
          order.cost
        ]);
        for (const row of order.rows) {
          rows.push([
            "",
            "",
            "",
            "",
            row.description,
            row.code,
            row.quantity,
            Number(numberValue(row.area).toFixed(3)),
            row.cost,
            ""
          ]);
        }
      }
      rows.push(["", "", "", "", statement.finalTotal.label, "", "", "", "", statement.finalTotal.value]);
    }
    const ws = XLSX.utils.aoa_to_sheet([columns, ...rows]);
    ws["!dir"] = "rtl";
    ws["!cols"] = columns.map((column) => ({
      wch: /البيان|العميل/.test(column) ? 38 : /المرجع|الكود/.test(column) ? 20 : 14
    }));
    applyReportWorksheetStyle(XLSX, ws, 0, rows.length);
    XLSX.utils.book_append_sheet(wb, ws, "Supplier Statement");
    return await saveWorkbook(
      XLSX,
      wb,
      `${supplierStatementFileBase(statement)}.xlsx`,
      { reportType: "supplier", ...supplierFolderPayloadForSupplier(statement.supplier) }
    );
  } catch (error) {
    showExportError(error);
    return null;
  }
}

function sanitizeOrderStatusReportCosts(report, currentUser) {
  if (report?.showCosts && canCurrentUserViewCosts(currentUser)) return report;
  const withoutCost = (value = {}) => {
    const { cost: _cost, ...rest } = value;
    return rest;
  };
  return {
    ...report,
    showCosts: false,
    rows: (report?.rows || []).map(withoutCost),
    suppliers: (report?.suppliers || []).map((supplier) => ({
      ...supplier,
      rows: (supplier.rows || []).map(withoutCost),
      subtotal: withoutCost(supplier.subtotal)
    })),
    total: withoutCost(report?.total)
  };
}

async function exportOrderStatusExcel(report, currentUser) {
  try {
    const XLSX = await loadSpreadsheetModule();
    const safeReport = sanitizeOrderStatusReportCosts(report, currentUser);
    const rows = safeReport.rows.map((row) => ({
      "المورد": row.supplier,
      "رقم الإذن": row.documentId,
      "العميل / المشروع": [row.customer, row.project].filter(Boolean).join(" / "),
      "رقم الطلب": row.orderNo,
      "تاريخ الطلب": row.date,
      "المطلوب": row.quantity,
      "المستلم": row.receivedQuantity,
      "المتبقي": row.remainingQuantity,
      "المساحة": row.area,
      "الحالة": row.statusText || statusLabel(row.status),
      "نوع الزجاج": row.glass,
      "ملاحظات": row.notes,
      ...(safeReport.showCosts ? { "تكلفة المورد": row.cost } : {})
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "Orders Status");
    if (safeReport.showCosts) {
      const costRows = safeReport.suppliers.map((supplier) => ({
        "المورد": supplier.supplier,
        "عدد الطلبات": supplier.rows.length,
        "الإجمالي الفرعي": supplier.subtotal.cost
      }));
      if (safeReport.suppliers.length > 1) {
        costRows.push({ "المورد": "الإجمالي الكلي", "عدد الطلبات": safeReport.rows.length, "الإجمالي الفرعي": safeReport.total.cost });
      }
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(costRows), "Cost Summary");
    }
    return await saveWorkbook(XLSX, wb, `${orderStatusReportFileBase(safeReport)}.xlsx`, { reportType: "status" });
  } catch (error) {
    showExportError(error);
    return null;
  }
}

async function exportStatementPdf(statement, currentUser, logoSrc) {
  try {
    return await renderReportPdf(<><ReportHeader title="تقرير مساحات الزجاج" logoSrc={logoSrc} /><StatementTable statement={statement} /><ReportFooter currentUser={currentUser} /></>, "GlassStatement.pdf", { reportType: "statement" });
  } catch (error) {
    showExportError(error);
    return null;
  }
}

async function exportSupplierPdf(statement, currentUser, logoSrc) {
  try {
    return await renderReportPdf(
      <SupplierReport statement={statement} currentUser={currentUser} logoSrc={logoSrc} />,
      `${supplierStatementFileBase(statement)}.pdf`,
      { reportType: "supplier", ...supplierFolderPayloadForSupplier(statement.supplier) }
    );
  } catch (error) {
    showExportError(error);
    return null;
  }
}

async function exportOrderStatusPdf(report, currentUser, logoSrc, saveOptions = {}) {
  try {
    const safeReport = sanitizeOrderStatusReportCosts(report, currentUser);
    return await renderReportPdf(<OrderStatusReport report={safeReport} currentUser={currentUser} logoSrc={logoSrc} />, `${orderStatusReportFileBase(safeReport)}.pdf`, { reportType: "status", ...saveOptions });
  } catch (error) {
    showExportError(error);
    return null;
  }
}

function exportPreviewExcel(preview, currentUser) {
  if (preview.type === "order") return exportOrderExcel(preview.order);
  if (preview.type === "statement") return exportStatementExcel(preview.statement);
  if (preview.type === "supplier") return exportSupplierExcel(preview.statement);
  if (preview.type === "orderStatus") return exportOrderStatusExcel(preview.report, currentUser);
  return null;
}

function statusVariantEmptyData() {
  return { customers: [], suppliers: [], payments: [], users: [], orders: [], learnedOptions: GAP_DEFAULTS, learnedTableOptions: normalizeLearnedTableOptions() };
}

function statusVariantOrderKey(order = {}) {
  return order.id || order.orderNo || order.documentId || "";
}

function StatusVariantApp() {
  const runtimeVersion = useRuntimeAppVersion();
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [currentUser, setCurrentUser] = useState(currentStoredUser);
  const [sessionRestoreChecked, setSessionRestoreChecked] = useState(false);
  const [data, setData] = useState(statusVariantEmptyData);
  const [query, setQuery] = useState("");
  const [selectedSupplier, setSelectedSupplier] = useState("");
  const [selectedStatuses, setSelectedStatuses] = useState(["ordered", "fabrication", "ready", "partial"]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showCosts, setShowCosts] = useState(false);
  const [selectedOrderKey, setSelectedOrderKey] = useState("");
  const [previewStatusReport, setPreviewStatusReport] = useState(null);
  const [supplierPopupOpen, setSupplierPopupOpen] = useState(false);
  const [statusPopupOpen, setStatusPopupOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [appearance, setAppearance] = useState(readAppearanceSettings);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [passwordRecoveryOpen, setPasswordRecoveryOpen] = useState(false);
  useDesktopPasswordRecovery(setPasswordRecoveryOpen, setMessage, setCurrentUser);
  const pdfJobRef = useRef(null);
  const reportLogoSrc = appearance.reportLogoDataUrl || loadingLogo;

  useEffect(() => {
    applyAppearanceSettings(appearance);
    persistAppearanceSettings(appearance, currentUser);
  }, [appearance, currentUser?.id]);

  useEffect(() => {
    if (!currentUser || !hasSupabaseConfig()) return undefined;
    let cancelled = false;
    loadGlobalAppearanceSettings()
      .then((globalSettings) => {
        if (cancelled) return;
        setAppearance(mergeAppearanceSettings(globalSettings, readStoredJson(appearanceStorageKey(currentUser), readStoredJson(APPEARANCE_STORAGE_KEY, {}))));
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [currentUser?.id]);

  useEffect(() => {
    document.title = `حالة الطلبات — ${FULL_APP_NAME}`;
  }, []);

  useEffect(() => {
    if (!message) return undefined;
    const timer = window.setTimeout(() => setMessage(""), 5600);
    return () => window.clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    let cancelled = false;
    restoreSupabaseSessionUser().then((user) => {
      if (cancelled) return;
      if (user) setCurrentUser(user);
      setSessionRestoreChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const client = getSupabaseClient();
    if (!client) return undefined;
    const { data: listener } = client.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setPasswordRecoveryOpen(true);
    });
    return () => listener?.subscription?.unsubscribe?.();
  }, []);

  useEffect(() => {
    if (!sessionRestoreChecked || !window.glassOrdersDesktop?.syncTelegramBotSession) return;
    syncDesktopTelegramSession(!!currentUser).catch((error) => {
      if (currentUser) setMessage(`تعذر تجهيز بوت Telegram. ${safeErrorMessage(error)}`);
    });
  }, [currentUser?.id, sessionRestoreChecked]);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      if (!sessionRestoreChecked) return;
      if (!currentUser) {
        setData(statusVariantEmptyData());
        setSelectedOrderKey("");
        setPreviewStatusReport(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const next = await loadData();
        if (cancelled) return;
        setData(next);
        setMessage("تم تحميل حالة الطلبات.");
      } catch (error) {
        if (cancelled) return;
        setData(statusVariantEmptyData());
        setSelectedOrderKey("");
        setMessage(`تعذر تحميل حالة الطلبات: ${safeErrorMessage(error)}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    bootstrap();
    return () => {
      cancelled = true;
    };
  }, [currentUser, sessionRestoreChecked]);

  const supplierNames = useMemo(() => uniqueValues((data.orders || []).map((order) => order.supplierName || "بدون مورد")), [data.orders]);
  const selectedStatusSet = useMemo(() => new Set(selectedStatuses), [selectedStatuses]);
  const canViewCosts = canCurrentUserViewCosts(currentUser);
  const costsVisible = canViewCosts && showCosts;
  const visibleOrders = useMemo(() => (data.orders || []).filter((order) => {
    const status = normalizeOrderStatus(order.status);
    const supplierAllowed = !selectedSupplier || (order.supplierName || "بدون مورد") === selectedSupplier;
    const statusAllowed = selectedStatusSet.size === 0 || selectedStatusSet.has(status);
    const dateAllowed = (!dateFrom || String(order.date || "") >= dateFrom) && (!dateTo || String(order.date || "") <= dateTo);
    const searchAllowed = matchesQuery(query, order.orderNo, order.documentId, order.supplierName, order.customerName, order.project, order.date, statusLabel(status), ...(order.rows || []).map((row) => row.code), ...(order.rows || []).map(rowDescription));
    return supplierAllowed && statusAllowed && dateAllowed && searchAllowed;
  }), [data.orders, query, selectedSupplier, selectedStatusSet, dateFrom, dateTo]);
  const selectedOrder = useMemo(() => visibleOrders.find((order) => statusVariantOrderKey(order) === selectedOrderKey) || null, [visibleOrders, selectedOrderKey]);
  const statusReportOrders = useMemo(() => selectedOrder ? [selectedOrder] : visibleOrders, [selectedOrder, visibleOrders]);
  const statusReport = useMemo(() => buildOrderStatusReport(statusReportOrders, selectedSupplier ? [selectedSupplier] : [], { showCosts: costsVisible }), [statusReportOrders, selectedSupplier, costsVisible]);
  const statusCostSummary = useMemo(() => costsVisible
    ? buildFilteredSupplierCostSubtotals(statusReportOrders, { getCost: (order) => orderTotals(order).supplierCost, filter: isOrderPayableForSupplier })
    : null, [statusReportOrders, costsVisible]);
  const statusReportHasRows = statusReport.rows.length > 0;
  const connectionLabel = data.source === "supabase" ? "متصل" : navigator.onLine ? "متصل" : "غير متصل";

  async function handleLogin(credentials) {
    setLoading(true);
    setMessage("");
    try {
      const user = await loginUser(credentials.username, credentials.password, credentials.email);
      setCurrentUser(user);
    } catch (error) {
      setMessage(`تعذر تسجيل الدخول: ${safeErrorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleResetSupabasePassword(credentials) {
    setLoading(true);
    try {
      await sendSupabasePasswordReset(credentials.username, credentials.email);
      setMessage("تم قبول الطلب. إذا كانت بيانات الحساب صحيحة فسيصل رابط إعادة التعيين إلى البريد المسجل.");
    } catch (error) {
      setMessage(`تعذر إرسال إعادة التعيين: ${safeErrorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  }

  async function completeStatusPasswordRecovery(newPassword) {
    setLoading(true);
    try {
      if (String(newPassword || "").length < 10) throw new Error("كلمة المرور يجب ألا تقل عن 10 أحرف.");
      const client = getSupabaseClient();
      if (!client) throw new Error("الاتصال غير متاح.");
      const result = await client.auth.updateUser({ password: newPassword });
      if (result.error) throw result.error;
      await clearSupabaseRecoverySession(setPasswordRecoveryOpen, setCurrentUser);
      setMessage("تم تحديث كلمة المرور. يمكنك تسجيل الدخول الآن.");
    } catch (error) {
      setMessage(`تعذر تحديث كلمة المرور: ${safeErrorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  }

  async function closeStatusPasswordRecovery() {
    await clearSupabaseRecoverySession(setPasswordRecoveryOpen, setCurrentUser);
  }

  async function refreshStatusOrders() {
    if (loading) return;
    setLoading(true);
    try {
      const next = await loadData();
      setData(next);
      setSelectedOrderKey((current) => next.orders?.some((order) => statusVariantOrderKey(order) === current) ? current : "");
      setMessage("تم تحديث حالة الطلبات.");
    } catch (error) {
      setMessage(`تعذر تحديث البيانات: ${safeErrorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    getSupabaseClient()?.auth?.signOut?.({ scope: "local" }).catch(() => null);
    if (sessionStorage.getItem(LOCAL_SESSION_TOKEN_KEY)) {
      localRequest("/api/auth/logout", { method: "POST" }).catch(() => null);
      sessionStorage.removeItem(LOCAL_SESSION_TOKEN_KEY);
    }
    clearSupabaseAuthStorage();
    resetSupabaseClientCache();
    localStorage.removeItem("glassOrdersUser");
    setCurrentUser(null);
    setData(statusVariantEmptyData());
    setSelectedOrderKey("");
    setPreviewStatusReport(null);
    setMessage("");
  }

  function toggleTheme() {
    const nextTheme = appearance.theme === "dark" ? "light" : "dark";
    setAppearance(appearanceWithTheme(nextTheme, appearance));
  }

  function clearFilters() {
    setQuery("");
    setSelectedSupplier("");
    setSelectedStatuses([]);
    setDateFrom("");
    setDateTo("");
    setSelectedOrderKey("");
  }

  function selectOrder(order) {
    const key = statusVariantOrderKey(order);
    setSelectedOrderKey((current) => current === key ? "" : key);
  }

  async function generateStatusReportPdf({ share = false, reportOverride = null } = {}) {
    const targetReport = reportOverride || statusReport;
    if (!targetReport?.rows?.length) {
      setMessage("لا توجد بنود في تقرير حالة الطلبات الحالي.");
      return null;
    }
    if (pdfJobRef.current) return pdfJobRef.current;
    const job = (async () => {
      setPdfBusy(true);
      setMessage(share ? "جاري إنشاء تقرير حالة الطلبات للمشاركة..." : "جاري إنشاء تقرير حالة الطلبات PDF...");
      const result = await exportOrderStatusPdf(targetReport, currentUser, reportLogoSrc, { androidCache: true, androidShare: share });
      if (result?.ok) {
        setMessage(result.shared ? "تم فتح قائمة مشاركة PDF." : `تم إنشاء ملف PDF: ${result.fileName || ""}`);
      } else if (!result?.canceled) {
        setMessage("تعذر إنشاء ملف PDF. لم يتم حفظ أو مشاركة ملف غير مكتمل.");
      }
      return result;
    })().catch((error) => {
      setMessage(`تعذر إنشاء ملف PDF: ${safeErrorMessage(error)}`);
      return null;
    }).finally(() => {
      pdfJobRef.current = null;
      setPdfBusy(false);
    });
    pdfJobRef.current = job;
    return job;
  }

  if (!currentUser) {
    return (
      <main className="status-app-shell auth-only" dir="rtl">
        {loading && <LoadingLayer logoSrc={loadingLogo} stage="جاري تحميل حالة الطلبات..." version={runtimeVersion} />}
        <LoginView
          onLogin={handleLogin}
          onResetPassword={handleResetSupabasePassword}
          supabaseMode={hasSupabaseConfig()}
          message={message}
          onClearMessage={() => setMessage("")}
          busy={loading}
          logoSrc={appLogo}
          version={runtimeVersion}
        />
        {passwordRecoveryOpen && (
          <PasswordRecoveryModal
            busy={loading}
            onSave={completeStatusPasswordRecovery}
            onClose={closeStatusPasswordRecovery}
          />
        )}
      </main>
    );
  }

  return (
    <main className="status-app-shell" dir="rtl">
      {loading && <LoadingLayer logoSrc={loadingLogo} stage="جاري تحديث حالة الطلبات..." version={runtimeVersion} />}
      {passwordRecoveryOpen && (
        <PasswordRecoveryModal
          busy={loading}
          onSave={completeStatusPasswordRecovery}
          onClose={closeStatusPasswordRecovery}
        />
      )}
      <header className="status-mobile-header">
        <strong>حالة الطلبات</strong>
        <span className={data.source === "supabase" ? "connection-dot online" : "connection-dot"} title={connectionLabel} />
        <button type="button" className="icon-button" title="تبديل المظهر" onClick={toggleTheme}>{appearance.theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}</button>
        <button type="button" className="icon-button" title="تحديث" disabled={loading} onClick={refreshStatusOrders}><RefreshCw size={17} /></button>
        <div className="status-account-menu">
          <button type="button" className="icon-button" title="الحساب" onClick={() => setAccountOpen((current) => !current)}><LogOut size={17} /></button>
          {accountOpen && (
            <div className="status-account-popup">
              <strong>{currentUser.display_name || currentUser.username}</strong>
              <span>{connectionLabel}</span>
              <button type="button" onClick={logout}><LogOut size={16} />تسجيل الخروج</button>
            </div>
          )}
        </div>
      </header>
      {message && <Notice message={message} onClose={() => setMessage("")} />}
      <section className="status-only-content">
        <div className="status-actions-bar">
          <button type="button" disabled={!statusReportHasRows} onClick={() => setPreviewStatusReport(statusReport)}><Eye size={16} />معاينة تقرير الحالة</button>
          <button type="button" disabled={!statusReportHasRows || pdfBusy} onClick={() => generateStatusReportPdf()}><FileDown size={16} />PDF</button>
          <button type="button" disabled={!statusReportHasRows || pdfBusy} onClick={() => generateStatusReportPdf({ share: true })}><Download size={16} />مشاركة</button>
          <button type="button" disabled={loading} onClick={refreshStatusOrders}><RefreshCw size={16} />تحديث</button>
        </div>
        <div className="status-filter-panel">
          <SearchBox value={query} onChange={setQuery} placeholder="بحث بالمورد / العميل / المشروع / رقم الطلب / رقم إذن المورد" />
          <div className="status-filter-row">
            <button type="button" onClick={() => setSupplierPopupOpen(true)}>المورد <span>{selectedSupplier || "كل الموردين"}</span></button>
            <button type="button" onClick={() => setStatusPopupOpen(true)}>الحالات <span>{selectedStatuses.length ? `${selectedStatuses.length} محدد` : "كل الحالات"}</span></button>
            <label className="status-date-filter">من<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
            <label className="status-date-filter">إلى<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
            {canViewCosts && <label className="status-cost-toggle"><input type="checkbox" checked={showCosts} onChange={(event) => setShowCosts(event.target.checked)} />إظهار التكلفة</label>}
            <button type="button" onClick={clearFilters}>مسح عوامل التصفية</button>
          </div>
          <div className="status-info-line">
            <span>عدد النتائج الظاهرة: {visibleOrders.length}</span>
            <span>{connectionLabel}</span>
            {selectedOrder && (
              <>
                <strong>نطاق التقرير والتكلفة: <bdi dir="ltr">{displayOrderNo(selectedOrder.orderNo)}</bdi></strong>
                <button type="button" onClick={() => setSelectedOrderKey("")}>إلغاء تحديد الطلب</button>
              </>
            )}
          </div>
        </div>
        <StatusOrderList orders={visibleOrders} selectedOrderKey={selectedOrderKey} onSelect={selectOrder} showCosts={costsVisible} />
        {costsVisible && statusCostSummary && (
          <div className="status-cost-summary status-only-cost-summary">
            {statusCostSummary.suppliers.map((supplier) => <div key={supplier.supplier}><span>{supplier.supplier}</span><strong>{money(supplier.subtotal)}</strong></div>)}
            {statusCostSummary.showGrandTotal && <div className="grand-total"><span>الإجمالي الكلي</span><strong>{money(statusCostSummary.grandTotal)}</strong></div>}
          </div>
        )}
      </section>
      {supplierPopupOpen && <SupplierFilterPopup suppliers={supplierNames} selectedSupplier={selectedSupplier} onSelect={(supplier) => { setSelectedSupplier(supplier); setSupplierPopupOpen(false); }} onClose={() => setSupplierPopupOpen(false)} />}
      {statusPopupOpen && <StatusFilterPopup selectedStatuses={selectedStatuses} onChange={setSelectedStatuses} onClose={() => setStatusPopupOpen(false)} />}
      {previewStatusReport && <StatusReportPreview report={previewStatusReport} currentUser={currentUser} logoSrc={reportLogoSrc} onClose={() => setPreviewStatusReport(null)} onPdf={() => generateStatusReportPdf({ reportOverride: previewStatusReport })} onShare={() => generateStatusReportPdf({ reportOverride: previewStatusReport, share: true })} pdfBusy={pdfBusy} />}
    </main>
  );
}

function SupplierFilterPopup({ suppliers, selectedSupplier, onSelect, onClose }) {
  const [query, setQuery] = useState("");
  const visibleSuppliers = useMemo(() => suppliers.filter((supplier) => matchesQuery(query, supplier)), [suppliers, query]);
  return (
    <div className="status-filter-layer" onMouseDown={onClose}>
      <div className="status-filter-popup" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <div className="status-filter-popup-head">
          <strong>المورد</strong>
          <button type="button" className="icon-button" onClick={onClose}><XCircle size={17} /></button>
        </div>
        <SearchBox value={query} onChange={setQuery} placeholder="بحث الموردين" />
        <div className="status-popup-list">
          <button type="button" className={!selectedSupplier ? "active" : ""} onClick={() => onSelect("")}>كل الموردين</button>
          {visibleSuppliers.map((supplier) => (
            <button type="button" key={supplier} className={selectedSupplier === supplier ? "active" : ""} onClick={() => onSelect(supplier)}>{supplier}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatusFilterPopup({ selectedStatuses, onChange, onClose }) {
  const selectedSet = new Set(selectedStatuses);
  function toggle(status) {
    const next = new Set(selectedSet);
    if (next.has(status)) next.delete(status);
    else next.add(status);
    onChange([...next]);
  }
  return (
    <div className="status-filter-layer" onMouseDown={onClose}>
      <div className="status-filter-popup" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <div className="status-filter-popup-head">
          <strong>الحالات</strong>
          <button type="button" className="icon-button" onClick={onClose}><XCircle size={17} /></button>
        </div>
        <div className="status-popup-tools">
          <button type="button" onClick={() => onChange(ORDER_STATUS_DEFS.map((status) => status.value))}>تحديد الكل</button>
          <button type="button" onClick={() => onChange([])}>مسح الكل</button>
        </div>
        <div className="status-popup-list checkbox-list">
          {ORDER_STATUS_DEFS.map((status) => (
            <label key={status.value}>
              <input type="checkbox" checked={selectedSet.has(status.value)} onChange={() => toggle(status.value)} />
              {status.label}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatusOrderList({ orders, selectedOrderKey, onSelect, showCosts = false }) {
  return (
    <div className="status-order-list">
      {orders.length === 0 && <p className="hint padded">لا توجد طلبات مطابقة للفلاتر.</p>}
      {orders.map((order) => (
        <StatusOrderCard
          key={statusVariantOrderKey(order)}
          order={order}
          selected={selectedOrderKey === statusVariantOrderKey(order)}
          onSelect={() => onSelect(order)}
          showCosts={showCosts}
        />
      ))}
    </div>
  );
}

function StatusOrderCard({ order, selected, onSelect, showCosts = false }) {
  const totals = orderTotals(order);
  const status = normalizeOrderStatus(order.status);
  return (
    <article className={selected ? "status-order-card selected" : "status-order-card"} onClick={onSelect}>
      <div className="status-card-title">
        <strong dir="ltr">{displayOrderNo(order.orderNo)}</strong>
        <span className={statusClassName(status)}>{statusLabel(status)}</span>
      </div>
      <dl className="status-readonly-grid">
        <div><dt>المورد</dt><dd>{order.supplierName || "بدون مورد"}</dd></div>
        <div><dt>العميل / المشروع</dt><dd>{[order.customerName, order.project].filter(Boolean).join(" / ") || "بدون بيانات"}</dd></div>
        <div><dt>التاريخ</dt><dd dir="ltr">{formatStatusDate(order.date)}</dd></div>
        <div><dt>رقم إذن المورد</dt><dd dir="ltr">{orderDocumentId(order)}</dd></div>
        <div><dt>المستلم</dt><dd>{money(orderCollectedPieces(order))}</dd></div>
        <div><dt>المتبقي</dt><dd>{money(orderRemainingPieces(order))}</dd></div>
        <div><dt>القطع</dt><dd>{money(totals.pieces)}</dd></div>
        <div><dt>المساحة</dt><dd>{square(totals.area)} م2</dd></div>
        {showCosts && <div><dt>تكلفة المورد</dt><dd>{isOrderPayableForSupplier(order) ? money(totals.supplierCost) : "غير مستحق"}</dd></div>}
      </dl>
      <GlassTypeBreakdown order={order} compact />
      {selected && (
        <div className="status-card-details">
          {(order.rows || []).slice(0, 8).map((row, index) => (
            <div key={row.id || index} className="status-card-row">
              <span>{index + 1}</span>
              <bdi dir="rtl">{rowDescription(row)}</bdi>
              <span dir="ltr">{row.code || "-"}</span>
              <span dir="ltr">{`${rowMaxWidthCm(row) || ""} × ${rowMaxHeightCm(row) || ""}`}</span>
            </div>
          ))}
          {(order.rows || []).length > 8 && <p className="hint">والمزيد داخل التقرير.</p>}
        </div>
      )}
      <div className="status-card-actions" onClick={(event) => event.stopPropagation()}>
        <button type="button" onClick={onSelect}>{selected ? "محدد" : "تحديد"}</button>
      </div>
    </article>
  );
}

function StatusReportPreview({ report, currentUser, logoSrc, onClose, onPdf, onShare, pdfBusy }) {
  return (
    <div className="status-preview-shell">
      <div className="status-preview-toolbar">
        <button type="button" onClick={onClose}>رجوع</button>
        <strong>تقرير حالة الطلبات</strong>
        <button type="button" disabled={pdfBusy} onClick={onPdf}><FileDown size={16} />PDF</button>
        <button type="button" disabled={pdfBusy} onClick={onShare}><Download size={16} />مشاركة</button>
      </div>
      <div className="status-preview-scroll">
        <div className="preview-page order-status-preview-page">
          <OrderStatusReport report={sanitizeOrderStatusReportCosts(report, currentUser)} currentUser={currentUser} logoSrc={logoSrc} />
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(IS_STATUS_VARIANT ? <StatusVariantApp /> : <App />);
