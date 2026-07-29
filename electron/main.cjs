const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, shell, dialog, Notification } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");

let localServerProcess = null;
const localServerLogs = [];
let browserStaticServer = null;
let browserStaticServerState = "stopped";
let browserStaticServerError = "";
const browserStaticServerLogs = [];
const browserStaticServerConnections = new Set();
let telegramBotProcess = null;
const telegramBotLogs = [];
let telegramBotState = "stopped";
let stoppingTelegramBot = false;
let telegramRestartTimer = null;
let mainWindow = null;
let tray = null;
let isQuitting = false;
let rendererHasUnsavedEntry = false;
const activeChildren = new Set();
let shutdownPromise = null;

const root = path.join(__dirname, "..");
const BOT_BACKGROUND_ARG = "--glass-orders-background-bot";
const DEFAULT_BOT_SETTINGS = {
  enabled: false,
  openAtLogin: false,
  startHiddenAtLogin: true,
  supabaseUrl: "",
  supabaseKey: ""
};
const appIconPath = path.join(root, "icons", "app-icon.png");
const trayIconPath = path.join(root, "icons", "tray-icon.png");
const windowStatePath = path.join(app.getPath("userData"), "window-state.json");
const offlineQueuePath = path.join(app.getPath("userData"), "offline-queue.json");
const offlineSnapshotPath = path.join(app.getPath("userData"), "offline-snapshot.json");
const botSettingsPath = path.join(app.getPath("userData"), "telegram-bot-settings.json");
const shutdownLogPath = path.join(app.getPath("userData"), "shutdown.log");
const BROWSER_SERVER_HOST = "127.0.0.1";
const BROWSER_SERVER_PORT = 5174;
const BROWSER_SERVER_URL = `http://${BROWSER_SERVER_HOST}:${BROWSER_SERVER_PORT}/`;

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

function helperRoot() {
  return app.isPackaged ? path.join(process.resourcesPath, "app.asar.unpacked") : root;
}

function bundledRoot() {
  return app.isPackaged ? path.join(process.resourcesPath, "app.asar") : root;
}

function helperScriptPath(...segments) {
  return firstExisting([
    app.isPackaged ? path.join(process.resourcesPath, ...segments) : "",
    app.isPackaged ? path.join(process.resourcesPath, "app.asar.unpacked", ...segments) : "",
    app.isPackaged ? path.join(process.resourcesPath, "app.asar", ...segments) : "",
    path.join(root, ...segments)
  ]);
}

function botAssetsDir() {
  return firstExisting([
    process.env.GLASS_ORDERS_BOT_DIR,
    app.isPackaged ? path.join(process.resourcesPath, "telegram_excel_bot") : "",
    app.isPackaged ? path.join(process.resourcesPath, "app.asar.unpacked", "telegram_excel_bot") : "",
    app.isPackaged ? path.join(process.resourcesPath, "app.asar", "telegram_excel_bot") : "",
    path.join(root, "telegram_excel_bot")
  ]);
}

function botNodePaths() {
  return [
    app.isPackaged ? path.join(process.resourcesPath, "node_modules") : "",
    app.isPackaged ? path.join(process.resourcesPath, "app.asar.unpacked", "node_modules") : "",
    app.isPackaged ? path.join(process.resourcesPath, "app.asar", "node_modules") : "",
    path.join(root, "node_modules")
  ].filter((candidate) => candidate && fs.existsSync(candidate));
}

function processWorkingRoot() {
  return app.isPackaged ? path.dirname(process.resourcesPath) : root;
}

function firstExisting(paths) {
  return paths.find((candidate) => candidate && fs.existsSync(candidate)) || paths.find(Boolean);
}

function currentExecutablePath() {
  return firstExisting([
    app.isPackaged ? path.join(path.dirname(process.resourcesPath), "YDGlassManager.exe") : "",
    app.isPackaged ? path.join(path.dirname(process.resourcesPath), "Glass Orders.exe") : "",
    app.isPackaged ? path.join(path.dirname(process.resourcesPath), `${app.getName()}.exe`) : "",
    app.getPath("exe"),
    process.execPath
  ]);
}

function packagedWorkbookPath() {
  return firstExisting([
    process.env.GLASS_ORDERS_WORKBOOK_PATH,
    app.isPackaged ? path.join(process.resourcesPath, "طلب شراء زجاج.xlsm") : "",
    app.isPackaged ? path.join(process.resourcesPath, "telegram_excel_bot", "طلب شراء زجاج.xlsm") : "",
    app.isPackaged ? path.join(path.dirname(process.resourcesPath), "طلب شراء زجاج.xlsm") : "",
    path.join(path.dirname(currentExecutablePath()), "طلب شراء زجاج.xlsm"),
    path.join(helperRoot(), "طلب شراء زجاج.xlsm"),
    path.join(root, "telegram_excel_bot", "طلب شراء زجاج.xlsm"),
    path.join(root, "طلب شراء زجاج.xlsm")
  ]);
}

