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

const clickEdit = (label) =>
  app.evaluate(({ Menu }, name) => {
    Menu.getApplicationMenu()
      .items.find((item) => item.label === 'Edit')
      .submenu.items.find((item) => item.label === name)
      .click();
  }, label);

// The page window's child views and their bounds, with the content size.
const layout = () =>
  app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const { width, height } = win.getContentBounds();
    return { width, height, children: win.contentView.children.map((view) => view.getBounds()) };
  });

const findBar = async () => {
  await expect.poll(() => app.windows().find((page) => page.url().endsWith('/find/find.html'))).toBeTruthy();
  const bar = app.windows().find((page) => page.url().endsWith('/find/find.html'));
  await bar.waitForLoadState('domcontentloaded');
  return bar;
};

// The final found-in-page results the page reported, oldest first.
const results = () => app.evaluate(() => globalThis.findResults.map(({ activeMatchOrdinal, matches }) => [activeMatchOrdinal, matches]));

test.beforeAll(async () => {
  fixture = await fixtureServer.start(0, { portalId: '4242' });
  ({ electronApp: app, dir: userData } = await launchApp(fixture.url));
  window = await app.firstWindow();
  await window.waitForURL(dashboardUrl());
  await app.evaluate(({ BrowserWindow }) => {
    const page = BrowserWindow.getAllWindows()[0].webContents;
    globalThis.findResults = [];
    globalThis.findCalls = [];
    globalThis.stopCalls = [];
    page.on('found-in-page', (event, result) => result.finalUpdate && globalThis.findResults.push(result));
    const findInPage = page.findInPage.bind(page);
    page.findInPage = (text, options) => {
      globalThis.findCalls.push(text);
      return findInPage(text, options);
    };
    const stopFindInPage = page.stopFindInPage.bind(page);
    page.stopFindInPage = (action) => {
      globalThis.stopCalls.push(action);
      return stopFindInPage(action);
    };
  });
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

test('find bar: open, count, step, no results, close', async () => {
  await clickEdit('Find...');
  const { width, height, children } = await layout();
  expect(children).toHaveLength(1);
  const [bounds] = children;
  expect(bounds).toEqual({ x: width - 360, y: 0, width: 360, height: 44 });
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);

  const bar = await findBar();
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
    const image = await app.evaluate(async ({ BrowserWindow }) => {
      const [view] = BrowserWindow.getAllWindows()[0].contentView.children;
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
  const calls = (await app.evaluate(() => globalThis.findCalls)).length;
  await clickEdit('Find...');
  await expect.poll(async () => (await layout()).children.length).toBe(1);
  await expect(bar.locator('#query')).toHaveValue('zzqxv');
  expect((await app.evaluate(() => globalThis.findCalls)).slice(calls)).toEqual(['zzqxv']);
  await bar.click('#close');
  await expect.poll(async () => (await layout()).children).toEqual([]);
});

test('find events from the page are ignored and the page has no find bridge', async () => {
  await clickEdit('Find...');
  const before = (await app.evaluate(() => globalThis.findCalls)).length;
  await app.evaluate(({ BrowserWindow, ipcMain }) => {
    const page = BrowserWindow.getAllWindows()[0].webContents;
    ipcMain.emit('find:event', { sender: page }, { type: 'query', text: 'record' });
  });
  expect(await window.evaluate(() => typeof window.findBar)).toBe('undefined');
  expect((await app.evaluate(() => globalThis.findCalls)).length).toBe(before);
});

test('the find bar is isolated, cannot navigate and opens no windows', async () => {
  await clickEdit('Find...');
  const bar = await findBar();
  const facts = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
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
  expect(await bar.evaluate(() => Object.keys(window.findBar).sort())).toEqual(['onState', 'send']);

  const url = bar.url();
  await bar.evaluate(() => {
    location.href = 'https://example.com/';
  });
  expect(await bar.evaluate(() => window.open('https://example.com/'))).toBeNull();
  await bar.waitForTimeout(500);
  expect(bar.url()).toBe(url);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
});
