const { app, session, globalShortcut } = require('electron');
const path = require('path');

// Modules
const { createMenu, createRouteOpener } = require('./menu');
const NotificationManager = require('./notifications');
const DockManager = require('./dock');
const { createWindowRegistry } = require('./windows');
const { PARTITION, setupSecurity } = require('./window-security');
const { baseUrl } = require('./base-url');
const { isPermissionAllowed } = require('./links');

// Constants
const GLOBAL_SHORTCUT = 'CommandOrControl+Shift+H';

// Managers
let registry;
let notificationManager;
let dockManager;
let trayManager;

if (!app.isPackaged && process.env.HUBSPOT_DESKTOP_USER_DATA) {
  app.setPath('userData', process.env.HUBSPOT_DESKTOP_USER_DATA);
}

// Quiet mode for local test runs: no shown window, no focus, no dock icon, menu bar, tray or global shortcut.
const QUIET = !app.isPackaged && process.env.HUBSPOT_DESKTOP_QUIET === '1';
if (QUIET && process.platform === 'darwin') app.setActivationPolicy('accessory');

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    registry?.show();
  });
}

// App lifecycle
app.whenReady().then(async () => {
  // Configure session
  const ses = session.fromPartition(PARTITION);
  setupPermissions(ses);
  setupUserAgent(ses);

  registry = createWindowRegistry({
    partition: PARTITION,
    preloadPath: path.join(__dirname, '../preload/preload.js'),
    base: baseUrl(),
    secure: (contents) => setupSecurity(contents, { quiet: QUIET }),
    quiet: QUIET,
  });
  const routes = createRouteOpener(registry);
  const newTab = () => registry.open({ url: routes.url('dashboards') });
  const newWindow = () => registry.open({ url: routes.url('dashboards'), tab: false });
  registry.onWindow((win) => win.on('new-window-for-tab', newTab));

  notificationManager = new NotificationManager(registry, { quiet: QUIET });
  dockManager = new DockManager();
  createMenu({ registry, openRoute: routes.open, newTab, newWindow });

  if (!QUIET) {
    // Required here only, so a quiet run never loads the tray module.
    const TrayManager = require('./tray');
    trayManager = new TrayManager(registry, routes.open);

    // Register global shortcut (Cmd+Shift+H to show/hide)
    globalShortcut.register(GLOBAL_SHORTCUT, () => {
      const win = registry.active();
      if (win?.isVisible() && win.isFocused()) {
        win.hide();
      } else {
        registry.show();
      }
    });
  }

  registry.open();

  // Handle macOS dock click
  app.on('activate', () => {
    registry.show();
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
  const base = baseUrl();
  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(isPermissionAllowed(permission, details.requestingUrl, { base }));
  });

  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin) =>
    isPermissionAllowed(permission, requestingOrigin, { base })
  );
}

function setupUserAgent(ses) {
  const chromeVersion = process.versions.chrome;
  ses.setUserAgent(`Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`);
}
