const DEFAULT_GLASS_COLOR = "#9fd3ff";
const DEFAULT_GLASS_ALPHA = 45;
const DEFAULT_EXTRA_DIRECTION = "في المنتصف تماماً";

export function isBlankOrderValue(value) {
  return value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "");
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function normalizedName(value) {
  return cleanText(value).toLocaleLowerCase();
}

function hasNumericInput(value) {
  return !isBlankOrderValue(value);
}

function positiveNumberState(value) {
  if (isBlankOrderValue(value)) return "missing";
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? "valid" : "invalid";
}

function drawingHasMeaningfulInput(drawing = {}) {
  if ((drawing.shapes || []).length || (drawing.paths || []).length || (drawing.panels || []).length) return true;
  if ((drawing.outline?.points || []).length) return true;
  return Object.values(drawing.edges || {}).some((value) => Number(value) !== 0);
}

function layerHasMeaningfulInput(layer = {}) {
  return !isBlankOrderValue(layer.glassType) ||
    !isBlankOrderValue(layer.company) ||
    !isBlankOrderValue(layer.thickness) ||
    hasNumericInput(layer.width) ||
    hasNumericInput(layer.height) ||
    hasNumericInput(layer.unitPrice) ||
    hasNumericInput(layer.supplierUnitPrice) ||
    !!layer.secure ||
    !!layer.mirror ||
    (cleanText(layer.color) && cleanText(layer.color).toLocaleLowerCase() !== DEFAULT_GLASS_COLOR) ||
    (!isBlankOrderValue(layer.alpha) && Number(layer.alpha) !== DEFAULT_GLASS_ALPHA);
}

export function orderRowHasStoredPanels(row = {}) {
  return (row.glassMode || "single") === "single" && Array.isArray(row.drawing?.panels) && row.drawing.panels.length > 0;
}

export function isCompletelyEmptyOrderRow(row = {}) {
  const mode = cleanText(row.glassMode || "single").toLocaleLowerCase();
  const rowHasMeaningfulInput = (mode && mode !== "single") ||
    !isBlankOrderValue(row.code) ||
    !isBlankOrderValue(row.notes) ||
    hasNumericInput(row.quantity) ||
    hasNumericInput(row.unitPrice) ||
    hasNumericInput(row.supplierUnitPrice) ||
    hasNumericInput(row.materialUnitPrice) ||
    hasNumericInput(row.supplierMaterialUnitPrice) ||
    !isBlankOrderValue(row.doubleGap) ||
    !isBlankOrderValue(row.triplexPvb) ||
    (cleanText(row.extraDirection) && cleanText(row.extraDirection) !== DEFAULT_EXTRA_DIRECTION);

  return !rowHasMeaningfulInput &&
    !(row.layers || []).some(layerHasMeaningfulInput) &&
    !drawingHasMeaningfulInput(row.drawing);
}

function validationError({ scope = "row", field, message, row, rowIndex, focusField = "" }) {
  return {
    scope,
    field,
    message,
    ...(scope === "row" ? {
      rowId: cleanText(row?.id) || `local-row-${rowIndex}`,
      rowIndex
    } : {}),
    ...(focusField ? { focusField } : {})
  };
}

function findSelectedParty(parties = [], id, name) {
  const expectedId = cleanText(id);
  const expectedName = normalizedName(name);
  if (!expectedId || !expectedName) return null;
  return parties.find((party) => cleanText(party?.id) === expectedId && normalizedName(party?.name) === expectedName) || null;
}

function validatePartySelection({ order, parties, nameField, idField, label, focusField }) {
  const name = cleanText(order?.[nameField]);
  const id = cleanText(order?.[idField]);
  if (!name) {
    return validationError({
      scope: "order",
      field: idField,
      focusField,
      message: `يجب اختيار ${label} قبل حفظ الطلب.`
    });
  }
  if (!id) {
    return validationError({
      scope: "order",
      field: idField,
      focusField,
      message: `يجب اختيار ${label} من القائمة قبل حفظ الطلب.`
    });
  }
  if (Array.isArray(parties) && parties.length && !findSelectedParty(parties, id, name)) {
    return validationError({
      scope: "order",
      field: idField,
      focusField,
      message: `اختيار ${label} غير صالح. اختر ${label} مرة أخرى من القائمة.`
    });
  }
  return null;
}

export function validateOrderHeaderForSave(order = {}, options = {}) {
  const errors = [];
  const customerError = validatePartySelection({
    order,
    parties: options.customers,
    nameField: "customerName",
    idField: "customerId",
    label: "العميل",
    focusField: "customer"
  });
  if (customerError) errors.push(customerError);

  const supplierError = validatePartySelection({
    order,
    parties: options.suppliers,
    nameField: "supplierName",
    idField: "supplierId",
    label: "المورد",
    focusField: "supplier"
  });
  if (supplierError) errors.push(supplierError);

  if (isBlankOrderValue(order.date)) {
    errors.push(validationError({
      scope: "order",
      field: "date",
      focusField: "date",
      message: "يجب تحديد تاريخ الطلب قبل الحفظ."
    }));
  }
  return errors;
}

