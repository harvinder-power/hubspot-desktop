const test = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('../fixture/api-server');
const { createClient } = require('../../src/main/hubspot-api');

const TOKEN = 'pat-eu1-SECRET-TOKEN-7f3a9c';
const NOW = Date.parse('2026-11-11T09:00:00.000Z');
const TASKS = 'POST /crm/objects/2026-09/tasks/search';
const MEETINGS = 'POST /crm/objects/2026-09/meetings/search';
const ACCOUNT = 'GET /account-info/2026-09/details';

async function setup(t, script, options = {}) {
  const api = await start(0, { script, ...options });
  t.after(() => api.close());
  return { api, client: createClient({ token: TOKEN, baseUrl: api.url, now: () => NOW }) };
}

const object = (id, properties) => ({ id, properties });
const page = (results) => ({ body: { total: results.length, results } });
const scopesError = (extra) => ({ status: 403, body: { status: 'error', message: 'Missing scopes', category: 'MISSING_SCOPES', ...extra } });

test('one out-of-range task timestamp gives a null due date and keeps the other rows', async (t) => {
  const { client } = await setup(t, {
    [TASKS]: page([
      object('1', { hs_task_subject: 'Bad', hs_timestamp: '99999999999999999', hs_task_type: 'CALL' }),
      object('2', { hs_task_subject: 'Good', hs_timestamp: '2026-11-11T08:00:00Z' }),
    ]),
  });
  assert.deepEqual(await client.tasksDue({ ownerId: '11' }), {
    ok: true,
    data: [
      { id: '1', subject: 'Bad', dueAt: null, type: 'CALL', priority: null },
      { id: '2', subject: 'Good', dueAt: '2026-11-11T08:00:00.000Z', type: null, priority: null },
    ],
  });
});

test('one out-of-range meeting start time gives a null start and keeps the other rows', async (t) => {
  const { client } = await setup(t, {
    [MEETINGS]: page([
      object('1', { hs_meeting_title: 'Bad', hs_meeting_start_time: '99999999999999999', hs_meeting_end_time: '2026-11-11T10:30:00Z' }),
      object('2', { hs_meeting_title: 'Good', hs_meeting_start_time: '2026-11-11T10:00:00Z' }),
    ]),
  });
  assert.deepEqual(await client.upcomingMeetings({ ownerId: '11' }), {
    ok: true,
    data: [
      { id: '1', title: 'Bad', startsAt: null, endsAt: '2026-11-11T10:30:00.000Z' },
      { id: '2', title: 'Good', startsAt: '2026-11-11T10:00:00.000Z', endsAt: null },
    ],
  });
});

test('missingScopes is read from every documented shape and never carries the token', async (t) => {
  const echoed = ['crm.objects.contacts.read', TOKEN, `crm.${TOKEN}.read`, 'x'.repeat(101), 42];
  const shapes = {
    'top-level context.missingScopes': { context: { missingScopes: echoed } },
    'errors[].context.missingScopes': { errors: [{ message: 'm', context: { missingScopes: echoed } }] },
    'errors[].context.requiredGranularScopes': { errors: [{ message: 'm', context: { requiredGranularScopes: echoed } }] },
  };
  for (const [name, extra] of Object.entries(shapes)) {
    await t.test(name, async (t) => {
      const { client } = await setup(t, { [ACCOUNT]: scopesError(extra) });
      const result = await client.account();
      assert.equal(result.error.kind, 'missing-scopes');
      assert.deepEqual(result.error.missingScopes, ['crm.objects.contacts.read']);
      assert.equal(JSON.stringify(result).includes(TOKEN), false);
    });
  }
  await t.test('all shapes together are merged without duplicates', async (t) => {
    const { client } = await setup(t, {
      [ACCOUNT]: scopesError({
        context: { missingScopes: ['a.read'] },
        errors: [{ context: { missingScopes: ['b.read', 'a.read'], requiredGranularScopes: ['c.read', 'b.read'] } }],
      }),
    });
    assert.deepEqual((await client.account()).error.missingScopes, ['a.read', 'b.read', 'c.read']);
  });
});

