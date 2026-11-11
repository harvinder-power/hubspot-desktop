const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const fixtureServer = require('../fixture/server');
const { launchApp, startAt } = require('./helpers');

let fixture;
let idp;
let app;
let userData;
let window;
let savedClipboard;

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

const readClipboard = () => app.evaluate(({ clipboard }) => clipboard.readText());
const writeClipboard = (text) => app.evaluate(({ clipboard }, value) => clipboard.writeText(value), text);

// Right-clicks with a real mouse event and returns the labels of the template the app built for it.
async function rightClick(selector) {
  const before = await app.evaluate(() => globalThis.templates.length);
  await window.click(selector, { button: 'right' });
  await expect.poll(() => app.evaluate(() => globalThis.templates.length)).toBe(before + 1);
  return app.evaluate(() => globalThis.templates.at(-1).map((item) => item.label ?? item.type));
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

// On macOS a right-click on a link selects the link text, so the selection's Copy item follows the link items.
const LINK_IN_APP = ['Open Link in New Tab', 'Open Link in Browser', 'Copy Link', 'separator', 'Copy', 'separator', 'Inspect Element'];

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
  window = await app.firstWindow();
  await window.waitForURL(dashboardUrl());
  await stubMenus();
  savedClipboard = await readClipboard();
});

// The clipboard is the user's real clipboard, so each test puts its text back.
test.afterEach(async () => {
  if (app && savedClipboard !== undefined) await writeClipboard(savedClipboard);
  savedClipboard = undefined;
  await app?.close();
  if (userData) fs.rmSync(userData, { recursive: true, force: true });
});

test('a right-click on an app link builds the link menu through the stubbed popup, and Copy Link copies it', async () => {
  await startAt(app, window, dashboardUrl());
  expect(await rightClick('#contact-link')).toEqual(LINK_IN_APP);
  expect(await app.evaluate(() => globalThis.popups)).toEqual([{ hasWindow: true }]);

  await choose('Copy Link');
  expect(await readClipboard()).toBe(contactUrl());
});

test('Open Link in Browser on an outside link sends the URL to the stubbed shell.openExternal', async () => {
  await startAt(app, window, dashboardUrl());
  expect(await rightClick('#external-link')).toEqual([
    'Open Link in Browser', 'Copy Link', 'separator', 'Copy', 'separator', 'Inspect Element',
  ]);

  await choose('Open Link in Browser');
  await expect.poll(() => app.evaluate(() => globalThis.openedExternally)).toEqual(['https://example.com/']);
});

test('Open Link in New Tab on an app link opens a second registry window on that URL', async () => {
  await startAt(app, window, dashboardUrl());
  expect(await rightClick('#contact-link')).toEqual(LINK_IN_APP);

  await choose('Open Link in New Tab');
  const urls = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id).map((w) => w.webContents.getURL())
    );
  await expect.poll(urls).toEqual([dashboardUrl(), contactUrl()]);
  expect(await app.evaluate(() => globalThis.openedExternally)).toEqual([]);
});

test('a right-click on a plain app page offers the page items, and File > Copy Page Link copies app pages only', async () => {
  await startAt(app, window, dashboardUrl());
  expect(await rightClick('h1')).toEqual([
    'Back', 'Forward', 'Reload', 'separator', 'Copy Page Link', 'Open Page in Browser', 'separator', 'Inspect Element',
  ]);

  await writeClipboard('sentinel');
  await clickMenu('File', 'Copy Page Link');
  expect(await readClipboard()).toBe(dashboardUrl());

  await startAt(app, window, `${fixture.url}/login`);
  await window.evaluate(() => document.querySelector('#idp-link').click());
  await window.waitForURL(idpUrl());
  await writeClipboard('sentinel');
  await clickMenu('File', 'Copy Page Link');
  await clickMenu('File', 'Open Page in Browser');
  expect(await readClipboard()).toBe('sentinel');
  expect(await app.evaluate(() => globalThis.openedExternally)).toEqual([]);
});
