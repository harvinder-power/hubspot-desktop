const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTemplate, pageLink } = require('../../src/main/context-menu');

const BASE = 'https://app.hubspot.com';
const APP_PAGE = 'https://app.hubspot.com/contacts/4242/objects/0-1/views/all/list';
const OUTSIDE_PAGE = 'https://example.com/docs';
const APP_LINK = 'https://app.hubspot.com/contacts/4242/record/0-1/101';
const IMAGE = 'https://cdn.example.com/logo.png';

const NO_FLAGS = { canUndo: false, canRedo: false, canCut: false, canCopy: false, canPaste: false, canSelectAll: false };
const ALL_FLAGS = { canUndo: true, canRedo: true, canCut: true, canCopy: true, canPaste: true, canSelectAll: true };
const PLAIN = { x: 10, y: 20, linkURL: '', srcURL: '', mediaType: 'none', selectionText: '', isEditable: false, editFlags: NO_FLAGS, misspelledWord: '', dictionarySuggestions: [] };

const DEV = { id: 'inspect-element', label: 'Inspect Element' };
const sep = (i) => ({ id: `separator-${i}`, type: 'separator' });
const editSection = (flags) => [
  { id: 'undo', label: 'Undo', enabled: flags.canUndo },
  { id: 'redo', label: 'Redo', enabled: flags.canRedo },
  { id: 'edit-separator', type: 'separator' },
  { id: 'cut', label: 'Cut', enabled: flags.canCut },
  { id: 'copy', label: 'Copy', enabled: flags.canCopy },
  { id: 'paste', label: 'Paste', enabled: flags.canPaste },
  { id: 'paste-and-match-style', label: 'Paste and Match Style', enabled: flags.canPaste },
  { id: 'select-all', label: 'Select All', enabled: flags.canSelectAll },
];

