const { contextBridge, ipcRenderer } = require('electron');

// The find bar's only bridge: send a bar event, receive the find state.
contextBridge.exposeInMainWorld('findBar', {
  send: (event) => ipcRenderer.send('find:event', event),
  onState: (callback) => ipcRenderer.on('find:state', (event, state) => callback(state)),
});
