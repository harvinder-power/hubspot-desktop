const { contextBridge } = require('electron');

// The page API is empty. Web notifications reach the OS through Chromium, and the main process reads the
// unread badge from the page title, so the page needs no bridge. Tests read the object as proof the preload ran.
contextBridge.exposeInMainWorld('electronAPI', {});
