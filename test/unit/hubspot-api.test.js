const test = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('../fixture/api-server');
const { createClient, REQUIRED_SCOPES, ERROR_KINDS } = require('../../src/main/hubspot-api');

const TOKEN = 'pat-eu1-SECRET-TOKEN-7f3a9c';
const NOW = Date.parse('2026-11-11T09:00:00.000Z');

async function setup(t, script) {
  const api = await start(0, { script });
  t.after(() => api.close());
  return { api, client: createClient({ token: TOKEN, baseUrl: api.url, now: () => NOW }) };
}

const searchPage = (results) => ({ total: results.length, results });
const object = (id, properties) => ({ id, properties, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', archived: false });
const missingScopes = (scope) => ({
  status: 403,
  body: {
    status: 'error',
    message: "This app hasn't been granted all required scopes to make this call.",
    correlationId: '4551aac3-5eaa-4a3e-99ac-b15b3fbe922a',
    category: 'MISSING_SCOPES',
    errors: [{ message: 'One or more of the following scopes are required.', context: { requiredGranularScopes: [scope] } }],
  },
});

test('account() reads the portal ID and derives the app origin from uiDomain', async (t) => {
  const { api, client } = await setup(t, {
    'GET /account-info/2026-09/details': {
      body: { portalId: 123456, accountType: 'STANDARD', timeZone: 'Europe/London', uiDomain: 'app-eu1.hubspot.com', dataHostingLocation: 'eu1' },
    },
  });
  assert.deepEqual(await client.account(), { ok: true, data: { portalId: '123456', appOrigin: 'https://app-eu1.hubspot.com' } });
  assert.equal(api.requests[0].method, 'GET');
  assert.equal(api.requests[0].path, '/account-info/2026-09/details');
  assert.equal(api.requests[0].headers.authorization, 'Bearer [redacted]');
});

test('account() gives a null app origin for a uiDomain that is not a HubSpot app host', async (t) => {
  const { client } = await setup(t, { 'GET /account-info/2026-09/details': { body: { portalId: 42, uiDomain: 'evil.example.com' } } });
  assert.deepEqual(await client.account(), { ok: true, data: { portalId: '42', appOrigin: null } });
});

test('owners() follows pagination to the end', async (t) => {
  const { api, client } = await setup(t, {
    'GET /crm/owners/2026-09': [
      { body: { results: [{ id: '11', email: 'ana@example.com', firstName: 'Ana', lastName: 'Ng', archived: false, type: 'PERSON' }], paging: { next: { after: 'cursor-2' } } } },
      { body: { results: [{ id: '12', email: 'bo@example.com', firstName: '', lastName: '', archived: false, type: 'PERSON' }] } },
    ],
  });
  assert.deepEqual(await client.owners(), {
    ok: true,
    data: [{ id: '11', email: 'ana@example.com', name: 'Ana Ng' }, { id: '12', email: 'bo@example.com', name: 'bo@example.com' }],
  });
  assert.deepEqual(api.requests.map((r) => r.path), ['/crm/owners/2026-09?limit=100', '/crm/owners/2026-09?limit=100&after=cursor-2']);
});

test('owners() stops after 10 pages even if HubSpot keeps sending a cursor', async (t) => {
  const { api, client } = await setup(t, { 'GET /crm/owners/2026-09': { body: { results: [], paging: { next: { after: 'again' } } } } });
  assert.deepEqual(await client.owners(), { ok: true, data: [] });
  assert.equal(api.requests.length, 10);
});

test('tasksDue() sends the owner, open-status and due-date filters, soonest first', async (t) => {
  const { api, client } = await setup(t, {
    'POST /crm/objects/2026-09/tasks/search': {
      body: searchPage([
        object('901', { hs_task_subject: 'Call Brian', hs_timestamp: '2026-11-11T08:00:00.000Z', hs_task_type: 'CALL', hs_task_priority: 'HIGH' }),
        object('902', { hs_task_subject: 'Send proposal', hs_timestamp: '1794416400000', hs_task_type: 'EMAIL', hs_task_priority: null }),
      ]),
    },
  });
  assert.deepEqual(await client.tasksDue({ ownerId: '11', before: '2026-11-11T17:00:00.000Z' }), {
    ok: true,
    data: [
      { id: '901', subject: 'Call Brian', dueAt: '2026-11-11T08:00:00.000Z', type: 'CALL', priority: 'HIGH' },
      { id: '902', subject: 'Send proposal', dueAt: '2026-11-11T17:00:00.000Z', type: 'EMAIL', priority: null },
    ],
  });
  const [req] = api.requests;
  assert.equal(req.method, 'POST');
  assert.equal(req.path, '/crm/objects/2026-09/tasks/search');
  assert.equal(req.headers['content-type'], 'application/json');
  assert.deepEqual(req.body, {
    filterGroups: [{
      filters: [
        { propertyName: 'hubspot_owner_id', operator: 'EQ', value: '11' },
        { propertyName: 'hs_task_status', operator: 'NEQ', value: 'COMPLETED' },
        { propertyName: 'hs_timestamp', operator: 'LTE', value: '1794416400000' },
      ],
    }],
    sorts: [{ propertyName: 'hs_timestamp', direction: 'ASCENDING' }],
    properties: ['hs_task_subject', 'hs_timestamp', 'hs_task_type', 'hs_task_priority'],
    limit: 50,
  });
});

test('upcomingMeetings() sends the owner and start-time window, soonest first', async (t) => {
  const { api, client } = await setup(t, {
    'POST /crm/objects/2026-09/meetings/search': {
      body: searchPage([object('77', { hs_meeting_title: 'Intro meeting', hs_meeting_start_time: '2026-11-11T10:00:00Z', hs_meeting_end_time: '2026-11-11T10:30:00Z' })]),
    },
  });
  assert.deepEqual(await client.upcomingMeetings({ ownerId: '11' }), {
    ok: true,
    data: [{ id: '77', title: 'Intro meeting', startsAt: '2026-11-11T10:00:00.000Z', endsAt: '2026-11-11T10:30:00.000Z' }],
  });
  assert.deepEqual(api.requests[0].body, {
    filterGroups: [{
      filters: [
        { propertyName: 'hubspot_owner_id', operator: 'EQ', value: '11' },
        { propertyName: 'hs_meeting_start_time', operator: 'BETWEEN', value: '1794387600000', highValue: '1794474000000' },
      ],
    }],
    sorts: [{ propertyName: 'hs_meeting_start_time', direction: 'ASCENDING' }],
    properties: ['hs_meeting_title', 'hs_meeting_start_time', 'hs_meeting_end_time'],
    limit: 20,
  });
});

test('search() merges one search per type into a flat list', async (t) => {
  const { api, client } = await setup(t, {
    'POST /crm/objects/2026-09/contacts/search': { body: searchPage([object('1', { firstname: 'Ana', lastname: 'Ng', email: 'ana@acme.test', company: 'Acme' }), object('2', { firstname: null, lastname: null, email: 'x@acme.test', company: 'Acme' })]) },
    'POST /crm/objects/2026-09/companies/search': { body: searchPage([object('3', { name: 'Acme', domain: 'acme.test' })]) },
    'POST /crm/objects/2026-09/deals/search': { body: searchPage([object('4', { dealname: 'Acme renewal' })]) },
  });
  assert.deepEqual(await client.search({ query: ' acme ' }), {
    ok: true,
    data: [
      { type: 'contacts', id: '1', title: 'Ana Ng', subtitle: 'ana@acme.test' },
      { type: 'contacts', id: '2', title: 'x@acme.test', subtitle: 'Acme' },
      { type: 'companies', id: '3', title: 'Acme', subtitle: 'acme.test' },
      { type: 'deals', id: '4', title: 'Acme renewal', subtitle: null },
    ],
  });
  const bodies = Object.fromEntries(api.requests.map((r) => [r.path, r.body]));
  assert.deepEqual(bodies, {
    '/crm/objects/2026-09/contacts/search': { query: 'acme', properties: ['firstname', 'lastname', 'email', 'company'], limit: 5 },
    '/crm/objects/2026-09/companies/search': { query: 'acme', properties: ['name', 'domain'], limit: 5 },
    '/crm/objects/2026-09/deals/search': { query: 'acme', properties: ['dealname'], limit: 5 },
  });
});

test('search() keeps the results of the types it may read when one type lacks scopes', async (t) => {
  const { client } = await setup(t, {
    'POST /crm/objects/2026-09/contacts/search': { body: searchPage([object('1', { firstname: 'Ana', lastname: 'Ng', email: 'ana@acme.test' })]) },
    'POST /crm/objects/2026-09/companies/search': { body: searchPage([]) },
    'POST /crm/objects/2026-09/deals/search': missingScopes('crm.objects.deals.read'),
  });
  const result = await client.search({ query: 'ana' });
  assert.deepEqual(result.data, [{ type: 'contacts', id: '1', title: 'Ana Ng', subtitle: 'ana@acme.test' }]);
  assert.equal(result.ok, true);
  assert.equal(result.partial.length, 1);
  assert.equal(result.partial[0].type, 'deals');
  assert.equal(result.partial[0].error.kind, 'missing-scopes');
  assert.deepEqual(result.partial[0].error.missingScopes, ['crm.objects.deals.read']);
});

test('search() with a blank query sends nothing and finds nothing', async (t) => {
  const { api, client } = await setup(t, {});
  assert.deepEqual(await client.search({ query: '   ' }), { ok: true, data: [] });
  assert.equal(api.requests.length, 0);
});

test('every HubSpot failure maps to exactly one error kind', async (t) => {
  const cases = [
    ['401', { status: 401, body: { status: 'error', message: 'Authentication credentials not found.', category: 'INVALID_AUTHENTICATION' } }, { kind: 'unauthorized' }],
    ['403 scopes', missingScopes('crm.objects.owners.read'), { kind: 'missing-scopes', missingScopes: ['crm.objects.owners.read'] }],
    ['403 other', { status: 403, body: { status: 'error', message: 'Forbidden', category: 'FORBIDDEN' } }, { kind: 'forbidden' }],
    ['429', { status: 429, headers: { 'Retry-After': '7' }, body: { status: 'error', message: 'You have reached your secondly limit.', errorType: 'RATE_LIMIT', policyName: 'SECONDLY' } }, { kind: 'rate-limited', retryAfterMs: 7000 }],
    ['429 date', { status: 429, headers: { 'Retry-After': 'Wed, 11 Nov 2026 09:00:30 GMT' }, body: {} }, { kind: 'rate-limited', retryAfterMs: 30000 }],
    ['500', { status: 500, body: { status: 'error', message: 'Internal error' } }, { kind: 'bad-response' }],
    ['html', { status: 200, body: '<!doctype html><title>Maintenance</title>' }, { kind: 'bad-response' }],
    ['shape', { status: 200, body: { results: 'nope' } }, { kind: 'bad-response' }],
  ];
  for (const [name, response, expected] of cases) {
    await t.test(name, async (t) => {
      const { client } = await setup(t, { 'GET /crm/owners/2026-09': response });
      const result = await client.owners();
      assert.equal(result.ok, false);
      const { message, ...rest } = result.error;
      assert.deepEqual(rest, expected);
      assert.equal(typeof message, 'string');
    });
  }
  assert.deepEqual(ERROR_KINDS, ['unauthorized', 'missing-scopes', 'forbidden', 'rate-limited', 'network', 'bad-response']);
});

test('a refused connection is a network error', async () => {
  const api = await start(0);
  await api.close();
  const result = await createClient({ token: TOKEN, baseUrl: api.url }).account();
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'network');
  assert.equal(result.error.message, 'Could not reach HubSpot (ECONNREFUSED)');
});

test('the fake server refuses a request without a bearer token in HubSpot error shape', async (t) => {
  const { api } = await setup(t, { 'GET /account-info/2026-09/details': { body: { portalId: 1 } } });
  const res = await fetch(`${api.url}/account-info/2026-09/details`);
  assert.equal(res.status, 401);
  assert.equal((await res.json()).category, 'INVALID_AUTHENTICATION');
  const result = await createClient({ token: '', baseUrl: api.url }).account();
  assert.equal(result.error.kind, 'unauthorized');
});

test('no function rejects, even when fetch misbehaves', async () => {
  const throwing = createClient({ token: TOKEN, fetch: () => { throw new TypeError('boom'); } });
  const badJson = createClient({ token: TOKEN, fetch: async () => ({ status: 200, headers: new Headers(), json: () => Promise.reject(new SyntaxError('bad')) }) });
  for (const client of [throwing, badJson]) {
    for (const call of [() => client.account(), () => client.owners(), () => client.tasksDue({ ownerId: '1' }), () => client.upcomingMeetings({ ownerId: '1' }), () => client.search({ query: 'a' }), () => client.tasksDue()]) {
      const result = await call();
      assert.equal(result.ok, false);
    }
  }
  assert.equal((await throwing.account()).error.kind, 'network');
  assert.equal((await badJson.account()).error.kind, 'bad-response');
});

test('the token never appears in results, errors, request logs or console output', async (t) => {
  const logged = [];
  for (const method of ['log', 'error', 'warn', 'info', 'debug']) t.mock.method(console, method, (...args) => logged.push(args.map(String).join(' ')));
  const echo = { status: 'error', message: `Token ${TOKEN} is invalid`, category: 'INVALID_AUTHENTICATION' };
  const { api, client } = await setup(t, {
    'GET /account-info/2026-09/details': { status: 401, body: echo },
    'GET /crm/owners/2026-09': { status: 429, body: echo },
    'POST /crm/objects/2026-09/tasks/search': missingScopes('crm.objects.tasks.read'),
    'POST /crm/objects/2026-09/meetings/search': { status: 500, body: echo },
    'POST /crm/objects/2026-09/contacts/search': { status: 403, body: echo },
  });
  const throwing = createClient({ token: TOKEN, fetch: () => { throw new Error(`failed with ${TOKEN}`); } });
  const results = [
    await client.account(),
    await client.owners(),
    await client.tasksDue({ ownerId: '1' }),
    await client.upcomingMeetings({ ownerId: '1' }),
    await client.search({ query: 'a', types: ['contacts'] }),
    await throwing.account(),
  ];
  assert.ok(results.every((r) => r.ok === false));
  assert.match(results[0].error.message, /\[token\]/);
  const everything = JSON.stringify({ results, requests: api.requests, logged });
  assert.equal(everything.includes(TOKEN), false);
  assert.equal(everything.includes('SECRET'), false);
});

test('REQUIRED_SCOPES is a frozen table of read-only scopes', () => {
  assert.deepEqual(REQUIRED_SCOPES, {
    account: [],
    owners: ['crm.objects.owners.read'],
    tasksDue: ['crm.objects.tasks.read'],
    upcomingMeetings: ['crm.objects.meetings.read'],
    search: { contacts: ['crm.objects.contacts.read'], companies: ['crm.objects.companies.read'], deals: ['crm.objects.deals.read'] },
  });
  assert.ok(Object.isFrozen(REQUIRED_SCOPES) && Object.isFrozen(REQUIRED_SCOPES.search) && Object.isFrozen(REQUIRED_SCOPES.owners));
  const all = [REQUIRED_SCOPES.owners, REQUIRED_SCOPES.tasksDue, REQUIRED_SCOPES.upcomingMeetings, ...Object.values(REQUIRED_SCOPES.search)].flat();
  assert.ok(all.every((scope) => scope.endsWith('.read')));
});
