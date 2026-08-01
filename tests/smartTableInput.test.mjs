import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mainSource = readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");

function sourceSection(startMarker, endMarker) {
  const start = mainSource.indexOf(startMarker);
  const end = mainSource.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `${startMarker} must exist`);
  assert.notEqual(end, -1, `${endMarker} must follow ${startMarker}`);
  return mainSource.slice(start, end);
}

test("smart-table inputs keep stable row identity and consume the complete input value", () => {
  const entrySource = sourceSection("function EntryView(", "function GlassRowEditor(");
  const rowEditorSource = sourceSection("function GlassRowEditor(", "function thicknessMmValue(");
  const changeHandler = sourceSection("function handleCellDraftChange(", "function handleCellBlur(");
  const cellSetter = sourceSection("function setCellValue(", "function requestRemoveRows(");

  assert.match(entrySource, /<GlassRowEditor\s+[\s\S]*?key=\{row\.id\}/);
  assert.match(rowEditorSource, /onChange=\{\(e\) => onCellValueChange\(index, "notes", e\.target\.value\)\}/);
  assert.match(rowEditorSource, /onChange=\{\(e\) => onCellValueChange\(index, "rowCode", e\.target\.value\)\}/);
  assert.match(changeHandler, /setCellValue\(rowIndex, column, value/);
  assert.doesNotMatch(changeHandler, /nativeEvent\.data|event\.key|slice\(-1\)|blur\(/);
  assert.match(cellSetter, /const stableRowId = rowIdAt\(rowIndex\)/);
  assert.match(cellSetter, /rows\.findIndex\(\(row\) => row\.id === stableRowId\)/);
  assert.doesNotMatch(cellSetter, /flushSync|\.map\(.*id:\s*uid\(/s);
  assert.doesNotMatch(entrySource, /editorDraftRef|directEditRef|setCellDomValue|Date\.now\(\).*key|Math\.random\(\).*key/);
});

test("normal typing, native caret keys, paste, and composition are not hijacked", () => {
  const keyHandler = sourceSection("function handleTableKeyDown(", "function handleTablePaste(");
  const pasteHandler = sourceSection("function handleTablePaste(", "function rejectInvalidOrder(");
  const rowEditorSource = sourceSection("function GlassRowEditor(", "function thicknessMmValue(");
  const nativeEditorStart = keyHandler.indexOf("if (target && isEditableDomTarget(target))");
  const nativeEditorEnd = keyHandler.indexOf("if (!editing && event.key === \"Delete\"", nativeEditorStart);
  const nativeEditorBlock = keyHandler.slice(nativeEditorStart, nativeEditorEnd);

  assert.match(keyHandler, /if \(target && isEditableDomTarget\(target\)\) \{[\s\S]*?event\.key === "Tab"[\s\S]*?event\.key === "Enter"[\s\S]*?return;[\s\S]*?\}/);
  assert.doesNotMatch(nativeEditorBlock, /ArrowLeft|ArrowRight|Backspace|Delete/);
  assert.match(pasteHandler, /isEditableDomTarget\(eventTarget\) && !\/\[\\t\\r\\n\]\//);
  assert.match(rowEditorSource, /onCompositionStart/);
  assert.match(rowEditorSource, /onCompositionEnd/);
  assert.match(keyHandler, /event\.isComposing \|\| event\.nativeEvent\?\.isComposing/);
});

test("a 50-character edit remains one complete local row value", () => {
  const rowId = "stable-local-row-id";
  const original = [
    { id: rowId, notes: "", code: "" },
    { id: "unchanged-row", notes: "keep", code: "B" }
  ];
  const typed = "ملاحظات عربية كاملة مع English 1234567890 بدون فقد أي حرف";
  let rows = original;
  let currentValue = "";

  for (const character of typed) {
    currentValue += character;
    rows = rows.map((row) => row.id === rowId ? { ...row, notes: currentValue } : row);
  }

  assert.equal(rows[0].id, rowId);
  assert.equal(rows[0].notes, typed);
  assert.deepEqual(rows[1], original[1]);
  assert.ok(typed.length >= 50);
});
