const { app, BrowserWindow } = require('electron');
const windowStateKeeper = require('electron-window-state');
const { pageKind, childWindowKind } = require('./links');

// Windows with the same identifier join one native tab group on macOS.
const TABBING_IDENTIFIER = 'hubspot-desktop';

// Two kinds of window, fixed at creation (see childWindowKind):
// - app window: opened by open(), or by a page for an app or blank URL. It is in the set and may be tabbed.
// - outside popup: opened by a page for any other URL. It is not in the set, is never tabbed, never
//   hosts a tab, is never active() and closes for real.
// The set is the only state, kept in focus order: the last entry was focused last.
// quiet: windows are never shown or focused, so a local test run cannot take focus.
function createWindowRegistry({ partition, preloadPath, base, secure, quiet = false }) {
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

  const onAppPage = (win) => !win.isDestroyed() && pageKind(win.webContents.getURL(), { base }) === 'app';

  // tab: false opens a separate window. Off macOS every window is separate.
  function open({ url, tab = true } = {}) {
    const current = isMac ? active() : null;
    // The last window hides instead of closing. Show it again, so it does not come back later as a surprise.
    if (current && !current.isVisible() && !quiet) current.show();
    const host = () => (tab && current && onAppPage(current) ? current : null);
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
    state?.manage(win);
    secure(win.webContents);
    track(win, { host, state });
    win.loadURL(url ?? base);
    return win;
  }

  // Children of any window, already secured by their opener. The kind comes from the requested URL,
  // with the same function that chose the child's window options.
  function watchChildren(win) {
    win.webContents.on('did-create-window', (child, { url }) => {
      if (childWindowKind(url, { base }) === 'app') adopt(child, { opener: win });
      else popup(child);
    });
  }

  // An app child is tabbed with its opener only when both are on app pages.
  function adopt(win, { opener }) {
    const host = () => (isMac && onAppPage(win) && onAppPage(opener) ? opener : null);
    track(win, { host });
  }

  function popup(win) {
    watchChildren(win);
    win.once('ready-to-show', () => {
      if (!quiet && !win.isDestroyed()) win.show();
    });
  }

  // host() is read at ready-to-show, when the window has committed its first page.
  function track(win, { host, state = null }) {
    windows.add(win);
    // Invariant: a window on an outside page is not in a tab group. did-navigate also fires for Back and Forward.
    // Once out, the window stays separate. Quiet windows are never tabbed.
    win.webContents.on('did-navigate', (event, url) => {
      if (isMac && !quiet && pageKind(url, { base }) === 'outside') win.moveTabToNewWindow();
    });
    let closedEarly = false;
    win.on('focus', () => {
      windows.delete(win);
      windows.add(win);
    });
    // On macOS the last window hides instead of closing, so the app stays in the dock and tray.
    win.on('close', (event) => {
      closedEarly = true;
      if (isMac && !quitting && windows.size === 1) {
        event.preventDefault();
        win.hide();
      }
    });
    win.on('closed', () => windows.delete(win));
    win.once('ready-to-show', () => {
      // A window closed before its first paint stays closed or hidden.
      if (quiet || closedEarly || win.isDestroyed()) return;
      // A tab joins its group once its contents are ready. Added at creation, it joined in 1 of 3 CI runs.
      const tabHost = host();
      if (tabHost && !tabHost.isDestroyed() && tabHost.isVisible()) tabHost.addTabbedWindow(win);
      win.show();
      if (state?.isMaximized) win.maximize();
    });
    watchChildren(win);
    for (const listener of listeners) listener(win);
  }

  function show() {
    const win = active();
    if (!win) return open();
    if (quiet) return win;
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
