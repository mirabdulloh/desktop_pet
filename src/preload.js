const { contextBridge, ipcRenderer } = require('electron');

const listen = (channel) => (callback) => {
  ipcRenderer.on(channel, (_event, payload) => callback(payload));
};

contextBridge.exposeInMainWorld('pet', {
  getCharacter: () => ipcRenderer.invoke('pet:get-character'),
  readModel: () => ipcRenderer.invoke('pet:read-model'),
  importModel: () => ipcRenderer.invoke('pet:import-model'),
  setInteractive: (value) => ipcRenderer.send('pet:set-interactive', value),
  dragStart: () => ipcRenderer.send('pet:drag-start'),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  jump: () => ipcRenderer.send('pet:jump'),
  onTick: listen('pet:tick'),
  onMotion: listen('pet:motion'),
  onModelChanged: listen('pet:model-changed'),
});
