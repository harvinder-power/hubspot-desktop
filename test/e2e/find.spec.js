const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const fixtureServer = require('../fixture/server');
const { evidenceDir, quiet, launchApp } = require('./helpers');

let fixture;
let userData;
let app;
let window;

const dashboardUrl = () => `${fixture.url}/reports-dashboard/4242`;
const listUrl = () => `${fixture.url}/contacts/4242/objects/0-1/views/all/list`;

const clickEdit = (label) =>
  app.evaluate(({ Menu }, name) => {
    Menu.getApplicationMenu()
      .items.find((item) => item.label === 'Edit')
      .submenu.items.find((item) => item.label === name)
      .click();
  }, label);

// The main window's child views and their bounds, with the content size.
const layout = () =>
  app.evaluate(() => {
    const win = globalThis.mainWin;
    const { width, height } = win.getContentBounds();
    return { width, height, children: win.contentView.children.map((view) => view.getBounds()) };
  });

const findBar = async () => {
  await expect.poll(() => app.windows().find((page) => page.url().endsWith('/find/find.html'))).toBeTruthy();
  const bar = app.windows().find((page) => page.url().endsWith('/find/find.html'));
  await bar.waitForLoadState('domcontentloaded');
  return bar;
};

// Opens the bar on the main window and waits for the count of `query`.
const searchFor = async (query, label) => {
  await clickEdit('Find...');
  const bar = await findBar();
  await bar.fill('#query', query);
  await expect(bar.locator('#count')).toHaveText(label);
  return bar;
};

// The final found-in-page results the page reported, oldest first.
const results = () => app.evaluate(() => globalThis.findResults.map(({ activeMatchOrdinal, matches }) => [activeMatchOrdinal, matches]));
const findCalls = () => app.evaluate(() => globalThis.findCalls);

