const GLASS_GROUP_CONTROL_CHARS = /[\u200f\u200e\u202a\u202b\u202c\u202d\u202e\ufeff\u0640\u200c\u200d\u2060]/g;
const GLASS_GROUP_DIGITS = new Map([
  ["٠", "0"], ["١", "1"], ["٢", "2"], ["٣", "3"], ["٤", "4"],
  ["٥", "5"], ["٦", "6"], ["٧", "7"], ["٨", "8"], ["٩", "9"],
  ["۰", "0"], ["۱", "1"], ["۲", "2"], ["۳", "3"], ["۴", "4"],
  ["۵", "5"], ["۶", "6"], ["۷", "7"], ["۸", "8"], ["۹", "9"]
]);

function cleanText(value) {
  return String(value || "").trim();
}

export function glassDescriptionGroupKey(value) {
  return cleanText(value)
    .normalize("NFKC")
    .replace(GLASS_GROUP_CONTROL_CHARS, "")
    .replace(/[٠-٩۰-۹]/g, (digit) => GLASS_GROUP_DIGITS.get(digit) || digit)
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/(\d+(?:[.,]\d+)?)\s*م\s*م/g, "$1مم")
    .replace(/(\d+),(\d+)/g, "$1.$2")
    .replace(/[*＊]+/g, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s*([/\\-])\s*/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

function layerMaterialKey(layer = {}) {
  return [
    glassDescriptionGroupKey(layer.glassType),
    glassDescriptionGroupKey(layer.company),
    glassDescriptionGroupKey(layer.thickness),
    layer.secure ? "secure" : ""
  ].join("|");
}

export function glassMaterialGroupKeyForRow(row = {}) {
  const mode = glassDescriptionGroupKey(row.glassMode || "single") || "single";
  const layers = Array.isArray(row.layers) ? row.layers : [];
  const layerKeys = layers.map(layerMaterialKey).filter((key) => key.replace(/\|/g, ""));
  if (!layerKeys.length) return "";
  return [
    mode,
    mode === "double" ? glassDescriptionGroupKey(row.doubleGap) : "",
    mode === "triplex" ? glassDescriptionGroupKey(row.triplexPvb) : "",
    ...layerKeys
  ].join("||");
}

export function groupGlassReceiptEntries(order = {}, entries = []) {
  const rows = Array.isArray(order.rows) ? order.rows : [];
  const rowsById = new Map(rows.map((row) => [String(row?.id || ""), row]).filter(([id]) => id));
  const groups = new Map();

  for (const entry of entries || []) {
    const description = cleanText(entry.description) || "نوع زجاج غير محدد";
    const sourceRow = rowsById.get(String(entry.rowId || "")) || rows[entry.rowIndex] || {};
    const groupKey = glassMaterialGroupKeyForRow(sourceRow) || glassDescriptionGroupKey(description) || description;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        key: `glass-${entry.rowId}`,
        description,
        orderedQuantity: 0,
        previouslyReceivedQuantity: 0,
        remainingQuantity: 0,
        entries: []
      });
    }
    const group = groups.get(groupKey);
    group.orderedQuantity += entry.orderedQuantity;
    group.previouslyReceivedQuantity += entry.previouslyReceivedQuantity;
    group.remainingQuantity += entry.remainingQuantity;
    group.entries.push(entry);
  }

  return [...groups.values()];
}
