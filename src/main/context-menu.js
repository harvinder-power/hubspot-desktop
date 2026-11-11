// Right-click menu. buildTemplate is pure and must not require electron, so node --test can load it.
// An item is { id, label, enabled?, type?: 'separator', role?, run?: string, arg? }.
// `run` names a function in the actions map that attach() is given; it is called as run(arg, contents).
const { isAppOrigin, pageKind } = require('./links');

const MAX_SUGGESTIONS = 5;

const parse = (url) => {
  try {
    return new URL(url);
  } catch {
    return null;
  }
};
const decode = (text) => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};
const isWebUrl = (url) => ['http:', 'https:'].includes(parse(url)?.protocol);

// The URL of a page that may be copied or opened in the browser, or null for any other page.
const pageLink = (url, base) => (url && pageKind(url, { base }) === 'app' ? url : null);

const ADDRESS_LINKS = { 'mailto:': { id: 'copy-address', label: 'Copy Address' }, 'tel:': { id: 'copy-number', label: 'Copy Number' } };
// Code point ranges: C0 and C1 controls, and the bidirectional embedding, override and isolate controls.
const UNSAFE_RANGES = [[0x00, 0x1f], [0x7f, 0x9f], [0x202a, 0x202e], [0x2066, 0x2069]];
const isSafe = (char) => !UNSAFE_RANGES.some(([low, high]) => char.codePointAt(0) >= low && char.codePointAt(0) <= high);
const address = (url) => [...decode(url.pathname)].filter(isSafe).join('').trim();

const EDIT_ITEMS = [
  { id: 'undo', label: 'Undo', role: 'undo', flag: 'canUndo' },
  { id: 'redo', label: 'Redo', role: 'redo', flag: 'canRedo' },
  { type: 'separator' },
  { id: 'cut', label: 'Cut', role: 'cut', flag: 'canCut' },
  { id: 'copy', label: 'Copy', role: 'copy', flag: 'canCopy' },
  { id: 'paste', label: 'Paste', role: 'paste', flag: 'canPaste' },
  { id: 'paste-and-match-style', label: 'Paste and Match Style', role: 'pasteAndMatchStyle', flag: 'canPaste' },
  { id: 'select-all', label: 'Select All', role: 'selectAll', flag: 'canSelectAll' },
];

const editItem = ({ flag, ...item }, editFlags = {}) =>
  item.type ? { id: 'edit-separator', type: 'separator' } : { ...item, enabled: Boolean(editFlags[flag]) };

function spelling({ misspelledWord, dictionarySuggestions = [] }) {
  if (!misspelledWord) return [];
  const guesses = dictionarySuggestions.slice(0, MAX_SUGGESTIONS);
  return [
    ...(guesses.length
      ? guesses.map((word, i) => ({ id: `suggestion-${i}`, label: word, run: 'replaceMisspelling', arg: word }))
      : [{ id: 'no-guesses', label: 'No Guesses Found', enabled: false }]),
    { id: 'add-to-dictionary', label: 'Add to Dictionary', run: 'addToDictionary', arg: misspelledWord },
  ];
}

function link({ linkURL }, { base }) {
  const url = parse(linkURL);
  if (!url) return [];
  const addressItem = ADDRESS_LINKS[url.protocol];
  if (addressItem) {
    const text = address(url);
    return text ? [{ ...addressItem, run: 'copyText', arg: text }] : [];
  }
  if (!isWebUrl(linkURL)) return [];
  // The page that shows the link does not matter: an app URL opens an app page in any tab.
  const inApp = isAppOrigin(linkURL, { base });
  return [
    ...(inApp ? [{ id: 'open-link-in-new-tab', label: 'Open Link in New Tab', run: 'openTab', arg: linkURL }] : []),
    { id: 'open-link-in-browser', label: 'Open Link in Browser', run: 'openInBrowser', arg: linkURL },
    { id: 'copy-link', label: 'Copy Link', run: 'copyText', arg: linkURL },
  ];
}

