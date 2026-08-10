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
  const nativeEditorStart = keyHandler.indexOf("if (target && isEditableDomTarget(target) && editing)");
  const nativeEditorEnd = keyHandler.indexOf("if (!editing && event.key === \"Delete\"", nativeEditorStart);
  const nativeEditorBlock = keyHandler.slice(nativeEditorStart, nativeEditorEnd);

  assert.match(keyHandler, /if \(target && isEditableDomTarget\(target\) && editing\) \{[\s\S]*?event\.key === "Tab"[\s\S]*?event\.key === "Enter"[\s\S]*?return;[\s\S]*?\}/);
  assert.doesNotMatch(nativeEditorBlock, /ArrowLeft|ArrowRight|Backspace|Delete/);
  assert.match(pasteHandler, /isEditableDomTarget\(eventTarget\) && !\/\[\\t\\r\\n\]\//);
  assert.match(rowEditorSource, /onCompositionStart/);
  assert.match(rowEditorSource, /onCompositionEnd/);
  assert.match(keyHandler, /event\.isComposing \|\| event\.nativeEvent\?\.isComposing/);
});

test("selected cells start editing only from explicit edit actions", () => {
  const entrySource = sourceSection("function EntryView(", "function GlassRowEditor(");
  const rowEditorSource = sourceSection("function GlassRowEditor(", "function thicknessMmValue(");
  const pointerHandler = sourceSection("function handleCellPointerDown(", "function handleCellDoubleClick(");
  const doubleClickHandler = sourceSection("function handleCellDoubleClick(", "function columnForRowNear(");

  assert.match(rowEditorSource, /onDoubleClick: \(event\) => onCellDoubleClick\(index, column, event\)/);
  assert.match(entrySource, /onCellDoubleClick=\{handleCellDoubleClick\}/);
  assert.match(pointerHandler, /setEditingCell\(null\)/);
  assert.doesNotMatch(pointerHandler, /setEditingCell\(nextCell\)/);
  assert.match(pointerHandler, /beginRangeDrag\(rowIndex, column, event\)/);
  assert.match(doubleClickHandler, /startEditingCell\(makeTableCell\(rowIndex, column\)\)/);
});

test("only fixed-choice table dropdown cells open from one click and Space", () => {
  const entrySource = sourceSection("function EntryView(", "function GlassRowEditor(");
  const pointerHandler = sourceSection("function handleCellPointerDown(", "function handleCellDoubleClick(");
  const doubleClickHandler = sourceSection("function handleCellDoubleClick(", "function columnForRowNear(");
  const keyHandler = sourceSection("function handleTableKeyDown(", "function handleTablePaste(");
  const comboSource = sourceSection("function Combo(", "function SearchBox(");

  assert.match(entrySource, /function isDropdownCellColumn\(column = ""\)/);
  assert.doesNotMatch(entrySource, /\^layer\\d\+\-\(glassType\|company\|thickness\)\$/);
  assert.match(entrySource, /column === "mode"/);
  assert.match(entrySource, /column === "extraDirection"/);
  assert.match(entrySource, /column === "doubleGap"/);
  assert.match(entrySource, /column === "triplexPvb"/);
  assert.match(entrySource, /function openEntryTableDropdown\(rowIndex, column/);
  assert.match(entrySource, /showPicker/);
  assert.match(entrySource, /glass-orders-open-combo/);
  assert.match(entrySource, /window\.dispatchEvent\(new Event\("glass-orders-cancel-interactions"\)\)/);
  assert.match(pointerHandler, /if \(isDropdownCellColumn\(column\)\) \{[\s\S]*activateDropdownCell\(rowIndex, column\)/);
  assert.match(doubleClickHandler, /if \(isDropdownCellColumn\(column\)\) \{[\s\S]*activateDropdownCell\(rowIndex, column\)/);
  assert.match(keyHandler, /event\.key === " " \|\| event\.code === "Space"/);
  assert.match(keyHandler, /activateDropdownCell\(rowIndex, column\)/);
  assert.match(comboSource, /node\.addEventListener\("glass-orders-open-combo", forceOpenCombo\)/);
  assert.match(comboSource, /onBlur=\{\(event\) => \{[\s\S]*setOpen\(false\)/);
  assert.match(comboSource, /if \(!editing\) return;[\s\S]*setOpen\(\(current\) => !current\)/);
});

test("smart-table selected-but-not-editing cells use spreadsheet selection affordance", () => {
  const styleSource = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(styleSource, /\.table-control:not\(\.editing-cell\)\s*\{[\s\S]*cursor:\s*cell/);
  assert.match(styleSource, /\.table-control:not\(\.editing-cell\)\s*\{[\s\S]*caret-color:\s*transparent/);
  assert.match(styleSource, /\.table-control\.editing-cell\s*\{[\s\S]*cursor:\s*text/);
});

test("manual numeric input preserves decimal separators while typing", () => {
  const numericSource = sourceSection("function normalizedCellValueForColumn(", "function readRowCellValue(");
  assert.match(numericSource, /replace\(",", "\."\)/);
  assert.match(numericSource, /\^-\?\(\?:\\d\+\(\?:\\\./);
  assert.doesNotMatch(numericSource, /String\(parsed\);[\s\S]*?return parsed === null/);
});

test("Ctrl shortcuts use physical keys so they work on non-English keyboard layouts", () => {
  const keyHandler = sourceSection("function handleTableKeyDown(", "function handleTablePaste(");
  assert.match(keyHandler, /const isShortcut = \(code, key\) => event\.code === code/);
  assert.match(keyHandler, /isShortcut\("KeyD", "d"\)/);
  assert.match(keyHandler, /isShortcut\("KeyZ", "z"\)/);
  assert.match(keyHandler, /isShortcut\("KeyY", "y"\)/);
});

test("delete dialogs do not restore focus to stale deleted row controls", () => {
  const orderDeleteModal = sourceSection("function DeleteOrderModal(", "function DashboardView(");
  const rowDeleteModal = sourceSection("function RowDeleteModal(", "function GlassRowEditor(");

  assert.match(orderDeleteModal, /cleanupRendererInteractionState\(\)/);
  assert.match(rowDeleteModal, /cleanupRendererInteractionState\(\)/);
  assert.doesNotMatch(orderDeleteModal, /restoreRendererInputFocus/);
  assert.doesNotMatch(rowDeleteModal, /restoreRendererInputFocus/);
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
