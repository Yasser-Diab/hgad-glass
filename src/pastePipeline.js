export const INTERNAL_MEASUREMENT_UNIT = "cm";

export const PASTE_MEASUREMENT_UNITS = Object.freeze(["m", "cm", "mm"]);
export const PASTE_SOURCE_DIRECTIONS = Object.freeze(["ltr", "rtl"]);

export const PASTE_MEASUREMENT_UNIT_OPTIONS = Object.freeze([
  Object.freeze({ value: "m", label: "متر" }),
  Object.freeze({ value: "cm", label: "سنتيمتر" }),
  Object.freeze({ value: "mm", label: "ملليمتر" })
]);

export const PASTE_SOURCE_DIRECTION_OPTIONS = Object.freeze([
  Object.freeze({ value: "ltr", label: "من اليسار إلى اليمين" }),
  Object.freeze({ value: "rtl", label: "من اليمين إلى اليسار" })
]);

export const DEFAULT_PASTE_PREFERENCES = Object.freeze({
  measurementUnit: "cm",
  sourceDirection: "rtl"
});

export const DEFAULT_MEASUREMENT_FIELD_KEYS = Object.freeze(["width", "height"]);
export const PASTE_PATCH_TYPE = "glass-orders/grid-paste";
export const PASTE_PATCH_VERSION = 1;

const ARABIC_DIGITS = Object.freeze({
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
  "۰": "0",
  "۱": "1",
  "۲": "2",
  "۳": "3",
  "۴": "4",
  "۵": "5",
  "۶": "6",
  "۷": "7",
  "۸": "8",
  "۹": "9"
});

const MEASUREMENT_UNIT_ALIASES = Object.freeze({
  m: "m",
  meter: "m",
  meters: "m",
  metre: "m",
  metres: "m",
  متر: "m",
  cm: "cm",
  centimeter: "cm",
  centimeters: "cm",
  centimetre: "cm",
  centimetres: "cm",
  سنتيمتر: "cm",
  سم: "cm",
  mm: "mm",
  millimeter: "mm",
  millimeters: "mm",
  millimetre: "mm",
  millimetres: "mm",
  ملليمتر: "mm",
  مم: "mm"
});

const SOURCE_DIRECTION_ALIASES = Object.freeze({
  ltr: "ltr",
  "left-to-right": "ltr",
  "left to right": "ltr",
  "من اليسار إلى اليمين": "ltr",
  "من اليسار الي اليمين": "ltr",
  rtl: "rtl",
  "right-to-left": "rtl",
  "right to left": "rtl",
  "من اليمين إلى اليسار": "rtl",
  "من اليمين الي اليسار": "rtl"
});

function normalizedAlias(value) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

export function normalizeMeasurementUnit(value, fallback = DEFAULT_PASTE_PREFERENCES.measurementUnit) {
  const normalizedFallback = MEASUREMENT_UNIT_ALIASES[normalizedAlias(fallback)] || DEFAULT_PASTE_PREFERENCES.measurementUnit;
  return MEASUREMENT_UNIT_ALIASES[normalizedAlias(value)] || normalizedFallback;
}

export function normalizeSourceDirection(value, fallback = DEFAULT_PASTE_PREFERENCES.sourceDirection) {
  const normalizedFallback = SOURCE_DIRECTION_ALIASES[normalizedAlias(fallback)] || DEFAULT_PASTE_PREFERENCES.sourceDirection;
  return SOURCE_DIRECTION_ALIASES[normalizedAlias(value)] || normalizedFallback;
}

export function normalizePastePreferences(savedPreferences = {}, defaults = DEFAULT_PASTE_PREFERENCES) {
  const safeSaved = savedPreferences && typeof savedPreferences === "object" ? savedPreferences : {};
  const safeDefaults = defaults && typeof defaults === "object" ? defaults : DEFAULT_PASTE_PREFERENCES;
  const defaultMeasurementUnit = normalizeMeasurementUnit(
    safeDefaults.measurementUnit,
    DEFAULT_PASTE_PREFERENCES.measurementUnit
  );
  const defaultSourceDirection = normalizeSourceDirection(
    safeDefaults.sourceDirection,
    DEFAULT_PASTE_PREFERENCES.sourceDirection
  );
  return {
    measurementUnit: normalizeMeasurementUnit(safeSaved.measurementUnit, defaultMeasurementUnit),
    sourceDirection: normalizeSourceDirection(safeSaved.sourceDirection, defaultSourceDirection)
  };
}

