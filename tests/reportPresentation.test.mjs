import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");
const styleSource = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

function sourceBetween(start, end) {
  const startIndex = appSource.indexOf(start);
  const endIndex = appSource.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`);
  return appSource.slice(startIndex, endIndex);
}

test("report previews contain no edit-order controls while interactive screens retain them", () => {
  const previewModal = sourceBetween("function PreviewModal(", "function OrderReport(");
  const statusReport = sourceBetween("function OrderStatusReport(", "function SupplierStatementOrderBlock(");
  const supplierReports = sourceBetween("function SupplierStatementOrderBlock(", "function ReportHeader(");

  for (const reportSource of [previewModal, statusReport, supplierReports]) {
    assert.doesNotMatch(reportSource, /title="تعديل الطلب"/);
    assert.doesNotMatch(reportSource, /onEditOrder|onOpenOrder/);
    assert.doesNotMatch(reportSource, /<Pencil\b/);
  }

  assert.match(appSource, /className="status-actions"[\s\S]*title="تعديل الطلب"[\s\S]*openOrderEditor\(order\)/);
  assert.match(appSource, /<StatementTable statement=\{statement\} onOpen=\{onOpen\} canEditOrder=\{canEditOrder\}/);
});

test("print and PDF clones physically remove report edit controls", () => {
  const selectorSource = sourceBetween("const REPORT_EDIT_CONTROL_SELECTOR", "function reportPrintDocumentHtml(");
  assert.match(selectorSource, /statement-order-edit/);
  assert.match(selectorSource, /button\[title="تعديل الطلب"\]/);
  assert.match(appSource, /function reportPrintDocumentHtml[\s\S]*removeReportEditControls\(clone\)[\s\S]*clone\.innerHTML/);
  assert.match(appSource, /function preparePdfClone[\s\S]*removeReportEditControls\(clonedElement\)/);
});

test("Orders Status preview uses an isolated toolbar and width-safe report grid", () => {
  const previewModal = sourceBetween("function PreviewModal(", "function OrderReport(");
  const orderStatusFileBase = sourceBetween("function orderStatusReportFileBase(", "function readJsonSetting(");
  const orderStatusExcel = sourceBetween("async function exportOrderStatusExcel(", "async function exportStatementPdf(");
  const orderStatusPdf = sourceBetween("async function exportOrderStatusPdf(", "function exportPreviewExcel(");
  assert.match(previewModal, /report-preview-modal/);
  assert.match(previewModal, /report-preview-toolbar/);
  assert.match(previewModal, /report-preview-scroll/);
  assert.match(previewModal, /order-status-preview-page/);
  assert.match(previewModal, /orderStatusReportFileBase\(preview\.report\)/);
  assert.match(orderStatusFileBase, /supplierPart/);
  assert.match(orderStatusFileBase, /statusPart/);
  assert.match(orderStatusFileBase, /تقرير حالة الطلبات - \$\{supplierPart\} - \$\{statusPart\}/);
  assert.match(orderStatusExcel, /orderStatusReportFileBase\(safeReport\)/);
  assert.match(orderStatusPdf, /orderStatusReportFileBase\(safeReport\)/);
  assert.doesNotMatch(orderStatusExcel, /OrdersStatus\.xlsx/);
  assert.doesNotMatch(orderStatusPdf, /OrdersStatus\.pdf/);

  assert.match(styleSource, /\.report-preview-modal\s*\{[\s\S]*grid-template-rows:\s*auto minmax\(0,\s*1fr\)/);
  assert.match(styleSource, /\.report-preview-scroll\s*\{[\s\S]*overflow:\s*auto/);
  assert.match(styleSource, /\.order-status-report-table\.without-cost \.order-status-report-row\s*\{[\s\S]*minmax\(0,\s*2\.14fr\)/);
  assert.match(styleSource, /\.order-status-report-table\.with-cost \.order-status-report-row\s*\{[\s\S]*minmax\(0,\s*1\.94fr\)/);
  assert.match(styleSource, /\.order-status-report-row\.supplier-subtotal\s*\{[\s\S]*border-block/);
  assert.match(styleSource, /\.order-status-report-row > span,\s*\.order-status-report-row > \.report-glass-breakdown\s*\{[\s\S]*border-inline-start/);
  assert.match(styleSource, /\.order-status-report-row > span,\s*\.order-status-report-row > \.report-glass-breakdown\s*\{[\s\S]*overflow-wrap:\s*break-word/);
  assert.match(styleSource, /\.order-status-report-row \.keep-line\s*\{[\s\S]*word-break:\s*normal/);
});

test("compact desktop entry layout is scoped away from full desktop and mobile", () => {
  assert.match(appSource, /className="panel entry-order-panel"/);
  assert.match(appSource, /"stack",\s*"entry-screen"/);
  assert.match(styleSource, /\.stack\.entry-screen\s*\{[\s\S]*grid-auto-rows:\s*max-content/);
  assert.match(styleSource, /@media \(min-width: 820px\) and \(max-width: 1050px\)\s*\{[\s\S]*\.workspace > \.entry-screen > \.entry-order-panel/);
  assert.match(styleSource, /\.entry-order-panel \.form-grid\s*\{[\s\S]*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(styleSource, /\.table-panel:not\(\.fullscreen-table\) > \.panel-head > \.actions\s*\{[\s\S]*repeat\(5,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(styleSource, /> \.table-panel:not\(\.fullscreen-table\)\s*\{[\s\S]*overflow:\s*hidden/);
});

test("double-glass layer rows have visible section separators", () => {
  assert.match(styleSource, /\.layers-cell > \.layer-line \+ \.material-line > \*/);
  assert.match(styleSource, /\.layers-cell > \.material-line \+ \.layer-line > \*/);
  assert.match(styleSource, /border-top:\s*2px solid color-mix\(in srgb,\s*var\(--gold\) 58%,\s*var\(--table-line\)\)/);
  assert.match(styleSource, /\.layers-cell > \.material-line > \*\s*\{[\s\S]*var\(--table-cell-alt-bg\)/);
});

test("status-only mobile layout keeps cards and filters viewport-safe", () => {
  assert.match(styleSource, /\.status-only-content\s*\{[\s\S]*-webkit-overflow-scrolling:\s*touch/);
  assert.match(styleSource, /@media \(max-width: 680px\)\s*\{[\s\S]*\.status-app-shell\s*\{[\s\S]*grid-template-rows:\s*auto minmax\(0,\s*1fr\)/);
  assert.match(styleSource, /@media \(max-width: 680px\)\s*\{[\s\S]*\.status-filter-row\s*\{[\s\S]*grid-template-columns:\s*1fr/);
  assert.match(styleSource, /@media \(max-width: 680px\)\s*\{[\s\S]*\.status-card-actions\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
});

test("mobile full order-entry layout does not keep the main form sticky over the table", () => {
  assert.match(styleSource, /@media \(max-width: 680px\)\s*\{[\s\S]*\.workspace > \.entry-screen > \.entry-order-panel\s*\{[\s\S]*position:\s*static/);
  assert.match(styleSource, /@media \(max-width: 680px\)\s*\{[\s\S]*\.table-panel > \.panel-head\s*\{[\s\S]*position:\s*static/);
  assert.match(styleSource, /@media \(max-width: 680px\)\s*\{[\s\S]*\.entry-order-panel > \.panel-head > \.actions\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
});

test("appearance logo changes support admin global persistence and user local overrides", () => {
  const settingsView = sourceBetween("function SettingsView(", "function Field(");
  assert.match(appSource, /const APPEARANCE_GLOBAL_SETTING_KEY = "appearance"/);
  assert.match(appSource, /function loadGlobalAppearanceSettings\(/);
  assert.match(appSource, /function persistGlobalAppearancePatch\(/);
  assert.match(appSource, /function mergeAppearanceSettings\(globalSettings = \{\}, localSettings = \{\}\)/);
  assert.match(settingsView, /globalLogo/);
  assert.match(settingsView, /persistGlobalAppearancePatch\(\{ reportLogoDataUrl/);
});