// WCAG relative luminance contrast of two opaque CSS rgb() colours.
function contrast(a, b) {
  const luminance = (color) => {
    const [r, g, b] = color.match(/[\d.]+/g).slice(0, 3).map((v) => {
      const c = Number(v) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test.beforeAll(async () => {
  fixture = await fixtureServer.start(0, { portalId: '4242' });
  ({ electronApp: app, dir: userData } = await launchApp(fixture.url));
  window = await app.firstWindow();
  await window.waitForURL(dashboardUrl());
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.mainWin = BrowserWindow.getAllWindows()[0];
    const page = globalThis.mainWin.webContents;
    page.on('found-in-page', (event, result) => result.finalUpdate && globalThis.findResults.push(result));
    const findInPage = page.findInPage.bind(page);
    page.findInPage = (text, options) => {
      const requestId = findInPage(text, options);
      globalThis.findCalls.push({ text, findNext: options.findNext, requestId });
      return requestId;
    };
    const stopFindInPage = page.stopFindInPage.bind(page);
    page.stopFindInPage = (action) => {
      globalThis.stopCalls.push(action);
      return stopFindInPage(action);
    };
  });
});

test.beforeEach(async () => {
  await app.evaluate(() => {
    globalThis.findResults = [];
    globalThis.findCalls = [];
    globalThis.stopCalls = [];
  });
});

// Each test starts with the main window's bar closed. The close goes through the bar's own IPC route.
test.afterEach(async () => {
  await app.evaluate(({ ipcMain }) => {
    for (const view of globalThis.mainWin.contentView.children) ipcMain.emit('find:event', { sender: view.webContents }, { type: 'close' });
  });
  await expect.poll(async () => (await layout()).children).toEqual([]);
});

test.afterAll(async () => {
  await app?.close();
  await fixture?.close();
  if (userData) fs.rmSync(userData, { recursive: true, force: true });
});

test('the Edit menu lists Find, Find Next and Find Previous', async () => {
  const items = await app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()
      .items.find((item) => item.label === 'Edit')
      .submenu.items.filter((item) => item.label.startsWith('Find'))
      .map(({ label, accelerator }) => [label, accelerator])
  );
  expect(items).toEqual([['Find...', 'CmdOrCtrl+F'], ['Find Next', 'CmdOrCtrl+G'], ['Find Previous', 'CmdOrCtrl+Shift+G']]);
});

test('Cmd+F, Cmd+G and Shift+Cmd+G belong to the three find items only', async () => {
  const owners = await app.evaluate(({ Menu }) => {
    const walk = (menu) => menu.items.flatMap((item) => [item, ...(item.submenu ? walk(item.submenu) : [])]);
    return walk(Menu.getApplicationMenu())
      .filter((item) => ['CmdOrCtrl+F', 'CmdOrCtrl+G', 'CmdOrCtrl+Shift+G'].includes(item.accelerator))
      .map(({ label, accelerator }) => [label, accelerator]);
  });
  expect(owners).toEqual([['Find...', 'CmdOrCtrl+F'], ['Find Next', 'CmdOrCtrl+G'], ['Find Previous', 'CmdOrCtrl+Shift+G']]);
});

test('a page navigation while the bar is open searches the new page again', async () => {
  const bar = await searchFor('record', '1 of 2');
  // The editor page has no "record".
  await window.goto(`${fixture.url}/editor`);
  await expect(bar.locator('#count')).toHaveText('No results');
  await window.goto(dashboardUrl());
  await expect(bar.locator('#count')).toHaveText('1 of 2');
});

test('a same-document navigation keeps the active match and starts no new search', async () => {
  const bar = await searchFor('record', '1 of 2');
  await clickEdit('Find Next');
  await expect(bar.locator('#count')).toHaveText('2 of 2');
  const before = (await findCalls()).length;
  await app.evaluate(() => {
    globalThis.inPageNavigations = 0;
    globalThis.mainWin.webContents.on('did-navigate-in-page', (event, url, isMainFrame) => {
      if (isMainFrame) globalThis.inPageNavigations += 1;
    });
  });
  await window.evaluate(() => history.replaceState(null, '', `${location.pathname}?view=1`));
  await expect.poll(() => app.evaluate(() => globalThis.inPageNavigations)).toBe(1);
  // The bar's own listener runs before the one above, so a search it started is already recorded.
  expect((await findCalls()).slice(before).filter((call) => call.findNext)).toEqual([]);
  await bar.waitForTimeout(300);
  await expect(bar.locator('#count')).toHaveText('2 of 2');
  await window.evaluate(() => history.replaceState(null, '', location.pathname));
});

test('find bar: open, count, step, no results, close', async () => {
  await clickEdit('Find...');
  const { width, height, children } = await layout();
  expect(children).toHaveLength(1);
  const [bounds] = children;
  expect(bounds).toEqual({ x: width - 344 - 8, y: 0, width: 344, height: 36 });
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);

  const bar = await findBar();
  // The view is the drawn bar: no transparent margin takes clicks meant for the page.
  const drawn = await bar.evaluate(() => {
    const { x, y, width: w, height: h } = document.getElementById('bar').getBoundingClientRect();
    return { x, y, width: w, height: h, viewport: [innerWidth, innerHeight] };
  });
  expect(drawn).toEqual({ x: 0, y: 0, width: bounds.width, height: bounds.height, viewport: [bounds.width, bounds.height] });

  // The fixture page says "Contact record" and "Deal record".
  await bar.fill('#query', 'record');
  await expect.poll(results).toContainEqual([1, 2]);
  await expect(bar.locator('#count')).toHaveText('1 of 2');

  await clickEdit('Find Next');
  await expect(bar.locator('#count')).toHaveText('2 of 2');
  await bar.press('#query', 'Shift+Enter');
  await expect(bar.locator('#count')).toHaveText('1 of 2');
  await bar.press('#query', 'Enter');
  await expect(bar.locator('#count')).toHaveText('2 of 2');

  if (!quiet) {
    const image = await app.evaluate(async () => {
      const [view] = globalThis.mainWin.contentView.children;
      return (await view.webContents.capturePage()).toPNG().toString('base64');
    });
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.writeFileSync(path.join(evidenceDir, 'find-bar.png'), Buffer.from(image, 'base64'));
  }

  await bar.fill('#query', 'zzqxv');
  await expect(bar.locator('#count')).toHaveText('No results');

  await bar.press('#query', 'Escape');
  await expect.poll(async () => (await layout()).children).toEqual([]);
  expect(await app.evaluate(() => globalThis.stopCalls)).toEqual(['clearSelection']);

  // Reopening restores the last query and searches it again.
  const calls = (await findCalls()).length;
  await clickEdit('Find...');
  await expect.poll(async () => (await layout()).children.length).toBe(1);
  await expect(bar.locator('#query')).toHaveValue('zzqxv');
  expect((await findCalls()).slice(calls).map(({ text, findNext }) => [text, findNext])).toEqual([['zzqxv', true]]);
  await bar.click('#close');
  await expect.poll(async () => (await layout()).children).toEqual([]);
});