function image({ mediaType, srcURL, x, y }) {
  if (mediaType !== 'image') return [];
  return [
    { id: 'copy-image', label: 'Copy Image', run: 'copyImageAt', arg: { x, y } },
    ...(isWebUrl(srcURL) ? [{ id: 'copy-image-address', label: 'Copy Image Address', run: 'copyText', arg: srcURL }] : []),
  ];
}

function edit({ isEditable, selectionText, editFlags }) {
  if (isEditable) return EDIT_ITEMS.map((item) => editItem(item, editFlags));
  return typeof selectionText === 'string' && selectionText.trim() ? [editItem(EDIT_ITEMS.find(({ id }) => id === 'copy'), editFlags)] : [];
}

function page(params, { pageUrl, base, canGoBack = false, canGoForward = false }, anyAbove) {
  if (anyAbove) return [];
  const url = pageLink(pageUrl, base);
  return [
    { id: 'back', label: 'Back', enabled: canGoBack, run: 'goBack' },
    { id: 'forward', label: 'Forward', enabled: canGoForward, run: 'goForward' },
    { id: 'reload', label: 'Reload', run: 'reload' },
    ...(url
      ? [
          { id: 'page-separator', type: 'separator' },
          { id: 'copy-page-link', label: 'Copy Page Link', run: 'copyText', arg: url },
          { id: 'open-page-in-browser', label: 'Open Page in Browser', run: 'openInBrowser', arg: url },
        ]
      : []),
  ];
}

function developer({ x, y }, { isPackaged }) {
  return isPackaged ? [] : [{ id: 'inspect-element', label: 'Inspect Element', run: 'inspect', arg: { x, y } }];
}

// Sections in menu order. Each returns its items, or [] when it does not apply.
const SECTIONS = [spelling, link, image, edit, page, developer];

// context is { pageUrl, base, isPackaged, canGoBack?, canGoForward? }.
function buildTemplate(params, context) {
  const sections = [];
  for (const section of SECTIONS) {
    const items = section(params, context, sections.length > 0);
    if (items.length) sections.push(items);
  }
  return sections.flatMap((items, i) => (i === 0 ? items : [{ id: `separator-${i}`, type: 'separator' }, ...items]));
}

// The functions that `run` names. openTab(url) opens an app URL in a new tab.
function createActions({ openTab }) {
  const { clipboard, shell } = require('electron');
  return {
    replaceMisspelling: (word, contents) => contents.replaceMisspelling(word),
    addToDictionary: (word, contents) => contents.session.addWordToSpellCheckerDictionary(word),
    openTab,
    // Only http: and https: URLs ever reach shell.openExternal from this menu.
    openInBrowser: (url) => isWebUrl(url) && shell.openExternal(url),
    copyText: (text) => clipboard.writeText(text),
    copyImageAt: ({ x, y }, contents) => contents.copyImageAt(x, y),
    goBack: (arg, contents) => contents.navigationHistory.goBack(),
    goForward: (arg, contents) => contents.navigationHistory.goForward(),
    reload: (arg, contents) => contents.reload(),
    inspect: ({ x, y }, contents) => contents.inspectElement(x, y),
  };
}

function attach(contents, actions) {
  const { app, BrowserWindow, Menu } = require('electron');
  const { baseUrl } = require('./base-url');
  const base = baseUrl();
  contents.on('context-menu', (event, params) => {
    const history = contents.navigationHistory;
    const context = {
      pageUrl: contents.getURL(),
      base,
      isPackaged: app.isPackaged,
      canGoBack: history.canGoBack(),
      canGoForward: history.canGoForward(),
    };
    const template = buildTemplate(params, context).map(({ run, arg, ...item }) =>
      run ? { ...item, click: () => contents.isDestroyed() || actions[run](arg, contents) } : item
    );
    Menu.buildFromTemplate(template).popup({ window: BrowserWindow.fromWebContents(contents) });
  });
}

module.exports = { buildTemplate, createActions, attach, pageLink };
