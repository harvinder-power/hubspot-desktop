const { test, expect } = require('@playwright/test');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const electronPath = require('electron');
const fixtureServer = require('../fixture/server');
const { evidenceDir, quiet, repoRoot, sandboxReported, launchApp, startAt } = require('./helpers');

const isMac = process.platform === 'darwin';

let fixture;
let idp;
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
        title: w.getTitle(),
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

// A target=_blank child of the first window, on the contacts list.
async function blankLinkChild() {
  const [child] = await Promise.all([app.waitForEvent('window'), first.evaluate(() => document.querySelector('#blank-link').click())]);
  await child.waitForURL(contactsUrl());
  return child;
}

// A sign-in popup from the app's /login page to the identity provider.
async function signInPopup() {
  await startAt(app, first, `${fixture.url}/login`);
  const idpUrl = `${idp.url}/idp/authorize`;
  const [popup] = await Promise.all([app.waitForEvent('window'), first.evaluate((url) => { window.open(url); }, idpUrl)]);
  await popup.waitForURL(idpUrl);
  return popup;
}

const idpUrl = () => `${idp.url}/idp/authorize`;
const LOCKED_TITLE = '127.0.0.1 (external page)';

// The registry asks BrowserWindow.getFocusedWindow() for the focused window, so this stands in for OS focus.
const pretendFocused = (index) =>
  app.evaluate(({ BrowserWindow }, i) => {
    const win = BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[i];
    BrowserWindow.getFocusedWindow = () => win;
  }, index);

// main.js listens for the native + button on registry windows only, so a window opens only for those.
const plusOpensWindow = async (index) => {
  const before = (await windowInfo()).length;
  await app.evaluate(({ BrowserWindow }, i) => { BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[i].emit('new-window-for-tab'); }, index);
  await first.waitForTimeout(500);
  return (await windowInfo()).length > before;
};

