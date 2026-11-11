# AGENTS.md

## What this is

- An open-source Electron desktop client for HubSpot.
- It wraps the HubSpot web app. It is not an official HubSpot product.
- It supports any portal and any data region (`app.hubspot.com`, `app-eu1.hubspot.com`, ...).
- Never hardcode a portal ID, a region, or a customer-specific route.
- The app sends no telemetry.
- New assets carry no HubSpot trademarks (name, logo, sprocket).

## Branches

- `next` is the integration branch. Open PRs against `next`.
- `main` is production. Only Harvinder merges `next` into `main`.
- Never commit to `next` or `main` directly. Work on a feature branch.

## Commands

- `npm start` runs the app against the real HubSpot. Humans only.
- `npm test` runs the unit tests (`node --test test/unit/*.test.js`).
- `npm run test:e2e` drives the real Electron app with Playwright against the fixture server.
- `npm run build` builds the macOS app with electron-builder.
- Local `npm run test:e2e` is quiet by default: no shown window or child window, focus, dock icon, dock bounce, tray or global shortcut. CI runs visible.
- `HUBSPOT_DESKTOP_QUIET=0 npm run test:e2e` forces a visible local run. Quiet runs skip eleven tests: the nine tests in `native tab groups (CI only)`, the last-window-before-ready-to-show test and the hide-and-show test. They need visible windows.
- Agents never force a visible local run without the coordinator's say.
- `npm run fixture` serves the fixture on `http://127.0.0.1:4321` for manual checks.

## Fixture and overrides

- `test/fixture/server.js` is a fake HubSpot. It imitates HubSpot URL shapes. It has no real data.
- `start(port, { portalId })` returns `{ url, portalId, close }`. The e2e suite uses portal `4242`.
- These variables work only in unpackaged runs. Packaged builds ignore them.
  - `HUBSPOT_DESKTOP_BASE_URL` replaces `https://app.hubspot.com` as the base URL.
  - `HUBSPOT_DESKTOP_USER_DATA` replaces the user-data directory. Tests use a temp directory.
- `EVIDENCE_DIR` sets where the e2e suite saves screenshots. The default is `test-results/evidence`.

## Running Electron from an agent shell

- Electron cannot launch inside the macOS Bash sandbox.
- The error is `bootstrap_check_in ... MachPortRendezvousServer: Permission denied (1100)`, then SIGTRAP.
- The sandbox also blocks local port binding (`listen EPERM`) and TLS to npm and GitHub.
- Run each of these as one plain command with the sandbox disabled:
  - `npm ci`
  - `npm test`
  - `EVIDENCE_DIR=<dir> npm run test:e2e`
- Do not use `cd <dir> &&` or pipes. Use `npm --prefix <repo> ...` instead.
- Electron 45 downloads its binary on first launch. `node node_modules/electron/install.js` fetches it ahead of time.

## Bans

- Agents never type, request, or store credentials.
- Tests never load the real `app.hubspot.com` or any other real HubSpot host. Use the fixture.
- Tests stub `shell.openExternal`, so no real browser opens.
- Never commit screenshots or evidence.