function pushLocalLog(line) {
  const text = String(line || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd();
  if (!text) return;
  for (const part of text.split("\n")) {
    localServerLogs.push(`[${new Date().toLocaleTimeString()}] ${part}`);
  }
  if (localServerLogs.length > 300) localServerLogs.shift();
}

function pushBrowserServerLog(line) {
  const text = String(line || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd();
  if (!text) return;
  for (const part of text.split("\n")) {
    browserStaticServerLogs.push(`[${new Date().toLocaleTimeString()}] ${part}`);
  }
  if (browserStaticServerLogs.length > 300) browserStaticServerLogs.shift();
}

function pushBotLog(line) {
  const text = String(line || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd();
  if (!text) return;
  for (const part of text.split("\n")) {
    const statusMatch = part.match(/BOT_STATUS:(starting|running|reconnecting|failed|stopped)/);
    if (statusMatch) telegramBotState = statusMatch[1];
    telegramBotLogs.push(`[${new Date().toLocaleTimeString()}] ${part}`);
  }
  if (telegramBotLogs.length > 500) telegramBotLogs.shift();
}

function readWindowState() {
  try {
    return JSON.parse(fs.readFileSync(windowStatePath, "utf8"));
  } catch {
    return {};
  }
}

function saveWindowState(win = mainWindow) {
  if (!win || win.isDestroyed()) return;
  const state = {
    bounds: win.getBounds(),
    isMaximized: win.isMaximized(),
    isFullScreen: win.isFullScreen()
  };
  try {
    fs.mkdirSync(path.dirname(windowStatePath), { recursive: true });
    fs.writeFileSync(windowStatePath, JSON.stringify(state, null, 2), "utf8");
  } catch {
    // Best effort only.
  }
}

function writeJsonFile(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload || {}, null, 2), "utf8");
  return { ok: true, filePath };
}

function readBotSettings() {
  try {
    return normalizeBotSettings(JSON.parse(fs.readFileSync(botSettingsPath, "utf8")));
  } catch {
    return { ...DEFAULT_BOT_SETTINGS };
  }
}

function normalizeBotSettings(settings = {}) {
  return {
    ...DEFAULT_BOT_SETTINGS,
    enabled: settings.enabled === true,
    openAtLogin: settings.openAtLogin === true,
    startHiddenAtLogin: settings.startHiddenAtLogin !== false,
    supabaseUrl: String(settings.supabaseUrl || ""),
    supabaseKey: String(settings.supabaseKey || "")
  };
}

function publicBotSettings(settings = readBotSettings()) {
  const normalized = normalizeBotSettings(settings);
  return {
    enabled: normalized.enabled,
    openAtLogin: normalized.openAtLogin,
    startHiddenAtLogin: normalized.startHiddenAtLogin,
    canOpenAtLogin: process.platform === "win32",
    hasSupabase: !!(normalized.supabaseUrl && normalized.supabaseKey)
  };
}

function applyBotLoginItemSettings(settings = readBotSettings()) {
  if (process.platform !== "win32") return publicBotSettings(settings);
  const normalized = normalizeBotSettings(settings);
  try {
    app.setLoginItemSettings({
      openAtLogin: normalized.openAtLogin,
      path: currentExecutablePath(),
      args: normalized.startHiddenAtLogin ? [BOT_BACKGROUND_ARG] : []
    });
  } catch (error) {
    pushBotLog(`Windows startup setting failed: ${error.message}`);
  }
  return publicBotSettings(normalized);
}

function saveBotSettings(patch = {}) {
  const current = readBotSettings();
  const next = normalizeBotSettings({ ...current, ...patch, updatedAt: new Date().toISOString() });
  writeJsonFile(botSettingsPath, next);
  applyBotLoginItemSettings(next);
  return next;
}

function shouldLaunchHidden() {
  return process.argv.includes(BOT_BACKGROUND_ARG);
}

function pendingOfflineCount() {
  try {
    const payload = JSON.parse(fs.readFileSync(offlineQueuePath, "utf8"));
    if (Array.isArray(payload)) return payload.length;
    if (Array.isArray(payload?.queue)) return payload.queue.length;
  } catch {
    // No queue file yet.
  }
  return 0;
}

function shutdownLog(message, error = null) {
  const line = `[${new Date().toISOString()}] [Shutdown] ${message}${error ? `: ${error.stack || error.message || error}` : ""}`;
  try {
    fs.mkdirSync(path.dirname(shutdownLogPath), { recursive: true });
    fs.appendFileSync(shutdownLogPath, `${line}\n`, "utf8");
  } catch {
    // Shutdown logging is best effort.
  }
  if (error) console.warn(line);
  else console.log(line);
}

function registerChild(child, label = "helper") {
  if (!child) return child;
  child.__glassOrdersLabel = label;
  activeChildren.add(child);
  child.once("exit", () => activeChildren.delete(child));
  return child;
}

function waitForChildExit(child, timeoutMs = 4500) {
  if (!child || child.exitCode !== null || child.signalCode) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);
    timer.unref?.();
    function cleanup() {
      clearTimeout(timer);
      child.off?.("exit", onExit);
      child.off?.("error", onExit);
    }
    function onExit() {
      cleanup();
      resolve(true);
    }
    child.once("exit", onExit);
    child.once("error", onExit);
  });
}

function taskkillProcessTree(pid, label = "helper") {
  if (process.platform !== "win32" || !pid) return Promise.resolve();
  return new Promise((resolve) => {
    try {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true
      });
      killer.once("exit", () => {
        shutdownLog(`${label} process tree ${pid} termination requested`);
        resolve();
      });
      killer.once("error", (error) => {
        shutdownLog(`Failed to run taskkill for ${label} ${pid}`, error);
        resolve();
      });
    } catch (error) {
      shutdownLog(`Failed to start taskkill for ${label} ${pid}`, error);
      resolve();
    }
  });
}

async function terminateChildProcess(child, label = "helper") {
  if (!child) return;
  const pid = child.pid;
  const resolvedLabel = child.__glassOrdersLabel || label;
  try {
    if (!child.killed && child.exitCode === null) {
      shutdownLog(`Stopping ${resolvedLabel} ${pid || ""}`.trim());
      child.kill();
    }
  } catch (error) {
    shutdownLog(`Failed to stop ${resolvedLabel}`, error);
  }
  const exitedGracefully = await waitForChildExit(child, 1500);
  if (!exitedGracefully && pid) {
    await taskkillProcessTree(pid, resolvedLabel);
    await waitForChildExit(child, 3500);
  }
  if (child.exitCode === null && !child.signalCode) {
    shutdownLog(`${resolvedLabel} ${pid || ""} did not confirm exit before timeout`.trim());
  } else {
    shutdownLog(`${resolvedLabel} ${pid || ""} stopped`.trim());
  }
  activeChildren.delete(child);
}

async function stopChildProcesses() {
  const children = [...activeChildren];
  await Promise.allSettled(children.map((child) => terminateChildProcess(child, child.__glassOrdersLabel || "helper")));
  activeChildren.clear();
}

