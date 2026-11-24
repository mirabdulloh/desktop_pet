const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('telegramApi', {
  state: () => ipcRenderer.invoke('telegram:state'),
  importExport: () => ipcRenderer.invoke('telegram:import'),
  learn: (keys) => ipcRenderer.invoke('telegram:learn', keys),
  remove: (key) => ipcRenderer.invoke('telegram:remove', key),
  removeShortcut: (key, short) => ipcRenderer.invoke('telegram:remove-shortcut', key, short),
  copy: (text) => ipcRenderer.invoke('telegram:copy', text),
  openInTelegram: (text) => ipcRenderer.invoke('telegram:open', text),
  discard: () => ipcRenderer.invoke('telegram:discard'),
  onUpdated: (callback) => ipcRenderer.on('telegram:updated', () => callback()),
  onProgress: (callback) => ipcRenderer.on('telegram:progress', (_event, text) => callback(text)),
});