test('the client never retries', async (t) => {
  const cases = {
    429: { status: 429, headers: { 'Retry-After': '1' }, body: { status: 'error', message: 'slow down' } },
    500: { status: 500, body: { status: 'error', message: 'Internal error' } },
    'dropped connection': { drop: true },
  };
  const kinds = { 429: 'rate-limited', 500: 'bad-response', 'dropped connection': 'network' };
  for (const [name, response] of Object.entries(cases)) {
    await t.test(name, async (t) => {
      const { api, client } = await setup(t, { [ACCOUNT]: response });
      assert.equal((await client.account()).error.kind, kinds[name]);
      assert.equal(api.requests.length, 1);
    });
  }
});

test('the fake server refuses a bearer value that is not its token', async (t) => {
  const { api } = await setup(t, { [ACCOUNT]: { body: { portalId: 1, uiDomain: 'app.hubspot.com' } } }, { token: 'right' });
  const wrong = await createClient({ token: 'wrong', baseUrl: api.url }).account();
  assert.equal(wrong.error.kind, 'unauthorized');
  assert.deepEqual(await createClient({ token: 'right', baseUrl: api.url }).account(), { ok: true, data: { portalId: '1', appOrigin: 'https://app.hubspot.com' } });
  assert.equal(JSON.stringify(api.requests).includes('right'), false);
});

test('account() accepts only an exact lower-case HubSpot app host as uiDomain', async (t) => {
  const cases = {
    'app.hubspot.com.evil.com': null,
    'evilapp.hubspot.com': null,
    'app-eu1.hubspot.com.evil.example': null,
    'APP.HUBSPOT.COM': null,
    'app-eu1.hubspot.com': 'https://app-eu1.hubspot.com',
  };
  for (const [uiDomain, appOrigin] of Object.entries(cases)) {
    await t.test(uiDomain, async (t) => {
      const { client } = await setup(t, { [ACCOUNT]: { body: { portalId: 7, uiDomain } } });
      assert.deepEqual(await client.account(), { ok: true, data: { portalId: '7', appOrigin } });
    });
  }
});

test('invalid arguments return invalid-input and send no request', async (t) => {
  const cases = {
    'tasksDue without ownerId': (c) => c.tasksDue({}),
    'tasksDue with an empty ownerId': (c) => c.tasksDue({ ownerId: '' }),
    'tasksDue with a NaN ownerId': (c) => c.tasksDue({ ownerId: NaN }),
    'tasksDue with an object ownerId': (c) => c.tasksDue({ ownerId: {} }),
    'tasksDue with an invalid before': (c) => c.tasksDue({ ownerId: '1', before: 'tomorrow' }),
    'upcomingMeetings without ownerId': (c) => c.upcomingMeetings({}),
    'upcomingMeetings with an invalid from': (c) => c.upcomingMeetings({ ownerId: '1', from: 'soon' }),
    'upcomingMeetings with an invalid to': (c) => c.upcomingMeetings({ ownerId: 1, to: 'later' }),
    'upcomingMeetings with from after to': (c) => c.upcomingMeetings({ ownerId: '1', from: '2026-11-12T00:00:00Z', to: '2026-11-11T00:00:00Z' }),
    'search with limit 0': (c) => c.search({ query: 'a', limit: 0 }),
    'search with limit 201': (c) => c.search({ query: 'a', limit: 201 }),
    'search with a fractional limit': (c) => c.search({ query: 'a', limit: 2.5 }),
    'search with a string limit': (c) => c.search({ query: 'a', limit: '5' }),
    'search with a 201-character query': (c) => c.search({ query: 'a'.repeat(201) }),
  };
  for (const [name, call] of Object.entries(cases)) {
    await t.test(name, async (t) => {
      const { api, client } = await setup(t, {});
      const result = await call(client);
      assert.equal(result.ok, false);
      assert.equal(result.error.kind, 'invalid-input');
      assert.equal(api.requests.length, 0);
    });
  }
});

