import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Load the dependency-free browser module directly so this test remains
// independent of the bundler and Electron runtime configuration.
const sourceUrl = new URL("../src/pastePipeline.js", import.meta.url);
const sourceText = await readFile(sourceUrl, "utf8");
const pipeline = await import(`data:text/javascript;base64,${Buffer.from(sourceText).toString("base64")}`);

const {
  DEFAULT_PASTE_PREFERENCES,
  applyPastePatchToRows,
  applySourceColumnDirection,
  buildPastePatch,
  convertMeasurementToCentimeters,
  normalizeClipboardRows,
  normalizePastePreferences
} = pipeline;

test("normalizes line endings, removes completely empty rows, and preserves interior empty cells", () => {
  const rows = normalizeClipboardRows("A\t\tC\r\n\t \t\rB\tD\t\r\n\r\n");
  assert.deepEqual(rows, [
    ["A", "", "C"],
    ["B", "D", ""]
  ]);
});

test("LTR and RTL change horizontal mapping only and never reverse row order", () => {
  const rows = [["r1-a", "r1-b"], ["r2-a", "r2-b"]];
  assert.deepEqual(applySourceColumnDirection(rows, "ltr"), rows);
  assert.deepEqual(applySourceColumnDirection(rows, "rtl"), [
    ["r1-b", "r1-a"],
    ["r2-b", "r2-a"]
  ]);

  const ltr = buildPastePatch({
    clipboardText: "r1-a\tr1-b\nr2-a\tr2-b",
    destinationFieldKeys: ["first", "second"],
    startFieldKey: "first",
    startRow: 4,
    sourceDirection: "ltr",
    currentRows: []
  });
  const rtl = buildPastePatch({
    clipboardText: "r1-a\tr1-b\nr2-a\tr2-b",
    destinationFieldKeys: ["first", "second"],
    startFieldKey: "first",
    startRow: 4,
    sourceDirection: "rtl",
    currentRows: []
  });

  assert.deepEqual(ltr.patch.changes.map(({ rowIndex, fieldKey, after }) => [rowIndex, fieldKey, after.value]), [
    [4, "first", "r1-a"],
    [4, "second", "r1-b"],
    [5, "first", "r2-a"],
    [5, "second", "r2-b"]
  ]);
  assert.deepEqual(rtl.patch.changes.map(({ rowIndex, fieldKey, after }) => [rowIndex, fieldKey, after.value]), [
    [4, "first", "r1-b"],
    [4, "second", "r1-a"],
    [5, "first", "r2-b"],
    [5, "second", "r2-a"]
  ]);
});

test("maps from the requested start row and stable destination field key", () => {
  const result = buildPastePatch({
    clipboardText: "10\t20",
    destinationFieldKeys: ["code", "width", "height", "quantity"],
    startFieldKey: "width",
    startRow: 7,
    sourceDirection: "ltr",
    measurementUnit: "cm",
    currentRows: []
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.patch.changes.map(({ rowIndex, fieldKey, after }) => [rowIndex, fieldKey, after.value]), [
    [7, "width", "10"],
    [7, "height", "20"]
  ]);
});

test("converts only measurement fields into internal centimeters without floating-point loss", () => {
  assert.equal(convertMeasurementToCentimeters("1.234", "m"), "123.4");
  assert.equal(convertMeasurementToCentimeters("12.345", "cm"), "12.345");
  assert.equal(convertMeasurementToCentimeters("123", "mm"), "12.3");
  assert.equal(convertMeasurementToCentimeters("٠٫٥", "m"), "50");

  const result = buildPastePatch({
    clipboardText: "1.25\tSKU-1\t15",
    destinationFieldKeys: ["layer0-width", "code", "layer0-height"],
    startFieldKey: "layer0-width",
    startRow: 0,
    sourceDirection: "ltr",
    measurementUnit: "m",
    currentRows: [{}]
  });
  assert.deepEqual(result.patch.changes.map(({ fieldKey, after }) => [fieldKey, after.value]), [
    ["layer0-width", "125"],
    ["code", "SKU-1"],
    ["layer0-height", "1500"]
  ]);
});

test("fails atomically when any mapped cell is invalid", () => {
  const currentRows = [{ width: "40", height: "50", code: "KEEP" }];
  const result = buildPastePatch({
    clipboardText: "12\tinvalid-number",
    destinationFieldKeys: ["width", "height", "code"],
    startFieldKey: "width",
    startRow: 0,
    sourceDirection: "ltr",
    measurementUnit: "cm",
    currentRows
  });

  assert.equal(result.ok, false);
  assert.equal(result.patch, null);
  assert.equal(result.errors[0].code, "invalid-measurement");
  assert.deepEqual(currentRows, [{ width: "40", height: "50", code: "KEEP" }]);
});

test("returns one deterministic before/after patch that supports exact undo and redo", () => {
  const original = [
    { code: "A", width: "40", height: "50", untouched: "keep" },
    { code: "B", width: "60", height: "70" }
  ];
  const result = buildPastePatch({
    clipboardText: "1.5\t250\n2\t300",
    destinationFieldKeys: ["code", "width", "height"],
    startFieldKey: "width",
    startRow: 0,
    sourceDirection: "ltr",
    measurementUnit: "mm",
    currentRows: original
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.patch, {
    type: "glass-orders/grid-paste",
    version: 1,
    start: { rowIndex: 0, fieldKey: "width" },
    source: {
      direction: "ltr",
      measurementUnit: "mm",
      internalMeasurementUnit: "cm",
      rowCount: 2,
      columnCounts: [2, 2]
    },
    destinationFieldKeys: ["code", "width", "height"],
    beforeRowCount: 2,
    changes: [
      {
        rowIndex: 0,
        fieldKey: "width",
        before: { exists: true, value: "40" },
        after: { exists: true, value: "0.15" }
      },
      {
        rowIndex: 0,
        fieldKey: "height",
        before: { exists: true, value: "50" },
        after: { exists: true, value: "25" }
      },
      {
        rowIndex: 1,
        fieldKey: "width",
        before: { exists: true, value: "60" },
        after: { exists: true, value: "0.2" }
      },
      {
        rowIndex: 1,
        fieldKey: "height",
        before: { exists: true, value: "70" },
        after: { exists: true, value: "30" }
      }
    ]
  });

  const pasted = applyPastePatchToRows(original, result.patch, "redo");
  assert.deepEqual(pasted, [
    { code: "A", width: "0.15", height: "25", untouched: "keep" },
    { code: "B", width: "0.2", height: "30" }
  ]);
  const undone = applyPastePatchToRows(pasted, result.patch, "undo");
  assert.deepEqual(undone, original);
  const redone = applyPastePatchToRows(undone, result.patch, "redo");
  assert.deepEqual(redone, pasted);
});

test("normalizes saved unit and direction preferences with safe defaults", () => {
  assert.deepEqual(normalizePastePreferences({
    measurementUnit: "ملليمتر",
    sourceDirection: "من اليسار إلى اليمين"
  }), {
    measurementUnit: "mm",
    sourceDirection: "ltr"
  });
  assert.deepEqual(normalizePastePreferences({ measurementUnit: "unknown", sourceDirection: "unknown" }), DEFAULT_PASTE_PREFERENCES);
});
