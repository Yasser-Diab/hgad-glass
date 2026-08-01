import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");

test("collected dropdown and checkbox share a render-safe confirmation flow", () => {
  assert.match(source, /function WorkflowStatusConfirmationDialog\(/);
  assert.match(source, /onChange=\{\(event\) => changeWorkflowStatus\(order, event\.target\.value\)\}/);
  assert.match(source, /setSpecialStatus\(order, event\.target\.checked, "collected"\)/);
  assert.match(source, /remainingQuantity\)\}/);
  assert.doesNotMatch(source, /formatNumber\(/);
  assert.doesNotMatch(
    source,
    /nextStatus === "collected"[\s\S]{0,500}window\.confirm/
  );
});
