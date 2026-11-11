// Read-only HubSpot REST client. Pure module: no electron, no module state.
// Endpoints, scopes and limits, with their doc sources: docs/hubspot-api.md.
//
// Every function resolves, never rejects, to a Result:
//   { ok: true, data }
//   { ok: false, error: { kind, message, missingScopes?, retryAfterMs? } }
// kind is one of the ERROR_KINDS below. search() may add `partial` to an ok Result.
const { REQUIRED_SCOPES } = require('./scopes');
const { OBJECT_TYPE_IDS, recordUrl } = require('./record-url');

const API_VERSION = '2026-09';
const ERROR_KINDS = Object.freeze(['unauthorized', 'missing-scopes', 'forbidden', 'rate-limited', 'network', 'bad-response']);
const OWNERS_PAGE_SIZE = 100;
const MAX_OWNERS = 1000;
const MAX_TASKS = 50;
const MAX_MEETINGS = 20;
const TIMEOUT_MS = 15000;
const DAY_MS = 24 * 60 * 60 * 1000;
const APP_HOST = /^app(-[a-z]{2}[0-9]+)?\.hubspot\.com$/;

const ok = (data) => ({ ok: true, data });
const fail = (kind, message, extra = {}) => ({ ok: false, error: { kind, message, ...extra } });
const badShape = () => fail('bad-response', 'HubSpot answered with an unexpected shape');

const str = (value) => (typeof value === 'string' && value !== '' ? value : null);

function isoOrNull(value) {
  const text = str(value);
  if (!text) return null;
  const ms = /^\d+$/.test(text) ? Number(text) : Date.parse(text);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

// One row per searchable type: the properties to ask for and how a person recognises a hit.
const SEARCH_TYPES = Object.freeze({
  contacts: {
    properties: ['firstname', 'lastname', 'email', 'company'],
    hit: (p, id) => {
      const name = [str(p.firstname), str(p.lastname)].filter(Boolean).join(' ');
      return { title: name || str(p.email) || `Contact ${id}`, subtitle: (name && str(p.email)) || str(p.company) };
    },
  },
  companies: {
    properties: ['name', 'domain'],
    hit: (p, id) => ({ title: str(p.name) || str(p.domain) || `Company ${id}`, subtitle: str(p.name) ? str(p.domain) : null }),
  },
  deals: {
    properties: ['dealname'],
    hit: (p, id) => ({ title: str(p.dealname) || `Deal ${id}`, subtitle: null }),
  },
});

function parseRetryAfter(value, now) {
  const text = str(value && value.trim());
  if (!text) return undefined;
  if (/^\d+$/.test(text)) return Number(text) * 1000;
  const at = Date.parse(text);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now());
}

function scopesFrom(body) {
  const errors = Array.isArray(body?.errors) ? body.errors : [];
  const scopes = errors.flatMap((e) => (Array.isArray(e?.context?.requiredGranularScopes) ? e.context.requiredGranularScopes : []));
  return [...new Set(scopes.filter((s) => typeof s === 'string'))];
}

function searchRows(json) {
  if (!json || !Array.isArray(json.results)) return null;
  const valid = json.results.every((r) => r && typeof r.id === 'string' && r.properties && typeof r.properties === 'object');
  return valid ? json.results : null;
}

