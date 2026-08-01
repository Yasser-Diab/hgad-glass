/**
 * Pure receipt and cost helpers for Glass Orders.
 *
 * The functions in this module do not read clocks, generate random IDs, mutate
 * their inputs, or perform persistence. Callers supply UI-specific description
 * and quantity callbacks, plus receipt metadata such as operation ID and time.
 */

const EPSILON = 1e-9;

export const RECEIPT_STATUS = Object.freeze({
  NOT_RECEIVED: "not_received",
  PARTIAL: "partial",
  FULLY_RECEIVED: "fully_received"
});

export const ORDER_STATUS_BY_RECEIPT_STATUS = Object.freeze({
  [RECEIPT_STATUS.NOT_RECEIVED]: "ordered",
  [RECEIPT_STATUS.PARTIAL]: "partial",
  [RECEIPT_STATUS.FULLY_RECEIVED]: "collected"
});

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function defaultGetRowId(row) {
  return row?.id;
}

function defaultGetDescription(row, index) {
  return row?.description || row?.glassDescription || row?.glassType || `نوع الزجاج ${index + 1}`;
}

function defaultGetQuantity(row) {
  return row?.orderedQuantity ?? row?.quantity ?? 0;
}

function defaultGetReceivedQuantity(row) {
  if (hasOwn(row, "receivedQuantity")) return row.receivedQuantity;
  if (hasOwn(row, "receivedPieces")) return row.receivedPieces;
  if (hasOwn(row, "collectedPieces")) return row.collectedPieces;
  return undefined;
}

function defaultSetReceivedQuantity(row, quantity) {
  return { ...row, receivedQuantity: quantity };
}

function normalizedNumberText(value) {
  const digits = {
    "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
    "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
    "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
    "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9"
  };
  return String(value ?? "")
    .replace(/[٠-٩۰-۹]/g, (digit) => digits[digit])
    .replace(/[٫,]/g, ".")
    .trim();
}

