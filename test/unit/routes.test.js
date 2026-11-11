const test = require('node:test');
const assert = require('node:assert/strict');
const { ROUTES, portalContext, resolve, portalTracker } = require('../../src/main/routes');

const eu = { origin: 'https://app-eu1.hubspot.com', portalId: '4242' };
const na = { origin: 'https://app.hubspot.com', portalId: '111' };
const dev = 'http://127.0.0.1:4321';

const resolveAll = (context, options) => Object.fromEntries(ROUTES.map(({ id }) => [id, resolve(id, context, options)]));

test('ROUTES lists the destinations in menu order with CmdOrCtrl+1 to 8', () => {
  assert.deepEqual(
    ROUTES.map(({ id, label, accelerator }) => [id, label, accelerator]),
    [
      ['dashboards', 'Dashboards', 'CmdOrCtrl+1'],
      ['contacts', 'Contacts', 'CmdOrCtrl+2'],
      ['companies', 'Companies', 'CmdOrCtrl+3'],
      ['deals', 'Deals', 'CmdOrCtrl+4'],
      ['tickets', 'Tickets', 'CmdOrCtrl+5'],
      ['tasks', 'Tasks', 'CmdOrCtrl+6'],
      ['inbox', 'Inbox', 'CmdOrCtrl+7'],
      ['meetings', 'Meetings', 'CmdOrCtrl+8'],
    ]
  );
  assert.ok(Object.isFrozen(ROUTES));
  assert.ok(ROUTES.every(Object.isFrozen));
});

test('resolve builds every route on a regional host', () => {
  assert.deepEqual(resolveAll(eu), {
    dashboards: 'https://app-eu1.hubspot.com/reports-dashboard/4242',
    contacts: 'https://app-eu1.hubspot.com/contacts/4242/objects/0-1/views/all/list',
    companies: 'https://app-eu1.hubspot.com/contacts/4242/objects/0-2/views/all/list',
    deals: 'https://app-eu1.hubspot.com/contacts/4242/objects/0-3/views/all/board',
    tickets: 'https://app-eu1.hubspot.com/contacts/4242/objects/0-5/views/all/list',
    tasks: 'https://app-eu1.hubspot.com/tasks/4242/view/all',
    inbox: 'https://app-eu1.hubspot.com/live-messages/4242',
    meetings: 'https://app-eu1.hubspot.com/meetings/4242',
  });
});

test('resolve builds every route on the default host', () => {
  assert.deepEqual(resolveAll(na), {
    dashboards: 'https://app.hubspot.com/reports-dashboard/111',
    contacts: 'https://app.hubspot.com/contacts/111/objects/0-1/views/all/list',
    companies: 'https://app.hubspot.com/contacts/111/objects/0-2/views/all/list',
    deals: 'https://app.hubspot.com/contacts/111/objects/0-3/views/all/board',
    tickets: 'https://app.hubspot.com/contacts/111/objects/0-5/views/all/list',
    tasks: 'https://app.hubspot.com/tasks/111/view/all',
    inbox: 'https://app.hubspot.com/live-messages/111',
    meetings: 'https://app.hubspot.com/meetings/111',
  });
});

test('resolve with no context returns the app root for the base', () => {
  assert.equal(resolve('deals', null), 'https://app.hubspot.com/');
  assert.equal(resolve('deals', null, { base: dev }), 'http://127.0.0.1:4321/');
});

test('resolve rejects an unknown route', () => {
  assert.throws(() => resolve('settings', na), /Unknown route: settings/);
});

test('portalContext reads the origin and portal from a record URL', () => {
  assert.deepEqual(portalContext('https://app.hubspot.com/contacts/111/record/0-3/202'), na);
});

test('portalContext keeps a regional host as the origin', () => {
  assert.deepEqual(portalContext('https://app-eu1.hubspot.com/reports-dashboard/4242?tab=1'), eu);
});

