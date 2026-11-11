const { Notification, ipcMain, app } = require('electron');
const path = require('path');
const { baseUrl } = require('./base-url');
const { isAppOrigin } = require('./links');

class NotificationManager {
  constructor(registry) {
    this.registry = registry;
    this.setupIPC();
  }

  setupIPC() {
    ipcMain.on('show-notification', (event, { title, body, tag }) => {
      if (!isAppOrigin(event.senderFrame?.url, { base: baseUrl() })) return;
      this.showNative(title, body, tag);
    });
  }

  showNative(title, body, tag) {
    if (!Notification.isSupported()) return;

    const notification = new Notification({
      title: title || 'HubSpot',
      body: body || '',
      icon: path.join(__dirname, '../../assets/icon.png'),
      silent: false
    });

    notification.on('click', () => {
      this.registry.show();
      // Bounce dock icon
      if (process.platform === 'darwin') {
        app.dock.bounce('informational');
      }
    });

    notification.show();
  }
}

module.exports = NotificationManager;
