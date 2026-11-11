const { test, expect } = require('@playwright/test');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const electronPath = require('electron');
const fixtureServer = require('../fixture/server');
const { evidenceDir, quiet, repoRoot, launchApp, startAt } = require('./helpers');

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
// In CI a first request for a background tab sometimes did not take, so each poll asks again.
// Quiet runs never focus. They send the window's focus event, which is what the registry records,
// and check that no window holds OS focus, so the registry falls back to that record.
async function focusWindow(index) {
  const request = () =>
    app.evaluate(({ app: electronApp, BrowserWindow }, [i, isQuiet]) => {
      const win = BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[i];
      if (isQuiet) {
        win.emit('focus');
      } else {
        electronApp.focus({ steal: true });
        win.focus();
      }
      return win.id;
    }, [index, quiet]);
  const id = await request();
  const focused = async () => {
    await request();
    return app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.id ?? null);
  };
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

// macOS orders the background tabs of a native tab group out, and Electron still reports them visible.
// So the tab signal is the Core Graphics on-screen flag of each window, read by a native probe.
// In each group exactly one window is on screen. A separate window is always on screen.
test.describe('native tab groups (CI only)', () => {
  test.skip(quiet || !isMac, 'needs visible macOS windows; runs in CI');

  const probe = path.join(os.tmpdir(), 'hubspot-desktop-cg-windows');
  test.beforeAll(() => {
    execFileSync('swiftc', ['-O', '-o', probe, path.join(__dirname, 'tools', 'cg-windows.swift')], { stdio: 'inherit' });
  });

  // The on-screen flag of each app window, in creation order.
  async function onScreen() {
    const ids = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .sort((a, b) => a.id - b.id)
        .map((w) => Number(w.getMediaSourceId().split(':')[1]))
    );
    const native = JSON.parse(execFileSync(probe, [String(app.process().pid)], { encoding: 'utf8' }));
    return ids.map((id) => native.find((w) => w.number === id)?.onScreen ?? null);
  }

  for (const run of [1, 2, 3]) {
    test(`on macOS New Tab joins the native tab group and New Window does not (run ${run})`, async () => {
      await newTab();
      const [page] = await Promise.all([app.waitForEvent('window'), clickMenu('File', 'New Window')]);
      await page.waitForURL(dashboardUrl());
      await expect.poll(async () => (await windowInfo()).map((w) => w.visible)).toEqual([true, true, true]);
      // Host and tab share one group, so only the front tab is on screen. New Window stays on screen.
      await expect.poll(onScreen).toEqual([false, true, true]);
      console.log(`tab group run ${run}: onScreen ${JSON.stringify(await onScreen())}`);
      if (run === 1) {
        fs.mkdirSync(evidenceDir, { recursive: true });
        await page.screenshot({ path: path.join(evidenceDir, 'new-window.png') });
      }
    });
  }

  test('with the last window hidden, New Tab shows it and joins it, and closing the tab leaves one window', async () => {
    // A window closed before ready-to-show is shown again by it, so wait until it is shown.
    await expect.poll(async () => (await windowInfo()).map((w) => w.visible)).toEqual([true]);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await expect.poll(async () => (await windowInfo()).map((w) => w.visible)).toEqual([false]);
    await newTab();
    await expect.poll(async () => (await windowInfo()).map((w) => w.visible)).toEqual([true, true]);
    await expect.poll(onScreen).toEqual([false, true]);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[1].close());
    await expect.poll(async () => (await windowInfo()).map((w) => w.visible)).toEqual([true]);
    await expect.poll(onScreen).toEqual([true]);
  });
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

test('quiet mode shows no window or dock icon and creates no tray or global shortcut', async () => {
  const { electronApp, dir } = await launchApp(fixture.url, { quiet: true });
  try {
    const page = await electronApp.firstWindow();
    await page.waitForURL(dashboardUrl());
    const [child] = await Promise.all([
      electronApp.waitForEvent('window'),
      page.evaluate((url) => { window.open(url); }, contactsUrl()),
    ]);
    await child.waitForURL(contactsUrl());
    const state = await electronApp.evaluate(({ app: electronApp, BrowserWindow, globalShortcut }) => {
      // Windows module paths use backslashes.
      const loaded = (name) => Object.keys(process.mainModule.constructor._cache)
        .some((file) => file.replaceAll('\\', '/').endsWith(`/src/main/${name}`));
      return {
        windows: BrowserWindow.getAllWindows().length,
        noneVisible: BrowserWindow.getAllWindows().every((w) => !w.isVisible()),
        // main.js requires tray.js only when it creates the tray. windows.js is the positive control in the same cache.
        windowsLoaded: loaded('windows.js'),
        trayLoaded: loaded('tray.js'),
        dockVisible: process.platform === 'darwin' ? electronApp.dock.isVisible() : false,
        shortcut: globalShortcut.isRegistered('CommandOrControl+Shift+H'),
      };
    });
    console.log(`quiet launch: ${JSON.stringify(state)}`);
    expect(state).toEqual({ windows: 2, noneVisible: true, windowsLoaded: true, trayLoaded: false, dockVisible: false, shortcut: false });
  } finally {
    await electronApp.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('on macOS closing the last window keeps it, and app.quit() still quits', async () => {
  test.skip(!isMac, 'the last window hides on macOS only');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  expect((await windowInfo()).map((w) => w.url)).toEqual([dashboardUrl()]);
  const exited = new Promise((resolve) => app.process().once('exit', (code, signal) => resolve({ code, signal })));
  await app.evaluate(({ app: electronApp }) => { setTimeout(() => electronApp.quit(), 0); });
  expect(await exited).toEqual({ code: 0, signal: null });
  app = null;
});

test('a second launch with the same user data exits, and the first instance answers it', async () => {
  test.skip(!isMac, 'with no window left the app quits off macOS');
  // destroy() skips the close handler, so the registry is empty and its show() must open a window.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].destroy());
  await expect.poll(async () => (await windowInfo()).length).toBe(0);
  const second = spawn(electronPath, [repoRoot], {
    env: {
      ...process.env,
      HUBSPOT_DESKTOP_BASE_URL: fixture.url,
      HUBSPOT_DESKTOP_USER_DATA: userData,
      HUBSPOT_DESKTOP_QUIET: quiet ? '1' : '0',
    },
    stdio: 'ignore',
  });
  const [page, code] = await Promise.all([app.waitForEvent('window'), new Promise((resolve) => second.once('exit', resolve))]);
  await page.waitForURL(dashboardUrl());
  expect(code).toBe(0);
  expect((await windowInfo()).map((w) => w.url)).toEqual([dashboardUrl()]);
});

test('the native + tab button opens a second registry window on Dashboards', async () => {
  const [page] = await Promise.all([
    app.waitForEvent('window'),
    app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].emit('new-window-for-tab'); }),
  ]);
  await page.waitForURL(dashboardUrl());
  expect((await windowInfo()).map((w) => w.url)).toEqual([dashboardUrl(), dashboardUrl()]);
});
