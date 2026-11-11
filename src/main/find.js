// Find in page. reduce() is pure and must not require electron, so node --test can load it.
// State: { open, query, active, total }. Events: { type: 'open' | 'close' | 'next' | 'previous' },
// { type: 'query', text } and { type: 'result', active, total }.
// reduce returns { state, effect }. effect is { find: { text, forward, findNext } }, { stop: true } or null.
// findNext follows Electron: true starts a new search session, false steps through the current one.
const INITIAL = Object.freeze({ open: false, query: '', active: 0, total: 0 });

// The Edit menu items. One table, so the accelerators can change in one place.
const FIND_MENU_ITEMS = [
  { label: 'Find...', accelerator: 'CmdOrCtrl+F', command: 'open' },
  { label: 'Find Next', accelerator: 'CmdOrCtrl+G', command: 'next' },
  { label: 'Find Previous', accelerator: 'CmdOrCtrl+Shift+G', command: 'previous' },
];

const BAR_EVENTS = ['query', 'next', 'previous', 'close'];
const MAX_QUERY = 500;
const BAR_SIZE = { width: 360, height: 44 };
const FIND_PARTITION = 'find-bar';

const search = (text, forward, findNext) => ({ find: { text, forward, findNext } });
const cleared = (state) => ({ ...state, active: 0, total: 0 });

function reduce(state, event) {
  const same = { state, effect: null };
  switch (event.type) {
    case 'open':
      if (state.open) return same;
      return { state: { ...state, open: true }, effect: state.query ? search(state.query, true, true) : null };
    case 'close':
      return state.open ? { state: cleared({ ...state, open: false }), effect: { stop: true } } : same;
    case 'query':
      if (!state.open || event.text === state.query) return same;
      if (!event.text) return { state: cleared({ ...state, query: '' }), effect: { stop: true } };
      return { state: { ...state, query: event.text }, effect: search(event.text, true, true) };
    case 'next':
    case 'previous':
      return state.open && state.query ? { state, effect: search(state.query, event.type === 'next', false) } : same;
    case 'result':
      return state.open && state.query ? { state: { ...state, active: event.active, total: event.total }, effect: null } : same;
    default:
      return same;
  }
}

const countLabel = ({ query, active, total }) => (!query ? '' : total ? `${active} of ${total}` : 'No results');

// Parses a message from the bar. Returns a bar event, or null for anything else.
function parseBarEvent(message) {
  if (!message || !BAR_EVENTS.includes(message.type)) return null;
  if (message.type !== 'query') return { type: message.type };
  return typeof message.text === 'string' ? { type: 'query', text: message.text.slice(0, MAX_QUERY) } : null;
}

// Only a bar's own contents may drive it. bars maps each bar view's webContents to its controller.
function routeBarEvent(bars, sender, message) {
  const bar = bars.get(sender);
  const event = parseBarEvent(message);
  if (bar && event) bar.dispatch(event);
}

function barBounds({ width }) {
  return { x: Math.max(0, width - BAR_SIZE.width), y: 0, ...BAR_SIZE };
}

// One bar per app window, made on first use. The page is never scripted: only findInPage and stopFindInPage.
function createBar(win, bars) {
  const { WebContentsView } = require('electron');
  const path = require('path');
  const page = win.webContents;
  const view = new WebContentsView({
    webPreferences: {
      partition: FIND_PARTITION,
      preload: path.join(__dirname, '../find/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const contents = view.webContents;
  view.setBackgroundColor('#00000000');
  contents.on('will-navigate', (event) => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.loadFile(path.join(__dirname, '../find/find.html'));

  let state = INITIAL;
  let request = null;
  const place = () => view.setBounds(barBounds(win.getContentBounds()));

  function dispatch(event) {
    const { state: next, effect } = reduce(state, event);
    const opened = next.open && !state.open;
    const closed = state.open && !next.open;
    state = next;
    if (effect?.find) request = page.findInPage(effect.find.text, { forward: effect.find.forward, findNext: effect.find.findNext });
    if (effect?.stop) {
      request = null;
      page.stopFindInPage('clearSelection');
    }
    if (opened) {
      win.contentView.addChildView(view);
      place();
    }
    if (closed) win.contentView.removeChildView(view);
    // A hidden window is never focused, so a quiet test run cannot take focus.
    if (event.type === 'open' && win.isVisible()) contents.focus();
    if (closed && win.isVisible()) page.focus();
    contents.send('find:state', { ...state, label: countLabel(state) });
  }

  // Results of an older request arrive late while the user types. Only the latest request counts.
  page.on('found-in-page', (event, result) => {
    if (result.requestId === request) dispatch({ type: 'result', active: result.activeMatchOrdinal, total: result.matches });
  });
  win.on('resize', () => state.open && place());
  win.on('closed', () => {
    bars.delete(contents);
    if (!contents.isDestroyed()) contents.close();
  });

  const bar = { dispatch };
  bars.set(contents, bar);
  return bar;
}

// Find actions for the menu. Each acts on registry.active() and does nothing without a window.
function createFind(registry) {
  const { ipcMain } = require('electron');
  const bars = new Map();
  const byWindow = new WeakMap();
  ipcMain.on('find:event', (event, message) => routeBarEvent(bars, event.sender, message));
  const barFor = (win) => {
    if (!byWindow.has(win)) byWindow.set(win, createBar(win, bars));
    return byWindow.get(win);
  };
  const act = (type) => () => {
    const win = registry.active();
    if (!win || win.isDestroyed()) return;
    if (type === 'open' || byWindow.has(win)) barFor(win).dispatch({ type });
  };
  return { open: act('open'), next: act('next'), previous: act('previous') };
}

module.exports = { INITIAL, FIND_MENU_ITEMS, reduce, countLabel, parseBarEvent, routeBarEvent, barBounds, createFind };
