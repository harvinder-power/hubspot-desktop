const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const fixtureServer = require('../fixture/server');
const helpers = require('./helpers');

const { evidenceDir, launchApp } = helpers;

let fixture;
let idp;
let third;
let chain;
let userData;
let app;
let window;

const dashboardUrl = () => `${fixture.url}/reports-dashboard/4242`;
const loginUrl = () => `${fixture.url}/login`;
const idpUrl = () => `${idp.url}/idp/authorize?return_to=${encodeURIComponent(dashboardUrl())}`;
const thirdUrl = () => `${third.url}/third-step`;
const chainUrl = () => `${chain.url}/idp/authorize?return_to=${encodeURIComponent(dashboardUrl())}`;
const DASHBOARD_STATE = () => ({ href: dashboardUrl(), title: '/reports-dashboard/4242' });
const LOCKED_TITLE = '127.0.0.1 (external page)';

function screenshot(page, name) {
  fs.mkdirSync(evidenceDir, { recursive: true });
  return page.screenshot({ path: path.join(evidenceDir, name) });
}

const resetExternal = () => app.evaluate(() => { globalThis.openedExternally = []; });
const openedExternally = () => app.evaluate(() => globalThis.openedExternally);

const startAt = (page, url) => helpers.startAt(app, page, url);

// Clicks through page.evaluate: Playwright's own click waits forever for a navigation the app cancels.
function clickLink(page, selectorOrUrl) {
  return page.evaluate((target) => {
    const link = target.startsWith('#')
      ? document.querySelector(target)
      : document.body.appendChild(Object.assign(document.createElement('a'), { href: target }));
    link.click();
  }, selectorOrUrl);
}

async function clickAndCollectExternal(page, selectorOrUrl) {
  await resetExternal();
  await clickLink(page, selectorOrUrl);
  await expect.poll(() => app.evaluate(() => globalThis.openedExternally.length)).toBeGreaterThan(0);
  return openedExternally();
}

const pageState = (page) => page.evaluate(() => ({ href: location.href, title: document.title }));

// The native title bar is not in a page screenshot, so read it from the BrowserWindow.
async function windowTitle(page, electronApp = app) {
  const href = await page.evaluate(() => location.href);
  return electronApp.evaluate(
    ({ BrowserWindow }, url) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL() === url)?.getTitle(),
    href
  );
}

async function signInToProvider() {
  await startAt(window, loginUrl());
  await clickLink(window, '#idp-link');
  await window.waitForURL(idpUrl());
}

test.beforeAll(async () => {
  idp = await fixtureServer.start(0);
  third = await fixtureServer.start(0);
  chain = await fixtureServer.start(0);
  fixture = await fixtureServer.start(0, { portalId: '4242', idpOrigin: idp.url, chainOrigin: chain.url });
  ({ electronApp: app, dir: userData } = await launchApp(fixture.url));
  window = await app.firstWindow();
  await window.waitForURL(`${fixture.url}/reports-dashboard/4242`);
});

test.afterAll(async () => {
  await app?.close();
  await fixture?.close();
  await idp?.close();
  await third?.close();
  await chain?.close();
  if (userData) fs.rmSync(userData, { recursive: true, force: true });
});

test('loads the fixture dashboard with a matching title', async () => {
  await expect(window).toHaveTitle('/reports-dashboard/4242');
  await expect(window.locator('h1')).toHaveText('/reports-dashboard/4242');
  fs.mkdirSync(evidenceDir, { recursive: true });
  await window.screenshot({ path: path.join(evidenceDir, 'dashboard.png') });
});

test('uses the temporary user-data directory', async () => {
  const actual = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'));
  expect(fs.realpathSync(actual)).toBe(fs.realpathSync(userData));
});

test('external link opens externally and the app window stays on the fixture', async () => {
  await startAt(window, dashboardUrl());
  expect(await clickAndCollectExternal(window, '#external-link')).toEqual(['https://example.com/']);
  expect(await pageState(window)).toEqual(DASHBOARD_STATE());
});

