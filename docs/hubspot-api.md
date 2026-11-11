# HubSpot API client

`src/main/hubspot-api/` is a read-only HubSpot REST client. Later units use it for the Today tray menu and quick-open search. The app does not call it yet.

## Rules

- Every call is a read. The client uses `POST` only for the CRM search endpoints. It does not require `electron`.
- The token is a private-app access token from the user's own portal. It is portal-wide, so "my tasks" needs an owner ID that the user picks.
- No function rejects. Each one resolves to `{ ok: true, data }` or `{ ok: false, error: { kind, message, missingScopes?, retryAfterMs? } }`.
- `kind` is one of these:
  - `unauthorized`: 401.
  - `missing-scopes`: 403 with category `MISSING_SCOPES`.
  - `forbidden`: any other 403.
  - `rate-limited`: 429.
  - `network`: fetch threw, or no answer came within `timeoutMs` (default 15,000).
  - `bad-response`: any other status, a body that is not JSON, or an unexpected shape.
  - `invalid-input`: an argument failed validation. The client sent no request.
- The client never retries. The caller decides when to try again.
- The client removes the token from `message` and from each `missingScopes` entry. These are the only fields that carry server text.

## Validation

Each function checks its arguments before it sends a request. A failure returns `invalid-input`.

- `ownerId` is a non-empty string or a finite number.
- `before`, `from` and `to` are ISO strings or Unix milliseconds that give a valid date.
- `from` is not after `to`.
- `limit` is an integer from 1 to 200. The client does not clamp it. 200 is the documented search maximum.
- `query` is at most 200 characters after trim. A blank query returns `ok: true` with no rows and sends nothing.

## Endpoints

All paths use the date version `2026-09` on `https://api.hubapi.com`.

| Function | Request | Source |
|---|---|---|
| `account()` | `GET /account-info/2026-09/details` | [get-account-details](https://developers.hubspot.com/docs/api-reference/latest/account/account-information/get-account-details.md) |
| `owners()` | `GET /crm/owners/2026-09?limit=100&after=…` | [get-owners](https://developers.hubspot.com/docs/api-reference/latest/crm/owners/get-owners.md) |
| `tasksDue()` | `POST /crm/objects/2026-09/tasks/search` | [search-tasks](https://developers.hubspot.com/docs/api-reference/latest/crm/activities/tasks/search/search-tasks.md) |
| `upcomingMeetings()` | `POST /crm/objects/2026-09/meetings/search` | [search-meetings](https://developers.hubspot.com/docs/api-reference/latest/crm/activities/meetings/search/search-meetings.md) |
| `search()` | `POST /crm/objects/2026-09/{contacts,companies,deals}/search` | [search guide](https://developers.hubspot.com/docs/api-reference/latest/crm/search-the-crm.md) |

- `account()` returns `portalId` as a string and `appOrigin`. `appOrigin` is `https://` plus `uiDomain` when `uiDomain` is exactly `app.hubspot.com` or `app-<region>.hubspot.com` in lower case. Else it is `null`.
- `owners()` asks for 100 per page. It stops at 1,000 owners, at the last page, or at an empty page that still has a cursor. When it stops with a cursor left, the Result has `truncated: true`. Else it has no `truncated` key.
- `tasksDue()` filters `hubspot_owner_id EQ`, `hs_task_status NEQ COMPLETED` and `hs_timestamp LTE before`, soonest first, limit 50. Source: [tasks guide](https://developers.hubspot.com/docs/api-reference/latest/crm/activities/tasks/guide.md).
- `upcomingMeetings()` filters `hubspot_owner_id EQ` and `hs_meeting_start_time BETWEEN from and to`, soonest first, limit 20. Source: [meetings guide](https://developers.hubspot.com/docs/api-reference/latest/crm/activities/meetings/guide.md).
- A timestamp that does not give a valid date becomes `null`. The row keeps its other fields.
- `search()` sends one search per type at once and merges the rows in type order. When some types fail, it returns `ok: true` with the good rows and `partial: [{ type, error }]` for each failed type, whatever the error kind. When all types fail, it returns the first failure. When all fail with `missing-scopes`, it returns one `missing-scopes` error with the merged scope list.

## Scopes

`REQUIRED_SCOPES` in `scopes.js` holds this table. The [scopes page](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/scopes.md) describes apps on the developer platform. It does not mention private apps.

| Function | Scope | Page that lists it | Private app can grant it |
|---|---|---|---|
| `account()` | none | get-account-details lists `oauth`. The scopes page says `oauth` is added by default to all apps. | Unverified. The client keeps `[]`. |
| `owners()` | `crm.objects.owners.read` | get-owners, scopes page | Unverified |
| `tasksDue()` | `crm.objects.contacts.read` | search-tasks "Required Scopes". The scopes page has no tasks scope. | Unverified |
| `upcomingMeetings()` | `crm.objects.contacts.read` | search-meetings "Required Scopes". The scopes page has no meetings scope. | Unverified |
| `search()` contacts | `crm.objects.contacts.read` | scopes page | Unverified |
| `search()` companies | `crm.objects.companies.read` | scopes page | Unverified |
| `search()` deals | `crm.objects.deals.read` | scopes page | Unverified |

## Errors and rate limits

- A 403 `MISSING_SCOPES` body can name scopes in `context.missingScopes`, `errors[].context.missingScopes` or `errors[].context.requiredGranularScopes`. The client reads all three and removes duplicates. Sources: the error schema examples in the search-tasks spec, and a [community thread](https://community.hubspot.com/t/missing-scope-in-apis/128648).
- The client keeps only scope entries that match `^[a-z0-9._-]+$` and have at most 100 characters.
- On 429 the client returns `rate-limited`. A `Retry-After` header (seconds or an HTTP date) adds `retryAfterMs`.
- Private apps get 100 requests per 10 s (Free, Starter) or 190 (Professional, Enterprise). Search allows 5 requests per second per account. Source: [usage guidelines](https://developers.hubspot.com/docs/developer-tooling/platform/usage-guidelines.md). One `search()` call sends up to three requests, so call it at most once per second.

## Record URLs

`recordUrl({ appOrigin, portalId, type, id })` in `record-url.js` builds a web-app link:

`<appOrigin>/contacts/<portalId>/record/<objectTypeId>/<id>`

| Type | `OBJECT_TYPE_IDS` |
|---|---|
| contacts | `0-1` |
| companies | `0-2` |
| deals | `0-3` |
| tickets | `0-5` |
| tasks | `0-27` |

The maintainers measured this shape on the real web app on 2026-11-11 for all five types. `recordUrl` returns `null` for an unknown type or a missing part. It has no meeting type, so the client gives no meeting URL.

## Unverified without a real token

- The scopes a private app needs for each function, and whether `account()` needs any.
- The `app-<region>.hubspot.com` value of `uiDomain`, and a region-specific API host for EU portals.
- Unix milliseconds as strings for date filters (the search guide shows this in an example only).
- Sorts as `{ propertyName, direction }` (the guide shows this; the OpenAPI pages show strings).
- Which of the three scope shapes a real 403 uses.
- A `Retry-After` header on 429.

## Tests

- `test/unit/hubspot-api.test.js`, `test/unit/hubspot-api-contract.test.js` and `test/unit/hubspot-api-record-url.test.js`.
- `test/fixture/api-server.js` is a fake API on `node:http`. `start(port, { script, token })` serves canned responses per method and path. A response `{ drop: true }` closes the connection. With `token`, any other bearer value gets a 401 in HubSpot's error shape. The request log redacts the token. No test calls a real HubSpot host.