export function normalizeClipboardLineEndings(clipboardText = "") {
  return String(clipboardText ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function normalizeClipboardLines(clipboardText = "") {
  return normalizeClipboardLineEndings(clipboardText).split("\n");
}

export function normalizeClipboardRows(clipboardText = "", options = {}) {
  const delimiter = typeof options.delimiter === "string" && options.delimiter.length
    ? options.delimiter
    : "\t";
  return normalizeClipboardLines(clipboardText)
    .map((line) => line.split(delimiter))
    .filter((row) => row.some((cell) => String(cell ?? "").trim() !== ""));
}

export function applySourceColumnDirection(rows = [], direction = "ltr") {
  const normalizedDirection = normalizeSourceDirection(direction, "ltr");
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const cells = Array.isArray(row) ? [...row] : [String(row ?? "")];
    return normalizedDirection === "rtl" ? cells.reverse() : cells;
  });
}

function normalizedDestinationFieldKeys(fieldKeys) {
  if (!Array.isArray(fieldKeys) || !fieldKeys.length) return null;
  const normalized = fieldKeys.map((fieldKey) => String(fieldKey ?? "").trim());
  if (normalized.some((fieldKey) => !fieldKey)) return null;
  if (new Set(normalized).size !== normalized.length) return null;
  return normalized;
}

function pipelineError(code, message, details = {}) {
  return { code, message, ...details };
}

export function mapClipboardRowsToFields(rows = [], options = {}) {
  const destinationFieldKeys = normalizedDestinationFieldKeys(options.destinationFieldKeys);
  if (!destinationFieldKeys) {
    return {
      ok: false,
      cells: [],
      errors: [pipelineError("invalid-destination-fields", "Destination field keys must be a non-empty, unique list.")]
    };
  }

  const startRow = Number(options.startRow ?? 0);
  if (!Number.isInteger(startRow) || startRow < 0) {
    return {
      ok: false,
      cells: [],
      errors: [pipelineError("invalid-start-row", "The paste start row must be a non-negative integer.")]
    };
  }

  const startFieldKey = String(options.startFieldKey ?? destinationFieldKeys[0]);
  const startFieldIndex = destinationFieldKeys.indexOf(startFieldKey);
  if (startFieldIndex < 0) {
    return {
      ok: false,
      cells: [],
      errors: [pipelineError("invalid-start-field", `Unknown paste start field: ${startFieldKey}.`, { fieldKey: startFieldKey })]
    };
  }

  const sourceDirection = normalizeSourceDirection(options.sourceDirection, "ltr");
  const directedRows = applySourceColumnDirection(rows, sourceDirection);
  const cells = [];
  const errors = [];

  directedRows.forEach((row, rowOffset) => {
    row.forEach((rawValue, columnOffset) => {
      const fieldKey = destinationFieldKeys[startFieldIndex + columnOffset];
      if (!fieldKey) {
        errors.push(pipelineError(
          "column-overflow",
          `Clipboard column ${columnOffset + 1} does not fit after field ${startFieldKey}.`,
          {
            sourceRowIndex: rowOffset,
            sourceColumnIndex: columnOffset,
            rowIndex: startRow + rowOffset
          }
        ));
        return;
      }
      cells.push({
        sourceRowIndex: rowOffset,
        sourceColumnIndex: columnOffset,
        rowIndex: startRow + rowOffset,
        fieldKey,
        rawValue: String(rawValue ?? "")
      });
    });
  });

  return { ok: errors.length === 0, cells, errors, directedRows };
}

function latinDigits(value) {
  return String(value ?? "")
    .replace(/[٠-٩۰-۹]/g, (digit) => ARABIC_DIGITS[digit] || digit)
    .replace(/٫/g, ".");
}

function parseExactDecimal(value) {
  const text = latinDigits(value).trim();
  if (!text) return null;
  const match = text.match(/^([+-]?)(?:(\d+)(?:[.,](\d*))?|[.,](\d+))$/);
  if (!match) return null;
  const integerPart = match[2] || "0";
  const fractionalPart = match[3] ?? match[4] ?? "";
  return {
    negative: match[1] === "-",
    digits: `${integerPart}${fractionalPart}`,
    decimalIndex: integerPart.length
  };
}