test('contact link navigates inside the app window', async () => {
  await startAt(window, dashboardUrl());
  await clickLink(window, '#contact-link');
  await window.waitForURL(`${fixture.url}/contacts/4242/record/0-1/101`);
  await expect(window.locator('h1')).toHaveText('/contacts/4242/record/0-1/101');
  expect(await openedExternally()).toEqual([]);
  await screenshot(window, 'contact-link-in-app.png');
});

test('target=_blank link opens a second app window that keeps the link policy', async () => {
  await startAt(window, dashboardUrl());
  const [popup] = await Promise.all([app.waitForEvent('window'), window.click('#blank-link')]);
  const listUrl = `${fixture.url}/contacts/4242/objects/0-1/views/all/list`;
  await popup.waitForURL(listUrl);
  await expect(popup.locator('h1')).toHaveText('/contacts/4242/objects/0-1/views/all/list');
  await screenshot(popup, 'blank-link-second-window.png');

  const windows = await app.evaluate(({ app: electronApp, BrowserWindow }) => {
    const sandboxed = new Map(electronApp.getAppMetrics().map((m) => [m.pid, m.sandboxed]));
    return BrowserWindow.getAllWindows().map(({ webContents }) => ({
      url: webContents.getURL(),
      storagePath: webContents.session.storagePath,
      sandboxed: sandboxed.get(webContents.getOSProcessId()),
    }));
  });
  const main = windows.find((w) => w.url === dashboardUrl());
  const child = windows.find((w) => w.url === listUrl);
  expect(child).toEqual({ url: listUrl, storagePath: main.storagePath, sandboxed: helpers.sandboxReported ? true : undefined });
  expect(await popup.evaluate(() => ({ api: typeof window.electronAPI, node: typeof require }))).toEqual({
    api: 'object',
    node: 'undefined',
  });

  expect(await clickAndCollectExternal(popup, '#external-link')).toEqual(['https://example.com/']);
  expect(await pageState(popup)).toEqual({ href: listUrl, title: '/contacts/4242/objects/0-1/views/all/list' });
  await popup.close();
});

test('sign-in round trip: the provider stays in the window and the title names its host', async () => {
  await signInToProvider();
  await expect(window.locator('h1')).toHaveText('Identity provider');
  await expect.poll(() => windowTitle(window)).toBe(LOCKED_TITLE);
  console.log(`2a BrowserWindow.getTitle() on the provider page: ${JSON.stringify(await windowTitle(window))}`);
  expect(await window.evaluate(() => Notification.requestPermission())).toBe('denied');
  await screenshot(window, '2a-sign-in-provider.png');

  await clickLink(window, '#return-link');
  await window.waitForURL(dashboardUrl());
  await expect(window.locator('h1')).toHaveText('/reports-dashboard/4242');
  await expect.poll(() => windowTitle(window)).toBe('/reports-dashboard/4242');
  console.log(`2a BrowserWindow.getTitle() after return: ${JSON.stringify(await windowTitle(window))}`);
  expect(await openedExternally()).toEqual([]);
});

test('after sign-in, the provider URL clicked from the dashboard opens externally', async () => {
  await signInToProvider();
  await clickLink(window, '#return-link');
  await window.waitForURL(dashboardUrl());
  expect(await clickAndCollectExternal(window, idpUrl())).toEqual([idpUrl()]);
  expect(await pageState(window)).toEqual(DASHBOARD_STATE());
  await screenshot(window, 'identity-provider-from-dashboard.png');
});

