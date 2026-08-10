import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  classifyOrderRow,
  isCompletelyEmptyOrderRow,
  validateOrderForSave
} from "../src/orderSaveValidation.js";

const customer = { id: "customer-1", name: "عميل الاختبار" };
const supplier = { id: "supplier-1", name: "مورد الاختبار" };

function blankRow(overrides = {}) {
  return {
    id: overrides.id || "row-1",
    glassMode: "single",
    code: "",
    quantity: "",
    unitPrice: "",
    supplierUnitPrice: "",
    materialUnitPrice: "",
    supplierMaterialUnitPrice: "",
    doubleGap: "",
    triplexPvb: "",
    extraDirection: "في المنتصف تماماً",
    notes: "",
    expanded: false,
    layers: [{
      width: "",
      height: "",
      glassType: "",
      company: "",
      thickness: "",
      unitPrice: "",
      supplierUnitPrice: "",
      secure: false,
      color: "#9fd3ff",
      alpha: 45,
      mirror: false,
      offsetX: 0,
      offsetY: 0,
      followBaseWidth: false,
      followBaseHeight: false
    }],
    drawing: {
      shapes: [],
      paths: [],
      outline: { points: [] },
      edges: { top: 0, right: 0, bottom: 0, left: 0 },
      panels: [],
      meta: {}
    },
    ...overrides
  };
}

function completeRow(overrides = {}) {
  return blankRow({
    id: overrides.id || "complete-row",
    quantity: "4",
    layers: [{
      ...blankRow().layers[0],
      glassType: "شفاف",
      company: "Saint-Gobain®",
      thickness: "6مم",
      width: "100",
      height: "200"
    }],
    ...overrides
  });
}

function validOrder(rows = [completeRow()], overrides = {}) {
  return {
    customerId: customer.id,
    customerName: customer.name,
    supplierId: supplier.id,
    supplierName: supplier.name,
    date: "2026-08-01",
    rows,
    ...overrides
  };
}

const validationOptions = { customers: [customer], suppliers: [supplier] };

test("requires customer and supplier names but allows first-time party names", () => {
  const missingBoth = validateOrderForSave(validOrder([completeRow()], {
    customerName: "",
    supplierName: ""
  }), validationOptions);

  assert.equal(missingBoth.isValid, false);
  assert.deepEqual(missingBoth.errors.slice(0, 2).map((error) => error.field), ["customerId", "supplierId"]);
  assert.match(missingBoth.errors[0].message, /اختيار العميل/);
  assert.match(missingBoth.errors[1].message, /اختيار المورد/);

  const firstTimeNames = validateOrderForSave(validOrder([completeRow()], {
    customerId: "",
    customerName: "عميل جديد",
    supplierId: "",
    supplierName: "مورد جديد"
  }), validationOptions);
  assert.equal(firstTimeNames.isValid, true);
});

test("internal defaults remain empty while every meaningful user value makes a row partial", () => {
  const empty = blankRow();
  assert.equal(isCompletelyEmptyOrderRow(empty), true);
  assert.equal(classifyOrderRow(empty), "empty");

  const meaningfulCases = [
    { code: "P-10" },
    { notes: "ملاحظة" },
    { quantity: "0" },
    { unitPrice: "0" },
    { glassMode: "double" },
    { layers: [{ ...empty.layers[0], glassType: "شفاف" }] },
    { layers: [{ ...empty.layers[0], company: "شركة" }] },
    { layers: [{ ...empty.layers[0], thickness: "6مم" }] },
    { layers: [{ ...empty.layers[0], width: "100" }] },
    { layers: [{ ...empty.layers[0], height: "200" }] },
    { layers: [{ ...empty.layers[0], secure: true }] },
    { layers: [{ ...empty.layers[0], mirror: true }] },
    { layers: [{ ...empty.layers[0], color: "#ffffff" }] },
    { layers: [{ ...empty.layers[0], alpha: 30 }] },
    { drawing: { ...empty.drawing, shapes: [{ id: "shape" }] } }
  ];

  for (const [index, patch] of meaningfulCases.entries()) {
    const row = blankRow({ id: `partial-${index}`, ...patch });
    assert.equal(isCompletelyEmptyOrderRow(row), false, `case ${index} must not be discarded`);
    assert.equal(classifyOrderRow(row, index), "partial", `case ${index} must block saving`);
  }
});

