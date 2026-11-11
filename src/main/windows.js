const { app, BrowserWindow } = require('electron');
const windowStateKeeper = require('electron-window-state');

// Windows with the same identifier join one native tab group on macOS.
const TABBING_IDENTIFIER = 'hubspot-desktop';

// The app windows. The set is the only state, kept in focus order: the last entry was focused last.
function createWindowRegistry({ partition, preloadPath, base, secure }) {
  const windows = new Set();
  const listeners = [];
  const isMac = process.platform === 'darwin';
  let quitting = false;
  app.on('before-quit', () => {
    quitting = true;
  });

  function active() {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused && windows.has(focused)) return focused;
    return [...windows].at(-1) ?? null;
  }

  // tab: false opens a separate window. Off macOS every window is separate.
  function open({ url, tab = true } = {}) {
    const host = isMac && tab ? active() : null;
    // Window bounds persist for the first window only.
    const state = windows.size === 0 ? windowStateKeeper({ defaultWidth: 1400, defaultHeight: 900, file: 'window-state.json' }) : null;
    const win = new BrowserWindow({
      ...(state ? { x: state.x, y: state.y, width: state.width, height: state.height } : { width: 1400, height: 900 }),
      minWidth: 800,
      minHeight: 600,
      titleBarStyle: 'default',
      backgroundColor: '#ffffff',
      show: false,
      tabbingIdentifier: TABBING_IDENTIFIER,
      webPreferences: {
        partition,
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        spellcheck: true,
      },
    });
    windows.add(win);
    state?.manage(win);
    if (host?.isVisible()) host.addTabbedWindow(win);

    win.on('focus', () => {
      windows.delete(win);
      windows.add(win);
    });
    // On macOS the last window hides instead of closing, so the app stays in the dock and tray.
    win.on('close', (event) => {
      if (isMac && !quitting && windows.size === 1) {
        event.preventDefault();
        win.hide();
      }
    });
    win.on('closed', () => windows.delete(win));
    win.once('ready-to-show', () => {
      win.show();
      if (state?.isMaximized) win.maximize();
    });

    secure(win.webContents);
    for (const listener of listeners) listener(win);
    win.loadURL(url ?? base);
    return win;
  }

  function show() {
    const win = active();
    if (!win) return open();
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return win;
  }

  return {
    open,
    active,
    show,
    all: () => [...windows],
    onWindow: (listener) => listeners.push(listener),
  };
}

module.exports = { createWindowRegistry, TABBING_IDENTIFIER };