test('a late result of an older search cannot overwrite the newer count', async () => {
  const bar = await searchFor('record', '1 of 2');
  await bar.fill('#query', 'zzqxv');
  await expect(bar.locator('#count')).toHaveText('No results');
  const calls = await findCalls();
  const older = calls.find((call) => call.text === 'record').requestId;
  const latest = calls.at(-1).requestId;
  await bar.evaluate(() => {
    window.labels = [];
    window.findBar.onState((state) => window.labels.push(state.label));
  });
  await app.evaluate((electron, ids) => {
    const page = globalThis.mainWin.webContents;
    const result = (requestId, activeMatchOrdinal, matches) => ({ requestId, activeMatchOrdinal, matches, finalUpdate: true });
    page.emit('found-in-page', {}, result(ids.older, 1, 2));
    // The positive control: a result of the latest request does reach the bar.
    page.emit('found-in-page', {}, result(ids.latest, 1, 7));
  }, { older, latest });
  await expect.poll(() => bar.evaluate(() => window.labels.at(-1))).toBe('1 of 7');
  expect(await bar.evaluate(() => window.labels)).toEqual(['1 of 7']);
});

test('Find acts on the focused window, even a window.open child', async () => {
  const [child] = await Promise.all([app.waitForEvent('window'), window.evaluate((url) => { window.open(url); }, listUrl())]);
  await child.waitForURL(listUrl());
  try {
    // A quiet run never focuses a window, so it stands in the focus with a stub.
    await app.evaluate(({ BrowserWindow }, stub) => {
      globalThis.childWin = BrowserWindow.getAllWindows().find((win) => win !== globalThis.mainWin);
      globalThis.realFocused = BrowserWindow.getFocusedWindow;
      if (stub) BrowserWindow.getFocusedWindow = () => globalThis.childWin;
      else globalThis.childWin.focus();
    }, quiet);
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow() === globalThis.childWin)).toBe(true);
    await clickEdit('Find...');
    await expect.poll(() => app.evaluate(() => globalThis.childWin.contentView.children.length)).toBe(1);
    expect((await layout()).children).toEqual([]);
  } finally {
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getFocusedWindow = globalThis.realFocused;
      globalThis.childWin?.destroy();
    });
  }
});

test('with no focused window Find opens in the active registry window', async () => {
  const [child] = await Promise.all([app.waitForEvent('window'), window.evaluate((url) => { window.open(url); }, listUrl())]);
  await child.waitForURL(listUrl());
  try {
    await app.evaluate(({ BrowserWindow }) => {
      globalThis.childWin = BrowserWindow.getAllWindows().find((win) => win !== globalThis.mainWin);
      globalThis.realFocused = BrowserWindow.getFocusedWindow;
      BrowserWindow.getFocusedWindow = () => null;
    });
    await clickEdit('Find...');
    await expect.poll(async () => (await layout()).children.length).toBe(1);
    expect(await app.evaluate(() => globalThis.childWin.contentView.children.length)).toBe(0);
  } finally {
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getFocusedWindow = globalThis.realFocused;
      globalThis.childWin?.destroy();
    });
  }
});

test('find events from the page are ignored and the page has no find bridge', async () => {
  await clickEdit('Find...');
  await findBar();
  const before = (await findCalls()).length;
  await app.evaluate(({ ipcMain }) => {
    ipcMain.emit('find:event', { sender: globalThis.mainWin.webContents }, { type: 'query', text: 'record' });
  });
  expect(await window.evaluate(() => typeof window.findBar)).toBe('undefined');
  expect((await findCalls()).length).toBe(before);
});

