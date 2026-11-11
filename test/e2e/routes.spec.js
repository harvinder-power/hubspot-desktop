const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const fixtureServer = require('../fixture/server');
const helpers = require('./helpers');

const { repoRoot, evidenceDir, launchApp } = helpers;

let fixture;
let userData;
let app;
let window;

const dashboardUrl = () => `${fixture.url}/reports-dashboard/4242`;
const editorUrl = () => `${fixture.url}/editor`;

const ROUTE_PATHS = {
  Dashboards: '/reports-dashboard/4242',
  Contacts: '/contacts/4242/objects/0-1/views/all/list',
  Companies: '/contacts/4242/objects/0-2/views/all/list',
  Deals: '/contacts/4242/objects/0-3/views/all/board',
  Tickets: '/contacts/4242/objects/0-5/views/all/list',
  Tasks: '/tasks/4242/view/all',
  Inbox: '/live-messages/4242',
  Meetings: '/meetings/4242',
};

const startAt = (page, url) => helpers.startAt(app, page, url);

const clickNavigate = (label) =>
  app.evaluate(({ Menu }, name) => {
    Menu.getApplicationMenu()
      .items.find((item) => item.label === 'Navigate')
      .submenu.items.find((item) => item.label === name)
      .click();
  }, label);

test.beforeAll(async () => {
  fixture = await fixtureServer.start(0, { portalId: '4242' });
  ({ electronApp: app, dir: userData } = await launchApp(fixture.url));
  window = await app.firstWindow();
  await window.waitForURL(dashboardUrl());
});

test.afterAll(async () => {
  await app?.close();
  await fixture?.close();
  if (userData) fs.rmSync(userData, { recursive: true, force: true });
});

test('the Navigate menu lists the routes, then Back and Forward', async () => {
  await startAt(window, dashboardUrl());
  const items = await app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()
      .items.find((item) => item.label === 'Navigate')
      .submenu.items.filter((item) => item.type !== 'separator')
      .map(({ label, accelerator }) => [label, accelerator])
  );
  expect(items).toEqual([
    ['Dashboards', 'CmdOrCtrl+1'],
    ['Contacts', 'CmdOrCtrl+2'],
    ['Companies', 'CmdOrCtrl+3'],
    ['Deals', 'CmdOrCtrl+4'],
    ['Tickets', 'CmdOrCtrl+5'],
    ['Tasks', 'CmdOrCtrl+6'],
    ['Inbox', 'CmdOrCtrl+7'],
    ['Meetings', 'CmdOrCtrl+8'],
    ['Back', 'CmdOrCtrl+['],
    ['Forward', 'CmdOrCtrl+]'],
  ]);
});

for (const [label, routePath] of Object.entries(ROUTE_PATHS)) {
  test(`Navigate > ${label} from the dashboard lands on ${routePath}`, async () => {
    await startAt(window, dashboardUrl());
    await clickNavigate(label);
    await window.waitForURL(`${fixture.url}${routePath}`);
    await expect(window.locator('h1')).toHaveText(routePath);
    if (label === 'Deals') {
      fs.mkdirSync(evidenceDir, { recursive: true });
      await window.screenshot({ path: path.join(evidenceDir, 'route-deals.png') });
    }
  });
}

test('a route clicked on a page without a portal ID uses the last portal', async () => {
  await startAt(window, dashboardUrl());
  await window.goto(editorUrl());
  await clickNavigate('Deals');
  await window.waitForURL(`${fixture.url}/contacts/4242/objects/0-3/views/all/board`);
});

test('Back and Forward move through the window history', async () => {
  await startAt(window, dashboardUrl());
  await clickNavigate('Tasks');
  await window.waitForURL(`${fixture.url}/tasks/4242/view/all`);
  await clickNavigate('Back');
  await window.waitForURL(dashboardUrl());
  await clickNavigate('Forward');
  await window.waitForURL(`${fixture.url}/tasks/4242/view/all`);
});

test('a same-origin frame that pushes another portal path does not change the remembered portal', async () => {
  await startAt(window, dashboardUrl());
  await window.goto(`${fixture.url}/frame-host`);
  await expect
    .poll(() => window.frames().map((frame) => frame.url()))
    .toContain(`${fixture.url}/contacts/99/objects/0-1/views/all/list`);
  await clickNavigate('Deals');
  await window.waitForURL(`${fixture.url}/contacts/4242/objects/0-3/views/all/board`);
});

test('a route clicked on the sign-in page loads the app root, not the last portal', async () => {
  await startAt(window, dashboardUrl());
  await window.goto(`${fixture.url}/login`);
  await clickNavigate('Deals');
  await window.waitForURL(dashboardUrl());
  expect(window.url()).toBe(dashboardUrl());
});

const trayTemplate = () =>
  app.evaluate(
    (electronModule, trayPath) =>
      process.mainModule
        .require(trayPath)
        .menuTemplate(() => {}, () => {})
        .map(({ type, label, accelerator }) => ({ type, label, accelerator })),
    path.join(repoRoot, 'src', 'main', 'tray.js')
  );

test('the tray menu lists the routes in table order', async () => {
  await startAt(window, dashboardUrl());
  const labels = (await trayTemplate()).filter((item) => item.type !== 'separator').map((item) => item.label);
  expect(labels).toEqual(['Show HubSpot', ...Object.keys(ROUTE_PATHS), 'Quit HubSpot Desktop']);
});

const BANNED_ACCELERATORS = [
  'CmdOrCtrl+K', 'CmdOrCtrl+I', 'CmdOrCtrl+D', 'Cmd+,',
  'CmdOrCtrl+Shift+N', 'CmdOrCtrl+Shift+T', 'CmdOrCtrl+,',
];
const BANNED_LABELS = [
  'New Contact', 'New Company', 'New Deal', 'New Task', 'New Ticket', 'Preferences...',
  'Quick Actions', 'Go To',
];

test('the application and tray menus have no editor-breaking shortcuts or fake create items', async () => {
  await startAt(window, dashboardUrl());
  const appItems = await app.evaluate(({ Menu }) => {
    const walk = (menu) => menu.items.flatMap((item) => [item, ...(item.submenu ? walk(item.submenu) : [])]);
    return walk(Menu.getApplicationMenu()).map(({ label, accelerator }) => ({ label, accelerator }));
  });
  for (const items of [appItems, await trayTemplate()]) {
    const accelerators = items.map((item) => item.accelerator).filter(Boolean);
    const labels = items.map((item) => item.label);
    for (const banned of BANNED_ACCELERATORS) expect(accelerators).not.toContain(banned);
    for (const banned of BANNED_LABELS) expect(labels).not.toContain(banned);
  }
});
