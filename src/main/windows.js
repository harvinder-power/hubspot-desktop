const { app, BrowserWindow } = require('electron');
const windowStateKeeper = require('electron-window-state');
const { isAppOrigin, pageKind, childWindowKind, tabEligible } = require('./links');

// Windows with the same identifier join one native tab group on macOS.
const TABBING_IDENTIFIER = 'hubspot-desktop';

// Two kinds of window, fixed at creation (see childWindowKind):
// - app window: opened by open(), or by a page for an app or blank URL. It is in the set.
// - outside popup: opened by a page for any other URL. It is not in the set, has no tab identifier,
//   is never active() and closes for real.
// Tab membership is not decided when a window opens. tabEligible reads it from committed state, and
// enforceTabs applies it to every window the app creates, so no event order can leave a window tabbed.
// The set is the only registry state, kept in focus order: the last entry was focused last.
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

  const eligible = (win) =>
    !win.isDestroyed() && tabEligible({ inRegistry: windows.has(win), committedKind: pageKind(win.webContents.getURL(), { base }) });

  // The invariant: a window that is not eligible is not in a tab group.
  function enforceTabs(win) {
    if (isMac && !quiet && !win.isDestroyed() && !eligible(win)) win.moveTabToNewWindow();
  }

  // macOS may tab a window into a group by itself when it is shown ("Prefer tabs"), next to any
  // window, so after each show every window is checked.
  function showWindow(win) {
    win.show();
    for (const other of BrowserWindow.getAllWindows()) enforceTabs(other);
  }

  // Each commit, an error page included, is checked. did-navigate also fires for Back and Forward.
  function guard(win) {
    win.webContents.on('did-navigate', () => enforceTabs(win));
    win.webContents.on('did-fail-load', (event, code, description, url, isMainFrame) => {
      if (isMainFrame) enforceTabs(win);
    });
  }

  // tab: false opens a separate window. Off macOS every window is separate.
  function open({ url, tab = true } = {}) {
    const current = isMac ? active() : null;
    // The last window hides instead of closing. Show it again, so it does not come back later as a surprise.
    if (current && !current.isVisible() && !quiet) showWindow(current);
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
    track(win, { host: tab ? current : null, state });
    win.loadURL(url ?? base);
    return win;
  }

  // Children of any window, already secured by their opener. The kind comes from the requested URL,
  // with the same function that chose the child's window options.
  // The opener is read from the origin of the document that opened the child.
  function watchChildren(win) {
    win.webContents.on('did-create-window', (child, { url }) => {
      const opener = isAppOrigin(win.webContents.mainFrame.origin, { base }) ? 'app' : 'outside';
      if (childWindowKind(url, { base }) === 'app') track(child, { host: isMac ? win : null, opener });
      else popup(child);
    });
  }

  // Window > Merge All Windows. macOS merges every window, so each one is checked afterwards.
  function mergeAll() {
    if (!isMac || quiet) return;
    [...windows].reverse().find((win) => eligible(win) && win.isVisible())?.mergeAllWindows();
    for (const other of BrowserWindow.getAllWindows()) enforceTabs(other);
  }

  function popup(win) {
    guard(win);
    watchChildren(win);
    win.once('ready-to-show', () => {
      if (!quiet && !win.isDestroyed()) showWindow(win);
    });
  }

  // host is the window the new one may join as a tab. It joins at ready-to-show, when the window has
  // committed its first page, and only when both windows are eligible then.
  // opener: null for a menu or + button window, else 'app' or 'outside' for the page that opened it.
  function track(win, { host, state = null, opener = null }) {
    windows.add(win);
    guard(win);
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
      if (host && eligible(host) && eligible(win) && host.isVisible()) host.addTabbedWindow(win);
      showWindow(win);
      if (state?.isMaximized) win.maximize();
    });
    watchChildren(win);
    for (const listener of listeners) listener(win, { opener });
  }

  function show() {
    const win = active();
    if (!win) return open();
    if (quiet) return win;
    if (win.isMinimized()) win.restore();
    showWindow(win);
    win.focus();
    return win;
  }

  return {
    open,
    active,
    show,
    mergeAll,
    all: () => [...windows],
    onWindow: (listener) => listeners.push(listener),
  };
}

module.exports = { createWindowRegistry, TABBING_IDENTIFIER };
