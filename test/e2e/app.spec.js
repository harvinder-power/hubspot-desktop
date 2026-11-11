const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const fixtureServer = require('../fixture/server');

const repoRoot = path.join(__dirname, '..', '..');
const evidenceDir = process.env.EVIDENCE_DIR || path.join(repoRoot, 'test-results', 'evidence');

let fixture;
let userData;
let app;
let window;

test.beforeAll(async () => {
  fixture = await fixtureServer.start(0, { portalId: '4242' });
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
