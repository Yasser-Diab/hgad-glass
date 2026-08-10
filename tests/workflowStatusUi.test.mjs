import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");

test("status-only bundle can be selected by Vite status mode", () => {
  assert.match(source, /import\.meta\.env\.VITE_APP_VARIANT === "status" \|\| import\.meta\.env\.MODE === "status"/);
});

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