function rowError(row, rowIndex, field, message) {
  return validationError({
    row,
    rowIndex,
    field,
    message: `الصف ${rowIndex + 1}: ${message}`
  });
}

function validateRequiredPositiveNumber(row, rowIndex, field, value, missingMessage, invalidMessage) {
  const state = positiveNumberState(value);
  if (state === "valid") return null;
  return rowError(row, rowIndex, field, state === "missing" ? missingMessage : invalidMessage);
}

export function validateOrderRowForSave(row = {}, rowIndex = 0) {
  if (isCompletelyEmptyOrderRow(row)) return [];
  const errors = [];
  const mode = cleanText(row.glassMode || "single").toLocaleLowerCase();
  const requiredLayerCount = mode === "single" ? 1 : 2;
  const hasPanels = orderRowHasStoredPanels(row);

  if (!["single", "double", "triplex"].includes(mode)) {
    errors.push(rowError(row, rowIndex, "mode", "يجب اختيار نظام زجاج صالح."));
  }

  for (let layerIndex = 0; layerIndex < requiredLayerCount; layerIndex += 1) {
    const layer = row.layers?.[layerIndex] || {};
    if (isBlankOrderValue(layer.glassType)) {
      errors.push(rowError(row, rowIndex, `layer${layerIndex}-glassType`, `يجب اختيار نوع الزجاج للطبقة ${layerIndex + 1}.`));
    }
    if (isBlankOrderValue(layer.thickness)) {
      errors.push(rowError(row, rowIndex, `layer${layerIndex}-thickness`, `يجب تحديد السمك للطبقة ${layerIndex + 1}.`));
    }
    if (!hasPanels) {
      const widthError = validateRequiredPositiveNumber(
        row,
        rowIndex,
        `layer${layerIndex}-width`,
        layer.width,
        `يجب إدخال العرض للطبقة ${layerIndex + 1}.`,
        `يجب أن يكون عرض الطبقة ${layerIndex + 1} أكبر من صفر.`
      );
      if (widthError) errors.push(widthError);
      const heightError = validateRequiredPositiveNumber(
        row,
        rowIndex,
        `layer${layerIndex}-height`,
        layer.height,
        `يجب إدخال الطول للطبقة ${layerIndex + 1}.`,
        `يجب أن يكون طول الطبقة ${layerIndex + 1} أكبر من صفر.`
      );
      if (heightError) errors.push(heightError);
    }
  }

  if (hasPanels) {
    for (const [panelIndex, panel] of (row.drawing?.panels || []).entries()) {
      if (positiveNumberState(panel?.width) !== "valid" || positiveNumberState(panel?.height) !== "valid") {
        errors.push(rowError(row, rowIndex, "drawing", `أبعاد اللوح ${panelIndex + 1} غير مكتملة أو غير صالحة.`));
        break;
      }
    }
  } else {
    const quantityError = validateRequiredPositiveNumber(
      row,
      rowIndex,
      "quantity",
      row.quantity,
      "يجب إدخال عدد الزجاج.",
      "يجب أن يكون عدد الزجاج أكبر من صفر."
    );
    if (quantityError) errors.push(quantityError);
  }

  if (mode === "double" && isBlankOrderValue(row.doubleGap)) {
    errors.push(rowError(row, rowIndex, "doubleGap", "يجب تحديد مقاس الفاصل للزجاج الدبل."));
  }
  if (mode === "triplex" && isBlankOrderValue(row.triplexPvb)) {
    errors.push(rowError(row, rowIndex, "triplexPvb", "يجب تحديد طبقة PVB للزجاج التربلكس."));
  }
  return errors;
}

export function classifyOrderRow(row = {}, rowIndex = 0) {
  if (isCompletelyEmptyOrderRow(row)) return "empty";
  return validateOrderRowForSave(row, rowIndex).length ? "partial" : "complete";
}

export function validateOrderForSave(order = {}, options = {}) {
  const rows = Array.isArray(order.rows) ? order.rows : [];
  const headerErrors = validateOrderHeaderForSave(order, options);
  const rowErrors = rows.flatMap((row, rowIndex) => validateOrderRowForSave(row, rowIndex));
  const payloadRows = rows.filter((row) => !isCompletelyEmptyOrderRow(row));
  if (!payloadRows.length) {
    const firstRow = rows[0] || {};
    rowErrors.push(rowError(firstRow, 0, "layer0-glassType", "يجب إدخال بند زجاج مكتمل واحد على الأقل."));
  }
  const errors = [...headerErrors, ...rowErrors];
  return {
    isValid: errors.length === 0,
    errors,
    payloadRows,
    rowStates: rows.map((row, rowIndex) => classifyOrderRow(row, rowIndex))
  };
}

export function validationErrorKey(error = {}) {
  return error.scope === "row"
    ? `${cleanText(error.rowId)}:${cleanText(error.field)}`
    : `order:${cleanText(error.field)}`;
}
