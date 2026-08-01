import assert from "node:assert/strict";
import test from "node:test";

import {
  RECEIPT_STATUS,
  ReceiptValidationError,
  applyReceiptBatch,
  buildFilteredSupplierCostSubtotals,
  buildGlassReceiptEntries,
  correctReceiptHistoryOperation,
  validateReceiptBatch
} from "../src/orderReceipts.js";

const getDescription = (row) => row.label;
const getQuantity = (row) => row.ordered;
const getReceivedQuantity = (row) => row.received;
const setReceivedQuantity = (row, quantity) => ({ ...row, received: quantity });

test("builds a single glass receipt entry from callbacks and a stable row ID", () => {
  const order = {
    id: "order-1",
    rows: [{ id: "row-1", label: "زجاج سنجل 6 مم", ordered: 8, received: 3 }]
  };
  const result = buildGlassReceiptEntries(order, {
    getDescription,
    getQuantity,
    getReceivedQuantity
  });

  assert.deepEqual(result.entries[0], {
    rowId: "row-1",
    rowIndex: 0,
    description: "زجاج سنجل 6 مم",
    orderedQuantity: 8,
    previouslyReceivedQuantity: 3,
    remainingQuantity: 5,
    legacyAllocatedQuantity: 0
  });
  assert.equal(result.receivedQuantity, 3);
  assert.equal(result.remainingQuantity, 5);
  assert.equal(result.receiptStatus, RECEIPT_STATUS.PARTIAL);
});

test("keeps different glass descriptions as separate source-row entries", () => {
  const result = buildGlassReceiptEntries({
    rows: [
      { id: "clear-6", label: "زجاج شفاف 6 مم", ordered: 20, received: 12 },
      { id: "tempered-10", label: "زجاج سكريت 10 مم", ordered: 15, received: 5 }
    ]
  }, { getDescription, getQuantity, getReceivedQuantity });

  assert.deepEqual(result.entries.map((entry) => entry.description), [
    "زجاج شفاف 6 مم",
    "زجاج سكريت 10 مم"
  ]);
  assert.deepEqual(result.entries.map((entry) => entry.remainingQuantity), [8, 10]);
});

test("allocates a legacy order aggregate deterministically without losing its total", () => {
  const result = buildGlassReceiptEntries({
    collectedPieces: 4,
    rows: [
      { id: "row-a", label: "زجاج أ", ordered: 2 },
      { id: "row-b", label: "زجاج ب", ordered: 3 }
    ]
  }, { getDescription, getQuantity });

  assert.equal(result.usedLegacyAllocation, true);
  assert.deepEqual(result.entries.map((entry) => entry.previouslyReceivedQuantity), [2, 2]);
  assert.equal(result.allocatedLegacyQuantity, 4);
  assert.equal(result.receivedQuantity, 4);
  assert.equal(result.accountedCollectedQuantity, 4);
  assert.equal(result.legacyUnallocatedQuantity, 0);
});

test("retains impossible legacy overflow as unallocated metadata instead of dropping it", () => {
  const result = buildGlassReceiptEntries({
    collectedPieces: 7,
    rows: [
      { id: "row-a", label: "زجاج أ", ordered: 2 },
      { id: "row-b", label: "زجاج ب", ordered: 3 }
    ]
  }, { getDescription, getQuantity });

  assert.equal(result.receivedQuantity, 5);
  assert.equal(result.legacyUnallocatedQuantity, 2);
  assert.equal(result.accountedCollectedQuantity, 7);
});

test("validates selection and returns Arabic glass-specific quantity errors", () => {
  const built = buildGlassReceiptEntries({
    rows: [
      { id: "clear", label: "زجاج شفاف 6 مم", ordered: 20, received: 12 },
      { id: "tempered", label: "زجاج سكريت 10 مم", ordered: 15, received: 5 }
    ]
  }, { getDescription, getQuantity, getReceivedQuantity });

  const noSelection = validateReceiptBatch(built, []);
  assert.equal(noSelection.valid, false);
  assert.equal(noSelection.errors[0].code, "no_selection");

  const invalid = validateReceiptBatch(built, [
    { rowId: "clear", selected: true, receivedNow: 0 },
    { rowId: "tempered", selected: true, receivedNow: 11 }
  ]);
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors[0].message, /زجاج شفاف 6 مم/);
  assert.match(invalid.errors[1].message, /زجاج سكريت 10 مم/);
  assert.match(invalid.errors[1].message, /أكبر من الكمية المتبقية/);
});

