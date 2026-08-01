import assert from "node:assert/strict";
import test from "node:test";

import {
  LocalOrderStatusValidationError,
  validateLocalOrderStatusPatch
} from "../server/orderStatusValidation.mjs";

const storedRows = [
  { id: "row-a", order_id: "order-a", quantity: 5, received_quantity: 1 },
  { id: "row-b", order_id: "order-a", quantity: 3, received_quantity: 0 }
];

function validate(patch, overrides = {}) {
  return validateLocalOrderStatusPatch({
    orderId: "order-a",
    patch,
    storedRows,
    knownRowOwners: [
      { id: "row-a", order_id: "order-a" },
      { id: "row-b", order_id: "order-a" },
      { id: "foreign-row", order_id: "order-b" }
    ],
    ...overrides
  });
}

function validationCode(code, statusCode = 400) {
  return (error) => error instanceof LocalOrderStatusValidationError
    && error.code === code
    && error.statusCode === statusCode;
}

test("accepts a selected-row receipt patch and derives the persisted total atomically", () => {
  const result = validate({
    status: "partial",
    collectedPieces: 3,
    rows: [{
      id: "row-b",
      receivedQuantity: 2,
      receiptHistory: [{ operationId: "receipt-1", quantityReceived: 2 }]
    }]
  });

  assert.equal(result.persistedCollected, 3);
  assert.equal(result.totalOrdered, 8);
  assert.equal(result.receiptStatus, "partial");
  assert.deepEqual(result.rows.map((row) => row.id), ["row-b"]);
});

test("allows a status-only workflow change without reading or rewriting receipt totals", () => {
  const result = validate({
    operation: "status",
    status: "ready",
    collectedPieces: 999
  });
  assert.equal(result.rows.length, 0);
  assert.equal(result.operation, "status");
  assert.equal(result.status, "ready");
  assert.equal(result.persistedCollected, undefined);

  const collectedResult = validate({
    operation: "status",
    status: "collected",
    collectedPieces: 0
  });
  assert.equal(collectedResult.status, "collected");
  assert.equal(collectedResult.persistedCollected, undefined);
});

test("rejects invalid status and a present non-array rows payload", () => {
  assert.throws(
    () => validate({ status: "made-up", collectedPieces: 1 }),
    validationCode("invalid_status")
  );
  assert.throws(
    () => validate({ status: "partial", collectedPieces: 1, rows: {} }),
    validationCode("invalid_rows")
  );
});

test("rejects missing, duplicate, unknown, and wrong-order row IDs", () => {
  assert.throws(
    () => validate({
      status: "partial",
      collectedPieces: 1,
      rows: [{ id: "", receivedQuantity: 1, receiptHistory: [] }]
    }),
    validationCode("missing_row_id")
  );
  assert.throws(
    () => validate({
      status: "partial",
      collectedPieces: 2,
      rows: [
        { id: "row-a", receivedQuantity: 1, receiptHistory: [] },
        { id: "row-a", receivedQuantity: 1, receiptHistory: [] }
      ]
    }),
    validationCode("duplicate_row_id")
  );
  assert.throws(
    () => validate({
      status: "partial",
      collectedPieces: 1,
      rows: [{ id: "missing-row", receivedQuantity: 1, receiptHistory: [] }]
    }),
    validationCode("unknown_row")
  );
  assert.throws(
    () => validate({
      status: "partial",
      collectedPieces: 1,
      rows: [{ id: "foreign-row", receivedQuantity: 1, receiptHistory: [] }]
    }),
    validationCode("wrong_order_row", 403)
  );
});

test("rejects nonnumeric, negative, excessive quantities and invalid history", () => {
  assert.throws(
    () => validate({ operation: "receipt", collectedPieces: "1", rows: [] }),
    validationCode("invalid_quantity")
  );
  assert.throws(
    () => validate({ operation: "receipt", collectedPieces: -1, rows: [] }),
    validationCode("negative_collected_total")
  );
  assert.throws(
    () => validate({
      status: "partial",
      collectedPieces: 1,
      rows: [{ id: "row-a", receivedQuantity: "2", receiptHistory: [] }]
    }),
    validationCode("invalid_quantity")
  );
  assert.throws(
    () => validate({
      status: "ordered",
      collectedPieces: 0,
      rows: [{ id: "row-a", receivedQuantity: -1, receiptHistory: [] }]
    }),
    validationCode("negative_received_quantity")
  );
  assert.throws(
    () => validate({
      status: "collected",
      collectedPieces: 7,
      rows: [{ id: "row-a", receivedQuantity: 7, receiptHistory: [] }]
    }),
    validationCode("received_exceeds_ordered")
  );
  assert.throws(
    () => validate({
      status: "partial",
      collectedPieces: 2,
      rows: [{ id: "row-a", receivedQuantity: 2, receiptHistory: {} }]
    }),
    validationCode("invalid_receipt_history")
  );
});

test("rejects mismatched collected totals but never blocks a manual status from receipt progress", () => {
  assert.throws(
    () => validate({
      status: "partial",
      collectedPieces: 4,
      rows: [{ id: "row-b", receivedQuantity: 2, receiptHistory: [] }]
    }),
    validationCode("collected_total_mismatch")
  );
  const receiptResult = validate({
    status: "ready",
    collectedPieces: 3,
    rows: [{ id: "row-b", receivedQuantity: 2, receiptHistory: [] }]
  });
  assert.equal(receiptResult.receiptStatus, "partial");
  assert.equal(receiptResult.status, undefined);
});
