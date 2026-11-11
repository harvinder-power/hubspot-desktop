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

// True only when the document is provably empty. Any error keeps the window open.
const IS_EMPTY_DOCUMENT = "document.body?.childElementCount === 0 && document.body.textContent.trim() === ''";

// The title depends only on the URL the window has committed, read at each call.
// A navigation that never commits changes nothing. Returns the locked title or null.
function applyTitle(win, contents, outsidePopup) {
  const history = contents.navigationHistory;
  const index = history.getActiveIndex();
  const previousUrl = index > 0 ? history.getEntryAtIndex(index - 1)?.url ?? '' : '';
  const title = lockedTitle(contents.getURL(), { base: baseUrl(), previousUrl, outsidePopup });
  if (title !== null) win?.setTitle(title);
  return title;
}

function setupSecurity(contents, { outsidePopup = false } = {}) {
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
    // A blank popup the app sends outside before writing into it has nothing else to show, so it closes.
    if (pageKind(currentUrl, { base }) !== 'blank' || contents.navigationHistory.length() !== 1) return;
    contents
      .executeJavaScript(IS_EMPTY_DOCUMENT)
      .then((empty) => empty === true && win?.close())
      .catch(() => {});
  };
  contents.on('will-navigate', guardNavigation);
  contents.on('will-redirect', guardNavigation);

  for (const name of ['did-navigate', 'did-fail-load', 'did-finish-load']) contents.on(name, () => applyTitle(win, contents, outsidePopup));
  win?.on('page-title-updated', (event) => {
    if (applyTitle(win, contents, outsidePopup) !== null) event.preventDefault();
  });

  contents.setWindowOpenHandler(({ url }) => {
    const action = decide({ url, currentUrl: contents.getURL(), kind: 'open', base });
    if (action === 'allow') return { action: 'allow', overrideBrowserWindowOptions: CHILD_WINDOW_OPTIONS[childWindowKind(url, { base })] };
    if (action === 'external') shell.openExternal(url);
    return { action: 'deny' };
  });

  contents.on('did-create-window', (child, { url }) =>
    setupSecurity(child.webContents, { outsidePopup: childWindowKind(url, { base }) === 'outside-popup' })
  );
}

module.exports = { PARTITION, setupSecurity };
