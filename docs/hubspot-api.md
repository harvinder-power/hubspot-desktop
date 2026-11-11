# HubSpot API client

`src/main/hubspot-api/` is a read-only HubSpot REST client. Later units use it for the Today tray menu and quick-open search. The app does not call it yet.

## Rules

- The client never writes to HubSpot. Every call is a read.
- It uses `POST` only for the CRM search endpoints. Search takes its filters in a JSON body.
- The token is a private-app access token. The user makes it in their own portal. It is portal-wide, so "my tasks" needs an owner ID that the user picks.
- No function rejects. Each one resolves to `{ ok: true, data }` or `{ ok: false, error: { kind, message, missingScopes?, retryAfterMs? } }`.
- `kind` is `unauthorized` (401), `missing-scopes` (403 with category `MISSING_SCOPES`), `forbidden` (other 403), `rate-limited` (429), `network` (fetch threw or timed out after 15 s) or `bad-response` (anything else).
- The client removes the token from every error message.
- The module does not require `electron`.

## Endpoints

All paths use the date version `2026-09` on `https://api.hubapi.com`.

| Function | Request | Source |
|---|---|---|
| `account()` | `GET /account-info/2026-09/details` | [get-account-details](https://developers.hubspot.com/docs/api-reference/latest/account/account-information/get-account-details.md) |
| `owners()` | `GET /crm/owners/2026-09?limit=100&after=…` | [get-owners](https://developers.hubspot.com/docs/api-reference/latest/crm/owners/get-owners.md) |
| `tasksDue()` | `POST /crm/objects/2026-09/tasks/search` | [search-tasks](https://developers.hubspot.com/docs/api-reference/latest/crm/activities/tasks/search/search-tasks.md) |
| `upcomingMeetings()` | `POST /crm/objects/2026-09/meetings/search` | [search-meetings](https://developers.hubspot.com/docs/api-reference/latest/crm/activities/meetings/search/search-meetings.md) |
| `search()` | `POST /crm/objects/2026-09/{contacts,companies,deals}/search` | [search guide](https://developers.hubspot.com/docs/api-reference/latest/crm/search-the-crm.md) |

- `2026-09` is the latest date version. Legacy `v3` paths stop working in September 2027. Source: [migration guide](https://developers.hubspot.com/docs/api-reference/legacy/migration-guide).
- `https://api.hubapi.com` is the root for all APIs. Source: [overview](https://developers.hubspot.com/docs/api-reference/latest/overview). A region-specific API host is not documented. Unverified for EU portals.
- `appOrigin` is `https://` plus the `uiDomain` field of the account details. The client accepts only `app.hubspot.com` or `app-<region>.hubspot.com`, else `null`. The docs give `app.hubspot.com` as the example. The `app-eu1.hubspot.com` value is unverified.
- `portalId` comes from `portalId` (an integer in the spec). The client returns it as a string.
- `owners()` asks for 100 per page (the documented default) and stops at 1,000 owners or 10 pages.
- `tasksDue()` filters `hubspot_owner_id EQ`, `hs_task_status NEQ COMPLETED` and `hs_timestamp LTE before`, sorted by `hs_timestamp` ascending, limit 50. `hs_timestamp` is the due date. Source: [tasks guide](https://developers.hubspot.com/docs/api-reference/latest/crm/activities/tasks/guide.md).
- `upcomingMeetings()` filters `hubspot_owner_id EQ` and `hs_meeting_start_time BETWEEN from and to`, sorted by start time ascending, limit 20. Source: [meetings guide](https://developers.hubspot.com/docs/api-reference/latest/crm/activities/meetings/guide.md).
- Date filter values are Unix milliseconds as strings. The search guide shows this in an example only. Unverified as a rule.
- Sorts use `{ propertyName, direction }`, as the search guide shows. The OpenAPI pages describe sorts as strings. The client follows the guide.
- `search()` sends `query`, which matches the default searchable properties of each type. It sends one search per type at once and merges the results in type order.
- Search results carry no associations. So the client gives no meeting record URL.

## Scopes

`REQUIRED_SCOPES` in `scopes.js` holds this table.

| Function | Scope | Status |
|---|---|---|
| `account()` | none | Unverified. The spec has `security: []`, and the page's scope list is not readable. `account-info.security.read` is for security logs, not details. |
| `owners()` | `crm.objects.owners.read` | Confirmed: [scopes](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/scopes.md), [get-owners](https://developers.hubspot.com/docs/api-reference/latest/crm/owners/get-owners.md) |
| `tasksDue()` | `crm.objects.tasks.read` | Unverified. It is in the search-tasks spec list, but that list has 80 alternatives, and the scopes page does not list it. |
| `upcomingMeetings()` | `crm.objects.meetings.read` | Unverified. Same reason as tasks. |
| `search()` contacts | `crm.objects.contacts.read` | Confirmed: [scopes](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/scopes.md) |
| `search()` companies | `crm.objects.companies.read` | Confirmed: same page |
| `search()` deals | `crm.objects.deals.read` | Confirmed: same page |

If one search type fails with `missing-scopes` and another succeeds, `search()` returns `ok: true` with a `partial: [{ type, error }]` list.

## Errors and rate limits

- Errors carry `category`, `correlationId` and `message`. Source: [get-owners](https://developers.hubspot.com/docs/api-reference/latest/crm/owners/get-owners.md). All fields are optional in practice. Source: [error handling](https://developers.hubspot.com/docs/api-reference/latest/error-handling.md).
- A 403 with category `MISSING_SCOPES` names the scopes in `errors[].context.requiredGranularScopes`. Source: a [community thread](https://community.hubspot.com/t/missing-scope-in-apis/128648). Unverified in the official docs.
- The 429 body has `errorType: "RATE_LIMIT"` and a `policyName`. Source: [usage guidelines](https://developers.hubspot.com/docs/developer-tooling/platform/usage-guidelines.md).
- Private apps get 100 requests per 10 s (Free, Starter) or 190 (Professional, Enterprise). Source: usage guidelines.
- Search has its own limit of 5 requests per second per account, and its answers carry no rate-limit headers. Sources: search guide, usage guidelines.
- A `Retry-After` header on 429 is not documented. Unverified.
- The client does not retry. On 429 it returns `rate-limited`. If a `Retry-After` header is present (seconds or an HTTP date), it adds `retryAfterMs`. The caller decides when to try again.
- One `search()` call sends up to three search requests at once. A caller must not call it more than once per second.

## Tests

- `test/unit/hubspot-api.test.js` and `test/unit/hubspot-api-record-url.test.js`.
- `test/fixture/api-server.js` is a fake API on `node:http`. It serves canned responses per method and path. It refuses a request without a bearer token with a 401. It logs requests with the token redacted.
- No test calls a real HubSpot host.
