const { contextBridge, ipcRenderer } = require('electron');

// The find bar's only bridge: send a bar event, receive the find state, and the platform for the shortcut hints.
contextBridge.exposeInMainWorld('findBar', Object.freeze({
  send: (event) => ipcRenderer.send('find:event', event),
  onState: (callback) => ipcRenderer.on('find:state', (event, state) => callback(state)),
  platform: process.platform,
}));
