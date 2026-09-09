import assert from "node:assert/strict";
import test from "node:test";

import { buildOrderReadinessChecklist } from "../src/orderReadiness.js";

const completeRow = {
  id: "row-1",
  glassMode: "single",
  quantity: 1,
  layers: [{ glassType: "شفاف", thickness: "6مم", width: 100, height: 100 }]
};

test("readiness checklist reflects the existing save validation without changing it", () => {
  const incomplete = buildOrderReadinessChecklist({ date: "2026-09-09", rows: [{}] });
  assert.equal(incomplete.ready, false);
  assert.equal(incomplete.items.find((item) => item.id === "rows").complete, false);

  const complete = buildOrderReadinessChecklist({
    date: "2026-09-09",
    customerName: "عميل",
    supplierName: "مورد",
    rows: [completeRow]
  });
  assert.equal(complete.ready, true);
  assert.equal(complete.completeCount, 4);
});
