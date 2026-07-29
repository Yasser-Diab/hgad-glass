function cleanId(value) {
  return String(value ?? "").trim();
}

function parseStoredLayers(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function storedNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Merge an operational full-order save with the supplier-cost fields that were
 * deliberately hidden from the current local user.
 */
export function mergeProtectedLocalOrderRows(incomingRows, storedRows) {
  const storedById = new Map((storedRows || []).map((row) => [String(row.id), row]));
  const protectedSupplierCosts = new Map();
  const rows = (incomingRows || []).map((row) => {
    const rowId = cleanId(row?.id);
    const stored = rowId ? storedById.get(rowId) : null;
    if (!stored) {
      throw new Error("إضافة بند جديد تتطلب مستخدماً لديه صلاحية عرض وتسجيل تكلفة المورد.");
    }
    const storedLayers = parseStoredLayers(stored.layers);
    const incomingLayers = Array.isArray(row.layers) ? row.layers : [];
    if (incomingLayers.length !== storedLayers.length) {
      throw new Error("تغيير تركيب طبقات الزجاج يتطلب مستخدماً لديه صلاحية التكلفة.");
    }
    const layers = incomingLayers.map((layer, index) => {
      const storedLayer = storedLayers[index] || {};
      const supplierUnitPrice =
        storedLayer.supplierUnitPrice ?? storedLayer.supplier_unit_price ?? 0;
      const supplierUnitPriceSnake =
        storedLayer.supplier_unit_price ?? storedLayer.supplierUnitPrice ?? 0;
      return {
        ...layer,
        supplierUnitPrice,
        supplier_unit_price: supplierUnitPriceSnake
      };
    });
    protectedSupplierCosts.set(rowId, storedNumber(stored.supplier_cost));
    return {
      ...row,
      id: rowId,
      supplierUnitPrice: storedNumber(stored.supplier_unit_price),
      supplierMaterialUnitPrice: storedNumber(stored.supplier_material_unit_price),
      layers
    };
  });
  return { rows, protectedSupplierCosts };
}
