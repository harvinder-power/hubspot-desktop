const { app, BrowserWindow, session, ipcMain, globalShortcut } = require('electron');
const path = require('path');

// Modules
const { createMenu } = require('./menu');
const NotificationManager = require('./notifications');
const DockManager = require('./dock');
const WindowManager = require('./window-state');
const TrayManager = require('./tray');
const { baseUrl } = require('./base-url');

// Constants
const PARTITION = 'persist:hubspot';
const GLOBAL_SHORTCUT = 'CommandOrControl+Shift+H';

// Managers
let windowManager;
let notificationManager;
let dockManager;
let trayManager;

if (!app.isPackaged && process.env.HUBSPOT_DESKTOP_USER_DATA) {
  app.setPath('userData', process.env.HUBSPOT_DESKTOP_USER_DATA);
}

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    windowManager?.focusOrCreate();
  });
}

// App lifecycle
app.whenReady().then(async () => {
  // Configure session
  const ses = session.fromPartition(PARTITION);
  setupPermissions(ses);
  setupUserAgent(ses);

  // Create window
  windowManager = new WindowManager(PARTITION);
  const mainWindow = windowManager.createMainWindow();

  // Initialize managers
  notificationManager = new NotificationManager(mainWindow);
  dockManager = new DockManager(mainWindow);
  trayManager = new TrayManager(mainWindow, windowManager);

  // Create menu
  createMenu(mainWindow);

  // Setup security handlers
  setupSecurity(mainWindow);

  // Register global shortcut (Cmd+Shift+H to show/hide)
  globalShortcut.register(GLOBAL_SHORTCUT, () => {
    if (mainWindow.isVisible() && mainWindow.isFocused()) {
      mainWindow.hide();
    } else {
      windowManager.focusOrCreate();
    }
  });

  // Load HubSpot
  mainWindow.loadURL(baseUrl());

  // Handle macOS dock click
  app.on('activate', () => {
    windowManager.focusOrCreate();
  });
});

// Cleanup on quit
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// Quit when all windows are closed (Windows/Linux)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

function setupPermissions(ses) {
  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    const url = webContents.getURL();
    const allowedPermissions = ['notifications', 'media', 'clipboard-read', 'clipboard-sanitized-write'];

    if (url.includes('hubspot.com') && allowedPermissions.includes(permission)) {
      return callback(true);
    }
    callback(false);
  });

  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    const allowedPermissions = ['notifications', 'media', 'clipboard-read', 'clipboard-sanitized-write'];
    if (requestingOrigin.includes('hubspot.com') && allowedPermissions.includes(permission)) {
      return true;
    }
    return false;
  });
}

function setupUserAgent(ses) {
  const chromeVersion = process.versions.chrome;
  ses.setUserAgent(`Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`);
}

function setupSecurity(mainWindow) {
  // Restrict navigation to allowed domains
  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      const parsedUrl = new URL(url);
      const allowedHosts = [
        'hubspot.com',
        'hubspotusercontent.com',
        'hsforms.com',
        'accounts.google.com',
        'login.microsoftonline.com',
        'login.live.com'
      ];

      const isAllowed = allowedHosts.some(host =>
        parsedUrl.hostname === host || parsedUrl.hostname.endsWith('.' + host)
      );

      if (!isAllowed) {
        event.preventDefault();
        require('electron').shell.openExternal(url);
      }
    } catch (e) {
      event.preventDefault();
    }
  });

  // Handle new window requests
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsedUrl = new URL(url);

      if (parsedUrl.hostname.includes('hubspot.com') ||
          parsedUrl.hostname.includes('hsforms.com')) {
        return { action: 'allow' };
      }

      require('electron').shell.openExternal(url);
      return { action: 'deny' };
    } catch (e) {
      return { action: 'deny' };
    }
  });
}
