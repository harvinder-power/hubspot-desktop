const { BrowserWindow, shell } = require('electron');
const path = require('path');
const { baseUrl } = require('./base-url');
const { decide, lockedTitle, pageKind } = require('./links');
const { TABBING_IDENTIFIER } = require('./windows');

const PARTITION = 'persist:hubspot';

// Children start hidden. The window registry adopts each one and shows it, as it does its own windows.
const CHILD_WINDOW_OPTIONS = {
  show: false,
  tabbingIdentifier: TABBING_IDENTIFIER,
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
    const currentUrl = contents.getURL();
    const action = decide({ url, currentUrl, kind: 'navigate', base });
    if (action === 'allow') return;
    event.preventDefault();
    if (action !== 'external') return;
    shell.openExternal(url);
    // A blank popup the app sends outside has nothing else to show, so it closes.
    if (pageKind(currentUrl, { base }) === 'blank' && contents.navigationHistory.length() === 1) win?.close();
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

module.exports = { PARTITION, setupSecurity };