function canonicalDecimal({ negative, digits, decimalIndex }) {
  let safeDigits = String(digits || "0");
  let safeDecimalIndex = decimalIndex;

  if (safeDecimalIndex <= 0) {
    safeDigits = `${"0".repeat(Math.abs(safeDecimalIndex))}${safeDigits}`;
    safeDecimalIndex = 0;
  }
  if (safeDecimalIndex >= safeDigits.length) {
    safeDigits = `${safeDigits}${"0".repeat(safeDecimalIndex - safeDigits.length)}`;
    safeDecimalIndex = safeDigits.length;
  }

  let integerPart = safeDecimalIndex === 0 ? "0" : safeDigits.slice(0, safeDecimalIndex);
  let fractionalPart = safeDecimalIndex === safeDigits.length ? "" : safeDigits.slice(safeDecimalIndex);
  integerPart = integerPart.replace(/^0+(?=\d)/, "") || "0";
  fractionalPart = fractionalPart.replace(/0+$/, "");
  const canonical = fractionalPart ? `${integerPart}.${fractionalPart}` : integerPart;
  const isZero = /^0(?:\.0*)?$/.test(canonical);
  return negative && !isZero ? `-${canonical}` : canonical;
}

export function convertMeasurementToCentimeters(value, sourceUnit = DEFAULT_PASTE_PREFERENCES.measurementUnit) {
  if (String(value ?? "").trim() === "") return "";
  const decimal = parseExactDecimal(value);
  if (!decimal) throw new TypeError(`Invalid measurement value: ${String(value ?? "")}`);
  const unit = normalizeMeasurementUnit(sourceUnit);
  const decimalShift = unit === "m" ? 2 : unit === "mm" ? -1 : 0;
  return canonicalDecimal({ ...decimal, decimalIndex: decimal.decimalIndex + decimalShift });
}

export function isMeasurementFieldKey(fieldKey, measurementFieldKeys = DEFAULT_MEASUREMENT_FIELD_KEYS) {
  const normalizedFieldKey = String(fieldKey ?? "");
  const explicitKeys = new Set(
    Array.isArray(measurementFieldKeys)
      ? measurementFieldKeys.map((key) => String(key))
      : DEFAULT_MEASUREMENT_FIELD_KEYS
  );
  return explicitKeys.has(normalizedFieldKey) || /^(?:layer\d+-)?(?:width|height)$/.test(normalizedFieldKey);
}

function validatorError(result, cell) {
  if (result === false) {
    return pipelineError("invalid-cell", `Invalid value for ${cell.fieldKey}.`);
  }
  if (typeof result === "string") {
    return pipelineError("invalid-cell", result);
  }
  if (result && typeof result === "object" && result.ok === false) {
    return pipelineError(result.code || "invalid-cell", result.message || `Invalid value for ${cell.fieldKey}.`);
  }
  return null;
}

export function validateMappedPasteCells(cells = [], options = {}) {
  const measurementUnit = normalizeMeasurementUnit(options.measurementUnit);
  const validators = options.validators && typeof options.validators === "object" ? options.validators : {};
  const processedCells = [];
  const errors = [];

  for (const cell of Array.isArray(cells) ? cells : []) {
    let value = cell.rawValue;
    if (isMeasurementFieldKey(cell.fieldKey, options.measurementFieldKeys)) {
      try {
        value = convertMeasurementToCentimeters(cell.rawValue, measurementUnit);
      } catch {
        errors.push(pipelineError(
          "invalid-measurement",
          `Invalid measurement for ${cell.fieldKey}.`,
          {
            rowIndex: cell.rowIndex,
            fieldKey: cell.fieldKey,
            sourceRowIndex: cell.sourceRowIndex,
            sourceColumnIndex: cell.sourceColumnIndex,
            rawValue: cell.rawValue
          }
        ));
        continue;
      }
    }

    const validationContext = { ...cell, value, measurementUnit, internalMeasurementUnit: INTERNAL_MEASUREMENT_UNIT };
    const fieldValidator = validators[cell.fieldKey];
    const generalValidator = validators["*"];
    const fieldError = typeof fieldValidator === "function"
      ? validatorError(fieldValidator(validationContext), cell)
      : null;
    const generalError = !fieldError && typeof generalValidator === "function"
      ? validatorError(generalValidator(validationContext), cell)
      : null;
    const error = fieldError || generalError;
    if (error) {
      errors.push({
        ...error,
        rowIndex: cell.rowIndex,
        fieldKey: cell.fieldKey,
        sourceRowIndex: cell.sourceRowIndex,
        sourceColumnIndex: cell.sourceColumnIndex,
        rawValue: cell.rawValue
      });
      continue;
    }
    processedCells.push({ ...cell, value });
  }

  return { ok: errors.length === 0, cells: processedCells, errors };
}

