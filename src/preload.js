const { contextBridge, ipcRenderer } = require('electron');

const listen = (channel) => (callback) => {
  ipcRenderer.on(channel, (_event, payload) => callback(payload));
};

contextBridge.exposeInMainWorld('pet', {
  getCharacter: () => ipcRenderer.invoke('pet:get-character'),
  setInteractive: (value) => ipcRenderer.send('pet:set-interactive', value),
  dragStart: () => ipcRenderer.send('pet:drag-start'),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  jump: () => ipcRenderer.send('pet:jump'),
  walk: (dir, distance, speed) => ipcRenderer.send('pet:walk', { dir, distance, speed }),
  stopWalk: () => ipcRenderer.send('pet:walk-stop'),
  showMenu: () => ipcRenderer.send('pet:show-menu'),
  onAction: listen('pet:action'),
  onTick: listen('pet:tick'),
  onMotion: listen('pet:motion'),
});