// Each case: params, context and the full expected list of { id, label, type, enabled } in order.
const CASES = [
  {
    name: 'a misspelled word with three suggestions inside an editable field',
    params: { isEditable: true, editFlags: ALL_FLAGS, misspelledWord: 'teh', dictionarySuggestions: ['the', 'ten', 'tea'] },
    expected: [
      { id: 'suggestion-0', label: 'the' },
      { id: 'suggestion-1', label: 'ten' },
      { id: 'suggestion-2', label: 'tea' },
      { id: 'add-to-dictionary', label: 'Add to Dictionary' },
      sep(1),
      ...editSection(ALL_FLAGS),
      sep(2),
      DEV,
    ],
  },
  {
    name: 'a misspelled word with no suggestions',
    params: { isEditable: true, editFlags: ALL_FLAGS, misspelledWord: 'qzxv', dictionarySuggestions: [] },
    expected: [
      { id: 'no-guesses', label: 'No Guesses Found', enabled: false },
      { id: 'add-to-dictionary', label: 'Add to Dictionary' },
      sep(1),
      ...editSection(ALL_FLAGS),
      sep(2),
      DEV,
    ],
  },
  {
    name: 'an app link on an app page',
    params: { linkURL: APP_LINK },
    expected: [
      { id: 'open-link-in-new-tab', label: 'Open Link in New Tab' },
      { id: 'open-link-in-browser', label: 'Open Link in Browser' },
      { id: 'copy-link', label: 'Copy Link' },
      sep(1),
      DEV,
    ],
  },
  {
    name: 'an outside https link on an app page',
    params: { linkURL: 'https://example.com/pricing' },
    expected: [
      { id: 'open-link-in-browser', label: 'Open Link in Browser' },
      { id: 'copy-link', label: 'Copy Link' },
      sep(1),
      DEV,
    ],
  },
  {
    name: 'a mailto: link',
    params: { linkURL: 'mailto:sam%40example.com' },
    expected: [{ id: 'copy-address', label: 'Copy Address' }, sep(1), DEV],
  },
  {
    name: 'a tel: link',
    params: { linkURL: 'tel:+442071234567' },
    expected: [{ id: 'copy-number', label: 'Copy Number' }, sep(1), DEV],
  },
  {
    name: 'a javascript: link has no link section and falls back to the page section',
    params: { linkURL: 'javascript:alert(1)' },
    expected: [
      { id: 'back', label: 'Back', enabled: false },
      { id: 'forward', label: 'Forward', enabled: false },
      { id: 'reload', label: 'Reload' },
      { id: 'page-separator', type: 'separator' },
      { id: 'copy-page-link', label: 'Copy Page Link' },
      { id: 'open-page-in-browser', label: 'Open Page in Browser' },
      sep(1),
      DEV,
    ],
  },
  {
    name: 'an image',
    params: { mediaType: 'image', srcURL: IMAGE },
    expected: [{ id: 'copy-image', label: 'Copy Image' }, { id: 'copy-image-address', label: 'Copy Image Address' }, sep(1), DEV],
  },
  {
    name: 'an image with a data: source offers Copy Image without its address',
    params: { mediaType: 'image', srcURL: 'data:image/png;base64,AAAA', linkURL: 'https://example.com/' },
    expected: [
      { id: 'open-link-in-browser', label: 'Open Link in Browser' },
      { id: 'copy-link', label: 'Copy Link' },
      sep(1),
      { id: 'copy-image', label: 'Copy Image' },
      sep(2),
      DEV,
    ],
  },
  {
    name: 'an image with a blob: source offers Copy Image without its address',
    params: { mediaType: 'image', srcURL: 'blob:https://app.hubspot.com/7d3e0c5a-1b2c-4d5e-8f90-a1b2c3d4e5f6' },
    expected: [{ id: 'copy-image', label: 'Copy Image' }, sep(1), DEV],
  },
  {
    name: 'an outside https link on the sign-in page has no Open Link in New Tab',
    params: { linkURL: 'https://example.com/pricing' },
    context: { pageUrl: 'https://app.hubspot.com/login' },
    expected: [{ id: 'open-link-in-browser', label: 'Open Link in Browser' }, { id: 'copy-link', label: 'Copy Link' }, sep(1), DEV],
  },
  {
    name: 'an app link on the sign-in page offers Open Link in New Tab',
    params: { linkURL: APP_LINK },
    context: { pageUrl: 'https://app.hubspot.com/login' },
    expected: [
      { id: 'open-link-in-new-tab', label: 'Open Link in New Tab' },
      { id: 'open-link-in-browser', label: 'Open Link in Browser' },
      { id: 'copy-link', label: 'Copy Link' },
      sep(1),
      DEV,
    ],
  },
  {
    name: 'an app link on an outside page offers Open Link in New Tab',
    params: { linkURL: APP_LINK },
    context: { pageUrl: OUTSIDE_PAGE },
    expected: [
      { id: 'open-link-in-new-tab', label: 'Open Link in New Tab' },
      { id: 'open-link-in-browser', label: 'Open Link in Browser' },
      { id: 'copy-link', label: 'Copy Link' },
      sep(1),
      DEV,
    ],
  },
  {
    name: 'a mailto: link with no address has no link section',
    params: { linkURL: 'mailto:?to=x@y' },
    context: { pageUrl: OUTSIDE_PAGE },
    expected: [
      { id: 'back', label: 'Back', enabled: false },
      { id: 'forward', label: 'Forward', enabled: false },
      { id: 'reload', label: 'Reload' },
      sep(1),
      DEV,
    ],
  },
  {
    name: 'a null selectionText counts as no selection',
    params: { selectionText: null },
    context: { pageUrl: OUTSIDE_PAGE },
    expected: [
      { id: 'back', label: 'Back', enabled: false },
      { id: 'forward', label: 'Forward', enabled: false },
      { id: 'reload', label: 'Reload' },
      sep(1),
      DEV,
    ],
  },
  {
    name: 'an image inside a link',
    params: { mediaType: 'image', srcURL: IMAGE, linkURL: APP_LINK },
    expected: [
      { id: 'open-link-in-new-tab', label: 'Open Link in New Tab' },
      { id: 'open-link-in-browser', label: 'Open Link in Browser' },
      { id: 'copy-link', label: 'Copy Link' },
      sep(1),
      { id: 'copy-image', label: 'Copy Image' },
      { id: 'copy-image-address', label: 'Copy Image Address' },
      sep(2),
      DEV,
    ],
  },
  {
    name: 'an editable field with canPaste false',
    params: { isEditable: true, editFlags: { ...ALL_FLAGS, canPaste: false } },
    expected: [...editSection({ ...ALL_FLAGS, canPaste: false }), sep(1), DEV],
  },
  {
    name: 'selected text on a plain page',
    params: { selectionText: 'Acme Ltd', editFlags: { ...NO_FLAGS, canCopy: true } },
    expected: [{ id: 'copy', label: 'Copy', enabled: true }, sep(1), DEV],
  },
  {
    name: 'a plain page area on an app page with history both ways',
    params: {},
    context: { canGoBack: true, canGoForward: true },
    expected: [
      { id: 'back', label: 'Back', enabled: true },
      { id: 'forward', label: 'Forward', enabled: true },
      { id: 'reload', label: 'Reload' },
      { id: 'page-separator', type: 'separator' },
      { id: 'copy-page-link', label: 'Copy Page Link' },
      { id: 'open-page-in-browser', label: 'Open Page in Browser' },
      sep(1),
      DEV,
    ],
  },
  {
    name: 'a plain page area on an outside page has no page-link items',
    params: {},
    context: { pageUrl: OUTSIDE_PAGE },
    expected: [
      { id: 'back', label: 'Back', enabled: false },
      { id: 'forward', label: 'Forward', enabled: false },
      { id: 'reload', label: 'Reload' },
      sep(1),
      DEV,
    ],
  },
  {
    name: 'a plain page area on the sign-in page has no page-link items',
    params: {},
    context: { pageUrl: 'https://app.hubspot.com/login' },
    expected: [
      { id: 'back', label: 'Back', enabled: false },
      { id: 'forward', label: 'Forward', enabled: false },
      { id: 'reload', label: 'Reload' },
      sep(1),
      DEV,
    ],
  },
  {
    name: 'a packaged build has no Inspect Element',
    params: { linkURL: APP_LINK },
    context: { isPackaged: true },
    expected: [
      { id: 'open-link-in-new-tab', label: 'Open Link in New Tab' },
      { id: 'open-link-in-browser', label: 'Open Link in Browser' },
      { id: 'copy-link', label: 'Copy Link' },
    ],
  },
  {
    name: 'a packaged build on an outside page shows only the page section',
    params: {},
    context: { isPackaged: true, pageUrl: OUTSIDE_PAGE },
    expected: [
      { id: 'back', label: 'Back', enabled: false },
      { id: 'forward', label: 'Forward', enabled: false },
      { id: 'reload', label: 'Reload' },
    ],
  },
];

