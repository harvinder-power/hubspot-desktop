const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const fixtureServer = require('../fixture/server');
const { evidenceDir, launchApp, startAt } = require('./helpers');

const isMac = process.platform === 'darwin';

let fixture;
let app;
let userData;
let first;

const dashboardUrl = () => `${fixture.url}/reports-dashboard/4242`;
const dealsUrl = () => `${fixture.url}/contacts/4242/objects/0-3/views/all/board`;
const contactsUrl = () => `${fixture.url}/contacts/4242/objects/0-1/views/all/list`;
const tasksUrl = () => `${fixture.url}/tasks/4242/view/all`;

const clickMenu = (menuLabel, itemLabel) =>
  app.evaluate(({ Menu }, [menu, item]) => {
    Menu.getApplicationMenu()
      .items.find((entry) => entry.label === menu)
      .submenu.items.find((entry) => entry.label === item)
      .click();
  }, [menuLabel, itemLabel]);

// Window ids follow creation order, so index 0 is the first window.
const windowInfo = () =>
  app.evaluate(({ app: electronApp, BrowserWindow }) => {
    const sandboxed = new Map(electronApp.getAppMetrics().map((m) => [m.pid, m.sandboxed]));
    return BrowserWindow.getAllWindows()
      .sort((a, b) => a.id - b.id)
      .map((w) => ({
        url: w.webContents.getURL(),
        tabbingIdentifier: w.tabbingIdentifier,
        bounds: w.getBounds(),
        visible: w.isVisible(),
        destroyed: w.isDestroyed(),
        storagePath: w.webContents.session.storagePath,
        sandboxed: sandboxed.get(w.webContents.getOSProcessId()),
      }));
  });

const focusWindow = (index) =>
  app.evaluate(({ BrowserWindow }, i) => BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[i].focus(), index);

async function newTab() {
  const [page] = await Promise.all([app.waitForEvent('window'), clickMenu('File', 'New Tab')]);
  await page.waitForURL(dashboardUrl());
  return page;
}

test.beforeAll(async () => {
  fixture = await fixtureServer.start(0, { portalId: '4242' });
});

test.afterAll(async () => {
  await fixture?.close();
});

test.beforeEach(async () => {
  ({ electronApp: app, dir: userData } = await launchApp(fixture.url));
  first = await app.firstWindow();
  await first.waitForURL(dashboardUrl());
});

test.afterEach(async () => {
  await app?.close();
  if (userData) fs.rmSync(userData, { recursive: true, force: true });
});

test('File > New Tab opens a second window in the same native tab group', async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setPosition(40, 60));
  await newTab();
  const windows = await windowInfo();
  console.log(`3a after New Tab: ${JSON.stringify(windows.map(({ url, tabbingIdentifier, bounds, visible }) => ({ url, tabbingIdentifier, bounds, visible })))}`);
  expect(windows.map((w) => w.url)).toEqual([dashboardUrl(), dashboardUrl()]);
  if (isMac) {
    expect(windows.map((w) => w.tabbingIdentifier)).toEqual(['hubspot-desktop', 'hubspot-desktop']);
    // A tab takes the frame of its group. A separate window would open centred.
    expect(windows[1].bounds).toEqual(windows[0].bounds);
  }
  fs.mkdirSync(evidenceDir, { recursive: true });
  await (await app.windows())[1].screenshot({ path: path.join(evidenceDir, 'new-tab.png') });
});

test('File > New Window opens a separate window, and Cmd+N belongs to New Window only', async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setPosition(40, 60));
  const [page] = await Promise.all([app.waitForEvent('window'), clickMenu('File', 'New Window')]);
  await page.waitForURL(dashboardUrl());
  const windows = await windowInfo();
  console.log(`3a after New Window: ${JSON.stringify(windows.map(({ tabbingIdentifier, bounds }) => ({ tabbingIdentifier, bounds })))}`);
  expect(windows).toHaveLength(2);
  if (isMac) expect(windows[1].bounds).not.toEqual(windows[0].bounds);

  const owners = await app.evaluate(({ Menu }) => {
    const walk = (menu) => menu.items.flatMap((item) => [item, ...(item.submenu ? walk(item.submenu) : [])]);
    return walk(Menu.getApplicationMenu())
      .filter((item) => ['CmdOrCtrl+N', 'CmdOrCtrl+T'].includes(item.accelerator))
      .map(({ label, accelerator }) => [label, accelerator]);
  });
  expect(owners).toEqual([['New Tab', 'CmdOrCtrl+T'], ['New Window', 'CmdOrCtrl+N']]);
});

test('the new window has the same session, a sandbox, the preload API and no Node', async () => {
  const tab = await newTab();
  const [main, second] = await windowInfo();
  expect(second).toMatchObject({ storagePath: main.storagePath, sandboxed: true });
  expect(await tab.evaluate(() => ({ api: typeof window.electronAPI, node: typeof require }))).toEqual({
    api: 'object',
    node: 'undefined',
  });
});

test('the link policy applies to the new window', async () => {
  const tab = await newTab();
  await startAt(app, tab, dashboardUrl());
  await tab.evaluate(() => document.querySelector('#external-link').click());
  await expect.poll(() => app.evaluate(() => globalThis.openedExternally)).toEqual(['https://example.com/']);
  expect(await tab.evaluate(() => location.href)).toBe(dashboardUrl());
});

test('Navigate acts on the focused window only', async () => {
  const tab = await newTab();
  await focusWindow(1);
  await clickMenu('Navigate', 'Deals');
  await tab.waitForURL(dealsUrl());
  expect((await windowInfo()).map((w) => w.url)).toEqual([dashboardUrl(), dealsUrl()]);

  await focusWindow(0);
  await clickMenu('Navigate', 'Contacts');
  await first.waitForURL(contactsUrl());
  expect((await windowInfo()).map((w) => w.url)).toEqual([contactsUrl(), dealsUrl()]);
});

test('Back acts on the focused window only', async () => {
  await startAt(app, first, tasksUrl());
  const tab = await newTab();
  await tab.goto(contactsUrl());
  await focusWindow(0);
  await clickMenu('Navigate', 'Back');
  await first.waitForURL(dashboardUrl());
  expect((await windowInfo()).map((w) => w.url)).toEqual([dashboardUrl(), contactsUrl()]);
});

test('closing a tab leaves one window; on macOS the last window hides and Show brings it back', async () => {
  await newTab();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[1].close());
  await expect.poll(async () => (await windowInfo()).map((w) => w.visible)).toEqual([true]);
  if (!isMac) return;

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await expect.poll(async () => (await windowInfo()).map(({ visible, destroyed }) => ({ visible, destroyed }))).toEqual([
    { visible: false, destroyed: false },
  ]);
  // The tray Show item, the dock click and a second launch all call registry.show().
  await app.evaluate(({ app: electronApp }) => electronApp.emit('activate'));
  await expect.poll(async () => (await windowInfo()).map((w) => w.visible)).toEqual([true]);
});

test('New Tab opens the dashboard of the portal learned in the first window', async () => {
  await app.evaluate(({ app: electronApp }) => {
    globalThis.startedUrls = [];
    electronApp.once('browser-window-created', (event, win) => {
      win.webContents.on('did-start-navigation', (details) => {
        if (details.isMainFrame) globalThis.startedUrls.push(details.url);
      });
    });
  });
  await newTab();
  expect(await app.evaluate(() => globalThis.startedUrls)).toEqual([dashboardUrl()]);
});