test("mixed complete and partial rows block the entire save and preserve the partial row", async () => {
  const partial = blankRow({
    id: "partial-row",
    quantity: "4",
    layers: [{ ...blankRow().layers[0], glassType: "شفاف", thickness: "" }]
  });
  const rows = [completeRow({ id: "row-1" }), partial, completeRow({ id: "row-3" })];
  const before = structuredClone(rows);
  const result = validateOrderForSave(validOrder(rows), validationOptions);

  assert.equal(result.isValid, false);
  assert.equal(result.payloadRows.length, 3, "partial rows must never be filtered from the raw validation result");
  assert.ok(result.errors.some((error) => error.rowId === partial.id && error.field === "layer0-thickness"));
  assert.deepEqual(rows, before, "validation must not mutate or remove any visible row");

  let persistenceCalls = 0;
  async function guardedSave(order) {
    const validation = validateOrderForSave(order, validationOptions);
    if (!validation.isValid) return false;
    persistenceCalls += 1;
    return true;
  }
  assert.equal(await guardedSave(validOrder(rows)), false);
  assert.equal(persistenceCalls, 0);
});

test("only completely empty rows are omitted after validation succeeds", () => {
  const first = completeRow({ id: "first" });
  const trailingBlank = blankRow({ id: "blank" });
  const result = validateOrderForSave(validOrder([first, trailingBlank]), validationOptions);

  assert.equal(result.isValid, true);
  assert.deepEqual(result.rowStates, ["complete", "empty"]);
  assert.deepEqual(result.payloadRows.map((row) => row.id), ["first"]);
  assert.equal(trailingBlank.id, "blank");
});

test("zero and invalid numeric values are preserved as input and reported separately from missing values", () => {
  const zeroQuantity = completeRow({ id: "zero", quantity: 0 });
  const result = validateOrderForSave(validOrder([zeroQuantity]), validationOptions);

  assert.equal(result.isValid, false);
  assert.equal(result.payloadRows[0].quantity, 0);
  const error = result.errors.find((item) => item.field === "quantity");
  assert.ok(error);
  assert.match(error.message, /أكبر من صفر/);
});

test("save flow validates the raw draft before building a filtered persistence snapshot", () => {
  const mainSource = readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");
  const saveStart = mainSource.indexOf("async function saveDraft(options = {})");
  const saveEnd = mainSource.indexOf("async function previewDraftOrder", saveStart);
  const saveSource = mainSource.slice(saveStart, saveEnd);

  const validationIndex = saveSource.indexOf("validateOrderForSave(sourceDraft");
  const snapshotIndex = saveSource.indexOf("orderSaveSnapshot({ ...sourceDraft");
  const persistenceIndex = saveSource.indexOf("saveOrderToStore(orderForSave");
  assert.ok(validationIndex >= 0);
  assert.ok(snapshotIndex > validationIndex);
  assert.ok(persistenceIndex > snapshotIndex);
  assert.match(saveSource, /if \(!validation\.isValid\)[\s\S]*?return null/);
});

test("order preview validates and renders the draft without saving first", () => {
  const mainSource = readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");
  const previewStart = mainSource.indexOf("async function previewDraftOrder()");
  const previewEnd = mainSource.indexOf("async function exportDraftOrderPdf", previewStart);
  const previewSource = mainSource.slice(previewStart, previewEnd);

  assert.match(previewSource, /validateOrderForReport\(sourceDraft\)/);
  assert.match(previewSource, /setPreview\(\{ type: "order", order: previewOrder \}\)/);
  assert.doesNotMatch(previewSource, /saveDraft\(/);
  assert.doesNotMatch(previewSource, /saveOrderToStore|saveOrderToSupabase|client\.rpc/);
});

test("validation summary remains a checklist and resolved fields leave the active invalid set", () => {
  const mainSource = readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");
  const entryStart = mainSource.indexOf("function EntryView(");
  const entryEnd = mainSource.indexOf("function GlassRowEditor(", entryStart);
  const entrySource = mainSource.slice(entryStart, entryEnd);

  assert.match(entrySource, /function isValidationErrorResolved\(error = \{\}\)/);
  assert.match(entrySource, /const unresolvedValidationErrors = validationErrors\.filter\(\(error\) => !isValidationErrorResolved\(error\)\)/);
  assert.match(entrySource, /const validationKeys = new Set\(unresolvedValidationErrors\.map\(validationErrorKey\)\)/);
  assert.match(entrySource, /className=\{resolved \? "resolved" : ""\}/);
  assert.match(entrySource, /resolved \? "✓" : "•"/);
  assert.match(entrySource, /تم استكمال البنود المطلوبة\. يمكنك الحفظ الآن\./);
});
