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

test("Telegram resolves relative workbook settings beside its bot assets", () => {
  const resolver = functionSource(botSource, "resolveBotAssetPath");

  assert.match(resolver, /path\.isAbsolute\(specified\) \? specified : path\.resolve\(botDir, specified\)/);
  assert.match(botSource, /env\.GLASS_ORDERS_WORKBOOK_PATH \|\| env\.EXCEL_FILE/);
  assert.match(botSource, /path\.join\(botDir, "طلب شراء زجاج\.xlsm"\)/);
});

test("Excel helpers read a filesystem buffer instead of unsupported ESM path loading", () => {
  assert.match(botSource, /XLSX\.read\(fs\.readFileSync\(workbookPath\), \{ type: "buffer", cellDates: true \}\)/);
  assert.match(fallbackServerSource, /XLSX\.read\(fs\.readFileSync\(filePath\), \{ type: "buffer", cellDates: true \}\)/);
  assert.doesNotMatch(botSource, /XLSX\.readFile\(/);
  assert.doesNotMatch(fallbackServerSource, /XLSX\.readFile\(/);
});

test("Telegram order lookups reload data and report workflow status separately from receipt progress", () => {
  const handleMessage = functionSource(botSource, "handleMessage");
  const loadSupabase = functionSource(botSource, "loadSupabase");
  const searchReply = functionSource(botSource, "searchReply");

  assert.match(botSource, /async function refreshDataSourceForRequest\(\)/);
  assert.match(handleMessage, /await refreshDataSourceForRequest\(\)/);
  assert.match(loadSupabase, /hasAnyExplicitReceived/);
  assert.match(loadSupabase, /legacyReceivedRemaining/);
  assert.match(loadSupabase, /"حالة الاوردرات":\s*statusLabel\(order\.status\)/);
  assert.doesNotMatch(loadSupabase, /normalizeArabic\(order\.status\)\s*===\s*"collected"\s*\?\s*0/);
  assert.match(searchReply, /حالة الطلب:/);
  assert.match(searchReply, /حالة الاستلام:/);
});

test("partial Supabase configuration keeps Excel reports available and explains why status buttons are absent", () => {
  const loadDataSource = functionSource(botSource, "loadDataSource");
  const handleMessage = functionSource(botSource, "handleMessage");

  assert.match(botSource, /function hasSupabaseStatusSession\(\)/);
  assert.match(botSource, /function hasPartialSupabaseStatusSession\(\)/);
  assert.match(loadDataSource, /if \(hasSupabaseStatusSession\(\)\) return loadSupabase\(\)/);
  assert.match(loadDataSource, /if \(hasPartialSupabaseStatusSession\(\) && !warnedAboutExcelOnlyMode\)/);
  assert.match(loadDataSource, /return loadWorkbook\(\)/);
  assert.match(handleMessage, /تحديث حالة الطلب متاح عند تشغيل البوت من تطبيق Windows بعد تسجيل الدخول/);
});

test("Telegram status actions use short-lived chat-bound callbacks and the secured status RPC", () => {
  const handleCallback = functionSource(botSource, "handleCallback");
  const callbackResolver = functionSource(botSource, "pendingStatusUpdateForCallback");
  const updater = functionSource(botSource, "updateSupabaseOrderStatus");

  assert.match(botSource, /const pendingStatusUpdates = new Map\(\)/);
  assert.match(botSource, /randomUUID\(\)/);
  assert.match(botSource, /expiresAt: Date\.now\(\) \+ \(10 \* 60 \* 1000\)/);
  assert.match(callbackResolver, /pending\.chatId !== chatId \|\| pending\.threadId !== threadId/);
  assert.match(callbackResolver, /pendingStatusUpdates\.delete/);
  assert.match(updater, /client\.rpc\("update_order_status"/);
  assert.match(updater, /p_app_version:\s*"0\.1\.13"/);
  assert.match(updater, /p_client_type:\s*"telegram_bot"/);
  assert.doesNotMatch(updater, /\.from\("glass_orders"\)\.update/);
  assert.match(handleCallback, /await updateSupabaseOrderStatus\(pending\)/);
  assert.match(botSource, /allowed_updates:\s*\["message", "callback_query"\]/);
});