test('a server redirect to another origin goes through the same policy', async () => {
  await startAt(window, dashboardUrl());
  expect(await clickAndCollectExternal(window, `${fixture.url}/redirect-out`)).toEqual([idpUrl()]);
  expect(await pageState(window)).toEqual(DASHBOARD_STATE());
  await screenshot(window, '2c-redirect-from-dashboard.png');

  await startAt(window, loginUrl());
  await clickLink(window, `${fixture.url}/redirect-out`);
  await window.waitForURL(idpUrl());
  await expect.poll(() => windowTitle(window)).toBe(LOCKED_TITLE);
  expect(await openedExternally()).toEqual([]);
  await screenshot(window, '2c-redirect-from-login.png');
});

test('a chain of providers stays in the window during sign-in and not after', async () => {
  await signInToProvider();
  await clickLink(window, thirdUrl());
  await window.waitForURL(thirdUrl());
  await expect.poll(() => windowTitle(window)).toBe(LOCKED_TITLE);
  expect(await openedExternally()).toEqual([]);
  await screenshot(window, '2d-chain-third-origin.png');

  await clickLink(window, dashboardUrl());
  await window.waitForURL(dashboardUrl());
  expect(await clickAndCollectExternal(window, thirdUrl())).toEqual([thirdUrl()]);
  expect(await pageState(window)).toEqual(DASHBOARD_STATE());
  await screenshot(window, '2d-third-origin-from-dashboard.png');
});

// The provider page starts a navigation that never commits, then sets its own title.
async function expectTitleStaysLocked(label, attack) {
  await signInToProvider();
  await expect.poll(() => windowTitle(window)).toBe(LOCKED_TITLE);
  await window.evaluate(attack, { dashboard: dashboardUrl(), noContent: `${fixture.url}/no-content`, slow: `${fixture.url}/slow` });
  await expect.poll(() => window.evaluate(() => document.title)).toBe('HubSpot');
  await window.waitForTimeout(500);
  const title = await windowTitle(window);
  console.log(`2b ${label} BrowserWindow.getTitle(): ${JSON.stringify(title)}`);
  expect(await window.evaluate(() => location.href)).toBe(idpUrl());
  expect(title).toBe(LOCKED_TITLE);
  expect(await openedExternally()).toEqual([]);
}

test('a stopped navigation to the app does not unlock the provider title', async () => {
  await expectTitleStaysLocked('window.stop', ({ dashboard }) => {
    location.href = dashboard;
    window.stop();
    document.title = 'HubSpot';
  });
  await screenshot(window, '2b-stopped-navigation.png');
});

test('a navigation to the app stopped in flight does not unlock the provider title', async () => {
  await expectTitleStaysLocked('window.stop in flight', ({ slow }) => {
    location.href = slow;
    setTimeout(() => {
      window.stop();
      document.title = 'HubSpot';
    }, 300);
  });
});

test('a 204 answer from the app does not unlock the provider title', async () => {
  await expectTitleStaysLocked('204', ({ noContent }) => {
    location.href = noContent;
    setTimeout(() => { document.title = 'HubSpot'; }, 300);
  });
  await screenshot(window, '2b-no-content.png');
});

test('Back to the provider page shows the locked title and the page cannot change it', async () => {
  await signInToProvider();
  await clickLink(window, '#return-link');
  await window.waitForURL(dashboardUrl());
  await expect.poll(() => windowTitle(window)).toBe('/reports-dashboard/4242');

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.navigationHistory.goBack());
  await window.waitForURL(idpUrl());
  await expect.poll(() => windowTitle(window)).toBe(LOCKED_TITLE);
  console.log(`2c BrowserWindow.getTitle() after Back: ${JSON.stringify(await windowTitle(window))}`);
  await window.evaluate(() => { document.title = 'HubSpot'; });
  await expect.poll(() => window.evaluate(() => document.title)).toBe('HubSpot');
  await window.waitForTimeout(500);
  const title = await windowTitle(window);
  console.log(`2c BrowserWindow.getTitle() after document.title = 'HubSpot': ${JSON.stringify(title)}`);
  expect(title).toBe(LOCKED_TITLE);
  await screenshot(window, '2c-back-to-provider.png');
});