// A target=_blank child of the first window, opened to the app sign-in page.
async function signInChild() {
  const loginUrl = `${fixture.url}/login`;
  const [child] = await Promise.all([
    app.waitForEvent('window'),
    first.evaluate((url) => {
      const link = Object.assign(document.createElement('a'), { href: url, target: '_blank' });
      document.body.append(link);
      link.click();
    }, loginUrl),
  ]);
  await child.waitForURL(loginUrl);
  return child;
}

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

  test('a target=_blank child of an app page joins its opener tab group', async () => {
    await blankLinkChild();
    await expect.poll(async () => (await windowInfo()).map((w) => w.visible)).toEqual([true, true]);
    await expect.poll(onScreen).toEqual([false, true]);
  });

  test('a sign-in popup to an outside origin stays a separate window', async () => {
    await signInPopup();
    await expect.poll(async () => (await windowInfo()).map((w) => w.visible)).toEqual([true, true]);
    await expect.poll(onScreen).toEqual([true, true]);
  });

  test('New Tab with a sign-in popup focused joins the app window, not the popup', async () => {
    await signInPopup();
    await startAt(app, first, dashboardUrl());
    await expect.poll(async () => (await windowInfo()).map((w) => w.visible)).toEqual([true, true]);
    await pretendFocused(1);
    await newTab();
    await expect.poll(async () => (await windowInfo()).map((w) => w.visible)).toEqual([true, true, true]);
    // The app window and the new tab share a group with the tab in front. The popup stays on screen.
    await expect.poll(onScreen).toEqual([false, true, true]);
  });

  test('a tabbed child that navigates to an outside page leaves the tab group', async () => {
    const child = await blankLinkChild();
    await expect.poll(onScreen).toEqual([false, true]);
    await child.goto(`${fixture.url}/login`);
    await child.evaluate(() => document.querySelector('#idp-link').click());
    await child.waitForURL(/\/idp\/authorize/);
    await expect.poll(onScreen).toEqual([true, true]);
  });

  test('a sign-in popup that reaches an app page never hosts its target=_blank child', async () => {
    await startAt(app, first, `${fixture.url}/login`);
    const url = `${idpUrl()}?return_to=${encodeURIComponent(dashboardUrl())}`;
    const [popup] = await Promise.all([app.waitForEvent('window'), first.evaluate((u) => { window.open(u); }, url)]);
    await popup.waitForURL(url);
    await popup.evaluate(() => document.querySelector('#return-link').click());
    await popup.waitForURL(dashboardUrl());
    const [child] = await Promise.all([app.waitForEvent('window'), popup.evaluate(() => document.querySelector('#blank-link').click())]);
    await child.waitForURL(contactsUrl());
    await expect.poll(async () => (await windowInfo()).map((w) => w.visible)).toEqual([true, true, true]);
    await expect.poll(onScreen).toEqual([true, true, true]);
    await popup.goto(`${fixture.url}/login`);
    await expect.poll(onScreen).toEqual([true, true, true]);
    await popup.evaluate(() => document.querySelector('#idp-link').click());
    await popup.waitForURL(/\/idp\/authorize/);
    await expect.poll(onScreen).toEqual([true, true, true]);
  });

  test('a tabbed window on /login that fails to load an unreachable host leaves the tab group', async () => {
    const tab = await newTab();
    await expect.poll(onScreen).toEqual([false, true]);
    await tab.goto(`${fixture.url}/login`);
    await expect.poll(onScreen).toEqual([false, true]);
    // Nothing listens on port 1, so the load fails and the window commits an error page.
    await tab.evaluate(() => { location.href = 'http://127.0.0.1:1/'; });
    await expect.poll(async () => (await windowInfo())[1].url).toBe('http://127.0.0.1:1/');
    await expect.poll(onScreen).toEqual([true, true]);
  });

  // By default macOS tabs a new window into the group of a full-screen window ("Prefer tabs: in full screen").
  // Tab membership survives leaving full screen, so the windows are read after every window leaves it.
  async function enterFullScreen(index) {
    await app.evaluate(({ BrowserWindow }, i) => BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[i].setFullScreen(true), index);
    const full = () => app.evaluate(({ BrowserWindow }, i) => BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[i].isFullScreen(), index);
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (await full()) return true;
      await first.waitForTimeout(250);
    }
    return false;
  }
  async function leaveFullScreen() {
    await app.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) if (w.isFullScreen()) w.setFullScreen(false);
    });
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.isFullScreen())), { timeout: 15_000 }).toBe(false);
    await first.waitForTimeout(1000);
  }

  for (const scenario of ['opener on an outside page', 'child redirected outside before show']) {
    test(`in full screen an app child is not grouped with an outside page (${scenario})`, async () => {
      const outsideOpener = scenario === 'opener on an outside page';
      if (outsideOpener) {
        await startAt(app, first, `${fixture.url}/login`);
        await first.evaluate(() => document.querySelector('#idp-link').click());
        await first.waitForURL(/\/idp\/authorize/);
      }
      const entered = await enterFullScreen(0);
      console.log(`full screen (${scenario}): entered ${entered}`);
      test.skip(!entered, 'INCONCLUSIVE: the runner did not enter full screen');
      const childUrl = outsideOpener ? dashboardUrl() : `${fixture.url}/redirect-out`;
      const [child] = await Promise.all([app.waitForEvent('window'), first.evaluate((u) => { window.open(u); }, childUrl)]);
      await child.waitForURL(outsideOpener ? dashboardUrl() : /\/idp\/authorize/);
      await expect.poll(async () => (await windowInfo()).map((w) => w.visible)).toEqual([true, true]);
      await first.waitForTimeout(1000);
      console.log(`full screen (${scenario}): onScreen in full screen ${JSON.stringify(await onScreen())}`);
      await leaveFullScreen();
      console.log(`full screen (${scenario}): onScreen after full screen ${JSON.stringify(await onScreen())}`);
      await expect.poll(onScreen).toEqual([true, true]);
    });
  }

  test('Back to an outside history entry in a tabbed window leaves the tab group', async () => {
    await startAt(app, first, `${fixture.url}/login`);
    await first.evaluate(() => document.querySelector('#idp-link').click());
    await first.waitForURL(/\/idp\/authorize/);
    await first.evaluate(() => document.querySelector('#return-link').click());
    await first.waitForURL(dashboardUrl());
    await newTab();
    await expect.poll(onScreen).toEqual([false, true]);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0].webContents.navigationHistory.goBack());
    await first.waitForURL(/\/idp\/authorize/);
    await expect.poll(onScreen).toEqual([true, true]);
  });

  const visibility = async () => (await windowInfo()).map((w) => w.visible);
  const release = () => fetch(`${idp.url}/release`);

  // The first window opens a provider popup that the fixture holds, so the popup shows only on release.
  async function heldPopupFromProvider() {
    await startAt(app, first, `${fixture.url}/login`);
    await first.evaluate((url) => { window.open(url); }, `${idp.url}/hold`);
    await expect.poll(async () => (await windowInfo()).length).toBe(2);
    await first.evaluate(() => document.querySelector('#idp-link').click());
    await first.waitForURL(/\/idp\/authorize/);
  }

  test('a hidden last window on the provider page stays hidden when an outside popup shows', async () => {
    try {
      await heldPopupFromProvider();
      await expect.poll(async () => (await visibility())[0]).toBe(true);
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0].close());
      console.log(`hidden last window: before release ${JSON.stringify(await visibility())}`);
    } finally {
      await release();
    }
    await expect.poll(visibility).toEqual([false, true]);
    await first.waitForTimeout(1000);
    console.log(`hidden last window: after the popup shows ${JSON.stringify(await visibility())}`);
    expect(await visibility()).toEqual([false, true]);
  });

  test('a lone full-screen window on the provider page stays full screen when an outside popup shows', async () => {
    let entered = false;
    try {
      await heldPopupFromProvider();
      entered = await enterFullScreen(0);
      console.log(`lone full screen: entered ${entered}`);
    } finally {
      await release();
    }
    test.skip(!entered, 'INCONCLUSIVE: the runner did not enter full screen');
    await expect.poll(visibility).toEqual([true, true]);
    await first.waitForTimeout(1000);
    const full = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0].isFullScreen());
    console.log(`lone full screen: after the popup shows isFullScreen ${full}, onScreen ${JSON.stringify(await onScreen())}`);
    expect(full).toBe(true);
    await leaveFullScreen();
  });

  test('Window > Merge All Windows groups the app windows and leaves out a window on an outside page', async () => {
    for (let i = 0; i < 2; i += 1) {
      const [page] = await Promise.all([app.waitForEvent('window'), clickMenu('File', 'New Window')]);
      await page.waitForURL(dashboardUrl());
      if (i === 1) await toProvider(page);
    }
    await expect.poll(visibility).toEqual([true, true, true]);
    await expect.poll(onScreen).toEqual([true, true, true]);
    await clickMenu('Window', 'Merge All Windows');
    const grouping = async () => {
      const [a, b, outside] = await onScreen();
      return { appWindowsGrouped: a !== b, outsideOnScreen: outside };
    };
    await expect.poll(grouping).toEqual({ appWindowsGrouped: true, outsideOnScreen: true });
    console.log(`merge all windows: onScreen ${JSON.stringify(await onScreen())}`);
  });
});

