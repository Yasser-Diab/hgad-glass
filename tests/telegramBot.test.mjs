import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  mergeBotSettingsRecord,
  normalizeBotSettingsRecord,
  runtimeBotSettings
} = require("../electron/secure-bot-settings.cjs");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`protected:${value}`, "utf8"),
  decryptString: (value) => value.toString("utf8").replace(/^protected:/, "")
};

test("Telegram credentials are encrypted at rest and recovered only for runtime", () => {
  const record = mergeBotSettingsRecord(normalizeBotSettingsRecord({
    enabled: true,
    supabaseUrl: "https://example.supabase.co",
    supabaseKey: "public-anon-key",
    supabaseEmail: "BOT@EXAMPLE.COM"
  }), {
    botToken: "telegram-secret",
    supabasePassword: "supabase-secret"
  }, fakeSafeStorage);

  const serialized = JSON.stringify(record);
  assert.doesNotMatch(serialized, /telegram-secret|supabase-secret/);
  assert.equal(record.supabaseEmail, "bot@example.com");
  assert.ok(record.botTokenCipher);
  assert.ok(record.supabasePasswordCipher);

  const runtime = runtimeBotSettings(record, fakeSafeStorage);
  assert.equal(runtime.botToken, "telegram-secret");
  assert.equal(runtime.supabasePassword, "supabase-secret");

  const cleared = mergeBotSettingsRecord(record, {
    botToken: "",
    supabasePassword: ""
  }, fakeSafeStorage);
  assert.equal(cleared.botTokenCipher, "");
  assert.equal(cleared.supabasePasswordCipher, "");
});

test("packaged bot receives complete Supabase credentials and stops retrying configuration failures", () => {
  const mainSource = fs.readFileSync(path.join(root, "electron", "main.cjs"), "utf8");
  const preloadSource = fs.readFileSync(path.join(root, "electron", "preload.cjs"), "utf8");
  const rendererSource = fs.readFileSync(path.join(root, "src", "main.jsx"), "utf8");
  const botSource = fs.readFileSync(path.join(root, "server", "telegramBot.mjs"), "utf8");
  const fallbackServerSource = fs.readFileSync(path.join(root, "server", "index.mjs"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

  assert.match(mainSource, /TELEGRAM_SUPABASE_EMAIL:\s*runSettings\.supabaseEmail/);
  assert.match(mainSource, /TELEGRAM_SUPABASE_PASSWORD:\s*runSettings\.supabasePassword/);
  assert.match(mainSource, /TELEGRAM_BOT_TOKEN:\s*runSettings\.botToken/);
  assert.match(mainSource, /startupFailed = telegramRestartBlocked \|\| telegramBotState === "failed" \|\| code === 2/);
  assert.match(mainSource, /credentialStorageAvailable:\s*encryptionAvailable\(safeStorage\)/);
  assert.doesNotMatch(
    mainSource.match(/function publicBotSettings[\s\S]*?\n\}/)?.[0] || "",
    /supabasePassword:|botToken:/
  );

  assert.match(preloadSource, /updateTelegramBotSettings:/);
  assert.match(rendererSource, /Telegram Bot Token/);
  assert.match(rendererSource, /حفظ بيانات البوت/);
  assert.match(botSource, /BOT_STATUS:failed/);
  assert.match(botSource, /process\.exitCode = 2/);
  assert.match(fallbackServerSource, /TELEGRAM_SUPABASE_EMAIL:\s*options\.supabaseEmail/);
  assert.match(fallbackServerSource, /TELEGRAM_BOT_TOKEN:\s*options\.botToken/);

  const packagedBotResource = packageJson.build.extraResources.find((entry) => entry.from === "telegram_excel_bot");
  assert.ok(packagedBotResource);
  assert.doesNotMatch(JSON.stringify(packagedBotResource), /\.env/);
});
