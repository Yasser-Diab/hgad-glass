import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mainSource = fs.readFileSync(path.join(root, "electron", "main.cjs"), "utf8");
const preloadSource = fs.readFileSync(path.join(root, "electron", "preload.cjs"), "utf8");
const rendererSource = fs.readFileSync(path.join(root, "src", "main.jsx"), "utf8");
const botSource = fs.readFileSync(path.join(root, "server", "telegramBot.mjs"), "utf8");
const fallbackServerSource = fs.readFileSync(path.join(root, "server", "index.mjs"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const next = source.indexOf("\nfunction ", start + 10);
  return source.slice(start, next === -1 ? source.length : next);
}

test("Telegram settings persist startup preferences only", () => {
  const normalizer = functionSource(mainSource, "normalizeBotSettings");
  const publicSettings = functionSource(mainSource, "publicBotSettings");
  const saver = functionSource(mainSource, "saveBotSettings");

  assert.match(normalizer, /enabled:/);
  assert.match(normalizer, /openAtLogin:/);
  assert.match(normalizer, /startHiddenAtLogin:/);
  assert.doesNotMatch(normalizer, /token|password|email|accessToken|refreshToken/i);

  assert.match(publicSettings, /hasBotToken:\s*botTokenAvailable\(\)/);
  assert.match(publicSettings, /hasSupabaseSession:\s*!!telegramSupabaseSession/);
  assert.doesNotMatch(publicSettings, /credentialSource/);
  assert.doesNotMatch(publicSettings, /\b(?:accessToken|refreshToken|botToken|password|email):/i);

  assert.match(saver, /writeJsonFile\(botSettingsPath,\s*next\)/);
  assert.doesNotMatch(saver, /token|password|email|accessToken|refreshToken|cipher/i);
  assert.doesNotMatch(mainSource, /safeStorage|botTokenCipher|supabasePasswordCipher/);
});

test("Telegram uses the active app session and has no dedicated login form", () => {
  const settingsStart = rendererSource.indexOf("function SettingsView");
  const settingsView = rendererSource.slice(settingsStart);

  assert.match(preloadSource, /syncTelegramBotSession:\s*\(session\)\s*=>\s*ipcRenderer\.invoke\("glass-orders:sync-telegram-session",\s*session\)/);
  assert.match(rendererSource, /client\.auth\.getSession\(\)/);
  assert.match(rendererSource, /syncTelegramBotSession\(await currentTelegramSupabaseSession\(\)\)/);
  assert.match(settingsView, /شغّل البوت لمتابعة الطلبات والتقارير عبر Telegram/);
  assert.match(settingsView, /تشغيل البوت متاح من تطبيق Windows/);
  assert.doesNotMatch(
    settingsView,
    /Telegram Bot Token|حفظ بيانات البوت|supabaseEmail|supabasePassword|botCredentialForm|BOT_TOKEN|\.env|server\/telegramBot|جلسة Supabase|بيانات دخول مستقلة|سجل بوت Telegram|التحديثات تعمل تلقائياً|ملف التحديث المناسب/
  );

  assert.match(mainSource, /TELEGRAM_SUPABASE_ACCESS_TOKEN:\s*runSession\.accessToken/);
  assert.match(mainSource, /TELEGRAM_SUPABASE_REFRESH_TOKEN:\s*runSession\.refreshToken/);
  assert.doesNotMatch(mainSource, /TELEGRAM_SUPABASE_EMAIL|TELEGRAM_SUPABASE_PASSWORD/);
  assert.match(botSource, /client\.auth\.setSession\(\{/);
  assert.match(botSource, /access_token:\s*supabaseAccessToken/);
  assert.match(botSource, /refresh_token:\s*supabaseRefreshToken/);
  assert.doesNotMatch(botSource, /signInWithPassword|TELEGRAM_SUPABASE_EMAIL|TELEGRAM_SUPABASE_PASSWORD/);
  assert.match(fallbackServerSource, /TELEGRAM_SUPABASE_ACCESS_TOKEN:\s*options\.accessToken/);
  assert.match(fallbackServerSource, /TELEGRAM_SUPABASE_REFRESH_TOKEN:\s*options\.refreshToken/);
});

test("packaged bot reads its token from telegram_excel_bot and stops retrying configuration failures", () => {
  assert.match(mainSource, /fs\.readFileSync\(path\.join\(botAssetsDir\(\),\s*"\.env"\)/);
  assert.match(mainSource, /folderEnv\.BOT_TOKEN/);
  assert.doesNotMatch(mainSource, /TELEGRAM_BOT_TOKEN:\s*runSession|TELEGRAM_BOT_TOKEN:\s*options/);
  assert.match(mainSource, /startupFailed = telegramRestartBlocked \|\| telegramBotState === "failed" \|\| code === 2/);
  assert.match(botSource, /BOT_STATUS:failed/);
  assert.match(botSource, /process\.exitCode = 2/);
  assert.match(botSource, /readEnvFile\(path\.join\(botDir,\s*"\.env"\)\)/);
  assert.match(botSource, /env\.BOT_TOKEN/);

  const packagedBotResource = packageJson.build.extraResources.find((entry) => entry.from === "telegram_excel_bot");
  assert.ok(packagedBotResource);
  assert.ok(packagedBotResource.filter.includes(".env"));
});
