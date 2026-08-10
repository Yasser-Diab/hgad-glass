import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");

function sourceSection(start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("single-panel drawing exposes an explicit partial-arch edge tool", () => {
  const editor = sourceSection("function SinglePanelDrawingEditor(", "function CustomersView(");
  const partialArch = sourceSection("function addPartialArch(", "function addOutlinePoint(");

  assert.match(editor, /tool === "partialArch"/);
  assert.match(editor, />قوس جزئي</);
  assert.match(editor, /tool === "edge" \|\| tool === "partialArch"/);
  assert.match(editor, /handleOutlineSegmentPointerDown\(event, segment\.index\)/);
  assert.match(partialArch, /const split = \{/);
  assert.match(partialArch, /const control = \{/);
  assert.match(partialArch, /mode: "curve"/);
  assert.match(partialArch, /\[rotatedPoints\[0\], split, control, \.\.\.rotatedPoints\.slice\(1\)\]/);
});