const build = ({ params, context }) =>
  buildTemplate({ ...PLAIN, ...params }, { pageUrl: APP_PAGE, base: BASE, isPackaged: false, ...context });

const summary = (items) =>
  items.map(({ id, label, type, enabled }) => ({ id, ...(label && { label }), ...(type && { type }), ...(enabled !== undefined && { enabled }) }));

for (const testCase of CASES) {
  test(`buildTemplate: ${testCase.name}`, () => {
    assert.deepEqual(summary(build(testCase)), testCase.expected);
  });
}

test('buildTemplate never starts or ends with a separator or puts two in a row', () => {
  for (const testCase of CASES) {
    const types = build(testCase).map((item) => item.type ?? 'item');
    assert.notEqual(types[0], 'separator', testCase.name);
    assert.notEqual(types.at(-1), 'separator', testCase.name);
    types.forEach((type, i) => assert.ok(!(type === 'separator' && types[i + 1] === 'separator'), testCase.name));
  }
});

test('buildTemplate gives at most five suggestions', () => {
  const items = build({ params: { isEditable: true, misspelledWord: 'x', dictionarySuggestions: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] } });
  assert.deepEqual(items.filter((item) => item.run === 'replaceMisspelling').map((item) => item.arg), ['a', 'b', 'c', 'd', 'e']);
});

