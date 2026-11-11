const { app, ipcMain } = require('electron');
const { baseUrl } = require('./base-url');
const { isAppOrigin } = require('./links');

class DockManager {
  constructor() {
    this.currentCount = 0;
    this.setupIPC();
  }

  setupIPC() {
    ipcMain.on('set-unread-count', (event, count) => {
      if (!isAppOrigin(event.senderFrame?.url, { base: baseUrl() })) return;
      this.updateBadge(count);
    });
  }

  updateBadge(count) {
    if (process.platform !== 'darwin') return;

    // Only update if count changed
    if (count === this.currentCount) return;

    this.currentCount = count;

    if (count > 0) {
      app.dock.setBadge(count > 99 ? '99+' : String(count));
    } else {
      app.dock.setBadge('');
    }
  }

  bounce(type = 'informational') {
    if (process.platform === 'darwin') {
      app.dock.bounce(type);
    }
  }
}

module.exports = DockManager;