test('a provider may pass through an app endpoint to a second provider', async () => {
  await signInToProvider();
  await clickLink(window, `${fixture.url}/chain-out`);
  await window.waitForURL(chainUrl());
  await expect(window.locator('h1')).toHaveText('Identity provider');
  await expect.poll(() => windowTitle(window)).toBe(LOCKED_TITLE);
  expect(await openedExternally()).toEqual([]);
  await screenshot(window, '2d-chain-through-app.png');
});

test('a first load that redirects to a provider stays in the window', async () => {
  const idpFirst = await fixtureServer.start(0, { portalId: '4242', idpOrigin: idp.url, rootToIdp: true });
  const { electronApp, dir } = await launchApp(idpFirst.url);
  try {
    const page = await electronApp.firstWindow();
    const providerUrl = `${idp.url}/idp/authorize?return_to=${encodeURIComponent(`${idpFirst.url}/reports-dashboard/4242`)}`;
    await page.waitForURL(providerUrl);
    await expect(page.locator('h1')).toHaveText('Identity provider');
    await expect.poll(() => windowTitle(page, electronApp)).toBe(LOCKED_TITLE);
    expect(await electronApp.evaluate(() => globalThis.openedExternally)).toEqual([]);
    await screenshot(page, '2e-first-load-provider.png');
  } finally {
    await electronApp.close();
    await idpFirst.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('preload IPC works from the app origin only', async () => {
  // Recorders run after the app's own listeners, so a recorded message has already been handled.
  await app.evaluate(({ ipcMain, Notification }) => {
    globalThis.ipcSeen = [];
    globalThis.notificationsShown = [];
    // The OS notification service is replaced too: on Linux isSupported() is false without libnotify.
    Notification.isSupported = () => true;
    Notification.prototype.show = function show() {
      globalThis.notificationsShown.push(this.title);
    };
    ipcMain.on('show-notification', (event, { title }) => globalThis.ipcSeen.push(title));
    ipcMain.on('set-unread-count', (event, count) => globalThis.ipcSeen.push(count));
  });
  // The unread count is shown as a dock badge, and app.dock exists on macOS only (src/main/dock.js).
  const isMac = process.platform === 'darwin';
  const badge = () => app.evaluate(({ app: electronApp }) => electronApp.dock.getBadge());
  const send = (page, title, count) =>
    page.evaluate(([t, c]) => {
      window.electronAPI.showNotification(t, 'y');
      window.electronAPI.setUnreadCount(c);
    }, [title, count]);

  await signInToProvider();
  if (isMac) expect(await badge()).toBe('');
  await send(window, 'from-provider', 5);
  await expect.poll(() => app.evaluate(() => globalThis.ipcSeen)).toEqual(expect.arrayContaining(['from-provider', 5]));
  expect(await app.evaluate(() => globalThis.notificationsShown)).toEqual([]);
  if (isMac) expect(await badge()).toBe('');

  await clickLink(window, '#return-link');
  await window.waitForURL(dashboardUrl());
  await send(window, 'from-app', 7);
  await expect.poll(() => app.evaluate(() => globalThis.notificationsShown)).toEqual(['from-app']);
  if (isMac) {
    await expect.poll(badge).toBe('7');
    await window.evaluate(() => window.electronAPI.setUnreadCount(0));
    await expect.poll(badge).toBe('');
  }
});

test('a sign-in popup opens a second app window with the locked title', async () => {
  await startAt(window, loginUrl());
  const [popup] = await Promise.all([
    app.waitForEvent('window'),
    window.evaluate((url) => { window.open(url); }, idpUrl()),
  ]);
  await popup.waitForURL(idpUrl());
  await expect(popup.locator('h1')).toHaveText('Identity provider');
  await expect.poll(() => windowTitle(popup)).toBe(LOCKED_TITLE);
  expect(await openedExternally()).toEqual([]);
  await screenshot(popup, '2f-sign-in-popup.png');
  await popup.close();
});

test('a popup from a provider page opens externally', async () => {
  await signInToProvider();
  await window.evaluate((url) => { window.open(url); }, thirdUrl());
  await expect.poll(openedExternally).toEqual([thirdUrl()]);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
});

// Window ids follow creation order, so the newest window is the popup.
const newestWindow = () =>
  app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().sort((a, b) => b.id - a.id)[0];
    return { url: win.webContents.getURL(), title: win.getTitle() };
  });
const windowCount = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);