test('a sign-in popup is not a registry window: no tab identifier, no + button, locked title', async () => {
  await signInPopup();
  const [, popup] = await windowInfo();
  expect(popup).toMatchObject({ url: idpUrl(), title: LOCKED_TITLE });
  if (isMac) expect(popup.tabbingIdentifier || null).toBeNull();
  expect(await plusOpensWindow(1)).toBe(false);
  expect(await plusOpensWindow(0)).toBe(true);
});

test('with a sign-in popup focused, New Tab and a route open in app windows and the popup keeps its page', async () => {
  await signInPopup();
  await pretendFocused(1);
  // /login cleared the portal, so Deals opens the app root, which goes to the dashboard.
  await clickMenu('Navigate', 'Deals');
  await first.waitForURL(dashboardUrl());
  await newTab();
  expect((await windowInfo()).map((w) => w.url)).toEqual([dashboardUrl(), idpUrl(), dashboardUrl()]);
});

test('closing the app window and then the sign-in popup destroys the popup, and activate shows the app window', async () => {
  test.skip(!isMac, 'the last window hides on macOS only');
  await signInPopup();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0].close());
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[1].close());
  await expect.poll(async () => (await windowInfo()).map((w) => w.url)).toEqual([`${fixture.url}/login`]);
  await app.evaluate(({ app: electronApp }) => electronApp.emit('activate'));
  await expect.poll(async () => (await windowInfo()).map(({ url, visible }) => ({ url, visible }))).toEqual([
    { url: `${fixture.url}/login`, visible: !quiet },
  ]);
});

