const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, shell, dialog } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

let localServerProcess = null;
const localServerLogs = [];
let telegramBotProcess = null;
const telegramBotLogs = [];
let mainWindow = null;
let tray = null;
let isQuitting = false;

const root = path.join(__dirname, "..");
const appIconPath = path.join(root, "app_logo.png");
const windowStatePath = path.join(app.getPath("userData"), "window-state.json");
const offlineQueuePath = path.join(app.getPath("userData"), "offline-queue.json");
const offlineSnapshotPath = path.join(app.getPath("userData"), "offline-snapshot.json");

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
    app.isPackaged ? path.join(process.resourcesPath, "app.asar.unpacked", ...segments) : "",
    app.isPackaged ? path.join(process.resourcesPath, "app.asar", ...segments) : "",
    path.join(root, ...segments)
  ]);
}

function botAssetsDir() {
  return firstExisting([
    process.env.GLASS_ORDERS_BOT_DIR,
    app.isPackaged ? path.join(process.resourcesPath, "app.asar.unpacked", "telegram_excel_bot") : "",
    app.isPackaged ? path.join(process.resourcesPath, "app.asar", "telegram_excel_bot") : "",
    path.join(root, "telegram_excel_bot")
  ]);
}

function processWorkingRoot() {
  return app.isPackaged ? path.dirname(process.resourcesPath) : root;
}

function firstExisting(paths) {
  return paths.find((candidate) => candidate && fs.existsSync(candidate)) || paths.find(Boolean);
}

function currentExecutablePath() {
  return firstExisting([
    app.isPackaged ? path.join(path.dirname(process.resourcesPath), "Glass Orders.exe") : "",
    app.isPackaged ? path.join(path.dirname(process.resourcesPath), `${app.getName()}.exe`) : "",
    app.getPath("exe"),
    process.execPath
  ]);
}

function packagedWorkbookPath() {
  return firstExisting([
    process.env.GLASS_ORDERS_WORKBOOK_PATH,
    app.isPackaged ? path.join(path.dirname(process.resourcesPath), "طلب شراء زجاج.xlsm") : "",
    path.join(path.dirname(currentExecutablePath()), "طلب شراء زجاج.xlsm"),
    path.join(helperRoot(), "طلب شراء زجاج.xlsm"),
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

function pushBotLog(line) {
  const text = String(line || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd();
  if (!text) return;
  for (const part of text.split("\n")) {
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

function requestExit() {
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
  isQuitting = true;
  app.quit();
}

function appIcon(size = 32) {
  const image = nativeImage.createFromPath(appIconPath);
  return image.isEmpty() ? undefined : image.resize({ width: size, height: size, quality: "best" });
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
    localServerProcess = spawn(runtime, [serverScript], {
      cwd: processWorkingRoot(),
      windowsHide: true,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        GLASS_ORDERS_PORT: process.env.GLASS_ORDERS_PORT || "4197",
        GLASS_ORDERS_DATA_DIR: process.env.GLASS_ORDERS_DATA_DIR || dataDir,
        GLASS_ORDERS_WORKBOOK_PATH: workbookPath
      }
    });
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

function stopLocalServer() {
  if (localServerProcess && !localServerProcess.killed) {
    pushLocalLog("Stopping local database server...");
    localServerProcess.kill();
  } else {
    pushLocalLog("Local database server is already stopped.");
  }
  localServerProcess = null;
  return { ok: true, running: false, logs: localServerLogs };
}

function botStatus() {
  return {
    running: !!(telegramBotProcess && !telegramBotProcess.killed),
    pid: telegramBotProcess?.pid || null,
    logs: telegramBotLogs
  };
}

async function startTelegramBot(options = {}) {
  if (telegramBotProcess && !telegramBotProcess.killed) return botStatus();
  const script = helperScriptPath("server", "telegramBot.mjs");
  const runtime = currentExecutablePath();
  const scriptDir = botAssetsDir();
  pushBotLog(`Starting Telegram bot: ${script}`);
  pushBotLog(`Using helper runtime ${runtime}`);
  if (!fs.existsSync(script)) {
    pushBotLog(`Telegram bot script was not found: ${script}`);
    return botStatus();
  }
  if (!fs.existsSync(runtime)) {
    pushBotLog(`Telegram bot runtime was not found: ${runtime}`);
    return botStatus();
  }
  if (!fs.existsSync(scriptDir)) {
    pushBotLog(`Telegram bot assets folder was not found: ${scriptDir}`);
    return botStatus();
  }
  try {
    telegramBotProcess = spawn(runtime, [script], {
      cwd: processWorkingRoot(),
      windowsHide: true,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        GLASS_ORDERS_BOT_DIR: scriptDir,
        GLASS_ORDERS_WORKBOOK_PATH: process.env.GLASS_ORDERS_WORKBOOK_PATH || packagedWorkbookPath(),
        EXCEL_FILE: process.env.EXCEL_FILE || packagedWorkbookPath(),
        VITE_SUPABASE_URL: options.supabaseUrl || process.env.VITE_SUPABASE_URL || "",
        VITE_SUPABASE_ANON_KEY: options.supabaseKey || process.env.VITE_SUPABASE_ANON_KEY || ""
      }
    });
  } catch (error) {
    pushBotLog(`Telegram bot failed to start: ${error.message}`);
    telegramBotProcess = null;
    return botStatus();
  }
  telegramBotProcess.stdout.on("data", (data) => pushBotLog(data));
  telegramBotProcess.stderr.on("data", (data) => pushBotLog(data));
  telegramBotProcess.on("error", (error) => {
    pushBotLog(`Telegram bot failed to start: ${error.message}`);
    telegramBotProcess = null;
  });
  telegramBotProcess.on("exit", (code) => {
    pushBotLog(`Telegram bot stopped with code ${code}`);
    telegramBotProcess = null;
  });
  return botStatus();
}

function stopTelegramBot() {
  if (telegramBotProcess && !telegramBotProcess.killed) {
    pushBotLog("Stopping Telegram bot...");
    telegramBotProcess.kill();
  }
  return botStatus();
}

function startTelegramBotFromMenu() {
  startTelegramBot().catch((error) => pushBotLog(`Telegram bot failed to start: ${error.message}`));
}

function showWindow(target) {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (!mainWindow) return;
  mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
  if (target) mainWindow.webContents.send("glass-orders:navigate", target);
}

function createTray() {
  if (tray) return;
  tray = new Tray(appIcon(24) || appIconPath);
  tray.setToolTip("Glass Orders");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Glass Orders", click: () => showWindow() },
    { label: "New order", click: () => showWindow("new-order") },
    { label: "Order status", click: () => showWindow("orders") },
    { label: "Suppliers", click: () => showWindow("suppliers") },
    { label: "Settings", click: () => showWindow("settings") },
    { type: "separator" },
    { label: "Start local server", click: () => startLocalServer() },
    { label: "Stop local server", click: () => stopLocalServer() },
    { label: "Start Telegram bot", click: () => startTelegramBotFromMenu() },
    { label: "Stop Telegram bot", click: () => stopTelegramBot() },
    { type: "separator" },
    { label: "Exit", click: () => requestExit() }
  ]));
  tray.on("double-click", () => showWindow());
}

function createApplicationMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: "Glass Orders",
      submenu: [
        { label: "Open", click: () => showWindow() },
        { label: "New order", accelerator: "Ctrl+N", click: () => showWindow("new-order") },
        { label: "Order status", click: () => showWindow("orders") },
        { label: "Suppliers", click: () => showWindow("suppliers") },
        { label: "Settings", click: () => showWindow("settings") },
        { type: "separator" },
        { label: "Exit", click: () => requestExit() }
      ]
    },
    {
      label: "Tools",
      submenu: [
        { label: "Start local server", click: () => startLocalServer() },
        { label: "Stop local server", click: () => stopLocalServer() },
        { label: "Start Telegram bot", click: () => startTelegramBotFromMenu() },
        { label: "Stop Telegram bot", click: () => stopTelegramBot() },
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

function createWindow() {
  const savedState = readWindowState();
  const bounds = savedState.bounds || {};
  const win = new BrowserWindow({
    width: bounds.width || 1440,
    height: bounds.height || 920,
    x: bounds.x,
    y: bounds.y,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: "#07080b",
    title: "Glass Orders",
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
      win.hide();
    }
  });

  win.on("resize", () => saveWindowState(win));
  win.on("move", () => saveWindowState(win));
}

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;
  app.setName("Glass Orders");
  createApplicationMenu();
  createWindow();
  createTray();
});