test("applies only selected rows, leaves the source immutable, and creates one row audit item", () => {
  const original = {
    id: "order-2",
    orderNo: "GO-001284",
    status: "ready",
    collectedPieces: 1,
    rows: [
      { id: "clear", label: "زجاج شفاف 6 مم", ordered: 5, received: 1 },
      { id: "tempered", label: "زجاج سكريت 10 مم", ordered: 4, received: 0 }
    ],
    receiptHistory: []
  };
  const originalSnapshot = structuredClone(original);
  const result = applyReceiptBatch(original, [
    { rowId: "tempered", selected: true, receivedNow: 2 }
  ], {
    getDescription,
    getQuantity,
    getReceivedQuantity,
    setReceivedQuantity,
    metadata: {
      operationId: "receipt-op-1",
      recordedAt: "2026-07-29T10:15:00.000Z",
      recordedBy: { id: "user-1", name: "Y.D" }
    }
  });

  assert.deepEqual(original, originalSnapshot);
  assert.strictEqual(result.order.rows[0], original.rows[0]);
  assert.equal(result.order.rows[0].received, 1);
  assert.equal(result.order.rows[1].received, 2);
  assert.equal(result.order.collectedPieces, 3);
  assert.equal(result.order.receiptStatus, RECEIPT_STATUS.PARTIAL);
  assert.equal(result.order.status, "ready");
  assert.equal(Object.prototype.hasOwnProperty.call(result.patch, "status"), false);
  assert.equal(result.history.length, 1);
  assert.deepEqual(result.history[0], {
    operationId: "receipt-op-1",
    orderId: "order-2",
    orderNo: "GO-001284",
    rowId: "tempered",
    description: "زجاج سكريت 10 مم",
    quantityReceived: 2,
    previousReceivedQuantity: 0,
    newReceivedQuantity: 2,
    previousRemainingQuantity: 4,
    newRemainingQuantity: 2,
    orderedQuantity: 4,
    recordedAt: "2026-07-29T10:15:00.000Z",
    recordedBy: { id: "user-1", name: "Y.D" }
  });
  assert.equal(result.order.receiptHistory.length, 1);
  assert.equal(result.order.receiptHistory[0].items.length, 1);
});

test("derives fully received progress without replacing the manual workflow status", () => {
  const order = {
    id: "order-3",
    status: "partial",
    collectedPieces: 5,
    rows: [
      { id: "a", label: "زجاج أ", ordered: 3, received: 3 },
      { id: "b", label: "زجاج ب", ordered: 4, received: 2 }
    ]
  };
  const result = applyReceiptBatch(order, [
    { rowId: "b", receivedNow: 2 }
  ], {
    getDescription,
    getQuantity,
    getReceivedQuantity,
    setReceivedQuantity,
    metadata: { operationId: "receipt-op-2", recordedAt: "2026-07-29T11:00:00.000Z", recordedBy: "user-2" }
  });

  assert.equal(result.collectedPieces, 7);
  assert.equal(result.receiptStatus, RECEIPT_STATUS.FULLY_RECEIVED);
  assert.equal(result.order.receiptStatus, RECEIPT_STATUS.FULLY_RECEIVED);
  assert.equal(result.order.status, "partial");
  assert.equal(result.history[0].previousRemainingQuantity, 2);
  assert.equal(result.history[0].newRemainingQuantity, 0);
});

test("throws a ReceiptValidationError without applying an invalid batch", () => {
  const order = {
    rows: [{ id: "a", label: "زجاج أ", ordered: 2, received: 1 }]
  };
  assert.throws(
    () => applyReceiptBatch(order, [{ rowId: "a", receivedNow: 2 }], {
      getDescription,
      getQuantity,
      getReceivedQuantity,
      setReceivedQuantity
    }),
    (error) => error instanceof ReceiptValidationError
      && error.errors[0].code === "exceeds_remaining"
  );
  assert.equal(order.rows[0].received, 1);
});

