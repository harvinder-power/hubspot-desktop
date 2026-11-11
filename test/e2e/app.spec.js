const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const fixtureServer = require('../fixture/server');

const repoRoot = path.join(__dirname, '..', '..');
const evidenceDir = process.env.EVIDENCE_DIR || path.join(repoRoot, 'test-results', 'evidence');

let fixture;
let idp;
let userData;
let app;
let window;

const dashboardUrl = () => `${fixture.url}/reports-dashboard/4242`;
const idpUrl = () => `${idp.url}/idp/authorize?return_to=${encodeURIComponent(dashboardUrl())}`;

function screenshot(page, name) {
  fs.mkdirSync(evidenceDir, { recursive: true });
  return page.screenshot({ path: path.join(evidenceDir, name) });
}

// Clicks through page.evaluate: Playwright's own click waits forever for a navigation the app cancels.
async function clickAndCollectExternal(page, selectorOrUrl) {
  await app.evaluate(() => { globalThis.openedExternally = []; });
  await page.evaluate((target) => {
    const link = target.startsWith('#')
      ? document.querySelector(target)
      : document.body.appendChild(Object.assign(document.createElement('a'), { href: target }));
    link.click();
  }, selectorOrUrl);
  await expect.poll(() => app.evaluate(() => globalThis.openedExternally.length)).toBeGreaterThan(0);
  return app.evaluate(() => globalThis.openedExternally);
}

const pageState = (page) => page.evaluate(() => ({ href: location.href, title: document.title }));

test.beforeAll(async () => {
  idp = await fixtureServer.start(0);
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
  // The app cancels this navigation, so Playwright's click would wait for it forever.
  await window.evaluate(() => document.querySelector('#external-link').click());
  await expect
    .poll(() => app.evaluate(() => globalThis.openedExternally))
    .toContain('https://example.com/');
  // Playwright still tracks the cancelled navigation, so read the page state directly.
  const state = await window.evaluate(() => ({ href: location.href, title: document.title }));
  expect(state).toEqual({ href: `${fixture.url}/reports-dashboard/4242`, title: '/reports-dashboard/4242' });
});

test('contact link navigates inside the app window', async () => {
  // Playwright still tracks the navigation the previous test cancelled, so click through evaluate.
  await window.evaluate(() => document.querySelector('#contact-link').click());
  await window.waitForURL(`${fixture.url}/contacts/4242/record/0-1/101`);
  await expect(window.locator('h1')).toHaveText('/contacts/4242/record/0-1/101');
  await screenshot(window, 'contact-link-in-app.png');
  await window.goto(dashboardUrl());
});

test('target=_blank link opens a second app window that keeps the link policy', async () => {
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

test('sign-in through an identity provider on another origin stays in the app window', async () => {
  await window.goto(`${fixture.url}/login`);
  await window.evaluate(() => document.querySelector('#idp-link').click());
  await window.waitForURL(idpUrl());
  await expect(window.locator('h1')).toHaveText('Identity provider');
  expect(await window.evaluate(() => Notification.requestPermission())).toBe('denied');
  await screenshot(window, 'sign-in-identity-provider.png');

  await window.evaluate(() => document.querySelector('#return-link').click());
  await window.waitForURL(dashboardUrl());
  await expect(window.locator('h1')).toHaveText('/reports-dashboard/4242');
});

test('the identity provider URL clicked from the dashboard opens externally', async () => {
  expect(await clickAndCollectExternal(window, idpUrl())).toEqual([idpUrl()]);
  expect(await pageState(window)).toEqual({ href: dashboardUrl(), title: '/reports-dashboard/4242' });
  await screenshot(window, 'identity-provider-from-dashboard.png');
});

test('the app origin is granted notification permission', async () => {
  expect(await window.evaluate(() => Notification.requestPermission())).toBe('granted');
  expect(await window.evaluate(() => Notification.permission)).toBe('granted');
  await screenshot(window, 'app-origin-notification-granted.png');
});
