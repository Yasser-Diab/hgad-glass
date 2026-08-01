import assert from "node:assert/strict";
import test from "node:test";

import { verifyOrderSaveIntegrity } from "../src/orderPersistenceIntegrity.js";

test("accepts a complete 13-row save response", () => {
  const rows = Array.from({ length: 13 }, (_, index) => ({ id: `row-${index + 1}` }));
  assert.equal(verifyOrderSaveIntegrity({
    persisted_rows: 13,
    persisted_row_ids: rows.map((row) => row.id)
  }, rows), true);
});

test("rejects a one-row response when 13 rows were submitted", () => {
  const rows = Array.from({ length: 13 }, (_, index) => ({ id: `row-${index + 1}` }));
  assert.throws(
    () => verifyOrderSaveIntegrity({ persisted_rows: 1, persisted_row_ids: ["row-1"] }, rows),
    (error) => error.code === "ORDER_ITEM_COUNT_MISMATCH" && error.expected === 13 && error.persisted === 1
  );
});

test("rejects an equal count with a missing submitted row ID", () => {
  const rows = [{ id: "row-1" }, { id: "row-2" }];
  assert.throws(
    () => verifyOrderSaveIntegrity({ persisted_rows: 2, persisted_row_ids: ["row-1", "wrong-row"] }, rows),
    (error) => error.code === "ORDER_ITEM_COUNT_MISMATCH" && error.missingRowIds.includes("row-2")
  );
});