test('a target=_blank child on /login that goes to the identity provider stays a registry window with a locked title', async () => {
  const child = await signInChild();
  await child.evaluate(() => document.querySelector('#idp-link').click());
  await child.waitForURL(/\/idp\/authorize/);
  await expect.poll(async () => (await windowInfo())[1].title).toBe(LOCKED_TITLE);
  expect(await plusOpensWindow(1)).toBe(true);
});

// Observed: will-navigate does not fire for about:blank, so the provider page can commit it.
// The title stays locked on that blank page, in an outside popup and in an app window.
for (const where of ['outside popup', 'app window']) {
  test(`an outside page that commits about:blank keeps a locked title (${where})`, async () => {
    let page;
    if (where === 'outside popup') {
      page = await signInPopup();
    } else {
      page = first;
      await startAt(app, first, `${fixture.url}/login`);
      await first.evaluate(() => document.querySelector('#idp-link').click());
      await first.waitForURL(/\/idp\/authorize/);
    }
    const index = where === 'outside popup' ? 1 : 0;
    await page.evaluate(() => { location.href = 'about:blank'; });
    await expect.poll(async () => (await windowInfo())[index].url).toBe('about:blank');
    await page.evaluate(() => { document.title = 'HubSpot'; });
    await page.waitForTimeout(500);
    expect((await windowInfo())[index].title).toBe('about: (external page)');
  });
}

// location.replace leaves [/login, about:blank]: the entry before the blank page is an app page.
test('an outside page in an app window that replaces itself with about:blank keeps a locked title', async () => {
  await startAt(app, first, `${fixture.url}/login`);
  await first.evaluate(() => document.querySelector('#idp-link').click());
  await first.waitForURL(/\/idp\/authorize/);
  await first.evaluate(() => { location.replace('about:blank'); });
  await expect.poll(async () => (await windowInfo())[0].url).toBe('about:blank');
  await first.evaluate(() => { document.title = 'HubSpot'; });
  await first.waitForTimeout(500);
  expect((await windowInfo())[0].title).toBe('about: (external page)');
});

// URL, main-frame origin and title of the window at `index`, logged so a CI run records them.
async function documentState(label, index) {
  const state = await app.evaluate(({ BrowserWindow }, i) => {
    const w = BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[i];
    return { url: w.webContents.getURL(), origin: w.webContents.mainFrame.origin, title: w.getTitle() };
  }, index);
  console.log(`${label}: ${JSON.stringify(state)}`);
  return state;
}

async function toProvider(page) {
  await startAt(app, page, `${fixture.url}/login`);
  await page.evaluate(() => document.querySelector('#idp-link').click());
  await page.waitForURL(/\/idp\/authorize/);
}

// document.open() on the child's initial empty document cancels its pending navigation to the app.
test('an app child that an outside page writes into before it commits keeps a locked title', async () => {
  await toProvider(first);
  // The child never commits a page, so Playwright reports no new page for it. Count windows instead.
  const written = await first.evaluate((url) => {
    try {
      const w = window.open(url);
      w.document.write('<title>HubSpot</title><p>x');
      w.document.close();
      return 'written';
    } catch (error) {
      return String(error);
    }
  }, dashboardUrl());
  console.log(`outside-written app child: ${written}`);
  await expect.poll(async () => (await windowInfo()).length).toBe(2);
  await first.waitForTimeout(1500);
  const state = await documentState('outside-written app child', 1);
  expect(state.url).not.toBe(dashboardUrl());
  expect(state.origin).toBe(idp.url);
  expect(state.title).toBe('unknown (external page)');
});

