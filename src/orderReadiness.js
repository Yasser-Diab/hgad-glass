import { isCompletelyEmptyOrderRow, validateOrderForSave } from "./orderSaveValidation.js";

function hasText(value) {
  return String(value ?? "").trim().length > 0;
}

export function buildOrderReadinessChecklist(order = {}, options = {}) {
  const validation = validateOrderForSave(order, options);
  const rows = Array.isArray(order.rows) ? order.rows : [];
  const meaningfulRows = rows.filter((row) => !isCompletelyEmptyOrderRow(row));
  const rowErrors = validation.errors.filter((error) => error.scope === "row");
  const items = [
    { id: "customer", label: "العميل", complete: hasText(order.customerName) },
    { id: "supplier", label: "المورد", complete: hasText(order.supplierName) },
    { id: "date", label: "تاريخ الطلب", complete: hasText(order.date) },
    {
      id: "rows",
      label: meaningfulRows.length ? "بنود الزجاج" : "بند زجاج واحد على الأقل",
      complete: meaningfulRows.length > 0 && rowErrors.length === 0
    }
  ];
  const issues = [...new Set(validation.errors.map((error) => error.message).filter(Boolean))];
  return {
    ready: validation.isValid,
    items,
    completeCount: items.filter((item) => item.complete).length,
    issues
  };
}