test("corrects one receipt operation and deterministically recalculates later snapshots", () => {
  const firstRecordedBy = { id: "user-1", name: "Recorder" };
  const original = {
    id: "order-correction",
    status: "collected",
    collectedPieces: 10,
    rows: [
      {
        id: "clear",
        label: "زجاج شفاف 6 مم",
        ordered: 10,
        received: 10,
        receiptHistory: [
          {
            operationId: "receipt-1",
            quantityReceived: 4,
            previousReceivedQuantity: 0,
            newReceivedQuantity: 4,
            previousRemainingQuantity: 10,
            newRemainingQuantity: 6,
            orderedQuantity: 10,
            recordedAt: "2026-07-28T10:00:00.000Z",
            recordedBy: firstRecordedBy
          },
          {
            operationId: "receipt-2",
            quantityReceived: 6,
            previousReceivedQuantity: 4,
            newReceivedQuantity: 10,
            previousRemainingQuantity: 6,
            newRemainingQuantity: 0,
            orderedQuantity: 10,
            recordedAt: "2026-07-29T10:00:00.000Z",
            recordedBy: { id: "user-2", name: "Second" }
          }
        ]
      },
      {
        id: "tempered",
        label: "زجاج سكريت 10 مم",
        ordered: 3,
        received: 3,
        receiptHistory: []
      }
    ]
  };
  const snapshot = structuredClone(original);
  const result = correctReceiptHistoryOperation(original, {
    rowId: "clear",
    operationId: "receipt-1",
    correctedQuantityReceived: 3
  }, {
    getDescription,
    getQuantity,
    getReceivedQuantity,
    setReceivedQuantity,
    metadata: {
      correctionId: "correction-1",
      correctedAt: "2026-07-29T12:30:00.000Z",
      correctedBy: { id: "admin-1", name: "Admin" }
    }
  });

  assert.deepEqual(original, snapshot);
  assert.strictEqual(result.order.rows[1], original.rows[1]);
  assert.equal(result.order.rows[0].received, 9);
  assert.equal(result.order.collectedPieces, 12);
  assert.equal(result.order.status, "collected");
  assert.equal(Object.prototype.hasOwnProperty.call(result.patch, "status"), false);
  assert.equal(result.order.rows[0].receiptHistory[0].quantityReceived, 3);
  assert.equal(result.order.rows[0].receiptHistory[0].recordedAt, "2026-07-28T10:00:00.000Z");
  assert.deepEqual(result.order.rows[0].receiptHistory[0].recordedBy, firstRecordedBy);
  assert.deepEqual(result.order.rows[0].receiptHistory[0].corrections[0], {
    correctionId: "correction-1",
    correctedAt: "2026-07-29T12:30:00.000Z",
    correctedBy: { id: "admin-1", name: "Admin" },
    previousQuantityReceived: 4,
    correctedQuantityReceived: 3
  });
  assert.equal(result.order.rows[0].receiptHistory[1].previousReceivedQuantity, 3);
  assert.equal(result.order.rows[0].receiptHistory[1].newReceivedQuantity, 9);
  assert.equal(result.order.rows[0].receiptHistory[1].previousRemainingQuantity, 7);
  assert.equal(result.order.rows[0].receiptHistory[1].newRemainingQuantity, 1);
});

test("blocks receipt corrections that are non-positive or make the row exceed ordered quantity", () => {
  const order = {
    rows: [{
      id: "clear",
      label: "زجاج شفاف",
      ordered: 5,
      received: 5,
      receiptHistory: [{
        operationId: "receipt-1",
        quantityReceived: 2,
        previousReceivedQuantity: 3,
        newReceivedQuantity: 5,
        previousRemainingQuantity: 2,
        newRemainingQuantity: 0
      }]
    }]
  };
  const options = { getDescription, getQuantity, getReceivedQuantity, setReceivedQuantity };

  assert.throws(
    () => correctReceiptHistoryOperation(order, {
      rowId: "clear",
      operationId: "receipt-1",
      correctedQuantityReceived: 0
    }, options),
    (error) => error instanceof ReceiptValidationError
      && error.errors[0].code === "non_positive_correction"
  );
  assert.throws(
    () => correctReceiptHistoryOperation(order, {
      rowId: "clear",
      operationId: "receipt-1",
      correctedQuantityReceived: 3
    }, options),
    (error) => error instanceof ReceiptValidationError
      && error.errors[0].code === "corrected_total_out_of_range"
  );
  assert.throws(
    () => correctReceiptHistoryOperation(order, {
      rowId: "clear",
      operationId: "receipt-1",
      correctedQuantityReceived: 2
    }, options),
    (error) => error instanceof ReceiptValidationError
      && error.errors[0].code === "unchanged_correction"
  );
  assert.equal(order.rows[0].received, 5);
  assert.equal(order.rows[0].receiptHistory[0].quantityReceived, 2);
});

test("computes filtered supplier subtotals once per stable order ID", () => {
  const orders = [
    { id: "o-1", supplierName: "المورد الأول", supplierCost: 125000, visible: true },
    { id: "o-1", supplierName: "المورد الأول", supplierCost: 125000, visible: true },
    { id: "o-2", supplierName: "المورد الثاني", supplierCost: 87500, visible: true },
    { id: "o-3", supplierName: "المورد الثالث", supplierCost: 42000, visible: false }
  ];
  const result = buildFilteredSupplierCostSubtotals(orders, {
    getCost: (order) => order.supplierCost,
    filter: (order) => order.visible
  });

  assert.equal(result.orderCount, 2);
  assert.deepEqual(result.duplicateOrderIds, ["o-1"]);
  assert.equal(result.suppliers.find((item) => item.supplier === "المورد الأول").subtotal, 125000);
  assert.equal(result.suppliers.find((item) => item.supplier === "المورد الثاني").subtotal, 87500);
  assert.equal(result.grandTotal, 212500);
  assert.equal(result.showGrandTotal, true);
});