// The app opens a named blank child. Its opener goes to the provider, which reaches the child by name
// and replaces its first document with a blank page of the provider's origin.
test('a named blank child the app opened keeps a locked title once the provider replaces its page', async () => {
  const [child] = await Promise.all([
    app.waitForEvent('window'),
    first.evaluate(() => {
      const w = window.open('', 'report');
      w.document.write('<title>Report</title><h1>Report</h1>');
      w.document.close();
    }),
  ]);
  await expect.poll(async () => (await documentState('app-written named child', 1)).title).toBe('Report');
  expect((await documentState('app-written named child', 1)).origin).toBe(fixture.url);
  await toProvider(first);
  await first.evaluate(() => {
    globalThis.reached = window.open('', 'report');
    globalThis.reached.location.replace('about:blank');
  });
  await expect.poll(async () => (await documentState('provider-replaced named child', 1)).origin).toBe(idp.url);
  await first.evaluate(() => { globalThis.reached.document.title = 'HubSpot'; });
  await child.waitForTimeout(500);
  const state = await documentState('provider-titled named child', 1);
  expect(state).toEqual({ url: 'about:blank', origin: idp.url, title: 'about: (external page)' });
  expect(await windowInfo()).toHaveLength(2);
});

test('a target=_blank child on /login does not clear the portal for the other windows', async () => {
  await signInChild();
  await pretendFocused(0);
  await clickMenu('Navigate', 'Deals');
  await first.waitForURL(dealsUrl(), { timeout: 10_000 });
});

test('a window that page opened is a registry window: menus, the + button and the portal tracker cover it', async () => {
  const child = await blankLinkChild();
  const otherPortal = `${fixture.url}/contacts/5555/objects/0-1/views/all/list`;
  await child.goto(otherPortal);
  await focusWindow(1);
  await clickMenu('Navigate', 'Deals');
  await child.waitForURL(`${fixture.url}/contacts/5555/objects/0-3/views/all/board`);
  await clickMenu('Navigate', 'Back');
  await child.waitForURL(otherPortal);
  expect((await windowInfo()).map((w) => w.url)).toEqual([dashboardUrl(), otherPortal]);

  const [tab] = await Promise.all([
    app.waitForEvent('window'),
    app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[1].emit('new-window-for-tab'); }),
  ]);
  await tab.waitForURL(`${fixture.url}/reports-dashboard/5555`);
  expect((await windowInfo()).map((w) => w.url)).toEqual([dashboardUrl(), otherPortal, `${fixture.url}/reports-dashboard/5555`]);
});

test('a child closed before ready-to-show is not shown and leaves the registry', async () => {
  const [child] = await Promise.all([app.waitForEvent('window'), first.evaluate((url) => { window.open(url); }, `${fixture.url}/slow`)]);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[1].close());
  await expect.poll(() => child.isClosed()).toBe(true);
  await first.waitForTimeout(2500);
  expect((await windowInfo()).map(({ url, visible }) => ({ url, visible }))).toEqual([{ url: dashboardUrl(), visible: !quiet }]);
  // Navigate acts on the first window, so the closed child is not the active registry window.
  await clickMenu('Navigate', 'Deals');
  await first.waitForURL(dealsUrl());
});

test('the last window closed before ready-to-show stays hidden', async () => {
  test.skip(quiet || !isMac, 'needs visible macOS windows; runs in CI');
  const { electronApp, dir } = await launchApp(`${fixture.url}/slow`);
  try {
    await electronApp.firstWindow();
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    const visible = () => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.isVisible()));
    await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getURL())).toBe(`${fixture.url}/slow`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(await visible()).toEqual([false]);
  } finally {
    await electronApp.close();
    fs.rmSync(dir, { recursive: true, force: true });
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
  expect(second).toMatchObject({ storagePath: main.storagePath, sandboxed: sandboxReported ? true : undefined });
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