async function prepareForShutdown(reason = "exit") {
  if (shutdownPromise) return shutdownPromise;
  isQuitting = true;
  shutdownPromise = (async () => {
    shutdownLog(`Started (${reason})`);
    if (telegramRestartTimer) {
      clearTimeout(telegramRestartTimer);
      telegramRestartTimer = null;
      shutdownLog("Telegram restart timer cleared");
    }
    stoppingTelegramBot = true;
    await stopGlassBrowserServer();
    await terminateChildProcess(telegramBotProcess, "Telegram bot");
    await terminateChildProcess(localServerProcess, "local database server");
    await stopChildProcesses();
    telegramBotProcess = null;
    localServerProcess = null;
    telegramBotState = "stopped";
    if (tray) {
      try {
        tray.destroy();
        shutdownLog("Tray destroyed");
      } catch (error) {
        shutdownLog("Tray destroy failed", error);
      }
      tray = null;
    }
    try {
      app.globalShortcut?.unregisterAll?.();
      shutdownLog("Global shortcuts unregistered");
    } catch (error) {
      shutdownLog("Global shortcut cleanup failed", error);
    }
    shutdownLog("Background services stopped");
  })();
  return shutdownPromise;
}

async function shutdownApp(reason = "exit") {
  isQuitting = true;
  const forceExitTimer = setTimeout(() => {
    shutdownLog("Timeout exceeded; force exit used");
    app.exit(0);
  }, 7000);
  forceExitTimer.unref?.();
  try {
    saveWindowState();
    await prepareForShutdown(reason);
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        win.removeAllListeners("close");
        if (!win.isDestroyed()) win.destroy();
      } catch (error) {
        shutdownLog("Window destruction failed", error);
      }
    }
    shutdownLog("Windows destroyed");
    shutdownLog("Electron quit requested");
    app.quit();
    setTimeout(() => app.exit(0), 1000).unref?.();
  } catch (error) {
    shutdownLog("Shutdown failed", error);
    app.exit(1);
  }
}

async function requestExit() {
  if (rendererHasUnsavedEntry) {
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: "warning",
      buttons: ["البقاء والتحرير", "خروج بدون حفظ"],
      defaultId: 0,
      cancelId: 0,
      title: "بيانات غير محفوظة",
      message: "هناك بيانات إدخال لم يتم حفظها بعد.",
      detail: "الخروج الآن قد يفقد البيانات الحالية. الإجراء الآمن هو البقاء داخل التطبيق."
    });
    if (choice === 0) {
      showWindow("entry");
      return;
    }
  }
  const count = pendingOfflineCount();
  if (count > 0) {
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: "warning",
      buttons: ["البقاء حتى المزامنة", "خروج بدون مزامنة"],
      defaultId: 0,
      cancelId: 0,
      title: "مزامنة غير مكتملة",
      message: "هناك بيانات محفوظة محلياً لم تصل إلى Supabase بعد.",
      detail: `العمليات المنتظرة: ${count}. اتصل بالإنترنت وافتح البرنامج حتى تكتمل المزامنة قبل الخروج.`
    });
    if (choice === 0) {
      showWindow();
      return;
    }
  }
  await shutdownApp("user exit");
}

function appIcon(size = 32, sourcePath = appIconPath) {
  const image = nativeImage.createFromPath(sourcePath);
  return image.isEmpty() ? undefined : image.resize({ width: size, height: size, quality: "best" });
}

function safeExternalUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    return ["https:", "http:"].includes(parsed.protocol) ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function showDesktopNotification(payload = {}) {
  if (!Notification.isSupported()) return { ok: false, error: "Notifications are not supported." };
  const title = String(payload.title || "Y.D Glass Manager");
  const body = String(payload.body || "");
  const url = safeExternalUrl(payload.url);
  const notification = new Notification({
    title,
    body,
    icon: appIconPath
  });
  notification.on("click", () => {
    if (url) shell.openExternal(url);
    showWindow();
  });
  notification.show();
  return { ok: true };
}

function sanitizePathSegment(value = "", fallback = "") {
  return String(value || "")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 120) || fallback;
}

function validateWritableDirectory(directory) {
  const dir = String(directory || "");
  if (!dir) return { ok: false, error: "No directory selected." };
  try {
    fs.mkdirSync(dir, { recursive: true });
    const testFile = path.join(dir, `.glass-orders-write-${Date.now()}.tmp`);
    fs.writeFileSync(testFile, "ok", "utf8");
    fs.unlinkSync(testFile);
    return { ok: true, directory: dir };
  } catch (error) {
    return { ok: false, error: error.message, directory: dir };
  }
}

function reportSavePath(payload = {}) {
  const settings = payload.saveSettings || {};
  const supplierId = String(payload.supplierId || "").trim();
  const supplierNameRaw = String(payload.supplierName || "").trim();
  const supplierName = sanitizePathSegment(supplierNameRaw || "");
  const fileName = sanitizePathSegment(payload.fileName || "YDGlassManager-export", "YDGlassManager-export");
  const baseDir = String(settings.directory || "");
  if (!baseDir) return null;
  const selectedSupplierIds = Array.isArray(settings.supplierSubfolderIds) ? settings.supplierSubfolderIds.map(String) : [];
  const selectedSupplierNames = Array.isArray(settings.supplierSubfolderNames) ? settings.supplierSubfolderNames.map((name) => String(name || "").trim().toLocaleLowerCase()) : [];
  const supplierSelected = supplierName && (
    (supplierId && selectedSupplierIds.includes(supplierId)) ||
    selectedSupplierNames.includes(supplierNameRaw.toLocaleLowerCase())
  );
  const parts = [baseDir];
  if (supplierSelected) parts.push(supplierName);
  const targetDir = path.join(...parts);
  const validation = validateWritableDirectory(targetDir);
  if (!validation.ok) throw new Error(validation.error);
  return path.join(targetDir, fileName);
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false };
  mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
  mainWindow.webContents.focus();
  return { ok: true, focused: mainWindow.isFocused() };
}