test('a popup from an app page to an app URL that redirects out stays in the popup', async () => {
  await startAt(window, dashboardUrl());
  const [popup] = await Promise.all([
    app.waitForEvent('window'),
    window.evaluate((url) => { window.open(url); }, `${fixture.url}/redirect-out`),
  ]);
  await popup.waitForURL(idpUrl());
  await expect.poll(newestWindow).toEqual({ url: idpUrl(), title: LOCKED_TITLE });
  expect(await openedExternally()).toEqual([]);

  await clickLink(popup, thirdUrl());
  await popup.waitForURL(thirdUrl());
  await clickLink(popup, dashboardUrl());
  await popup.waitForURL(dashboardUrl());
  await expect.poll(newestWindow).toEqual({ url: dashboardUrl(), title: '/reports-dashboard/4242' });
  expect(await openedExternally()).toEqual([]);
  await popup.close();
});

for (const blank of ['', 'about:blank']) {
  test(`a blank popup (${JSON.stringify(blank)}) the app sends outside opens externally and closes`, async () => {
    await startAt(window, dashboardUrl());
    await window.evaluate(([url, target]) => { window.open(url).location = target; }, [blank, idpUrl()]);
    await expect.poll(openedExternally).toEqual([idpUrl()]);
    await expect.poll(windowCount).toBe(1);
  });
}

test('a blank popup the app wrote into stays open when one of its links goes outside', async () => {
  await startAt(window, dashboardUrl());
  const [popup] = await Promise.all([
    app.waitForEvent('window'),
    window.evaluate(() => {
      const child = window.open('');
      child.document.write('<h1>Report</h1><a id="out" href="https://example.com/">Source</a>');
      child.document.close();
    }),
  ]);
  await popup.evaluate(() => document.querySelector('#out').click());
  await expect.poll(openedExternally).toEqual(['https://example.com/']);
  await popup.waitForTimeout(1000);
  expect(await windowCount()).toBe(2);
  expect(await popup.evaluate(() => document.querySelector('h1').textContent)).toBe('Report');
  await popup.close();
});

test('a blank popup the app writes keeps its own title', async () => {
  await startAt(window, dashboardUrl());
  const [popup] = await Promise.all([
    app.waitForEvent('window'),
    window.evaluate(() => {
      const child = window.open('');
      child.document.write('<title>Print preview</title><h1>Print preview</h1>');
      child.document.close();
    }),
  ]);
  await expect.poll(newestWindow).toEqual({ url: 'about:blank', title: 'Print preview' });
  expect(await openedExternally()).toEqual([]);
  await popup.close();
});

test('the locked title follows the outside host from 127.0.0.1 to localhost', async () => {
  const localhostUrl = `http://localhost:${new URL(third.url).port}/third-step`;
  await signInToProvider();
  await expect.poll(() => windowTitle(window)).toBe(LOCKED_TITLE);
  await clickLink(window, localhostUrl);
  await window.waitForURL(localhostUrl);
  await expect.poll(() => windowTitle(window)).toBe('localhost (external page)');
  expect(await openedExternally()).toEqual([]);
});

test('the app origin is granted notification permission', async () => {
  await startAt(window, dashboardUrl());
  expect(await window.evaluate(() => Notification.requestPermission())).toBe('granted');
  expect(await window.evaluate(() => Notification.permission)).toBe('granted');
  await screenshot(window, 'app-origin-notification-granted.png');
});
