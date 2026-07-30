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
  assert.match(previewModal, /report-preview-modal/);
  assert.match(previewModal, /report-preview-toolbar/);
  assert.match(previewModal, /report-preview-scroll/);
  assert.match(previewModal, /order-status-preview-page/);

  assert.match(styleSource, /\.report-preview-modal\s*\{[\s\S]*grid-template-rows:\s*auto minmax\(0,\s*1fr\)/);
  assert.match(styleSource, /\.report-preview-scroll\s*\{[\s\S]*overflow:\s*auto/);
  assert.match(styleSource, /\.order-status-report-table\.without-cost \.order-status-report-row\s*\{[\s\S]*minmax\(0,\s*2\.14fr\)/);
  assert.match(styleSource, /\.order-status-report-table\.with-cost \.order-status-report-row\s*\{[\s\S]*minmax\(0,\s*1\.94fr\)/);
  assert.match(styleSource, /\.order-status-report-row\.supplier-subtotal\s*\{[\s\S]*border-block/);
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