function finiteNumber(value, label) {
  const number = typeof value === "number" ? value : Number(normalizedNumberText(value));
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be a finite number.`);
  return number;
}

function nonNegativeNumber(value, label) {
  const number = finiteNumber(value, label);
  if (number < -EPSILON) throw new RangeError(`${label} cannot be negative.`);
  return Math.max(0, number);
}

function stableId(value, label) {
  const id = String(value ?? "").trim();
  if (!id) throw new Error(`${label} requires a stable row/order ID.`);
  return id;
}

function receiptStatusForTotals(orderedQuantity, receivedQuantity) {
  const ordered = Math.max(0, orderedQuantity);
  const received = Math.max(0, receivedQuantity);
  if (received <= EPSILON) return RECEIPT_STATUS.NOT_RECEIVED;
  if (ordered > EPSILON && received >= ordered - EPSILON) return RECEIPT_STATUS.FULLY_RECEIVED;
  return RECEIPT_STATUS.PARTIAL;
}

/**
 * Derive the receipt-only status without overwriting an order's manufacturing
 * workflow state.
 */
export function deriveReceiptStatus(orderedQuantity, receivedQuantity) {
  return receiptStatusForTotals(
    nonNegativeNumber(orderedQuantity, "orderedQuantity"),
    nonNegativeNumber(receivedQuantity, "receivedQuantity")
  );
}

/**
 * Build one receipt entry per source order row.
 *
 * `getDescription` and `getQuantity` let the monolithic order editor reuse its
 * existing `rowDescription` and physical-piece calculation. Stable row IDs are
 * retained so a receipt can update and audit exactly one source row.
 *
 * Legacy support: when none of the rows has an explicit received value, the
 * old order-level `collectedPieces` aggregate is allocated deterministically
 * from the first row onward. A valid aggregate is preserved exactly. Any
 * impossible overflow remains visible as `legacyUnallocatedQuantity` rather
 * than being silently discarded.
 */
export function buildGlassReceiptEntries(order, options = {}) {
  const rows = options.rows || order?.rows || [];
  const getRowId = options.getRowId || defaultGetRowId;
  const getDescription = options.getDescription || defaultGetDescription;
  const getQuantity = options.getQuantity || defaultGetQuantity;
  const getReceivedQuantity = options.getReceivedQuantity || defaultGetReceivedQuantity;
  const allocateLegacy = options.allocateLegacy !== false;
  const legacySource = options.legacyCollectedQuantity
    ?? order?.collectedPieces
    ?? order?.collectedQuantity
    ?? 0;
  const legacyCollectedQuantity = nonNegativeNumber(legacySource, "legacyCollectedQuantity");
  const seenRowIds = new Set();

  const seeds = rows.map((row, rowIndex) => {
    const rowId = stableId(getRowId(row, rowIndex, order), `Row ${rowIndex + 1}`);
    if (seenRowIds.has(rowId)) throw new Error(`Duplicate stable row ID: ${rowId}`);
    seenRowIds.add(rowId);

    const description = String(getDescription(row, rowIndex, order) || `نوع الزجاج ${rowIndex + 1}`).trim();
    const orderedQuantity = nonNegativeNumber(getQuantity(row, rowIndex, order), `Ordered quantity for ${description}`);
    const receivedSource = getReceivedQuantity(row, rowIndex, order);
    const hasExplicitReceived = receivedSource !== undefined && receivedSource !== null && receivedSource !== "";
    const explicitReceivedQuantity = hasExplicitReceived
      ? nonNegativeNumber(receivedSource, `Received quantity for ${description}`)
      : 0;

    if (explicitReceivedQuantity > orderedQuantity + EPSILON) {
      throw new RangeError(`Received quantity for ${description} exceeds its ordered quantity.`);
    }

    return {
      row,
      rowId,
      rowIndex,
      description,
      orderedQuantity,
      hasExplicitReceived,
      explicitReceivedQuantity: Math.min(orderedQuantity, explicitReceivedQuantity)
    };
  });

  const hasAnyExplicitReceived = seeds.some((seed) => seed.hasExplicitReceived);
  let legacyRemaining = allocateLegacy && !hasAnyExplicitReceived ? legacyCollectedQuantity : 0;
  let allocatedLegacyQuantity = 0;

  const entries = seeds.map((seed) => {
    const legacyAllocatedQuantity = legacyRemaining > EPSILON
      ? Math.min(seed.orderedQuantity, legacyRemaining)
      : 0;
    if (legacyAllocatedQuantity > 0) {
      legacyRemaining -= legacyAllocatedQuantity;
      allocatedLegacyQuantity += legacyAllocatedQuantity;
    }
    const previouslyReceivedQuantity = seed.hasExplicitReceived
      ? seed.explicitReceivedQuantity
      : legacyAllocatedQuantity;
    const remainingQuantity = Math.max(0, seed.orderedQuantity - previouslyReceivedQuantity);

    return Object.freeze({
      rowId: seed.rowId,
      rowIndex: seed.rowIndex,
      description: seed.description,
      orderedQuantity: seed.orderedQuantity,
      previouslyReceivedQuantity,
      remainingQuantity,
      legacyAllocatedQuantity
    });
  });

  const orderedQuantity = entries.reduce((sum, entry) => sum + entry.orderedQuantity, 0);
  const receivedQuantity = entries.reduce((sum, entry) => sum + entry.previouslyReceivedQuantity, 0);
  const remainingQuantity = Math.max(0, orderedQuantity - receivedQuantity);
  const legacyDifferenceQuantity = legacyCollectedQuantity - receivedQuantity;
  const legacyUnallocatedQuantity = Math.max(0, legacyDifferenceQuantity);

  return Object.freeze({
    entries: Object.freeze(entries),
    orderedQuantity,
    receivedQuantity,
    remainingQuantity,
    receiptStatus: receiptStatusForTotals(orderedQuantity, receivedQuantity),
    usedLegacyAllocation: allocatedLegacyQuantity > EPSILON,
    allocatedLegacyQuantity,
    legacyCollectedQuantity,
    legacyUnallocatedQuantity,
    legacyDifferenceQuantity,
    accountedCollectedQuantity: receivedQuantity + legacyUnallocatedQuantity,
    hasAnyExplicitReceived
  });
}

function entryList(entriesOrResult) {
  if (Array.isArray(entriesOrResult)) return entriesOrResult;
  if (Array.isArray(entriesOrResult?.entries)) return entriesOrResult.entries;
  throw new TypeError("Receipt entries must be an array or a buildGlassReceiptEntries result.");
}

function normalizeBatchItems(batch) {
  if (Array.isArray(batch)) return batch;
  if (Array.isArray(batch?.items)) return batch.items;
  if (!batch || typeof batch !== "object") return [];
  return Object.entries(batch).map(([rowId, value]) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return { rowId, ...value };
    }
    return { rowId, selected: true, receivedNow: value };
  });
}

function normalizedBatchItem(item) {
  return {
    rowId: String(item?.rowId ?? item?.id ?? "").trim(),
    selected: hasOwn(item, "selected") ? Boolean(item.selected) : true,
    receivedNow: item?.receivedNow ?? item?.quantity ?? item?.value
  };
}

function arabicGlassLabel(entry, rowId) {
  return String(entry?.description || rowId || "نوع الزجاج المحدد").trim();
}

/**
 * Validate a multi-glass receipt batch.
 *
 * The returned Arabic messages name the affected glass type. Confirmation is
 * invalid when no type is selected, a selected value is missing/non-positive,
 * or it exceeds that entry's remaining quantity.
 */
export function validateReceiptBatch(entriesOrResult, batch) {
  const entries = entryList(entriesOrResult);
  const byRowId = new Map(entries.map((entry) => [String(entry.rowId), entry]));
  const normalized = normalizeBatchItems(batch).map(normalizedBatchItem).filter((item) => item.selected);
  const errors = [];
  const selected = [];
  const seen = new Set();

  if (normalized.length === 0) {
    errors.push({
      code: "no_selection",
      rowId: "",
      description: "",
      message: "يجب تحديد نوع زجاج واحد على الأقل للاستلام."
    });
  }

  for (const item of normalized) {
    const entry = byRowId.get(item.rowId);
    const label = arabicGlassLabel(entry, item.rowId);
    if (!item.rowId || !entry) {
      errors.push({
        code: "unknown_glass",
        rowId: item.rowId,
        description: label,
        message: `تعذر العثور على نوع الزجاج المحدد: ${label}.`
      });
      continue;
    }
    if (seen.has(item.rowId)) {
      errors.push({
        code: "duplicate_selection",
        rowId: item.rowId,
        description: label,
        message: `تم تحديد ${label} أكثر من مرة.`
      });
      continue;
    }
    seen.add(item.rowId);

    if (item.receivedNow === undefined || item.receivedNow === null || normalizedNumberText(item.receivedNow) === "") {
      errors.push({
        code: "missing_quantity",
        rowId: item.rowId,
        description: label,
        message: `أدخل الكمية المستلمة الآن ل${label}.`
      });
      continue;
    }

    const receivedNow = Number(normalizedNumberText(item.receivedNow));
    if (!Number.isFinite(receivedNow)) {
      errors.push({
        code: "invalid_quantity",
        rowId: item.rowId,
        description: label,
        message: `أدخل كمية مستلمة صحيحة ل${label}.`
      });
      continue;
    }
    if (receivedNow < 0) {
      errors.push({
        code: "negative_quantity",
        rowId: item.rowId,
        description: label,
        message: `الكمية المستلمة ل${label} لا يمكن أن تكون سالبة.`
      });
      continue;
    }
    if (receivedNow <= EPSILON) {
      errors.push({
        code: "zero_quantity",
        rowId: item.rowId,
        description: label,
        message: `الكمية المستلمة ل${label} يجب أن تكون أكبر من صفر.`
      });
      continue;
    }
    if (receivedNow > entry.remainingQuantity + EPSILON) {
      errors.push({
        code: "exceeds_remaining",
        rowId: item.rowId,
        description: label,
        message: `الكمية المستلمة ل${label} أكبر من الكمية المتبقية.`
      });
      continue;
    }

    selected.push(Object.freeze({
      rowId: item.rowId,
      description: label,
      receivedNow
    }));
  }

  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    selected: Object.freeze(selected)
  });
}

/**
 * Error thrown by applyReceiptBatch when validateReceiptBatch rejects input.
 */
export class ReceiptValidationError extends Error {
  constructor(errors) {
    super(errors?.[0]?.message || "بيانات الاستلام غير صحيحة.");
    this.name = "ReceiptValidationError";
    this.errors = errors || [];
  }
}

function deterministicOperationId(order, selected, recordedAt) {
  const orderId = String(order?.id || order?.orderNo || "order");
  const rowPart = selected.map((item) => item.rowId).sort().join("+") || "none";
  return `receipt:${orderId}:${recordedAt || "unspecified"}:${rowPart}`;
}

/**
 * Apply a validated receipt batch as one immutable order patch.
 *
 * The result contains:
 * - `order`: the patched order;
 * - `patch`: fields suitable for one local/persistence update;
 * - `receiptOperation`: one operation header with per-row before/after history;
 * - `history`: the operation's row audit items.
 *
 * Pass `getDescription` and `getQuantity` exactly as for
 * buildGlassReceiptEntries. `setReceivedQuantity` adapts the result to the
 * application's chosen row field. Metadata is caller-supplied to keep this
 * function deterministic and side-effect free.
 */
export function applyReceiptBatch(order, batch, options = {}) {
  const built = buildGlassReceiptEntries(order, options);
  const validation = validateReceiptBatch(built, batch);
  if (!validation.valid) throw new ReceiptValidationError(validation.errors);

  if (built.legacyUnallocatedQuantity > EPSILON) {
    throw new ReceiptValidationError([{
      code: "unallocated_legacy_quantity",
      rowId: "",
      description: "",
      message: "توجد كمية استلام قديمة غير موزعة على أنواع الزجاج. وزّعها قبل تسجيل استلام جديد."
    }]);
  }

  const setReceivedQuantity = options.setReceivedQuantity || defaultSetReceivedQuantity;
  const selectedByRowId = new Map(validation.selected.map((item) => [item.rowId, item]));
  const entryByRowId = new Map(built.entries.map((entry) => [entry.rowId, entry]));
  const metadata = options.metadata || {};
  const recordedAt = String(metadata.recordedAt || "");
  const recordedBy = metadata.recordedBy ?? null;
  const operationId = String(
    metadata.operationId
    || deterministicOperationId(order, validation.selected, recordedAt)
  );
  const orderId = String(order?.id || "");
  const orderNo = String(order?.orderNo || "");
  const history = [];

  const rows = (order?.rows || []).map((row, rowIndex) => {
    const rowId = stableId(
      (options.getRowId || defaultGetRowId)(row, rowIndex, order),
      `Row ${rowIndex + 1}`
    );
    const entry = entryByRowId.get(rowId);
    const selected = selectedByRowId.get(rowId);
    if (!entry) return row;

    // Materialize a legacy allocation even for an unselected row so the old
    // order aggregate remains exactly represented after the first new receipt.
    if (!selected && !(built.usedLegacyAllocation && entry.legacyAllocatedQuantity > EPSILON)) {
      return row;
    }

    const receivedNow = selected?.receivedNow || 0;
    const newReceivedQuantity = entry.previouslyReceivedQuantity + receivedNow;
    const nextRow = setReceivedQuantity(
      row,
      newReceivedQuantity,
      { entry, selected: Boolean(selected), receivedNow, order }
    );

    if (selected) {
      history.push(Object.freeze({
        operationId,
        orderId,
        orderNo,
        rowId,
        description: entry.description,
        quantityReceived: receivedNow,
        previousReceivedQuantity: entry.previouslyReceivedQuantity,
        newReceivedQuantity,
        previousRemainingQuantity: entry.remainingQuantity,
        newRemainingQuantity: Math.max(0, entry.orderedQuantity - newReceivedQuantity),
        orderedQuantity: entry.orderedQuantity,
        recordedAt,
        recordedBy
      }));
    }
    return nextRow;
  });

  const receivedByRowId = new Map(
    built.entries.map((entry) => [
      entry.rowId,
      entry.previouslyReceivedQuantity + (selectedByRowId.get(entry.rowId)?.receivedNow || 0)
    ])
  );
  const collectedPieces = [...receivedByRowId.values()].reduce((sum, quantity) => sum + quantity, 0);
  const receiptStatus = receiptStatusForTotals(built.orderedQuantity, collectedPieces);
  // Receipt progress is deliberately independent from the manually selected
  // workflow status. A caller may opt into a legacy mapping explicitly, but a
  // receipt operation must not overwrite order.status by default.
  const orderStatusField = hasOwn(options, "orderStatusField") ? options.orderStatusField : null;
  const receiptStatusField = options.receiptStatusField || "receiptStatus";
  const collectedTotalField = options.collectedTotalField || "collectedPieces";
  const historyField = hasOwn(options, "historyField") ? options.historyField : "receiptHistory";
  const mapReceiptStatusToOrderStatus = options.mapReceiptStatusToOrderStatus
    || ((status) => ORDER_STATUS_BY_RECEIPT_STATUS[status]);
  const previousReceiptStatus = built.receiptStatus;

  const receiptOperation = Object.freeze({
    operationId,
    orderId,
    orderNo,
    recordedAt,
    recordedBy,
    previousReceiptStatus,
    newReceiptStatus: receiptStatus,
    previousCollectedQuantity: built.receivedQuantity,
    newCollectedQuantity: collectedPieces,
    items: Object.freeze(history)
  });

  const patch = {
    rows,
    [collectedTotalField]: collectedPieces,
    [receiptStatusField]: receiptStatus
  };
  if (orderStatusField) {
    patch[orderStatusField] = mapReceiptStatusToOrderStatus(receiptStatus, order);
  }
  if (historyField) {
    patch[historyField] = Object.freeze([
      ...(Array.isArray(order?.[historyField]) ? order[historyField] : []),
      receiptOperation
    ]);
  }

  return Object.freeze({
    order: Object.freeze({ ...order, ...patch }),
    patch: Object.freeze(patch),
    receiptOperation,
    history: Object.freeze(history),
    validation,
    collectedPieces,
    receiptStatus
  });
}

/**
 * Correct one recorded receipt operation for one source row.
 *
 * The original operation identity, recording time and recording user remain
 * intact. Correction metadata is appended to that operation, while its
 * quantity and every later before/after snapshot for the same row are
 * recalculated in array order. Other rows and their histories retain their
 * object identities.
 */
export function correctReceiptHistoryOperation(order, correction, options = {}) {
  const built = buildGlassReceiptEntries(order, options);
  const rowId = stableId(correction?.rowId, "Receipt correction");
  const entry = built.entries.find((item) => item.rowId === rowId);
  if (!entry) {
    throw new ReceiptValidationError([{
      code: "unknown_glass",
      rowId,
      description: rowId,
      message: `تعذر العثور على نوع الزجاج المحدد: ${rowId}.`
    }]);
  }

  const correctedQuantity = Number(normalizedNumberText(
    correction?.correctedQuantityReceived
      ?? correction?.quantityReceived
      ?? correction?.receivedNow
  ));
  const label = arabicGlassLabel(entry, rowId);
  if (!Number.isFinite(correctedQuantity)) {
    throw new ReceiptValidationError([{
      code: "invalid_quantity",
      rowId,
      description: label,
      message: `أدخل كمية مستلمة صحيحة ل${label}.`
    }]);
  }
  if (correctedQuantity <= EPSILON) {
    throw new ReceiptValidationError([{
      code: "non_positive_correction",
      rowId,
      description: label,
      message: `الكمية المصححة ل${label} يجب أن تكون أكبر من صفر.`
    }]);
  }

  const rows = order?.rows || [];
  const getRowId = options.getRowId || defaultGetRowId;
  const sourceRowIndex = rows.findIndex((row, index) => (
    String(getRowId(row, index, order) ?? "").trim() === rowId
  ));
  if (sourceRowIndex < 0) {
    throw new ReceiptValidationError([{
      code: "unknown_glass",
      rowId,
      description: label,
      message: `تعذر العثور على نوع الزجاج المحدد: ${label}.`
    }]);
  }

  const sourceRow = rows[sourceRowIndex];
  const getHistory = options.getHistory || ((row) => row?.receiptHistory);
  const setHistory = options.setHistory || ((row, history) => ({ ...row, receiptHistory: history }));
  const setReceivedQuantity = options.setReceivedQuantity || defaultSetReceivedQuantity;
  const sourceHistory = Array.isArray(getHistory(sourceRow, sourceRowIndex, order))
    ? getHistory(sourceRow, sourceRowIndex, order)
    : [];
  const requestedHistoryIndex = Number.isInteger(correction?.historyIndex)
    ? correction.historyIndex
    : -1;
  const operationId = String(correction?.operationId ?? "").trim();
  const historyIndex = requestedHistoryIndex >= 0
    ? requestedHistoryIndex
    : sourceHistory.findIndex((item) => (
      operationId && String(item?.operationId ?? "").trim() === operationId
    ));
  const target = sourceHistory[historyIndex];
  if (!target || (operationId && String(target.operationId ?? "").trim() !== operationId)) {
    throw new ReceiptValidationError([{
      code: "unknown_receipt_operation",
      rowId,
      description: label,
      message: `تعذر العثور على عملية الاستلام المطلوب تصحيحها ل${label}.`
    }]);
  }

  const previousOperationQuantity = finiteNumber(
    target.quantityReceived,
    `Recorded receipt quantity for ${label}`
  );
  if (Math.abs(correctedQuantity - previousOperationQuantity) <= EPSILON) {
    throw new ReceiptValidationError([{
      code: "unchanged_correction",
      rowId,
      description: label,
      message: `الكمية المصححة ل${label} مطابقة للكمية المسجلة حالياً.`
    }]);
  }
  const correctedFinalQuantity = entry.previouslyReceivedQuantity
    + correctedQuantity
    - previousOperationQuantity;
  if (correctedFinalQuantity < -EPSILON || correctedFinalQuantity > entry.orderedQuantity + EPSILON) {
    throw new ReceiptValidationError([{
      code: "corrected_total_out_of_range",
      rowId,
      description: label,
      message: correctedFinalQuantity > entry.orderedQuantity
        ? `إجمالي المستلم بعد تصحيح ${label} أكبر من الكمية المطلوبة.`
        : `إجمالي المستلم بعد تصحيح ${label} لا يمكن أن يكون سالباً.`
    }]);
  }

  const startingReceivedQuantity = nonNegativeNumber(
    target.previousReceivedQuantity,
    `Previous receipt quantity for ${label}`
  );
  let originalRunning = startingReceivedQuantity;
  for (let index = historyIndex; index < sourceHistory.length; index += 1) {
    originalRunning += finiteNumber(
      sourceHistory[index]?.quantityReceived,
      `Receipt history quantity ${index + 1} for ${label}`
    );
  }
  const untrackedTailQuantity = entry.previouslyReceivedQuantity - originalRunning;

  const metadata = options.metadata || {};
  const correctedAt = String(metadata.correctedAt || "");
  const correctedBy = metadata.correctedBy ?? null;
  const correctionId = String(
    metadata.correctionId
    || `receipt-correction:${operationId || historyIndex}:${correctedAt || "unspecified"}`
  );
  const correctionMetadata = Object.freeze({
    correctionId,
    correctedAt,
    correctedBy,
    previousQuantityReceived: previousOperationQuantity,
    correctedQuantityReceived: correctedQuantity
  });

  let running = startingReceivedQuantity;
  const correctedHistory = sourceHistory.map((item, index) => {
    if (index < historyIndex) return item;
    const quantityReceived = index === historyIndex
      ? correctedQuantity
      : finiteNumber(item?.quantityReceived, `Receipt history quantity ${index + 1} for ${label}`);
    const newReceivedQuantity = running + quantityReceived;
    if (newReceivedQuantity < -EPSILON || newReceivedQuantity > entry.orderedQuantity + EPSILON) {
      throw new ReceiptValidationError([{
        code: "corrected_history_out_of_range",
        rowId,
        description: label,
        message: `يؤدي تصحيح ${label} إلى سجل استلام يتجاوز الكمية المطلوبة أو يقل عن صفر.`
      }]);
    }
    const previousReceivedQuantity = running;
    running = Math.max(0, Math.min(entry.orderedQuantity, newReceivedQuantity));
    const snapshot = {
      ...item,
      orderedQuantity: entry.orderedQuantity,
      quantityReceived,
      previousReceivedQuantity,
      newReceivedQuantity: running,
      previousRemainingQuantity: Math.max(0, entry.orderedQuantity - previousReceivedQuantity),
      newRemainingQuantity: Math.max(0, entry.orderedQuantity - running)
    };
    if (index === historyIndex) {
      snapshot.correction = true;
      snapshot.correctedAt = correctedAt;
      snapshot.correctedBy = correctedBy;
      snapshot.corrections = Object.freeze([
        ...(Array.isArray(item?.corrections) ? item.corrections : []),
        correctionMetadata
      ]);
    }
    return Object.freeze(snapshot);
  });

  const recalculatedFinalQuantity = running + untrackedTailQuantity;
  if (
    recalculatedFinalQuantity < -EPSILON
    || recalculatedFinalQuantity > entry.orderedQuantity + EPSILON
    || Math.abs(recalculatedFinalQuantity - correctedFinalQuantity) > EPSILON
  ) {
    throw new ReceiptValidationError([{
      code: "inconsistent_receipt_history",
      rowId,
      description: label,
      message: `تعذر تصحيح ${label} لأن سجل الاستلام الحالي غير متسق.`
    }]);
  }

  const correctedRow = setReceivedQuantity(
    setHistory(sourceRow, correctedHistory, { order, entry, historyIndex }),
    Math.max(0, Math.min(entry.orderedQuantity, correctedFinalQuantity)),
    { order, entry, correction: correctionMetadata }
  );
  const correctedRows = rows.map((row, index) => index === sourceRowIndex ? correctedRow : row);
  const receivedByRowId = new Map(
    built.entries.map((item) => [
      item.rowId,
      item.rowId === rowId ? correctedFinalQuantity : item.previouslyReceivedQuantity
    ])
  );
  const collectedPieces = [...receivedByRowId.values()].reduce((sum, quantity) => sum + quantity, 0);
  const receiptStatus = receiptStatusForTotals(built.orderedQuantity, collectedPieces);
  const patch = Object.freeze({
    rows: correctedRows,
    collectedPieces,
    receiptStatus
  });

  return Object.freeze({
    order: Object.freeze({ ...order, ...patch }),
    patch,
    rowId,
    historyIndex,
    correction: correctionMetadata,
    correctedHistoryItem: correctedHistory[historyIndex],
    previousOperationQuantity,
    correctedOperationQuantity: correctedQuantity,
    previousReceivedQuantity: entry.previouslyReceivedQuantity,
    newReceivedQuantity: correctedFinalQuantity,
    collectedPieces,
    receiptStatus
  });
}

function defaultGetOrderId(order) {
  return order?.id || order?.orderNo;
}

function defaultGetSupplier(order) {
  return order?.supplierName || order?.supplier || "بدون مورد";
}

function defaultGetCost(order) {
  return order?.supplierCost ?? order?.totals?.supplierCost ?? 0;
}

/**
 * Calculate supplier subtotals and a grand total from the filtered order set.
 *
 * Each stable order ID contributes at most once, so visual glass sub-lines or
 * duplicated projections cannot multiply cost. `filter` and
 * `selectedOrderIds` allow the caller to pass the exact current view scope.
 */
export function buildFilteredSupplierCostSubtotals(orders, options = {}) {
  const getOrderId = options.getOrderId || defaultGetOrderId;
  const getSupplier = options.getSupplier || defaultGetSupplier;
  const getCost = options.getCost || defaultGetCost;
  const filter = options.filter || (() => true);
  const selectedOrderIds = options.selectedOrderIds == null
    ? null
    : new Set([...options.selectedOrderIds].map((id) => String(id)));
  const seenOrderIds = new Set();
  const duplicateOrderIds = new Set();
  const supplierGroups = new Map();

  for (const [index, order] of (orders || []).entries()) {
    if (!filter(order, index)) continue;
    const orderId = stableId(getOrderId(order, index), `Order ${index + 1}`);
    if (selectedOrderIds && !selectedOrderIds.has(orderId)) continue;
    if (seenOrderIds.has(orderId)) {
      duplicateOrderIds.add(orderId);
      continue;
    }
    seenOrderIds.add(orderId);

    const supplier = String(getSupplier(order, index) || "بدون مورد").trim() || "بدون مورد";
    const cost = finiteNumber(getCost(order, index), `Supplier cost for order ${orderId}`);
    if (!supplierGroups.has(supplier)) {
      supplierGroups.set(supplier, { supplier, subtotal: 0, orderCount: 0, orderIds: [] });
    }
    const group = supplierGroups.get(supplier);
    group.subtotal += cost;
    group.orderCount += 1;
    group.orderIds.push(orderId);
  }

  const suppliers = [...supplierGroups.values()]
    .sort((a, b) => a.supplier.localeCompare(b.supplier, "ar"))
    .map((group) => Object.freeze({
      ...group,
      orderIds: Object.freeze([...group.orderIds])
    }));
  const grandTotal = suppliers.reduce((sum, supplier) => sum + supplier.subtotal, 0);

  return Object.freeze({
    suppliers: Object.freeze(suppliers),
    grandTotal,
    showGrandTotal: suppliers.length > 1,
    orderCount: seenOrderIds.size,
    duplicateOrderIds: Object.freeze([...duplicateOrderIds])
  });
}
