const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const fixtureServer = require('../fixture/server');
const { launchApp, startAt } = require('./helpers');

let fixture;
let idp;
let app;
let userData;
let window;

const dashboardUrl = () => `${fixture.url}/reports-dashboard/4242`;
const contactUrl = () => `${fixture.url}/contacts/4242/record/0-1/101`;
const idpUrl = () => `${idp.url}/idp/authorize?return_to=${encodeURIComponent(dashboardUrl())}`;

// Replaces Menu.prototype.popup before any right-click, so no real menu can open.
// Menu.buildFromTemplate still builds the menu, and records each template it is given.
const stubMenus = () =>
  app.evaluate(({ Menu }) => {
    globalThis.templates = [];
    globalThis.popups = [];
    const build = Menu.buildFromTemplate.bind(Menu);
    Menu.buildFromTemplate = (template) => {
      globalThis.templates.push(template);
      return build(template);
    };
    Menu.prototype.popup = function stubPopup(options) {
      globalThis.popups.push({ hasWindow: Boolean(options?.window) });
    };
  });

// Replaces the methods on the clipboard object that the app code holds, so no test touches the real clipboard.
const stubClipboard = () =>
  app.evaluate(({ clipboard }) => {
    globalThis.copied = [];
    globalThis.clipboardReads = 0;
    clipboard.writeText = (text) => {
      globalThis.copied.push(text);
    };
    clipboard.readText = () => {
      globalThis.clipboardReads += 1;
      return '';
    };
  });

const copied = () => app.evaluate(() => globalThis.copied);

// Right-clicks with a real mouse event and returns the labels of the template the app built for it.
async function rightClick(selector) {
  const before = await app.evaluate(() => globalThis.templates.length);
  await window.click(selector, { button: 'right' });
  await expect.poll(() => app.evaluate(() => globalThis.templates.length)).toBe(before + 1);
  return app.evaluate(() => globalThis.templates.at(-1).map((item) => item.label ?? item.type));
}

// Some platforms select the link text on right-click and add the selection's Copy item, others do not.
const PLATFORM_ITEMS = ['Copy'];

// The menu has exactly `expected` in order, plus at most the platform items and separators.
function expectItems(labels, expected) {
  expect(labels.filter((label) => label !== 'separator' && !PLATFORM_ITEMS.includes(label))).toEqual(expected);
}

// Calls the click function of an item in the last template; the menu itself is never shown.
const choose = (label) =>
  app.evaluate((electron, itemLabel) => globalThis.templates.at(-1).find((item) => item.label === itemLabel).click(), label);

const clickMenu = (menuLabel, itemLabel) =>
  app.evaluate(({ Menu }, [menu, item]) => {
    Menu.getApplicationMenu()
      .items.find((entry) => entry.label === menu)
      .submenu.items.find((entry) => entry.label === item)
      .click();
  }, [menuLabel, itemLabel]);

// Quiet runs never take OS focus, so tests set the window that BrowserWindow.getFocusedWindow returns.
const setFocusedUrl = (url) =>
  app.evaluate(({ BrowserWindow }, focusedUrl) => {
    BrowserWindow.getFocusedWindow = () => (focusedUrl === null ? null : { webContents: { getURL: () => focusedUrl } });
  }, url);

const LINK_IN_APP = ['Open Link in New Tab', 'Open Link in Browser', 'Copy Link', 'Inspect Element'];
const PAGE_ITEMS = ['Back', 'Forward', 'Reload', 'Copy Page Link', 'Open Page in Browser', 'Inspect Element'];

test.beforeAll(async () => {
  idp = await fixtureServer.start(0);
  fixture = await fixtureServer.start(0, { portalId: '4242', idpOrigin: idp.url });
});

test.afterAll(async () => {
  await fixture?.close();
  await idp?.close();
});

test.beforeEach(async () => {
  ({ electronApp: app, dir: userData } = await launchApp(fixture.url));
  await stubClipboard();
  window = await app.firstWindow();
  await window.waitForURL(dashboardUrl());
  await stubMenus();
});