test('buildTemplate binds each action to the value it acts on', () => {
  const run = (testCase) => build(testCase).filter((item) => item.run).map(({ id, run: name, arg }) => [id, name, arg]);
  assert.deepEqual(run({ params: { linkURL: APP_LINK }, context: { isPackaged: true } }), [
    ['open-link-in-new-tab', 'openTab', APP_LINK],
    ['open-link-in-browser', 'openInBrowser', APP_LINK],
    ['copy-link', 'copyText', APP_LINK],
  ]);
  assert.deepEqual(run({ params: { linkURL: 'mailto:sam%40example.com?subject=Hi' }, context: { isPackaged: true } }), [
    ['copy-address', 'copyText', 'sam@example.com'],
  ]);
  assert.deepEqual(run({ params: { linkURL: 'tel:+442071234567' }, context: { isPackaged: true } }), [
    ['copy-number', 'copyText', '+442071234567'],
  ]);
  assert.deepEqual(run({ params: { mediaType: 'image', srcURL: IMAGE }, context: { isPackaged: true } }), [
    ['copy-image', 'copyImageAt', { x: 10, y: 20 }],
    ['copy-image-address', 'copyText', IMAGE],
  ]);
  assert.deepEqual(run({ params: { misspelledWord: 'teh', dictionarySuggestions: ['the'], isEditable: true }, context: { isPackaged: true } }), [
    ['suggestion-0', 'replaceMisspelling', 'the'],
    ['add-to-dictionary', 'addToDictionary', 'teh'],
  ]);
  assert.deepEqual(run({ params: {} }), [
    ['back', 'goBack', undefined],
    ['forward', 'goForward', undefined],
    ['reload', 'reload', undefined],
    ['copy-page-link', 'copyText', APP_PAGE],
    ['open-page-in-browser', 'openInBrowser', APP_PAGE],
    ['inspect-element', 'inspect', { x: 10, y: 20 }],
  ]);
});

test('Copy Address and Copy Number copy the decoded address without control or bidirectional characters', () => {
  const copied = (linkURL) =>
    build({ params: { linkURL }, context: { isPackaged: true } })
      .filter((item) => item.id === 'copy-address' || item.id === 'copy-number')
      .map((item) => item.arg);
  assert.deepEqual(copied('mailto:a@b.c%0D%0Abcc:x@evil'), ['a@b.cbcc:x@evil']);
  assert.deepEqual(copied('mailto:%E2%80%AEmoc.live@a'), ['moc.live@a']);
  assert.deepEqual(copied('mailto:%E2%81%A6a@b.c%E2%81%A9%C2%85'), ['a@b.c']);
  assert.deepEqual(copied('tel:+44%00123'), ['+44123']);
  assert.deepEqual(copied('mailto:?to=x@y'), []);
  assert.deepEqual(copied('mailto:%20%0A'), []);
  assert.deepEqual(copied('mailto:a@b.c?subject=x'), ['a@b.c']);
});

test('buildTemplate treats a non-string selectionText as no selection', () => {
  for (const selectionText of [null, undefined, 42, {}]) {
    assert.deepEqual(summary(build({ params: { selectionText }, context: { isPackaged: true, pageUrl: OUTSIDE_PAGE } })).map(({ id }) => id), [
      'back', 'forward', 'reload',
    ]);
  }
});

test('edit items use native roles', () => {
  const roles = build({ params: { isEditable: true, editFlags: ALL_FLAGS }, context: { isPackaged: true } }).map((item) => item.role);
  assert.deepEqual(roles, ['undo', 'redo', undefined, 'cut', 'copy', 'paste', 'pasteAndMatchStyle', 'selectAll']);
});

test('pageLink returns the URL of an app page only', () => {
  assert.equal(pageLink(APP_PAGE, BASE), APP_PAGE);
  assert.equal(pageLink('https://app.hubspot.com/login', BASE), null);
  assert.equal(pageLink(OUTSIDE_PAGE, BASE), null);
  assert.equal(pageLink('', BASE), null);
  assert.equal(pageLink(undefined, BASE), null);
});
