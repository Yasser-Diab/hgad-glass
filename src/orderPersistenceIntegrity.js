function rowIdList(rows) {
  return (rows || []).map((row) => String(row?.id || "").trim()).filter(Boolean);
}

/**
 * Refuse a save response that cannot prove every submitted row is still
 * independently persisted. The caller must keep its local draft unchanged
 * when this function throws.
 */
export function verifyOrderSaveIntegrity(response, submittedRows) {
  const expectedIds = rowIdList(submittedRows);
  const expectedCount = expectedIds.length;
  const persistedCount = Number(response?.persisted_rows);
  const persistedIds = Array.isArray(response?.persisted_row_ids)
    ? response.persisted_row_ids.map((id) => String(id))
    : [];
  const persistedIdSet = new Set(persistedIds);
  const missingIds = expectedIds.filter((id) => !persistedIdSet.has(id));

  if (
    !Number.isInteger(persistedCount)
    || persistedCount !== expectedCount
    || persistedIds.length !== expectedCount
    || persistedIdSet.size !== expectedCount
    || missingIds.length
  ) {
    const error = new Error(
      `أُلغي تحديث الطلب لأن قاعدة البيانات لم تؤكد حفظ جميع البنود. `
      + `المتوقع ${expectedCount} والمحفوظ ${Number.isInteger(persistedCount) ? persistedCount : "غير مؤكد"}. `
      + "بقيت بيانات الطلب على الشاشة دون تغيير."
    );
    error.code = "ORDER_ITEM_COUNT_MISMATCH";
    error.expected = expectedCount;
    error.persisted = Number.isInteger(persistedCount) ? persistedCount : null;
    error.missingRowIds = Object.freeze(missingIds);
    throw error;
  }

  return true;
}
