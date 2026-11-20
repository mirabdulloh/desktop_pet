const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pet', {
  onLoadCharacter: (callback) => {
    ipcRenderer.on('pet:load-character', (_event, character) => callback(character));
  },
  setIgnoreMouse: (ignore) => ipcRenderer.send('pet:set-ignore-mouse', ignore),
  moveWindowBy: (dx, dy) => ipcRenderer.send('pet:move-window-by', { dx, dy }),
  quit: () => ipcRenderer.send('pet:quit'),
});
