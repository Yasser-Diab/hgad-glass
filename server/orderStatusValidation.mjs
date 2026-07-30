const EPSILON = 1e-9;

export const LOCAL_ORDER_STATUSES = Object.freeze([
  "ordered",
  "fabrication",
  "ready",
  "partial",
  "collected",
  "pricing",
  "cancelled",
  "draft"
]);

export class LocalOrderStatusValidationError extends Error {
  constructor(code, message, httpStatus = 400) {
    super(message);
    this.name = "LocalOrderStatusValidationError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.statusCode = httpStatus;
  }
}

function fail(code, message, httpStatus = 400) {
  throw new LocalOrderStatusValidationError(code, message, httpStatus);
}

function finiteStoredNumber(value, fallback = 0) {
  if (value === "" || value === null || value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function strictJsonNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail("invalid_quantity", `${label} يجب أن تكون رقماً صالحاً.`);
  }
  return value;
}

function normalizedIncomingRows(patch) {
  if (patch.rows === undefined) return [];
  if (!Array.isArray(patch.rows)) {
    fail("invalid_rows", "صفوف الاستلام يجب أن تكون قائمة صالحة.");
  }
  return patch.rows;
}

/**
 * Validate a local status/receipt patch before any database mutation.
 *
 * storedRows contains every row currently owned by the target order.
 * knownRowOwners optionally contains rows found by the incoming IDs across all
 * orders, allowing the caller to distinguish unknown IDs from wrong-order IDs.
 */
export function validateLocalOrderStatusPatch({
  orderId,
  patch = {},
  storedRows = [],
  knownRowOwners = []
}) {
  const status = String(patch.status ?? "").trim().toLowerCase();
  if (!LOCAL_ORDER_STATUSES.includes(status)) {
    fail("invalid_status", "حالة الطلب غير صالحة.");
  }

  const requestedCollected = strictJsonNumber(
    patch.collectedPieces,
    "إجمالي الكمية المستلمة"
  );
  if (requestedCollected < 0) {
    fail("negative_collected_total", "إجمالي الكمية المستلمة لا يمكن أن يكون سالباً.");
  }

  const incomingRows = normalizedIncomingRows(patch);
  const seen = new Set();
  const storedById = new Map(storedRows.map((row) => [String(row.id), row]));
  const ownerById = new Map(knownRowOwners.map((row) => [String(row.id), String(row.order_id)]));
  const normalizedRows = incomingRows.map((row) => {
    const rowId = String(row?.id ?? "").trim();
    if (!rowId) fail("missing_row_id", "كل صف استلام يحتاج إلى معرّف صالح.");
    if (seen.has(rowId)) fail("duplicate_row_id", `صف الاستلام ${rowId} مكرر.`);
    seen.add(rowId);

    const stored = storedById.get(rowId);
    if (!stored) {
      if (ownerById.has(rowId) && ownerById.get(rowId) !== String(orderId)) {
        fail("wrong_order_row", "أحد صفوف الاستلام لا يتبع هذا الطلب.", 403);
      }
      fail("unknown_row", `صف الاستلام ${rowId} غير موجود.`);
    }

    const receivedQuantity = strictJsonNumber(
      row?.receivedQuantity,
      `الكمية المستلمة للصف ${rowId}`
    );
    if (receivedQuantity < 0) {
      fail("negative_received_quantity", `الكمية المستلمة للصف ${rowId} لا يمكن أن تكون سالبة.`);
    }
    const orderedQuantity = Math.max(0, finiteStoredNumber(stored.quantity));
    if (receivedQuantity > orderedQuantity + EPSILON) {
      fail("received_exceeds_ordered", `الكمية المستلمة للصف ${rowId} أكبر من الكمية المطلوبة.`);
    }
    if (!Array.isArray(row?.receiptHistory)) {
      fail("invalid_receipt_history", `سجل الاستلام للصف ${rowId} يجب أن يكون قائمة صالحة.`);
    }
    return Object.freeze({
      id: rowId,
      receivedQuantity,
      receiptHistory: row.receiptHistory
    });
  });

  const incomingById = new Map(normalizedRows.map((row) => [row.id, row]));
  let totalOrdered = 0;
  let totalReceived = 0;
  for (const stored of storedRows) {
    const orderedQuantity = Math.max(0, finiteStoredNumber(stored.quantity));
    const incoming = incomingById.get(String(stored.id));
    const receivedQuantity = incoming
      ? incoming.receivedQuantity
      : Math.max(0, finiteStoredNumber(stored.received_quantity));
    if (receivedQuantity > orderedQuantity + EPSILON) {
      fail("stored_received_exceeds_ordered", "إجمالي الاستلام الحالي يحتوي على كمية تتجاوز الكمية المطلوبة.");
    }
    totalOrdered += orderedQuantity;
    totalReceived += receivedQuantity;
  }

  if (totalReceived > totalOrdered + EPSILON) {
    fail("received_total_exceeds_ordered", "إجمالي الكمية المستلمة أكبر من إجمالي الكمية المطلوبة.");
  }
  if (normalizedRows.length && Math.abs(totalReceived - requestedCollected) > EPSILON) {
    fail("collected_total_mismatch", "إجمالي الكمية المستلمة لا يطابق صفوف الاستلام.");
  }

  const persistedCollected = normalizedRows.length ? totalReceived : requestedCollected;
  if (persistedCollected > totalOrdered + EPSILON) {
    fail("collected_total_exceeds_ordered", "إجمالي الكمية المستلمة أكبر من إجمالي الكمية المطلوبة.");
  }
  const derivedStatus = persistedCollected <= EPSILON
    ? "ordered"
    : totalOrdered > EPSILON && persistedCollected >= totalOrdered - EPSILON
      ? "collected"
      : "partial";
  if (!["pricing", "cancelled", "draft"].includes(status)) {
    const inconsistentReceivedStatus = ["partial", "collected"].includes(derivedStatus)
      && status !== derivedStatus;
    const inconsistentEmptyStatus = derivedStatus === "ordered"
      && ["partial", "collected"].includes(status);
    if (inconsistentReceivedStatus || inconsistentEmptyStatus) {
      fail("receipt_status_mismatch", "حالة الطلب لا تطابق كميات الاستلام.");
    }
  }

  return Object.freeze({
    status,
    rows: Object.freeze(normalizedRows),
    requestedCollected,
    persistedCollected,
    totalOrdered,
    totalReceived,
    derivedStatus
  });
}
