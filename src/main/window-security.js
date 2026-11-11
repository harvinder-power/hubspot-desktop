const { BrowserWindow, shell } = require('electron');
const path = require('path');
const { baseUrl } = require('./base-url');
const { decide, lockedTitle, pageKind, childWindowKind } = require('./links');
const { TABBING_IDENTIFIER } = require('./windows');

const PARTITION = 'persist:hubspot';

const CHILD_WEB_PREFERENCES = {
  partition: PARTITION,
  preload: path.join(__dirname, '../preload/preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
};

// Options by childWindowKind. Children start hidden; the window registry shows them.
// An outside popup has no tabbing identifier, so macOS never tabs it with app windows.
const CHILD_WINDOW_OPTIONS = {
  app: { show: false, tabbingIdentifier: TABBING_IDENTIFIER, webPreferences: CHILD_WEB_PREFERENCES },
  'outside-popup': { show: false, webPreferences: CHILD_WEB_PREFERENCES },
};

// Closes the page only when the document is provably empty. The check and the close run in one
// renderer task, so nothing the app writes can land between them. Any error keeps the window open.
const CLOSE_IF_EMPTY = "document.body?.childElementCount === 0 && document.body.textContent.trim() === '' && (window.close(), true)";

// The title depends only on the document the window holds now, its URL and its origin, read at each call.
// A navigation that never commits changes nothing. Returns the locked title or null.
function applyTitle(win, contents) {
  const title = lockedTitle(contents.getURL(), { base: baseUrl(), origin: contents.mainFrame.origin });
  if (title !== null) win?.setTitle(title);
  return title;
}

function setupSecurity(contents) {
  const base = baseUrl();
  const win = BrowserWindow.fromWebContents(contents);
  const title = () => applyTitle(win, contents);

  const guardNavigation = (event) => {
    if (!event.isMainFrame) return;
    const { url } = event;
    const currentUrl = contents.getURL();
    const action = decide({ url, currentUrl, kind: 'navigate', base });
    if (action === 'allow') return;
    event.preventDefault();
    if (action !== 'external') return;
    shell.openExternal(url);
    // A blank popup the app sends outside before writing into it has nothing else to show, so it closes.
    if (pageKind(currentUrl, { base }) !== 'blank' || contents.navigationHistory.length() !== 1) return;
    contents.executeJavaScript(CLOSE_IF_EMPTY).catch(() => {});
  };
  contents.on('will-navigate', guardNavigation);
  contents.on('will-redirect', guardNavigation);

  for (const name of ['did-navigate', 'did-fail-load', 'did-finish-load']) contents.on(name, title);
  win?.on('page-title-updated', (event) => {
    if (title() !== null) event.preventDefault();
  });

  contents.setWindowOpenHandler(({ url }) => {
    const action = decide({ url, currentUrl: contents.getURL(), kind: 'open', base });
    if (action === 'allow') return { action: 'allow', overrideBrowserWindowOptions: CHILD_WINDOW_OPTIONS[childWindowKind(url, { base })] };
    if (action === 'external') shell.openExternal(url);
    return { action: 'deny' };
  });

  contents.on('did-create-window', (child) => setupSecurity(child.webContents));
}

module.exports = { PARTITION, setupSecurity };
