const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('memoryApi', {
  status: () => ipcRenderer.invoke('memory:status'),
  connect: (uri) => ipcRenderer.invoke('memory:connect', uri),
  importEnv: () => ipcRenderer.invoke('memory:import-env'),
  disconnect: () => ipcRenderer.invoke('memory:disconnect'),
  list: () => ipcRenderer.invoke('memory:list'),
  remove: (id) => ipcRenderer.invoke('memory:remove', id),
  clearAll: () => ipcRenderer.invoke('memory:clear'),
});
