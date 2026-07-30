"use strict";

const SECRET_FIELDS = Object.freeze({
  botToken: "botTokenCipher",
  supabasePassword: "supabasePasswordCipher"
});

function encryptionAvailable(safeStorage) {
  try {
    return safeStorage?.isEncryptionAvailable?.() === true;
  } catch {
    return false;
  }
}

function encryptSecret(value, safeStorage) {
  const secret = String(value || "");
  if (!secret) return "";
  if (!encryptionAvailable(safeStorage)) {
    throw new Error("Windows secure credential storage is unavailable.");
  }
  return safeStorage.encryptString(secret).toString("base64");
}

function decryptSecret(value, safeStorage) {
  const cipher = String(value || "");
  if (!cipher) return "";
  if (!encryptionAvailable(safeStorage)) return "";
  try {
    return safeStorage.decryptString(Buffer.from(cipher, "base64"));
  } catch {
    return "";
  }
}

function normalizeBotSettingsRecord(settings = {}) {
  return {
    enabled: settings.enabled === true,
    openAtLogin: settings.openAtLogin === true,
    startHiddenAtLogin: settings.startHiddenAtLogin !== false,
    supabaseUrl: String(settings.supabaseUrl || ""),
    supabaseKey: String(settings.supabaseKey || ""),
    supabaseEmail: String(settings.supabaseEmail || "").trim().toLocaleLowerCase(),
    botTokenCipher: String(settings.botTokenCipher || ""),
    supabasePasswordCipher: String(settings.supabasePasswordCipher || "")
  };
}

function mergeBotSettingsRecord(currentSettings = {}, patch = {}, safeStorage) {
  const current = normalizeBotSettingsRecord(currentSettings);
  const next = normalizeBotSettingsRecord({ ...current, ...patch });
  for (const [plainField, cipherField] of Object.entries(SECRET_FIELDS)) {
    if (!Object.prototype.hasOwnProperty.call(patch, plainField)) continue;
    next[cipherField] = encryptSecret(patch[plainField], safeStorage);
  }
  return next;
}

function runtimeBotSettings(record = {}, safeStorage) {
  const normalized = normalizeBotSettingsRecord(record);
  return {
    ...normalized,
    botToken: decryptSecret(normalized.botTokenCipher, safeStorage),
    supabasePassword: decryptSecret(normalized.supabasePasswordCipher, safeStorage)
  };
}

module.exports = {
  decryptSecret,
  encryptSecret,
  encryptionAvailable,
  mergeBotSettingsRecord,
  normalizeBotSettingsRecord,
  runtimeBotSettings
};