test('the find bar is isolated and has a frozen, minimal bridge', async () => {
  await clickEdit('Find...');
  const bar = await findBar();
  const facts = await app.evaluate(() => {
    const win = globalThis.mainWin;
    const [view] = win.contentView.children;
    const prefs = view.webContents.getLastWebPreferences();
    return {
      type: view.webContents.getType(),
      persistent: view.webContents.session.isPersistent(),
      shared: view.webContents.session === win.webContents.session,
      contextIsolation: prefs.contextIsolation,
      sandbox: prefs.sandbox,
      nodeIntegration: prefs.nodeIntegration,
    };
  });
  // A WebContentsView reports 'window', so the shared right-click menu attaches to the bar too.
  expect(facts).toEqual({ type: 'window', persistent: false, shared: false, contextIsolation: true, sandbox: true, nodeIntegration: false });
  expect(await bar.evaluate(() => ({ keys: Object.keys(window.findBar).sort(), frozen: Object.isFrozen(window.findBar) }))).toEqual({
    keys: ['onState', 'platform', 'send'],
    frozen: true,
  });
});

test('the find-bar session denies permission requests and checks', async () => {
  await clickEdit('Find...');
  const bar = await findBar();
  const answers = await bar.evaluate(async () => ({
    request: await Notification.requestPermission(),
    check: (await navigator.permissions.query({ name: 'notifications' })).state,
  }));
  expect(answers).toEqual({ request: 'denied', check: 'denied' });
});

test('the bar hints show this platform\'s shortcuts', async () => {
  await clickEdit('Find...');
  const bar = await findBar();
  const titles = await bar.evaluate(() => ['previous', 'next', 'close'].map((id) => document.getElementById(id).title));
  expect(titles).toEqual(
    process.platform === 'darwin'
      ? ['Previous (Shift+Cmd+G)', 'Next (Cmd+G)', 'Close (Esc)']
      : ['Previous (Ctrl+Shift+G)', 'Next (Ctrl+G)', 'Close (Esc)']
  );
});

test('Enter inside an IME composition does not step to the next match', async () => {
  const bar = await searchFor('record', '1 of 2');
  const before = (await findCalls()).length;
  await bar.evaluate(() => {
    const event = new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true });
    document.getElementById('query').dispatchEvent(event);
  });
  // Bar messages arrive in order, so a step sent by the composing Enter would come before this close.
  await bar.press('#query', 'Escape');
  await expect.poll(async () => (await layout()).children).toEqual([]);
  expect((await findCalls()).slice(before)).toEqual([]);
});

test('the query field has a visible focus outline with 3:1 contrast in light and dark', async () => {
  await clickEdit('Find...');
  const bar = await findBar();
  const ring = () =>
    bar.evaluate(() => {
      const input = document.getElementById('query');
      input.focus();
      const style = getComputedStyle(input);
      return {
        style: style.outlineStyle,
        width: parseFloat(style.outlineWidth),
        color: style.outlineColor,
        surface: getComputedStyle(document.getElementById('bar')).backgroundColor,
      };
    });
  try {
    for (const scheme of ['light', 'dark']) {
      await bar.emulateMedia({ colorScheme: scheme });
      expect(await bar.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(scheme === 'dark');
      const { style, width, color, surface } = await ring();
      // A real outline, so forced-colors mode keeps it.
      expect(style, scheme).toBe('solid');
      expect(width, scheme).toBeGreaterThanOrEqual(2);
      expect(contrast(color, surface), `${scheme}: ${color} on ${surface}`).toBeGreaterThanOrEqual(3);
    }
    await bar.emulateMedia({ forcedColors: 'active' });
    expect(await bar.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true);
    expect((await ring()).style).toBe('solid');
  } finally {
    await bar.emulateMedia({ colorScheme: null, forcedColors: null });
  }
});

// Last: Playwright keeps waiting on the bar page's refused navigation, so no later test can drive the bar.
test('the find bar cannot navigate and opens no windows', async () => {
  await clickEdit('Find...');
  const bar = await findBar();
  const url = bar.url();
  await bar.evaluate(() => {
    location.href = 'https://example.com/';
  });
  expect(await bar.evaluate(() => window.open('https://example.com/'))).toBeNull();
  await bar.waitForTimeout(500);
  expect(bar.url()).toBe(url);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
});
