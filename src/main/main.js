const { app, BrowserWindow, session, ipcMain, globalShortcut, shell } = require('electron');
const path = require('path');

// Modules
const { createMenu, createRouteOpener } = require('./menu');
const NotificationManager = require('./notifications');
const DockManager = require('./dock');
const WindowManager = require('./window-state');
const TrayManager = require('./tray');
const { baseUrl } = require('./base-url');
const { MODE, decide, isAppOrigin, isPermissionAllowed } = require('./links');

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
  const openRoute = createRouteOpener(mainWindow, () => windowManager.focusOrCreate());
  trayManager = new TrayManager(mainWindow, windowManager, openRoute);

  // Create menu
  createMenu(mainWindow, openRoute);

  // Setup security handlers
  setupSecurity(mainWindow.webContents);

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

const CHILD_WINDOW_OPTIONS = {
  webPreferences: {
    partition: PARTITION,
    preload: path.join(__dirname, '../preload/preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  },
};

// Sign-in mode per window. See MODE in links.js.
const windowModes = new WeakMap();
// Modes for child windows that setWindowOpenHandler allowed and did-create-window has not yet seen.
const pendingChildModes = new WeakMap();

function setupSecurity(contents, initialMode = MODE.app) {
  const base = baseUrl();
  const win = BrowserWindow.fromWebContents(contents);
  windowModes.set(contents, initialMode);
  pendingChildModes.set(contents, []);

  const guardNavigation = (event) => {
    if (!event.isMainFrame) return;
    const { url } = event;
    const result = decide({ url, currentUrl: contents.getURL(), mode: windowModes.get(contents), kind: 'navigate', base });
    if (result.action === 'allow') return windowModes.set(contents, result.mode);
    event.preventDefault();
    if (result.action === 'external') shell.openExternal(url);
  };
  contents.on('will-navigate', guardNavigation);
  contents.on('will-redirect', guardNavigation);

  contents.on('did-navigate', (event, url) => {
    if (isAppOrigin(url, { base })) windowModes.set(contents, MODE.app);
    if (windowModes.get(contents) === MODE.signin) win?.setTitle(`Sign in: ${new URL(url).hostname}`);
  });
  // In sign-in mode the title names the host. The page must not replace it.
  win?.on('page-title-updated', (event) => {
    if (windowModes.get(contents) === MODE.signin) event.preventDefault();
  });

  contents.setWindowOpenHandler(({ url }) => {
    const result = decide({ url, currentUrl: contents.getURL(), mode: windowModes.get(contents), kind: 'open', base });
    if (result.action === 'allow') {
      pendingChildModes.get(contents).push(result.mode);
      return { action: 'allow', overrideBrowserWindowOptions: CHILD_WINDOW_OPTIONS };
    }
    if (result.action === 'external') shell.openExternal(url);
    return { action: 'deny' };
  });

  contents.on('did-create-window', (child) =>
    setupSecurity(child.webContents, pendingChildModes.get(contents).shift() ?? MODE.app)
  );
}