test('valid edge arguments are sent', async (t) => {
  const { api, client } = await setup(t, { 'POST /crm/objects/2026-09/deals/search': page([]), [TASKS]: page([]) });
  assert.equal((await client.search({ query: 'a'.repeat(200), types: ['deals'], limit: 200 })).ok, true);
  assert.equal((await client.tasksDue({ ownerId: 11 })).ok, true);
  assert.equal(api.requests.length, 2);
  assert.equal(api.requests[1].body.filterGroups[0].filters[0].value, '11');
});

test('search() keeps good rows when one type fails for any reason', async (t) => {
  const { client } = await setup(t, {
    'POST /crm/objects/2026-09/contacts/search': { status: 429, body: { status: 'error', message: 'slow' } },
    'POST /crm/objects/2026-09/companies/search': page([object('3', { name: 'Acme', domain: 'acme.test' })]),
    'POST /crm/objects/2026-09/deals/search': page([object('4', { dealname: 'Renewal' })]),
  });
  const result = await client.search({ query: 'acme' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, [
    { type: 'companies', id: '3', title: 'Acme', subtitle: 'acme.test' },
    { type: 'deals', id: '4', title: 'Renewal', subtitle: null },
  ]);
  assert.deepEqual(result.partial.map((p) => [p.type, p.error.kind]), [['contacts', 'rate-limited']]);
});

test('search() returns bad-response when every type answers 500', async (t) => {
  const err = { status: 500, body: { status: 'error', message: 'Internal error' } };
  const { client } = await setup(t, {
    'POST /crm/objects/2026-09/contacts/search': err,
    'POST /crm/objects/2026-09/companies/search': err,
    'POST /crm/objects/2026-09/deals/search': err,
  });
  const result = await client.search({ query: 'acme' });
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'bad-response');
});

test('search() with types [deals] sends exactly one request, to the deals path', async (t) => {
  const { api, client } = await setup(t, { 'POST /crm/objects/2026-09/deals/search': page([]) });
  assert.deepEqual(await client.search({ query: 'acme', types: ['deals'] }), { ok: true, data: [] });
  assert.deepEqual(api.requests.map((r) => `${r.method} ${r.path}`), ['POST /crm/objects/2026-09/deals/search']);
});

test('every request asks for JSON', async (t) => {
  const { api, client } = await setup(t, { [ACCOUNT]: { body: { portalId: 1 } }, [TASKS]: page([]) });
  await client.account();
  await client.tasksDue({ ownerId: '1' });
  assert.deepEqual(api.requests.map((r) => [r.method, r.headers.accept]), [['GET', 'application/json'], ['POST', 'application/json']]);
});

test('owners() says truncated when it stops at 1,000 owners with a cursor left', async (t) => {
  const full = Array.from({ length: 100 }, (_, i) => ({ id: String(i), email: null, firstName: 'O', lastName: String(i) }));
  const { api, client } = await setup(t, { 'GET /crm/owners/2026-09': { body: { results: full, paging: { next: { after: 'more' } } } } });
  const result = await client.owners();
  assert.equal(result.ok, true);
  assert.equal(result.truncated, true);
  assert.equal(result.data.length, 1000);
  assert.equal(api.requests.length, 10);
});

test('owners() has no truncated key when the last page has no cursor', async (t) => {
  const { client } = await setup(t, {
    'GET /crm/owners/2026-09': [
      { body: { results: [{ id: '1' }], paging: { next: { after: 'two' } } } },
      { body: { results: [{ id: '2' }] } },
    ],
  });
  const result = await client.owners();
  assert.deepEqual(result, { ok: true, data: [{ id: '1', email: null, name: '1' }, { id: '2', email: null, name: '2' }] });
  assert.equal(Object.hasOwn(result, 'truncated'), false);
});

test('a request that never answers resolves to network after timeoutMs', { timeout: 2000 }, async () => {
  const hang = (url, { signal }) => new Promise((resolve, reject) => {
    const keepAlive = setTimeout(() => {}, 5000);
    signal.addEventListener('abort', () => {
      clearTimeout(keepAlive);
      reject(signal.reason);
    });
  });
  const result = await createClient({ token: TOKEN, fetch: hang, timeoutMs: 50 }).account();
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'network');
});
