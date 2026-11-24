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
  walk: (dir, distance, gait, replace) => ipcRenderer.send('pet:walk', { dir, distance, gait, replace }),
  stopWalk: () => ipcRenderer.send('pet:walk-stop'),
  goTop: () => ipcRenderer.send('pet:go-top'),
  comeDown: () => ipcRenderer.send('pet:come-down'),
  showMenu: () => ipcRenderer.send('pet:show-menu'),
  chatStatus: () => ipcRenderer.invoke('pet:chat-status'),
  focusWindow: () => ipcRenderer.send('pet:focus'),
  saveApiKey: (key) => ipcRenderer.invoke('pet:save-key', key),
  sendChat: (text) => ipcRenderer.invoke('pet:chat-send', text),
  onChatOpen: listen('pet:chat-open'),
  onChatDelta: listen('pet:chat-delta'),
  onAction: listen('pet:action'),
  onTick: listen('pet:tick'),
  onMotion: listen('pet:motion'),
});
