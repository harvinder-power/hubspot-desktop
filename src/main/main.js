const { app, BrowserWindow, session, ipcMain, globalShortcut, shell } = require('electron');
const path = require('path');

// Modules
const { createMenu } = require('./menu');
const NotificationManager = require('./notifications');
const DockManager = require('./dock');
const WindowManager = require('./window-state');
const TrayManager = require('./tray');
const { baseUrl } = require('./base-url');
const { decide, lockedTitle, isPermissionAllowed } = require('./links');

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

// The title depends only on the URL the window has committed, read at each call.
// A navigation that never commits changes nothing. Returns the locked title or null.
function applyTitle(win, contents) {
  const title = lockedTitle(contents.getURL(), { base: baseUrl() });
  if (title !== null) win?.setTitle(title);
  return title;
}

function setupSecurity(contents) {
  const base = baseUrl();
  const win = BrowserWindow.fromWebContents(contents);

  const guardNavigation = (event) => {
    if (!event.isMainFrame) return;
    const { url } = event;
    const action = decide({ url, currentUrl: contents.getURL(), kind: 'navigate', base });
    if (action === 'allow') return;
    event.preventDefault();
    if (action === 'external') shell.openExternal(url);
  };
  contents.on('will-navigate', guardNavigation);
  contents.on('will-redirect', guardNavigation);

  for (const name of ['did-navigate', 'did-fail-load', 'did-finish-load']) contents.on(name, () => applyTitle(win, contents));
  win?.on('page-title-updated', (event) => {
    if (applyTitle(win, contents) !== null) event.preventDefault();
  });

  contents.setWindowOpenHandler(({ url }) => {
    const action = decide({ url, currentUrl: contents.getURL(), kind: 'open', base });
    if (action === 'allow') return { action: 'allow', overrideBrowserWindowOptions: CHILD_WINDOW_OPTIONS };
    if (action === 'external') shell.openExternal(url);
    return { action: 'deny' };
  });

  contents.on('did-create-window', (child) => setupSecurity(child.webContents));
}