function currentCellSnapshot(currentRows, readCurrentCell, rowIndex, fieldKey) {
  if (typeof readCurrentCell === "function") {
    const result = readCurrentCell({ currentRows, rowIndex, fieldKey });
    if (result && typeof result === "object" && Object.prototype.hasOwnProperty.call(result, "exists")) {
      return {
        exists: !!result.exists,
        value: result.exists ? result.value : null
      };
    }
    return {
      exists: result !== undefined,
      value: result === undefined ? null : result
    };
  }
  const row = currentRows[rowIndex];
  const exists = !!row && Object.prototype.hasOwnProperty.call(row, fieldKey);
  return { exists, value: exists ? row[fieldKey] : null };
}

export function buildPastePatch(options = {}) {
  const preferences = normalizePastePreferences({
    measurementUnit: options.measurementUnit,
    sourceDirection: options.sourceDirection
  });
  const normalizedRows = normalizeClipboardRows(options.clipboardText, { delimiter: options.delimiter });
  if (!normalizedRows.length) {
    return {
      ok: false,
      patch: null,
      errors: [pipelineError("empty-clipboard", "The clipboard does not contain any non-empty rows.")]
    };
  }

  const mapping = mapClipboardRowsToFields(normalizedRows, {
    destinationFieldKeys: options.destinationFieldKeys,
    startFieldKey: options.startFieldKey,
    startRow: options.startRow,
    sourceDirection: preferences.sourceDirection
  });
  if (!mapping.ok) return { ok: false, patch: null, errors: mapping.errors };

  const validation = validateMappedPasteCells(mapping.cells, {
    measurementUnit: preferences.measurementUnit,
    measurementFieldKeys: options.measurementFieldKeys,
    validators: options.validators
  });
  if (!validation.ok) return { ok: false, patch: null, errors: validation.errors };

  const currentRows = Array.isArray(options.currentRows) ? options.currentRows : [];
  const destinationFieldKeys = normalizedDestinationFieldKeys(options.destinationFieldKeys);
  const startRow = Number(options.startRow ?? 0);
  const startFieldKey = String(options.startFieldKey ?? destinationFieldKeys[0]);
  const changes = validation.cells.map((cell) => ({
    rowIndex: cell.rowIndex,
    fieldKey: cell.fieldKey,
    before: currentCellSnapshot(currentRows, options.readCurrentCell, cell.rowIndex, cell.fieldKey),
    after: { exists: true, value: cell.value }
  }));

  return {
    ok: true,
    errors: [],
    patch: {
      type: PASTE_PATCH_TYPE,
      version: PASTE_PATCH_VERSION,
      start: { rowIndex: startRow, fieldKey: startFieldKey },
      source: {
        direction: preferences.sourceDirection,
        measurementUnit: preferences.measurementUnit,
        internalMeasurementUnit: INTERNAL_MEASUREMENT_UNIT,
        rowCount: normalizedRows.length,
        columnCounts: normalizedRows.map((row) => row.length)
      },
      destinationFieldKeys: [...destinationFieldKeys],
      beforeRowCount: currentRows.length,
      changes
    }
  };
}

export function applyPastePatchToRows(rows = [], patch, mode = "redo") {
  if (!patch || patch.type !== PASTE_PATCH_TYPE || patch.version !== PASTE_PATCH_VERSION) {
    throw new TypeError("Unsupported paste patch.");
  }
  if (!["redo", "undo"].includes(mode)) {
    throw new TypeError(`Unsupported paste patch mode: ${mode}.`);
  }

  const nextRows = (Array.isArray(rows) ? rows : []).map((row) => ({ ...(row || {}) }));
  for (const change of patch.changes || []) {
    while (nextRows.length <= change.rowIndex) nextRows.push({});
    const state = mode === "redo" ? change.after : change.before;
    if (state.exists) nextRows[change.rowIndex][change.fieldKey] = state.value;
    else delete nextRows[change.rowIndex][change.fieldKey];
  }
  if (mode === "undo" && Number.isInteger(patch.beforeRowCount) && patch.beforeRowCount >= 0) {
    nextRows.length = Math.min(nextRows.length, patch.beforeRowCount);
  }
  return nextRows;
}