app.on("second-instance", (_event, _commandLine, _workingDirectory) => {
  showWindow();
});

ipcMain.handle("glass-orders:start-local-server", () => startLocalServer());
ipcMain.handle("glass-orders:stop-local-server", () => stopLocalServer());
ipcMain.handle("glass-orders:local-server-logs", () => localServerLogs);
ipcMain.handle("glass-orders:start-telegram-bot", (_event, options = {}) => startTelegramBot(options));
ipcMain.handle("glass-orders:stop-telegram-bot", () => stopTelegramBot());
ipcMain.handle("glass-orders:telegram-bot-status", () => botStatus());
ipcMain.handle("glass-orders:write-offline-queue", (_event, payload = {}) => writeJsonFile(offlineQueuePath, payload));
ipcMain.handle("glass-orders:write-offline-snapshot", (_event, payload = {}) => writeJsonFile(offlineSnapshotPath, payload));
ipcMain.handle("glass-orders:save-file", async (_event, payload = {}) => {
  const fileName = String(payload.fileName || "GlassOrders-export").replace(/[<>:"/\\|?*\x00-\x1f]/g, "-");
  const defaultPath = path.join(app.getPath("documents"), fileName);
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Save report",
    defaultPath,
    filters: payload.mimeType === "application/pdf"
      ? [{ name: "PDF", extensions: ["pdf"] }]
      : [{ name: "Excel workbook", extensions: ["xlsx"] }]
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  const buffer = Buffer.from(String(payload.data || ""), "base64");
  fs.writeFileSync(result.filePath, buffer);
  return { ok: true, filePath: result.filePath };
});

app.on("window-all-closed", () => {
  // Keep running in the tray until the user chooses Exit.
});

app.on("before-quit", (event) => {
  if (!isQuitting && pendingOfflineCount() > 0) {
    event.preventDefault();
    requestExit();
    return;
  }
  isQuitting = true;
  saveWindowState();
  if (localServerProcess && !localServerProcess.killed) localServerProcess.kill();
  if (telegramBotProcess && !telegramBotProcess.killed) telegramBotProcess.kill();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
  else showWindow();
});