test('portalContext accepts the dev-override origin', () => {
  assert.deepEqual(portalContext(`${dev}/tasks/4242/view/all`, { base: dev }), { origin: dev, portalId: '4242' });
  assert.equal(portalContext(`${dev}/tasks/4242/view/all`), null);
});

test('portalContext returns null off the app origin or without a portal', () => {
  assert.equal(portalContext('https://example.com/contacts/111/record/0-1/1'), null);
  assert.equal(portalContext('https://app.hubspot.com/login'), null);
  assert.equal(portalContext('https://app.hubspot.com/contacts/111abc'), null);
  assert.equal(portalContext('https://app.hubspot.com.evil.example/contacts/111'), null);
  assert.equal(portalContext('not a url'), null);
});

test('portalContext ignores sign-in pages and accepts a portal path without a trailing slash', () => {
  assert.equal(portalContext('https://app.hubspot.com/login/12345'), null);
  assert.equal(portalContext('https://app.hubspot.com/sso/987'), null);
  assert.deepEqual(portalContext('https://app.hubspot.com/contacts/111'), na);
});

test('portalTracker clears the portal on an app sign-in page', () => {
  const tracker = portalTracker();
  tracker.observe('https://app.hubspot.com/contacts/111/record/0-1/1');
  tracker.observe('https://app.hubspot.com/login');
  assert.equal(tracker.context, null);
  assert.equal(resolve('deals', tracker.context), 'https://app.hubspot.com/');
});

test('portalTracker keeps the portal on a sign-in page in a window a page opened while other windows remain', () => {
  const tracker = portalTracker();
  tracker.observe('https://app.hubspot.com/contacts/111/record/0-1/1');
  for (const opener of ['app', 'outside']) {
    tracker.observe('https://app.hubspot.com/login', { opener });
    assert.deepEqual(tracker.context, na, opener);
  }
  tracker.observe('https://app.hubspot.com/login', { opener: null });
  assert.equal(tracker.context, null);
});

test('portalTracker clears the portal on a sign-in page in a page-opened window that is the only window', () => {
  for (const opener of ['app', 'outside']) {
    const tracker = portalTracker();
    tracker.observe('https://app.hubspot.com/contacts/111/record/0-1/1');
    tracker.observe('https://app.hubspot.com/login', { opener, alone: true });
    assert.equal(tracker.context, null, opener);
  }
});

test('portalTracker takes the portal from a window an app page opened, never from one an outside page opened', () => {
  const tracker = portalTracker();
  tracker.observe('https://app.hubspot.com/contacts/111/record/0-1/1');
  tracker.observe('https://app.hubspot.com/contacts/999/record/0-1/1', { opener: 'outside' });
  tracker.observe('https://app.hubspot.com/contacts/999/record/0-1/1', { opener: 'outside', alone: true });
  assert.deepEqual(tracker.context, na);
  tracker.observe('https://app.hubspot.com/contacts/222/record/0-1/1', { opener: 'app' });
  assert.deepEqual(tracker.context, { origin: 'https://app.hubspot.com', portalId: '222' });
});

test('portalTracker keeps the portal on an outside page during sign-in', () => {
  const tracker = portalTracker();
  tracker.observe('https://app.hubspot.com/contacts/111/record/0-1/1');
  tracker.observe('https://idp.example.com/authorize?return_to=x');
  assert.deepEqual(tracker.context, na);
});

test('portalTracker keeps the last portal across URLs without one', () => {
  const tracker = portalTracker({ base: dev });
  assert.equal(tracker.context, null);
  tracker.observe(`${dev}/reports-dashboard/4242`);
  tracker.observe(`${dev}/editor`);
  tracker.observe('https://example.com/contacts/9/record');
  assert.deepEqual(tracker.context, { origin: dev, portalId: '4242' });
  tracker.observe('https://app-eu1.hubspot.com/contacts/111/objects/0-1/views/all/list');
  assert.deepEqual(tracker.context, { origin: 'https://app-eu1.hubspot.com', portalId: '111' });
});