function createClient({ token, fetch = globalThis.fetch, baseUrl = 'https://api.hubapi.com', now = () => Date.now() } = {}) {
  const scrub = (text) => (token ? String(text).split(token).join('[token]') : String(text));

  async function request(method, path, body) {
    let res;
    try {
      res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      return fail('network', scrub(`Could not reach HubSpot (${err?.cause?.code || err?.name || 'error'})`));
    }
    let json;
    try {
      json = await res.json();
    } catch {
      json = undefined;
    }
    const said = typeof json?.message === 'string' ? `: ${json.message}` : '';
    const { status } = res;
    if (status === 401) return fail('unauthorized', scrub(`HubSpot refused the token (401)${said}`));
    if (status === 403 && json?.category === 'MISSING_SCOPES') {
      return fail('missing-scopes', scrub(`The token is missing scopes (403)${said}`), { missingScopes: scopesFrom(json) });
    }
    if (status === 403) return fail('forbidden', scrub(`HubSpot refused access (403)${said}`));
    if (status === 429) {
      const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'), now);
      return fail('rate-limited', scrub(`HubSpot rate limit reached (429)${said}`), retryAfterMs === undefined ? {} : { retryAfterMs });
    }
    if (status < 200 || status >= 300) return fail('bad-response', scrub(`HubSpot answered ${status}${said}`));
    if (json === undefined) return fail('bad-response', 'HubSpot answered with a body that is not JSON');
    return ok(json);
  }

  async function searchObjects(type, body) {
    const result = await request('POST', `/crm/objects/${API_VERSION}/${type}/search`, body);
    if (!result.ok) return result;
    const rows = searchRows(result.data);
    return rows ? ok(rows) : badShape();
  }

  const ownerWindow = (ownerId, extra) => [{ filters: [{ propertyName: 'hubspot_owner_id', operator: 'EQ', value: String(ownerId) }, ...extra] }];

  async function account() {
    const result = await request('GET', `/account-info/${API_VERSION}/details`);
    if (!result.ok) return result;
    const { portalId, uiDomain } = result.data || {};
    if (!Number.isInteger(portalId) && !str(portalId)) return badShape();
    const host = str(uiDomain);
    return ok({ portalId: String(portalId), appOrigin: host && APP_HOST.test(host) ? `https://${host}` : null });
  }

  async function owners() {
    const all = [];
    let after = null;
    do {
      const query = new URLSearchParams({ limit: String(OWNERS_PAGE_SIZE) });
      if (after) query.set('after', after);
      const page = await request('GET', `/crm/owners/${API_VERSION}?${query}`);
      if (!page.ok) return page;
      const rows = page.data?.results;
      if (!Array.isArray(rows) || !rows.every((o) => o && typeof o.id === 'string')) return badShape();
      for (const o of rows) {
        const name = [str(o.firstName), str(o.lastName)].filter(Boolean).join(' ');
        all.push({ id: o.id, email: str(o.email), name: name || str(o.email) || o.id });
      }
      after = str(page.data?.paging?.next?.after);
    } while (after && all.length < MAX_OWNERS);
    return ok(all.slice(0, MAX_OWNERS));
  }

  async function tasksDue({ ownerId, before = new Date(now()).toISOString() }) {
    const result = await searchObjects('tasks', {
      filterGroups: ownerWindow(ownerId, [
        { propertyName: 'hs_task_status', operator: 'NEQ', value: 'COMPLETED' },
        { propertyName: 'hs_timestamp', operator: 'LTE', value: String(Date.parse(before)) },
      ]),
      sorts: [{ propertyName: 'hs_timestamp', direction: 'ASCENDING' }],
      properties: ['hs_task_subject', 'hs_timestamp', 'hs_task_type', 'hs_task_priority'],
      limit: MAX_TASKS,
    });
    if (!result.ok) return result;
    return ok(result.data.map(({ id, properties: p }) => ({
      id,
      subject: str(p.hs_task_subject),
      dueAt: isoOrNull(p.hs_timestamp),
      type: str(p.hs_task_type),
      priority: str(p.hs_task_priority),
    })));
  }

  async function upcomingMeetings({ ownerId, from = new Date(now()).toISOString(), to = new Date(now() + DAY_MS).toISOString() }) {
    const result = await searchObjects('meetings', {
      filterGroups: ownerWindow(ownerId, [
        { propertyName: 'hs_meeting_start_time', operator: 'BETWEEN', value: String(Date.parse(from)), highValue: String(Date.parse(to)) },
      ]),
      sorts: [{ propertyName: 'hs_meeting_start_time', direction: 'ASCENDING' }],
      properties: ['hs_meeting_title', 'hs_meeting_start_time', 'hs_meeting_end_time'],
      limit: MAX_MEETINGS,
    });
    if (!result.ok) return result;
    return ok(result.data.map(({ id, properties: p }) => ({
      id,
      title: str(p.hs_meeting_title),
      startsAt: isoOrNull(p.hs_meeting_start_time),
      endsAt: isoOrNull(p.hs_meeting_end_time),
    })));
  }

  async function search({ query, types = ['contacts', 'companies', 'deals'], limit = 5 }) {
    const text = str(query && query.trim());
    const known = types.filter((type) => Object.hasOwn(SEARCH_TYPES, type));
    if (!text || known.length === 0) return ok([]);
    const settled = await Promise.all(known.map(async (type) => ({
      type,
      result: await searchObjects(type, { query: text, properties: SEARCH_TYPES[type].properties, limit }),
    })));
    const failures = settled.filter((s) => !s.result.ok);
    const hard = failures.find((f) => f.result.error.kind !== 'missing-scopes');
    if (hard) return hard.result;
    if (failures.length === settled.length) {
      const missingScopes = [...new Set(failures.flatMap((f) => f.result.error.missingScopes))];
      return fail('missing-scopes', 'The token has none of the scopes that search needs', { missingScopes });
    }
    const data = settled
      .filter((s) => s.result.ok)
      .flatMap(({ type, result }) => result.data.map(({ id, properties }) => ({ type, id, ...SEARCH_TYPES[type].hit(properties, id) })));
    if (failures.length === 0) return ok(data);
    return { ok: true, data, partial: failures.map(({ type, result }) => ({ type, error: result.error })) };
  }

  const safe = (fn) => async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      return fail('bad-response', scrub(`Unexpected client error: ${err?.message}`));
    }
  };

  return {
    account: safe(account),
    owners: safe(owners),
    tasksDue: safe(tasksDue),
    upcomingMeetings: safe(upcomingMeetings),
    search: safe(search),
  };
}

module.exports = { API_VERSION, ERROR_KINDS, MAX_OWNERS, OBJECT_TYPE_IDS, REQUIRED_SCOPES, createClient, recordUrl };