function shouldRestoreMainWindowFocus() {
  return !!(mainWindow && !mainWindow.isDestroyed() && (mainWindow.isFocused() || BrowserWindow.getFocusedWindow() === mainWindow));
}

function restoreMainWindowFocus(shouldRestore) {
  return shouldRestore ? focusMainWindow() : { ok: true, skipped: true };
}

function forceFocusReset() {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false };
  return focusMainWindow();
}

async function printHtml(payload = {}) {
  const widthMicrons = Math.max(10000, Math.round(Number(payload.widthMm || 90) * 1000));
  const heightMicrons = Math.max(10000, Math.round(Number(payload.heightMm || 55) * 1000));
  const restoreFocus = shouldRestoreMainWindowFocus();
  const printWindow = new BrowserWindow({
    show: false,
    width: 900,
    height: 700,
    webPreferences: { sandbox: true }
  });
  try {
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(String(payload.html || ""))}`);
    await new Promise((resolve, reject) => {
      printWindow.webContents.print({
        silent: false,
        printBackground: true,
        deviceName: String(payload.printerName || ""),
        pageSize: { width: widthMicrons, height: heightMicrons },
        margins: { marginType: "none" }
      }, (success, failureReason) => success ? resolve() : reject(new Error(failureReason || "Print failed.")));
    });
    return { ok: true };
  } finally {
    if (!printWindow.isDestroyed()) printWindow.close();
    restoreMainWindowFocus(restoreFocus);
  }
}

function cairoFontFaceCss() {
  const fontPath = firstExisting([
    path.join(botAssetsDir(), "Cairo-Regular.ttf"),
    path.join(root, "telegram_excel_bot", "Cairo-Regular.ttf")
  ]);
  try {
    if (!fontPath || !fs.existsSync(fontPath)) return "";
    const fontBase64 = fs.readFileSync(fontPath).toString("base64");
    return `
      @font-face {
        font-family: "GlassOrdersCairo";
        src: url("data:font/ttf;base64,${fontBase64}") format("truetype");
        font-weight: 400 900;
        font-style: normal;
        font-display: swap;
      }
    `;
  } catch (error) {
    console.warn(`Could not embed Cairo font in PDF: ${error.message}`);
    return "";
  }
}

function injectPdfPrintAssets(html = "") {
  const fontCss = cairoFontFaceCss();
  if (!fontCss) return String(html || "");
  const styleTag = `<style id="glass-orders-pdf-font">${fontCss}</style>`;
  const documentHtml = String(html || "");
  if (/<\/head>/i.test(documentHtml)) return documentHtml.replace(/<\/head>/i, `${styleTag}</head>`);
  return `<!doctype html><html dir="rtl"><head><meta charset="utf-8">${styleTag}</head><body>${documentHtml}</body></html>`;
}

async function waitForPrintableContent(webContents) {
  try {
    await webContents.executeJavaScript(`
      Promise.all([
        document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve(),
        Promise.all(Array.from(document.images || []).map((img) => img.complete ? Promise.resolve() : new Promise((resolve) => {
          img.addEventListener("load", resolve, { once: true });
          img.addEventListener("error", resolve, { once: true });
        })))
      ]).then(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    `, true);
  } catch (error) {
    console.warn(`PDF print readiness check failed: ${error.message}`);
  }
}

async function printPdfHtml(payload = {}) {
  const rawName = String(payload.fileName || "YDGlassManager-export.pdf").replace(/[<>:"/\\|?*\x00-\x1f]/g, "-");
  const fileName = /\.pdf$/i.test(rawName) ? rawName : `${rawName}.pdf`;
  const restoreFocus = shouldRestoreMainWindowFocus();
  let filePath = reportSavePath({ ...payload, fileName });
  if (!filePath) {
    const lastDirectory = payload.saveSettings?.lastDirectory || app.getPath("documents");
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Save report",
      defaultPath: path.join(lastDirectory, fileName),
      filters: [{ name: "PDF", extensions: ["pdf"] }]
    });
    restoreMainWindowFocus(restoreFocus);
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    filePath = result.filePath;
  }
  const printWindow = new BrowserWindow({
    show: false,
    width: 1240,
    height: 1754,
    webPreferences: { sandbox: true }
  });
  const tempPath = path.join(app.getPath("temp"), `glass-orders-report-${Date.now()}-${Math.random().toString(16).slice(2)}.html`);
  try {
    fs.writeFileSync(tempPath, injectPdfPrintAssets(payload.html || ""), "utf8");
    await printWindow.loadFile(tempPath);
    await waitForPrintableContent(printWindow.webContents);
    const pdfBuffer = await printWindow.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      landscape: false,
      pageSize: "A4",
      displayHeaderFooter: false,
      margins: { marginType: "none" }
    });
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, pdfBuffer);
    if (payload.saveSettings?.openPdfAfterSave) {
      shell.openPath(filePath).catch(() => null);
    }
    restoreMainWindowFocus(restoreFocus && !payload.saveSettings?.openPdfAfterSave);
    return { ok: true, filePath, directory: path.dirname(filePath) };
  } finally {
    if (!printWindow.isDestroyed()) printWindow.close();
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // Temporary print HTML cleanup is best effort.
    }
    restoreMainWindowFocus(restoreFocus && !payload.saveSettings?.openPdfAfterSave);
  }
}

function startLocalServer() {
  if (localServerProcess && !localServerProcess.killed) {
    return { ok: true, alreadyRunning: true, logs: localServerLogs };
  }
  const serverScript = helperScriptPath("server", "index.mjs");
  const runtime = currentExecutablePath();
  const dataDir = path.join(app.getPath("userData"), "local-pg");
  const workbookPath = packagedWorkbookPath();
  pushLocalLog(`Starting local database server from ${serverScript}`);
  pushLocalLog(`Using helper runtime ${runtime}`);
  if (!fs.existsSync(runtime)) {
    pushLocalLog(`Local server runtime was not found: ${runtime}`);
    return { ok: false, error: `Runtime not found: ${runtime}`, logs: localServerLogs };
  }
  if (!fs.existsSync(serverScript)) {
    pushLocalLog(`Local server script was not found: ${serverScript}`);
    return { ok: false, error: `Server script not found: ${serverScript}`, logs: localServerLogs };
  }
  try {
    localServerProcess = registerChild(spawn(runtime, [serverScript], {
      cwd: processWorkingRoot(),
      windowsHide: true,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        GLASS_ORDERS_PORT: process.env.GLASS_ORDERS_PORT || "4197",
        GLASS_ORDERS_DATA_DIR: process.env.GLASS_ORDERS_DATA_DIR || dataDir,
        GLASS_ORDERS_WORKBOOK_PATH: workbookPath
      }
    }), "local database server");
  } catch (error) {
    pushLocalLog(`Local database server failed to start: ${error.message}`);
    localServerProcess = null;
    return { ok: false, error: error.message, logs: localServerLogs };
  }
  localServerProcess.stdout?.on("data", (data) => pushLocalLog(data));
  localServerProcess.stderr?.on("data", (data) => pushLocalLog(data));
  localServerProcess.on("error", (error) => {
    pushLocalLog(`Local database server failed to start: ${error.message}`);
    localServerProcess = null;
  });
  localServerProcess.on("exit", (code) => {
    pushLocalLog(`Local database server stopped with code ${code}`);
    localServerProcess = null;
  });
  return { ok: true, started: true, logs: localServerLogs };
}

async function stopLocalServer() {
  if (localServerProcess && !localServerProcess.killed) {
    pushLocalLog("Stopping local database server...");
    await terminateChildProcess(localServerProcess, "local database server");
  } else {
    pushLocalLog("Local database server is already stopped.");
  }
  localServerProcess = null;
  return { ok: true, running: false, logs: localServerLogs };
}

function frontendBundleDir() {
  return firstExisting([
    process.env.GLASS_ORDERS_FRONTEND_DIR,
    app.isPackaged ? path.join(process.resourcesPath, "app.asar", "dist") : "",
    app.isPackaged ? path.join(process.resourcesPath, "app.asar.unpacked", "dist") : "",
    path.join(root, "dist")
  ]);
}

function browserServerStatus() {
  return {
    ok: browserStaticServerState === "running",
    state: browserStaticServerState,
    url: BROWSER_SERVER_URL,
    error: browserStaticServerError,
    logs: browserStaticServerLogs
  };
}

function browserMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2"
  }[ext] || "application/octet-stream";
}

function safeStaticPath(bundleDir, requestUrl = "/") {
  let pathname = "/";
  try {
    pathname = decodeURIComponent(new URL(requestUrl, BROWSER_SERVER_URL).pathname || "/");
  } catch {
    pathname = "/";
  }
  const relative = pathname.replace(/^\/+/, "") || "index.html";
  const candidate = path.normalize(path.join(bundleDir, relative));
  const normalizedRoot = path.normalize(bundleDir + path.sep);
  if (candidate !== path.normalize(bundleDir) && !candidate.startsWith(normalizedRoot)) {
    return { filePath: path.join(bundleDir, "index.html"), fallback: true };
  }
  return { filePath: candidate, fallback: false, pathname };
}

function serveBrowserStaticRequest(bundleDir, request, response) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Method Not Allowed");
    return;
  }
  const resolved = safeStaticPath(bundleDir, request.url);
  let filePath = resolved.filePath;
  let stat = null;
  try {
    stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, "index.html");
      stat = fs.statSync(filePath);
    }
  } catch {
    const hasAssetExtension = !!path.extname(filePath);
    if (hasAssetExtension && path.basename(filePath) !== "index.html") {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      response.end("Not Found");
      return;
    }
    filePath = path.join(bundleDir, "index.html");
    try {
      stat = fs.statSync(filePath);
    } catch {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      response.end("Y.D Glass Manager frontend bundle is missing.");
      return;
    }
  }
  const isIndex = path.basename(filePath).toLowerCase() === "index.html";
  response.writeHead(200, {
    "Content-Type": browserMimeType(filePath),
    "Content-Length": stat.size,
    "Cache-Control": isIndex ? "no-cache, must-revalidate" : "public, max-age=31536000, immutable",
    "X-Glass-Orders-Local-Server": "browser-ui"
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  fs.createReadStream(filePath).on("error", (error) => {
    pushBrowserServerLog(`[LocalServer] Read failed: ${error.message}`);
    if (!response.headersSent) response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Unable to read file.");
  }).pipe(response);
}

function waitForBrowserServerReady(timeoutMs = 4500) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    function attempt() {
      const request = http.get(BROWSER_SERVER_URL, (response) => {
        response.resume();
        if (response.statusCode >= 200 && response.statusCode < 500) resolve(true);
        else retry();
      });
      request.on("error", retry);
      request.setTimeout(900, () => {
        request.destroy();
        retry();
      });
    }
    function retry() {
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error("Local browser server did not respond in time."));
        return;
      }
      setTimeout(attempt, 150);
    }
    attempt();
  });
}

async function startGlassBrowserServer(options = {}) {
  browserStaticServerError = "";
  pushBrowserServerLog("[LocalServer] Start requested");
  if (browserStaticServer?.listening) {
    browserStaticServerState = "running";
    pushBrowserServerLog("[LocalServer] Already running");
    if (options.open !== false) {
      await shell.openExternal(BROWSER_SERVER_URL);
      pushBrowserServerLog("[LocalServer] Browser opened");
    }
    return browserServerStatus();
  }
  const bundleDir = frontendBundleDir();
  const indexPath = path.join(bundleDir || "", "index.html");
  if (!bundleDir || !fs.existsSync(indexPath)) {
    browserStaticServerState = "error";
    browserStaticServerError = "Production frontend bundle was not found. Build the app before packaging.";
    pushBrowserServerLog(`[LocalServer] Missing production bundle: ${indexPath}`);
    return browserServerStatus();
  }
  browserStaticServerState = "starting";
  pushBrowserServerLog("[LocalServer] Serving packaged frontend");
  pushBrowserServerLog(`[LocalServer] Root: ${bundleDir}`);
  pushBrowserServerLog(`[LocalServer] Host: ${BROWSER_SERVER_HOST}`);
  pushBrowserServerLog(`[LocalServer] Port: ${BROWSER_SERVER_PORT}`);
  browserStaticServer = http.createServer((request, response) => serveBrowserStaticRequest(bundleDir, request, response));
  browserStaticServer.on("connection", (socket) => {
    browserStaticServerConnections.add(socket);
    socket.on("close", () => browserStaticServerConnections.delete(socket));
  });
  browserStaticServer.on("error", (error) => {
    browserStaticServerError = error.code === "EADDRINUSE"
      ? "تعذر تشغيل الخادم المحلي لأن المنفذ 5174 مستخدم بواسطة برنامج آخر."
      : error.message;
    browserStaticServerState = "error";
    pushBrowserServerLog(`[LocalServer] Startup error: ${browserStaticServerError}`);
  });
  try {
    await new Promise((resolve, reject) => {
      browserStaticServer.once("error", reject);
      browserStaticServer.listen(BROWSER_SERVER_PORT, BROWSER_SERVER_HOST, resolve);
    });
    browserStaticServerState = "running";
    pushBrowserServerLog("[LocalServer] Ready");
    await waitForBrowserServerReady();
    if (options.open !== false) {
      await shell.openExternal(BROWSER_SERVER_URL);
      pushBrowserServerLog("[LocalServer] Browser opened");
    }
    return browserServerStatus();
  } catch (error) {
    browserStaticServerError = error.code === "EADDRINUSE"
      ? "تعذر تشغيل الخادم المحلي لأن المنفذ 5174 مستخدم بواسطة برنامج آخر."
      : error.message;
    browserStaticServerState = "error";
    pushBrowserServerLog(`[LocalServer] Start failed: ${browserStaticServerError}`);
    try { browserStaticServer?.close?.(); } catch { /* ignore close failure */ }
    browserStaticServer = null;
    return browserServerStatus();
  }
}

async function openGlassBrowserServer() {
  if (!browserStaticServer?.listening) return startGlassBrowserServer({ open: true });
  await shell.openExternal(BROWSER_SERVER_URL);
  pushBrowserServerLog("[LocalServer] Browser opened");
  return browserServerStatus();
}

async function stopGlassBrowserServer() {
  pushBrowserServerLog("[LocalServer] Stop requested");
  browserStaticServerError = "";
  if (!browserStaticServer) {
    browserStaticServerState = "stopped";
    pushBrowserServerLog("[LocalServer] Already stopped");
    return browserServerStatus();
  }
  browserStaticServerState = "stopping";
  await new Promise((resolve) => {
    for (const socket of browserStaticServerConnections) socket.destroy();
    browserStaticServer.close(() => resolve());
    setTimeout(resolve, 2500).unref?.();
  });
  browserStaticServerConnections.clear();
  browserStaticServer = null;
  browserStaticServerState = "stopped";
  pushBrowserServerLog("[LocalServer] Closed");
  return browserServerStatus();
}

function botStatus() {
  const settings = publicBotSettings();
  return {
    running: !!(telegramBotProcess && !telegramBotProcess.killed),
    state: telegramBotState,
    pid: telegramBotProcess?.pid || null,
    logs: telegramBotLogs,
    settings
  };
}

async function startTelegramBot(options = {}) {
  if (telegramRestartTimer) {
    clearTimeout(telegramRestartTimer);
    telegramRestartTimer = null;
  }
  stoppingTelegramBot = false;
  const currentSettings = readBotSettings();
  const runSettings = normalizeBotSettings({
    ...currentSettings,
    supabaseUrl: options.supabaseUrl || currentSettings.supabaseUrl,
    supabaseKey: options.supabaseKey || currentSettings.supabaseKey
  });
  if (options.remember) {
    saveBotSettings({ ...runSettings, enabled: true });
  }
  if (telegramBotProcess && !telegramBotProcess.killed) return botStatus();
  telegramBotState = "starting";
  const script = helperScriptPath("server", "telegramBot.mjs");
  const runtime = currentExecutablePath();
  const scriptDir = botAssetsDir();
  const nodePath = botNodePaths().join(path.delimiter);
  pushBotLog(`Starting Telegram bot: ${script}`);
  pushBotLog(`Using helper runtime ${runtime}`);
  pushBotLog(`Using bot assets ${scriptDir}`);
  if (nodePath) pushBotLog(`Using bot libraries ${nodePath}`);
  if (!fs.existsSync(script)) {
    pushBotLog(`Telegram bot script was not found: ${script}`);
    telegramBotState = "failed";
    return botStatus();
  }
  if (!fs.existsSync(runtime)) {
    pushBotLog(`Telegram bot runtime was not found: ${runtime}`);
    telegramBotState = "failed";
    return botStatus();
  }
  if (!fs.existsSync(scriptDir)) {
    pushBotLog(`Telegram bot assets folder was not found: ${scriptDir}`);
    telegramBotState = "failed";
    return botStatus();
  }
  try {
    telegramBotProcess = registerChild(spawn(runtime, [script], {
      cwd: processWorkingRoot(),
      windowsHide: true,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        NODE_PATH: [nodePath, process.env.NODE_PATH || ""].filter(Boolean).join(path.delimiter),
        GLASS_ORDERS_BOT_DIR: scriptDir,
        GLASS_ORDERS_WORKBOOK_PATH: process.env.GLASS_ORDERS_WORKBOOK_PATH || packagedWorkbookPath(),
        EXCEL_FILE: process.env.EXCEL_FILE || packagedWorkbookPath(),
        VITE_SUPABASE_URL: runSettings.supabaseUrl || process.env.VITE_SUPABASE_URL || "",
        VITE_SUPABASE_ANON_KEY: runSettings.supabaseKey || process.env.VITE_SUPABASE_ANON_KEY || ""
      }
    }), "Telegram bot");
  } catch (error) {
    pushBotLog(`Telegram bot failed to start: ${error.message}`);
    telegramBotProcess = null;
    telegramBotState = "failed";
    return botStatus();
  }
  telegramBotProcess.stdout.on("data", (data) => pushBotLog(data));
  telegramBotProcess.stderr.on("data", (data) => pushBotLog(data));
  telegramBotProcess.on("error", (error) => {
    pushBotLog(`Telegram bot failed to start: ${error.message}`);
    telegramBotProcess = null;
    telegramBotState = "failed";
  });
  telegramBotProcess.on("exit", (code) => {
    pushBotLog(`Telegram bot stopped with code ${code}`);
    telegramBotProcess = null;
    telegramBotState = stoppingTelegramBot ? "stopped" : "reconnecting";
    const settings = readBotSettings();
    if (!stoppingTelegramBot && settings.enabled) {
      const delay = 8000 + Math.floor(Math.random() * 4000);
      pushBotLog(`Restarting Telegram bot helper in ${Math.round(delay / 1000)}s...`);
      telegramRestartTimer = setTimeout(() => {
        telegramRestartTimer = null;
        startTelegramBot({ ...settings, remember: false }).catch((error) => {
          telegramBotState = "failed";
          pushBotLog(`Telegram bot restart failed: ${error.message}`);
        });
      }, delay);
    }
  });
  return botStatus();
}

async function stopTelegramBot(options = {}) {
  stoppingTelegramBot = true;
  if (telegramRestartTimer) {
    clearTimeout(telegramRestartTimer);
    telegramRestartTimer = null;
  }
  if (options.remember !== false) {
    saveBotSettings({ enabled: false, openAtLogin: false });
  }
  if (telegramBotProcess && !telegramBotProcess.killed) {
    pushBotLog("Stopping Telegram bot...");
    await terminateChildProcess(telegramBotProcess, "Telegram bot");
  }
  telegramBotState = "stopped";
  return botStatus();
}

function startRememberedTelegramBot() {
  const settings = readBotSettings();
  applyBotLoginItemSettings(settings);
  if (!settings.enabled) return;
  startTelegramBot({ ...settings, remember: false }).catch((error) => pushBotLog(`Telegram bot failed to start: ${error.message}`));
}

function showWindow(target) {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow({ show: true });
  if (!mainWindow) return;
  mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
  if (target) mainWindow.webContents.send("glass-orders:navigate", target);
}

function createTray() {
  if (tray) return;
  tray = new Tray(appIcon(24, trayIconPath) || trayIconPath);
  tray.setToolTip("Y.D Glass Manager");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Y.D Glass Manager", click: () => showWindow() },
    { label: "New order", click: () => showWindow("new-order") },
    { label: "Order status", click: () => showWindow("orders") },
    { label: "Suppliers", click: () => showWindow("suppliers") },
    { label: "Settings", click: () => showWindow("settings") },
    { type: "separator" },
    { label: "Open app in browser", click: () => startGlassBrowserServer({ open: true }) },
    { label: "Start local server", click: () => startLocalServer() },
    { label: "Stop local server", click: () => stopLocalServer() },
    { label: "Telegram bot settings", click: () => showWindow("settings") },
    { type: "separator" },
    { label: "Exit", click: () => requestExit() }
  ]));
  tray.on("double-click", () => showWindow());
}

function createApplicationMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: "Y.D Glass Manager",
      submenu: [
        { label: "Open", click: () => showWindow() },
        { label: "New order", accelerator: "Ctrl+N", click: () => showWindow("new-order") },
        { label: "Order status", click: () => showWindow("orders") },
        { label: "Suppliers", click: () => showWindow("suppliers") },
        { label: "Settings", click: () => showWindow("settings") },
        { type: "separator" },
        { label: "Open app in browser", click: () => startGlassBrowserServer({ open: true }) },
        { label: "Exit", click: () => requestExit() }
      ]
    },
    {
      label: "Tools",
      submenu: [
        { label: "Open app in browser", click: () => startGlassBrowserServer({ open: true }) },
        { label: "Start local server", click: () => startLocalServer() },
        { label: "Stop local server", click: () => stopLocalServer() },
        { label: "Telegram bot settings", click: () => showWindow("settings") },
        { type: "separator" },
        { role: "reload", label: "Reload app" },
        { role: "toggleDevTools", label: "Developer tools" }
      ]
    },
    {
      label: "Help",
      submenu: [
        { label: "HGAD website", click: () => shell.openExternal("https://hgad-eg.com") }
      ]
    }
  ]);
  Menu.setApplicationMenu(menu);
}

function createWindow(options = {}) {
  const savedState = readWindowState();
  const bounds = savedState.bounds || {};
  const win = new BrowserWindow({
    show: options.show !== false,
    width: bounds.width || 1440,
    height: bounds.height || 920,
    x: bounds.x,
    y: bounds.y,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: "#07080b",
    title: "Y.D Glass Manager",
    icon: appIconPath,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow = win;
  if (savedState.isMaximized) win.maximize();
  if (savedState.isFullScreen) win.setFullScreen(true);

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    win.loadURL(devUrl);
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.on("close", (event) => {
    saveWindowState(win);
    if (!isQuitting) {
      event.preventDefault();
      if (rendererHasUnsavedEntry) {
        const choice = dialog.showMessageBoxSync(win, {
          type: "warning",
          buttons: ["البقاء والتحرير", "إخفاء بدون حفظ"],
          defaultId: 0,
          cancelId: 0,
          title: "بيانات غير محفوظة",
          message: "هناك بيانات إدخال لم يتم حفظها بعد.",
          detail: "إخفاء النافذة الآن قد يجعلك تنسى البيانات الحالية. الإجراء الآمن هو البقاء داخل التطبيق."
        });
        if (choice === 0) {
          showWindow("entry");
          return;
        }
      }
      win.hide();
    }
  });

  win.on("resize", () => saveWindowState(win));
  win.on("move", () => saveWindowState(win));
}

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;
  const hiddenLaunch = shouldLaunchHidden();
  app.setName("Y.D Glass Manager");
  if (process.platform === "win32") app.setAppUserModelId("com.hgad.glassorders");
  createApplicationMenu();
  createWindow({ show: !hiddenLaunch });
  createTray();
  startRememberedTelegramBot();
});

app.on("second-instance", (_event, commandLine, _workingDirectory) => {
  if ((commandLine || []).includes(BOT_BACKGROUND_ARG)) {
    startRememberedTelegramBot();
    return;
  }
  showWindow();
});

ipcMain.handle("glass-orders:start-local-server", () => startLocalServer());
ipcMain.handle("glass-orders:app-version", () => app.getVersion());
ipcMain.handle("glass-orders:stop-local-server", () => stopLocalServer());
ipcMain.handle("glass-orders:local-server-logs", () => localServerLogs);
ipcMain.handle("glass-orders:browser-server-start", () => startGlassBrowserServer({ open: true }));
ipcMain.handle("glass-orders:browser-server-open", () => openGlassBrowserServer());
ipcMain.handle("glass-orders:browser-server-stop", () => stopGlassBrowserServer());
ipcMain.handle("glass-orders:browser-server-status", () => browserServerStatus());
ipcMain.handle("glass-orders:start-telegram-bot", (_event, options = {}) => startTelegramBot(options));
ipcMain.handle("glass-orders:stop-telegram-bot", (_event, options = {}) => stopTelegramBot(options));
ipcMain.handle("glass-orders:telegram-bot-status", () => botStatus());
ipcMain.handle("glass-orders:telegram-bot-settings", () => publicBotSettings());
ipcMain.handle("glass-orders:update-telegram-bot-settings", (_event, patch = {}) => publicBotSettings(saveBotSettings(patch)));
ipcMain.handle("glass-orders:write-offline-queue", (_event, payload = {}) => writeJsonFile(offlineQueuePath, payload));
ipcMain.handle("glass-orders:write-offline-snapshot", (_event, payload = {}) => writeJsonFile(offlineSnapshotPath, payload));
ipcMain.handle("glass-orders:set-unsaved-entry", (_event, payload = {}) => {
  rendererHasUnsavedEntry = payload?.dirty === true;
  return { ok: true, dirty: rendererHasUnsavedEntry };
});
ipcMain.handle("glass-orders:restore-focus", () => focusMainWindow());
ipcMain.handle("glass-orders:force-focus-reset", () => forceFocusReset());
ipcMain.handle("glass-orders:select-directory", async (_event, payload = {}) => {
  const restoreFocus = shouldRestoreMainWindowFocus();
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select report folder",
    defaultPath: payload.defaultPath || app.getPath("documents"),
    properties: ["openDirectory", "createDirectory"]
  });
  restoreMainWindowFocus(restoreFocus);
  if (result.canceled || !result.filePaths?.[0]) return { ok: false, canceled: true };
  return { ok: true, directory: result.filePaths[0] };
});
ipcMain.handle("glass-orders:validate-directory", (_event, payload = {}) => validateWritableDirectory(payload.directory));
ipcMain.handle("glass-orders:get-printers", async () => {
  try {
    const printers = await mainWindow?.webContents?.getPrintersAsync?.();
    return { ok: true, printers: printers || [] };
  } catch (error) {
    return { ok: false, error: error.message, printers: [] };
  }
});
ipcMain.handle("glass-orders:print-html", (_event, payload = {}) => printHtml(payload));
ipcMain.handle("glass-orders:print-pdf-html", (_event, payload = {}) => printPdfHtml(payload));
ipcMain.handle("glass-orders:open-external", (_event, url) => {
  const targetUrl = safeExternalUrl(url);
  if (!targetUrl) return { ok: false, error: "Invalid URL." };
  shell.openExternal(targetUrl);
  return { ok: true };
});
ipcMain.handle("glass-orders:show-notification", (_event, payload = {}) => showDesktopNotification(payload));
ipcMain.handle("glass-orders:save-file", async (_event, payload = {}) => {
  const fileName = String(payload.fileName || "YDGlassManager-export").replace(/[<>:"/\\|?*\x00-\x1f]/g, "-");
  const restoreFocus = shouldRestoreMainWindowFocus();
  let filePath = reportSavePath({ ...payload, fileName });
  if (!filePath) {
    const lastDirectory = payload.saveSettings?.lastDirectory || app.getPath("documents");
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Save report",
      defaultPath: path.join(lastDirectory, fileName),
      filters: payload.mimeType === "application/pdf"
        ? [{ name: "PDF", extensions: ["pdf"] }]
        : [{ name: "Excel workbook", extensions: ["xlsx"] }]
    });
    restoreMainWindowFocus(restoreFocus);
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    filePath = result.filePath;
  }
  const buffer = Buffer.from(String(payload.data || ""), "base64");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buffer);
  if (payload.mimeType === "application/pdf" && payload.saveSettings?.openPdfAfterSave) {
    shell.openPath(filePath).catch(() => null);
  }
  restoreMainWindowFocus(restoreFocus && !(payload.mimeType === "application/pdf" && payload.saveSettings?.openPdfAfterSave));
  return { ok: true, filePath, directory: path.dirname(filePath) };
});

app.on("window-all-closed", () => {
  // Keep running in the tray until the user chooses Exit.
});

app.on("before-quit", (event) => {
  if (!isQuitting && (pendingOfflineCount() > 0 || rendererHasUnsavedEntry)) {
    event.preventDefault();
    requestExit();
    return;
  }
  isQuitting = true;
  if (!shutdownPromise) {
    event.preventDefault();
    shutdownApp("before-quit");
  }
});

app.on("will-quit", () => {
  shutdownLog("Electron will quit");
});

app.on("quit", (_event, code) => {
  shutdownLog(`Electron quit with code ${code}`);
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow({ show: true });
  else showWindow();
});
