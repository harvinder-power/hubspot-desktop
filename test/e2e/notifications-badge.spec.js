const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const fixtureServer = require('../fixture/server');
const { launchApp, repoRoot, startAt } = require('./helpers');

let fixture;
let idp;
let app;
let dir;
let window;

const dashboardUrl = () => `${fixture.url}/reports-dashboard/4242`;
const titleUrl = (count) => `${fixture.url}/title/${count}`;

// Every app.setBadgeCount call is recorded. CI measured app.getBadgeCount() equal to the set count on all three OSes.
const badgeCalls = () => app.evaluate(() => globalThis.badgeCalls);
const lastBadge = async () => (await badgeCalls()).at(-1) ?? 0;
const appBadge = () => app.evaluate(({ app: electronApp }) => electronApp.getBadgeCount());

async function expectBadge(count) {
  await expect.poll(lastBadge).toBe(count);
  expect(await appBadge()).toBe(count);
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

// Electron binds the web Badging API for every frame and worker with no origin check, and it sets the dock badge.
async function badgeApi(page) {
  return page.evaluate(async () => {
    const worker = new Worker(URL.createObjectURL(new Blob(['postMessage([typeof navigator.setAppBadge, typeof navigator.clearAppBadge])'])));
    const inWorker = await new Promise((resolve) => { worker.onmessage = (event) => resolve(event.data); });
    worker.terminate();
    return { set: typeof navigator.setAppBadge, clear: typeof navigator.clearAppBadge, worker: inWorker };
  });
}

const titles = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.webContents.getTitle()));

// A page call goes to the main process over a separate channel, so the title fence orders it only on a best-effort basis.
async function callAndFence(page, call, fence) {
  const result = await page.evaluate(async ({ call: name, fence: title }) => {
    const outcome = typeof navigator[name] === 'function'
      ? await (name === 'setAppBadge' ? navigator.setAppBadge(42) : navigator.clearAppBadge()).then(() => 'resolved', (error) => `rejected ${error}`)
      : 'absent';
    document.title = title;
    return outcome;
  }, { call, fence });
  await expect.poll(titles).toContain(fence);
  return result;
}

test('no page can set the badge through the web Badging API', async () => {
  // Known hole: neither --disable-blink-features=Badging nor any other switch removes the API in Electron 45.3.
  test.fail(true, 'Electron binds BadgeService for every frame with no origin check; see the PR 14 follow-up');
  await startAt(app, window, titleUrl(3));
  await expectBadge(3);
  const [child] = await Promise.all([app.waitForEvent('window'), window.evaluate((url) => { window.open(url); }, `${fixture.url}/login`)]);
  try {
    await child.waitForURL(`${fixture.url}/login`);
    await child.evaluate(() => document.querySelector('#idp-link').click());
    await child.waitForURL((url) => url.origin === idp.url);
    const measured = { platform: process.platform, app: await badgeApi(window), outside: await badgeApi(child) };
    measured.outsideSet = await callAndFence(child, 'setAppBadge', 'after set');
    measured.afterOutsideSet = await appBadge();
    measured.outsideClear = await callAndFence(child, 'clearAppBadge', 'after clear');
    measured.afterOutsideClear = await appBadge();
    console.log(`Badging API: ${JSON.stringify(measured)}`);
    const absent = { set: 'undefined', clear: 'undefined', worker: ['undefined', 'undefined'] };
    expect(measured.outside).toEqual(absent);
    expect(measured.app).toEqual(absent);
    expect([measured.afterOutsideSet, measured.afterOutsideClear]).toEqual([3, 3]);
  } finally {
    await child.close();
  }
});

async function openCountWindow(count) {
  await startAt(app, window, dashboardUrl());
  const [child] = await Promise.all([app.waitForEvent('window'), window.evaluate((url) => { window.open(url); }, titleUrl(count))]);
  await child.waitForURL(titleUrl(count));
  await expectBadge(count);
  return child;
}

// Runs fn(webContents) in the main process for the window that has committed `url`.
const onWindowAt = (url, fn) => app.evaluate(({ BrowserWindow }, { url: target, body }) => {
  const contents = BrowserWindow.getAllWindows().map((w) => w.webContents).find((c) => c.getURL() === target);
  return new Function('contents', body)(contents);
}, { url, body: `(${fn})(contents)` });

test('a window whose next load fails drops its count', async () => {
  const child = await openCountWindow(3);
  // Nothing listens on port 1, so the load fails and the window commits an error page with no did-navigate.
  await onWindowAt(titleUrl(3), (contents) => { contents.loadURL('http://127.0.0.1:1/').catch(() => {}); });
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.webContents.getURL()))).toContain('http://127.0.0.1:1/');
  await expectBadge(0);
  await child.close();
});

test('a window whose renderer exits drops its count', async () => {
  // A window.open child shares its opener's renderer, so the crash runs in an app of its own.
  const own = await launchApp(fixture.url);
  try {
    const page = await own.electronApp.firstWindow();
    await page.waitForURL(dashboardUrl());
    await page.goto(titleUrl(4));
    const count = () => own.electronApp.evaluate(({ app: electronApp }) => electronApp.getBadgeCount());
    await expect.poll(count).toBe(4);
    await own.electronApp.evaluate(({ BrowserWindow }, url) => {
      BrowserWindow.getAllWindows().find((w) => w.webContents.getURL() === url).webContents.forcefullyCrashRenderer();
    }, titleUrl(4));
    await expect.poll(count).toBe(0);
  } finally {
    await own.electronApp.close();
    fs.rmSync(own.dir, { recursive: true, force: true });
  }
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
    // The denied permission is the proof: Chromium shows a page notification itself, and only once the
    // origin holds the permission. It is checked before any constructor call, so no run can show one.
    expect(await page.evaluate(() => Notification.permission)).toBe('denied');
    const event = await page.evaluate(() => new Promise((resolve) => {
      const notification = new Notification('Test', { body: 'x' });
      notification.onshow = () => resolve('show');
      notification.onerror = () => resolve('error');
    }));
    expect(event).toBe('error');
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
