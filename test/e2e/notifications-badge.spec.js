const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const fixtureServer = require('../fixture/server');
const { launchApp, repoRoot, startAt } = require('./helpers');

const isMac = process.platform === 'darwin';

let fixture;
let idp;
let app;
let dir;
let window;

const dashboardUrl = () => `${fixture.url}/reports-dashboard/4242`;
const titleUrl = (count) => `${fixture.url}/title/${count}`;

// Every app.setBadgeCount call is recorded on every OS. app.getBadgeCount() reports the dock badge on macOS only:
// on Linux it needs a Unity launcher, which CI lacks, and on Windows Electron has no badge count.
const badgeCalls = () => app.evaluate(() => globalThis.badgeCalls);
const lastBadge = async () => (await badgeCalls()).at(-1) ?? 0;
const dockBadge = () => app.evaluate(({ app: electronApp }) => electronApp.getBadgeCount());

async function expectBadge(count) {
  await expect.poll(lastBadge).toBe(count);
  if (isMac) expect(await dockBadge()).toBe(count);
}

test.beforeAll(async () => {
  idp = await fixtureServer.start(0);
  fixture = await fixtureServer.start(0, { portalId: '4242', idpOrigin: idp.url });
  ({ electronApp: app, dir } = await launchApp(fixture.url));
  window = await app.firstWindow();
  await window.waitForURL(dashboardUrl());
  await app.evaluate(({ app: electronApp }) => {
    globalThis.badgeCalls = [];
    const setBadgeCount = electronApp.setBadgeCount.bind(electronApp);
    electronApp.setBadgeCount = (count) => {
      globalThis.badgeCalls.push(count);
      return setBadgeCount(count);
    };
  });
});

test.afterAll(async () => {
  await app?.close();
  await fixture?.close();
  await idp?.close();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

test('an app page title sets the badge, and navigating away resets it', async () => {
  await startAt(app, window, dashboardUrl());
  await window.evaluate(() => { document.title = '(3) Inbox'; });
  await expectBadge(3);
  const measured = await app.evaluate(({ app: electronApp }) => ({ platform: process.platform, getBadgeCount: electronApp.getBadgeCount() }));
  console.log(`badge after '(3) Inbox': ${JSON.stringify(measured)}`);

  await window.goto(titleUrl(12));
  await expectBadge(12);
  await window.goto(dashboardUrl());
  await expectBadge(0);
});

test('an outside page with a count title leaves the badge unchanged', async () => {
  await startAt(app, window, `${fixture.url}/login`);
  await window.evaluate(() => document.querySelector('#idp-link').click());
  await window.waitForURL((url) => url.origin === idp.url);
  await app.evaluate(() => { globalThis.badgeCalls = []; });
  await window.evaluate(() => { document.title = '(3) Inbox'; });
  // The main process emits page-title-updated as it stores the title, so the badge has been handled once it reads it.
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.webContents.getTitle()))).toContain('(3) Inbox');
  await expectBadge(0);
  expect(await badgeCalls()).not.toContain(3);
});

test('closing a window removes its count from the badge', async () => {
  await startAt(app, window, dashboardUrl());
  const [child] = await Promise.all([app.waitForEvent('window'), window.evaluate((url) => { window.open(url); }, titleUrl(5))]);
  await child.waitForURL(titleUrl(5));
  await expectBadge(5);
  await child.close();
  await expectBadge(0);
});

test('the page keeps Chromium\'s own Notification and the preload exposes no notification or badge function', async () => {
  await startAt(app, window, dashboardUrl());
  const page = await window.evaluate(() => ({
    native: Function.prototype.toString.call(Notification).includes('[native code]'),
    eventTarget: Notification.prototype instanceof EventTarget,
    api: window.electronAPI && Object.keys(window.electronAPI),
  }));
  expect(page).toEqual({ native: true, eventTarget: true, api: [] });
  const listeners = await app.evaluate(({ ipcMain }) => ({
    notification: ipcMain.listenerCount('show-notification'),
    unread: ipcMain.listenerCount('set-unread-count'),
  }));
  expect(listeners).toEqual({ notification: 0, unread: 0 });
});

test('in quiet mode a page notification shows nothing', async () => {
  const quiet = await launchApp(fixture.url, { quiet: true });
  try {
    const page = await quiet.electronApp.firstWindow();
    await page.waitForURL(dashboardUrl());
    await quiet.electronApp.evaluate(({ Notification }) => {
      globalThis.notificationsShown = 0;
      // On Linux isSupported() is false without libnotify, so the stub makes every OS take the same path.
      Notification.isSupported = () => true;
      Notification.prototype.show = () => { globalThis.notificationsShown += 1; };
    });
    // The permission check comes first, so no run reaches the constructor while the permission is granted.
    expect(await page.evaluate(() => Notification.permission)).toBe('denied');
    const event = await page.evaluate(() => new Promise((resolve) => {
      const notification = new Notification('Test', { body: 'x' });
      notification.onshow = () => resolve('show');
      notification.onerror = () => resolve('error');
    }));
    expect(event).toBe('error');
    expect(await quiet.electronApp.evaluate(() => globalThis.notificationsShown)).toBe(0);
  } finally {
    await quiet.electronApp.close();
    fs.rmSync(quiet.dir, { recursive: true, force: true });
  }
});

test('a tray click shows the app through the registry and never hides it', async () => {
  // The tray does not exist in quiet mode, so the tray module runs here with a stand-in Tray class.
  const result = await app.evaluate((electron, trayPath) => {
    const TrayManager = process.mainModule.require(trayPath);
    const handlers = {};
    class FakeTray {
      on(name, handler) { handlers[name] = handler; }
      setToolTip() {}
      setContextMenu() {}
      destroy() {}
    }
    const calls = [];
    const visibleWindow = { isVisible: () => true, hide: () => calls.push('hide') };
    const registry = { active: () => visibleWindow, show: () => calls.push('show') };
    new TrayManager(registry, () => {}, { Tray: FakeTray });
    handlers.click();
    return calls;
  }, path.join(repoRoot, 'src', 'main', 'tray.js'));
  expect(result).toEqual(['show']);
});
