const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("glassOrdersDesktop", {
  platform: process.platform,
  startLocalServer: () => ipcRenderer.invoke("glass-orders:start-local-server"),
  stopLocalServer: () => ipcRenderer.invoke("glass-orders:stop-local-server"),
  localServerLogs: () => ipcRenderer.invoke("glass-orders:local-server-logs"),
  startTelegramBot: (options) => ipcRenderer.invoke("glass-orders:start-telegram-bot", options),
  stopTelegramBot: (options) => ipcRenderer.invoke("glass-orders:stop-telegram-bot", options),
  telegramBotStatus: () => ipcRenderer.invoke("glass-orders:telegram-bot-status"),
  telegramBotSettings: () => ipcRenderer.invoke("glass-orders:telegram-bot-settings"),
  updateTelegramBotSettings: (patch) => ipcRenderer.invoke("glass-orders:update-telegram-bot-settings", patch),
  writeOfflineQueue: (payload) => ipcRenderer.invoke("glass-orders:write-offline-queue", payload),
  writeOfflineSnapshot: (payload) => ipcRenderer.invoke("glass-orders:write-offline-snapshot", payload),
  saveFile: (payload) => ipcRenderer.invoke("glass-orders:save-file", payload),
  onNavigate: (callback) => {
    const listener = (_event, target) => callback(target);
    ipcRenderer.on("glass-orders:navigate", listener);
    return () => ipcRenderer.removeListener("glass-orders:navigate", listener);
  }
});
