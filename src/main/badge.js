// Unread badge. The main process reads the count from the committed page title of each app window.
// Pure module apart from the injected setCount. It must not require electron, so node --test can load it.
const { pageKind } = require('./links');

// HubSpot puts the count first in the title: '(3) Inbox', or '(99+) Inbox' past 99.
// Only a leading count counts, so a record named 'Acme (5) Ltd' sets no badge. More than 5 digits reads as 0.
const LEADING_COUNT = /^\((\d{1,5})\+?\)/;

// Returns a non-negative integer.
function unreadFromTitle(title) {
  if (typeof title !== 'string') return 0;
  const match = LEADING_COUNT.exec(title);
  return match ? Number(match[1]) : 0;
}

// The largest count of all app windows. HubSpot shows the same account count in every tab, so a sum
// would count it once per tab, and the focused window's count would drop to 0 when the app is in the background.
function totalUnread(counts) {
  return Math.max(0, ...counts);
}

// Chromium's code for a navigation that stopped before it committed. The window still shows its last page.
const ERR_ABORTED = -3;

// Each app window's count is read again on each title update and each commit, and is dropped when the
// window closes. Outside popups are not in the registry, and an outside page in an app window counts 0.
// A main-frame error page commits with did-fail-load and no did-navigate, and a gone renderer shows no
// page, so both count 0.
function watchBadge({ registry, base, setCount }) {
  const counts = new Map();
  const apply = () => setCount(totalUnread(counts.values()));
  registry.onWindow((win) => {
    const contents = win.webContents;
    const update = () => {
      const isApp = pageKind(contents.getURL(), { base }) === 'app';
      counts.set(win, isApp ? unreadFromTitle(contents.getTitle()) : 0);
      apply();
    };
    const reset = () => {
      counts.set(win, 0);
      apply();
    };
    contents.on('page-title-updated', update);
    contents.on('did-navigate', update);
    contents.on('did-fail-load', (event, code, description, url, isMainFrame) => {
      if (isMainFrame && code !== ERR_ABORTED) reset();
    });
    contents.on('render-process-gone', reset);
    win.on('closed', () => {
      counts.delete(win);
      apply();
    });
  });
}

module.exports = { unreadFromTitle, totalUnread, watchBadge };
