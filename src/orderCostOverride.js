function isBlank(value) {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

function firstDefined(source = {}, keys = []) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) return source[key];
  }
  return null;
}

export function supplierLumpSumCostState(value) {
  if (isBlank(value)) return { empty: true, valid: true, value: null };
  const parsed = Number(String(value).replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0) return { empty: false, valid: false, value: null };
  return { empty: false, valid: true, value: parsed };
}

export function supplierLumpSumCost(order = {}) {
  const raw = firstDefined(order, ["supplierLumpSumCost", "supplier_lump_sum_cost"]);
  const state = supplierLumpSumCostState(raw);
  return state.valid ? state.value : null;
}

export function hasSupplierLumpSumCost(order = {}) {
  return supplierLumpSumCost(order) !== null;
}

export function effectiveSupplierCost(order = {}, calculatedCost = 0) {
  const override = supplierLumpSumCost(order);
  return override === null ? Number(calculatedCost) || 0 : override;
}

export function supplierCostSource(order = {}) {
  return hasSupplierLumpSumCost(order) ? "lump-sum" : "calculated";
}
