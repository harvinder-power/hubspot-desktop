const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const fixtureServer = require('../fixture/server');

const repoRoot = path.join(__dirname, '..', '..');
const evidenceDir = process.env.EVIDENCE_DIR || path.join(repoRoot, 'test-results', 'evidence');

let fixture;
let idp;
let third;
let userData;
let app;
let window;

const dashboardUrl = () => `${fixture.url}/reports-dashboard/4242`;
const loginUrl = () => `${fixture.url}/login`;
const idpUrl = () => `${idp.url}/idp/authorize?return_to=${encodeURIComponent(dashboardUrl())}`;
const thirdUrl = () => `${third.url}/third-step`;
const DASHBOARD_STATE = () => ({ href: dashboardUrl(), title: '/reports-dashboard/4242' });
const SIGN_IN_TITLE = 'Sign in: 127.0.0.1';

function screenshot(page, name) {
  fs.mkdirSync(evidenceDir, { recursive: true });
  return page.screenshot({ path: path.join(evidenceDir, name) });
}

const resetExternal = () => app.evaluate(() => { globalThis.openedExternally = []; });
const openedExternally = () => app.evaluate(() => globalThis.openedExternally);

// Every test starts from an explicit page with an empty openedExternally list.
async function startAt(page, url) {
  await page.goto(url);
  await resetExternal();
}

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
async function windowTitle(page) {
  const href = await page.evaluate(() => location.href);
  return app.evaluate(
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
  fixture = await fixtureServer.start(0, { portalId: '4242', idpOrigin: idp.url });
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'hubspot-desktop-e2e-'));
  app = await electron.launch({
    args: [repoRoot],
    env: {
      ...process.env,
      HUBSPOT_DESKTOP_BASE_URL: fixture.url,
      HUBSPOT_DESKTOP_USER_DATA: userData,
    },
  });
  await app.evaluate(({ shell }) => {
    globalThis.openedExternally = [];
    shell.openExternal = async (url) => {
      globalThis.openedExternally.push(url);
    };
  });
  window = await app.firstWindow();
  await window.waitForURL(`${fixture.url}/reports-dashboard/4242`);
});

test.afterAll(async () => {
  await app?.close();
  await fixture?.close();
  await idp?.close();
  await third?.close();
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

test('application menu contains the Navigate items', async () => {
  const labels = await app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()
      .items.find((item) => item.label === 'Navigate')
      .submenu.items.filter((item) => item.type !== 'separator')
      .map((item) => item.label)
  );
  expect(labels).toEqual([
    'Dashboard', 'Contacts', 'Companies', 'Deals', 'Tasks', 'Tickets',
    'Inbox', 'Calendar', 'Back', 'Forward',
  ]);
});

test('Navigate menu items stay on the override origin', async () => {
  await startAt(window, dashboardUrl());
  await app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()
      .items.find((item) => item.label === 'Navigate')
      .submenu.items.find((item) => item.label === 'Tasks')
      .click();
  });
  await window.waitForURL(`${fixture.url}/reports-dashboard/4242/tasks`);
  await window.goto(`${fixture.url}/`);
  await window.waitForURL(`${fixture.url}/reports-dashboard/4242`);
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
  expect(child).toEqual({ url: listUrl, storagePath: main.storagePath, sandboxed: true });
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
  await expect.poll(() => windowTitle(window)).toBe(SIGN_IN_TITLE);
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
  await expect.poll(() => windowTitle(window)).toBe(SIGN_IN_TITLE);
  expect(await openedExternally()).toEqual([]);
  await screenshot(window, '2c-redirect-from-login.png');
});

test('a chain of providers stays in the window during sign-in and not after', async () => {
  await signInToProvider();
  await clickLink(window, thirdUrl());
  await window.waitForURL(thirdUrl());
  await expect.poll(() => windowTitle(window)).toBe(SIGN_IN_TITLE);
  expect(await openedExternally()).toEqual([]);
  await screenshot(window, '2d-chain-third-origin.png');

  await clickLink(window, dashboardUrl());
  await window.waitForURL(dashboardUrl());
  expect(await clickAndCollectExternal(window, thirdUrl())).toEqual([thirdUrl()]);
  expect(await pageState(window)).toEqual(DASHBOARD_STATE());
  await screenshot(window, '2d-third-origin-from-dashboard.png');
});

test('preload IPC works from the app origin only', async () => {
  // Recorders run after the app's own listeners, so a recorded message has already been handled.
  await app.evaluate(({ ipcMain, Notification }) => {
    globalThis.ipcSeen = [];
    globalThis.notificationsShown = [];
    Notification.prototype.show = function show() {
      globalThis.notificationsShown.push(this.title);
    };
    ipcMain.on('show-notification', (event, { title }) => globalThis.ipcSeen.push(title));
    ipcMain.on('set-unread-count', (event, count) => globalThis.ipcSeen.push(count));
  });
  const badge = () => app.evaluate(({ app: electronApp }) => electronApp.dock.getBadge());
  const send = (page, title, count) =>
    page.evaluate(([t, c]) => {
      window.electronAPI.showNotification(t, 'y');
      window.electronAPI.setUnreadCount(c);
    }, [title, count]);

  await signInToProvider();
  expect(await badge()).toBe('');
  await send(window, 'from-provider', 5);
  await expect.poll(() => app.evaluate(() => globalThis.ipcSeen)).toEqual(expect.arrayContaining(['from-provider', 5]));
  expect(await app.evaluate(() => globalThis.notificationsShown)).toEqual([]);
  expect(await badge()).toBe('');

  await clickLink(window, '#return-link');
  await window.waitForURL(dashboardUrl());
  await send(window, 'from-app', 7);
  await expect.poll(() => app.evaluate(() => globalThis.notificationsShown)).toEqual(['from-app']);
  await expect.poll(badge).toBe('7');
  await window.evaluate(() => window.electronAPI.setUnreadCount(0));
  await expect.poll(badge).toBe('');
});

test('a sign-in popup opens a second app window in sign-in mode', async () => {
  await startAt(window, loginUrl());
  const [popup] = await Promise.all([
    app.waitForEvent('window'),
    window.evaluate((url) => { window.open(url); }, idpUrl()),
  ]);
  await popup.waitForURL(idpUrl());
  await expect(popup.locator('h1')).toHaveText('Identity provider');
  await expect.poll(() => windowTitle(popup)).toBe(SIGN_IN_TITLE);
  expect(await openedExternally()).toEqual([]);
  await screenshot(popup, '2f-sign-in-popup.png');
  await popup.close();
});

test('the app origin is granted notification permission', async () => {
  await startAt(window, dashboardUrl());
  expect(await window.evaluate(() => Notification.requestPermission())).toBe('granted');
  expect(await window.evaluate(() => Notification.permission)).toBe('granted');
  await screenshot(window, 'app-origin-notification-granted.png');
});