test.afterEach(async () => {
  if (app) expect(await app.evaluate(() => globalThis.clipboardReads)).toBe(0);
  await app?.close();
  if (userData) fs.rmSync(userData, { recursive: true, force: true });
});

test('a right-click on an app link builds the link menu through the stubbed popup, and Copy Link copies it', async () => {
  await startAt(app, window, dashboardUrl());
  expectItems(await rightClick('#contact-link'), LINK_IN_APP);
  expect(await app.evaluate(() => globalThis.popups)).toEqual([{ hasWindow: true }]);

  await choose('Copy Link');
  expect(await copied()).toEqual([contactUrl()]);
});

test('Open Link in Browser on an outside link sends the URL to the stubbed shell.openExternal', async () => {
  await startAt(app, window, dashboardUrl());
  expectItems(await rightClick('#external-link'), ['Open Link in Browser', 'Copy Link', 'Inspect Element']);

  await choose('Open Link in Browser');
  await expect.poll(() => app.evaluate(() => globalThis.openedExternally)).toEqual(['https://example.com/']);
});

test('Open Link in New Tab on an app link opens a second registry window on that URL', async () => {
  await startAt(app, window, dashboardUrl());
  expectItems(await rightClick('#contact-link'), LINK_IN_APP);

  await choose('Open Link in New Tab');
  const urls = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id).map((w) => w.webContents.getURL())
    );
  await expect.poll(urls).toEqual([dashboardUrl(), contactUrl()]);
  expect(await app.evaluate(() => globalThis.openedExternally)).toEqual([]);
});

test('a menu item clicked after its window is destroyed does nothing and does not throw', async () => {
  await startAt(app, window, dashboardUrl());
  expectItems(await rightClick('#contact-link'), LINK_IN_APP);
  await choose('Open Link in New Tab');
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(2);

  expectItems(await rightClick('h1'), PAGE_ITEMS);
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.staleReload = globalThis.templates.at(-1).find((item) => item.label === 'Reload');
    const [first] = BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id);
    globalThis.staleContents = first.webContents;
    first.destroy();
  });
  await expect.poll(() => app.evaluate(() => globalThis.staleContents.isDestroyed())).toBe(true);
  const result = await app.evaluate(() => {
    try {
      globalThis.staleReload.click();
      return 'no throw';
    } catch (error) {
      return error.message;
    }
  });
  expect(result).toBe('no throw');
});

test('a right-click on a plain app page offers the page items, and File > Copy Page Link copies app pages only', async () => {
  await startAt(app, window, dashboardUrl());
  expectItems(await rightClick('h1'), PAGE_ITEMS);

  await setFocusedUrl(null);
  await clickMenu('File', 'Copy Page Link');
  expect(await copied()).toEqual([dashboardUrl()]);

  await startAt(app, window, `${fixture.url}/login`);
  await window.evaluate(() => document.querySelector('#idp-link').click());
  await window.waitForURL(idpUrl());
  await clickMenu('File', 'Copy Page Link');
  await clickMenu('File', 'Open Page in Browser');
  expect(await copied()).toEqual([dashboardUrl()]);
  expect(await app.evaluate(() => globalThis.openedExternally)).toEqual([]);
});

test('File menu page-link items act on the focused window, not the active app window', async () => {
  await startAt(app, window, dashboardUrl());

  await setFocusedUrl(idpUrl());
  await clickMenu('File', 'Copy Page Link');
  await clickMenu('File', 'Open Page in Browser');
  expect(await copied()).toEqual([]);
  expect(await app.evaluate(() => globalThis.openedExternally)).toEqual([]);

  await setFocusedUrl(contactUrl());
  await clickMenu('File', 'Copy Page Link');
  await clickMenu('File', 'Open Page in Browser');
  expect(await copied()).toEqual([contactUrl()]);
  await expect.poll(() => app.evaluate(() => globalThis.openedExternally)).toEqual([contactUrl()]);
});
