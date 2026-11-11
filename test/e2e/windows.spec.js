const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const fixtureServer = require('../fixture/server');
const { evidenceDir, quiet, launchApp, startAt } = require('./helpers');

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
    // A window that is closing can still be listed for a moment after its contents are destroyed.
    return BrowserWindow.getAllWindows()
      .filter((w) => !w.isDestroyed() && !w.webContents.isDestroyed())
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

// Visible runs focus the window for real: the app must be frontmost, so steal it, then wait for focus.
// Quiet runs never focus. They send the window's focus event, which is what the registry records,
// and check that no window holds OS focus, so the registry falls back to that record.
async function focusWindow(index) {
  const id = await app.evaluate(({ app: electronApp, BrowserWindow }, [i, isQuiet]) => {
    const win = BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[i];
    if (isQuiet) {
      win.emit('focus');
    } else {
      electronApp.focus({ steal: true });
      win.focus();
    }
    return win.id;
  }, [index, quiet]);
  const focused = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.id ?? null);
  await expect.poll(focused).toBe(quiet ? null : id);
}

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

test('File > New Tab opens a second registry window on the dashboard with the shared tab identifier', async () => {
  await newTab();
  const windows = await windowInfo();
  console.log(`3a after New Tab: ${JSON.stringify(windows.map(({ url, tabbingIdentifier }) => ({ url, tabbingIdentifier })))}`);
  expect(windows.map((w) => w.url)).toEqual([dashboardUrl(), dashboardUrl()]);
  if (isMac) expect(windows.map((w) => w.tabbingIdentifier)).toEqual(['hubspot-desktop', 'hubspot-desktop']);
});

test('on macOS New Tab joins the native tab group and New Window does not', async () => {
  test.skip(quiet || !isMac, 'needs visible macOS windows; runs in CI');
  // The minimum window size fits the CI screen (1024 wide), so macOS does not move the frame.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 40, y: 60, width: 800, height: 600 }));
  await newTab();
  const [page] = await Promise.all([app.waitForEvent('window'), clickMenu('File', 'New Window')]);
  await page.waitForURL(dashboardUrl());
  await expect.poll(async () => (await windowInfo()).map((w) => w.visible)).toEqual([true, true, true]);
  const windows = await windowInfo();
  console.log(`3a after New Tab then New Window: ${JSON.stringify(windows.map(({ tabbingIdentifier, bounds, visible }) => ({ tabbingIdentifier, bounds, visible })))}`);
  // A tab takes the frame of its group. A separate window keeps its own default frame.
  expect(windows[1].bounds).toEqual(windows[0].bounds);
  expect(windows[2].bounds).not.toEqual(windows[0].bounds);
  fs.mkdirSync(evidenceDir, { recursive: true });
  await page.screenshot({ path: path.join(evidenceDir, 'new-window.png') });
});

// DIAGNOSTIC: logs candidate tab-membership signals in CI. Removed once a signal is chosen.
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const probe = path.join(os.tmpdir(), 'hubspot-desktop-cg-windows');
const settle = () => new Promise((resolve) => setTimeout(resolve, 1000));
async function snapshot(label) {
  const electronSide = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .sort((a, b) => a.id - b.id)
      .map((w) => ({
        id: w.id,
        cg: Number(w.getMediaSourceId().split(':')[1]),
        visible: w.isVisible(),
        focused: w.isFocused(),
        bounds: w.getBounds(),
        content: w.getContentBounds(),
      }))
  );
  const cg = JSON.parse(execFileSync(probe, [String(app.process().pid)], { encoding: 'utf8' }));
  const rows = electronSide.map((w) => {
    const native = cg.find((c) => c.number === w.cg);
    return { ...w, onScreen: native?.onScreen ?? null, layer: native?.layer ?? null, cgBounds: native?.bounds ?? null, name: native?.name };
  });
  console.log(`DIAG ${label}: ${JSON.stringify(rows)}`);
  console.log(`DIAG ${label} cg-all: ${JSON.stringify(cg.filter((c) => c.layer === 0))}`);
}
const selectNextTab = (index) => app.evaluate(({ BrowserWindow }, i) => BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[i].selectNextTab(), index);

test.describe('DIAG tab signals', () => {
  test.skip(quiet || !isMac, 'diagnostic needs visible macOS windows');
  test.beforeAll(() => {
    execFileSync('swiftc', ['-O', '-o', probe, path.join(__dirname, 'tools', 'cg-windows.swift')], { stdio: 'inherit' });
  });
  for (const run of [1, 2, 3]) {
    test(`DIAG A New Tab as built run ${run}`, async () => {
      await newTab();
      await expect.poll(async () => (await windowInfo()).length).toBe(2);
      await settle();
      await snapshot(`A${run} after New Tab`);
      await selectNextTab(0);
      await settle();
      await snapshot(`A${run} after host.selectNextTab`);
      await selectNextTab(0);
      await settle();
      await snapshot(`A${run} after second host.selectNextTab`);
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[1].moveTabToNewWindow());
      await settle();
      await snapshot(`A${run} after tab.moveTabToNewWindow`);
    });
    test(`DIAG B addTabbedWindow after show run ${run}`, async () => {
      await Promise.all([app.waitForEvent('window'), clickMenu('File', 'New Window')]);
      await expect.poll(async () => (await windowInfo()).map((w) => w.visible)).toEqual([true, true]);
      await settle();
      await snapshot(`B${run} separate before addTabbedWindow`);
      await app.evaluate(({ BrowserWindow }) => {
        const [host, win] = BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id);
        host.addTabbedWindow(win);
      });
      await settle();
      await snapshot(`B${run} after addTabbedWindow`);
      await selectNextTab(0);
      await settle();
      await snapshot(`B${run} after host.selectNextTab`);
    });
    test(`DIAG C New Window run ${run}`, async () => {
      await Promise.all([app.waitForEvent('window'), clickMenu('File', 'New Window')]);
      await expect.poll(async () => (await windowInfo()).map((w) => w.visible)).toEqual([true, true]);
      await settle();
      await snapshot(`C${run} after New Window`);
      await selectNextTab(0);
      await settle();
      await snapshot(`C${run} after host.selectNextTab`);
    });
  }
});

test('File > New Window opens a second window, and Cmd+T and Cmd+N belong to New Tab and New Window only', async () => {
  const [page] = await Promise.all([app.waitForEvent('window'), clickMenu('File', 'New Window')]);
  await page.waitForURL(dashboardUrl());
  expect(await windowInfo()).toHaveLength(2);

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
  test.skip(quiet, 'needs a visible window; runs in CI');
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

test('quiet mode shows no window and creates no tray or global shortcut', async () => {
  const { electronApp, dir } = await launchApp(fixture.url, { quiet: true });
  try {
    await (await electronApp.firstWindow()).waitForURL(dashboardUrl());
    const state = await electronApp.evaluate(({ BrowserWindow, globalShortcut }) => ({
      windows: BrowserWindow.getAllWindows().length,
      noneVisible: BrowserWindow.getAllWindows().every((w) => !w.isVisible()),
      // main.js requires tray.js only when it creates the tray.
      trayLoaded: Object.keys(process.mainModule.constructor._cache).some((file) => file.endsWith('tray.js')),
      shortcut: globalShortcut.isRegistered('CommandOrControl+Shift+H'),
    }));
    console.log(`quiet launch: ${JSON.stringify(state)}`);
    expect(state).toEqual({ windows: 1, noneVisible: true, trayLoaded: false, shortcut: false });
  } finally {
    await electronApp.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
