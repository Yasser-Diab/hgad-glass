const { contextBridge, ipcRenderer } = require("electron");

const authRecoveryListeners = new Set();
let authRecoverySignalPending = false;
let authRecoveryDispatching = false;

async function dispatchPendingAuthRecovery() {
  if (authRecoveryDispatching || !authRecoveryListeners.size) return;
  authRecoveryDispatching = true;
  try {
    const callbackUrl = await ipcRenderer.invoke("glass-orders:consume-auth-recovery-url");
    authRecoverySignalPending = false;
    if (!callbackUrl) return;
    for (const callback of [...authRecoveryListeners]) {
      Promise.resolve(callback(callbackUrl)).catch(() => null);
    }
  } finally {
    authRecoveryDispatching = false;
  }
}

ipcRenderer.on("glass-orders:auth-recovery-available", () => {
  authRecoverySignalPending = true;
  void dispatchPendingAuthRecovery();
});

contextBridge.exposeInMainWorld("glassOrdersDesktop", {
  platform: process.platform,
  authRecoveryRedirectUrl: "ydglassmanager://auth/recovery",
  getAppVersion: () => ipcRenderer.invoke("glass-orders:app-version"),
  consumeAuthRecoveryUrl: () => ipcRenderer.invoke("glass-orders:consume-auth-recovery-url"),
  onAuthRecoveryUrl: (callback) => {
    if (typeof callback !== "function") return () => {};
    authRecoveryListeners.add(callback);
    if (authRecoverySignalPending) void dispatchPendingAuthRecovery();
    return () => authRecoveryListeners.delete(callback);
  },
  startLocalServer: () => ipcRenderer.invoke("glass-orders:start-local-server"),
  stopLocalServer: () => ipcRenderer.invoke("glass-orders:stop-local-server"),
  localServerLogs: () => ipcRenderer.invoke("glass-orders:local-server-logs"),
  startBrowserServer: () => ipcRenderer.invoke("glass-orders:browser-server-start"),
  openBrowserServer: () => ipcRenderer.invoke("glass-orders:browser-server-open"),
  stopBrowserServer: () => ipcRenderer.invoke("glass-orders:browser-server-stop"),
  browserServerStatus: () => ipcRenderer.invoke("glass-orders:browser-server-status"),
  startTelegramBot: (options) => ipcRenderer.invoke("glass-orders:start-telegram-bot", options),
  stopTelegramBot: (options) => ipcRenderer.invoke("glass-orders:stop-telegram-bot", options),
  syncTelegramBotSession: (session) => ipcRenderer.invoke("glass-orders:sync-telegram-session", session),
  telegramBotStatus: () => ipcRenderer.invoke("glass-orders:telegram-bot-status"),
  telegramBotSettings: () => ipcRenderer.invoke("glass-orders:telegram-bot-settings"),
  updateTelegramBotSettings: (patch) => ipcRenderer.invoke("glass-orders:update-telegram-bot-settings", patch),
  writeOfflineQueue: (payload) => ipcRenderer.invoke("glass-orders:write-offline-queue", payload),
  writeOfflineSnapshot: (payload) => ipcRenderer.invoke("glass-orders:write-offline-snapshot", payload),
  saveFile: (payload) => ipcRenderer.invoke("glass-orders:save-file", payload),
  selectDirectory: (payload) => ipcRenderer.invoke("glass-orders:select-directory", payload),
  validateDirectory: (payload) => ipcRenderer.invoke("glass-orders:validate-directory", payload),
  getPrinters: () => ipcRenderer.invoke("glass-orders:get-printers"),
  printHtml: (payload) => ipcRenderer.invoke("glass-orders:print-html", payload),
  printPdfHtml: (payload) => ipcRenderer.invoke("glass-orders:print-pdf-html", payload),
  restoreFocus: () => ipcRenderer.invoke("glass-orders:restore-focus"),
  forceFocusReset: () => ipcRenderer.invoke("glass-orders:force-focus-reset"),
  setUnsavedEntry: (payload) => ipcRenderer.invoke("glass-orders:set-unsaved-entry", payload),
  openExternal: (url) => ipcRenderer.invoke("glass-orders:open-external", url),
  showNotification: (payload) => ipcRenderer.invoke("glass-orders:show-notification", payload),
  onNavigate: (callback) => {
    const listener = (_event, target) => callback(target);
    ipcRenderer.on("glass-orders:navigate", listener);
    return () => ipcRenderer.removeListener("glass-orders:navigate", listener);
  }
});
