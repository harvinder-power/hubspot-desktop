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
- `npm run check:chars` fails on invisible and bidirectional control characters in tracked text files. It prints file, line, column and code point.
- Local `npm run test:e2e` is quiet by default: no shown window or child window, focus, dock icon, dock bounce, tray, notification or global shortcut. CI runs visible.
- A quiet run denies the `notifications` permission, so Chromium shows no web notification. Tests of the tray module pass a stand-in `Tray` class.
- `HUBSPOT_DESKTOP_QUIET=0 npm run test:e2e` forces a visible local run. Quiet runs skip fifteen tests: the thirteen tests in `native tab groups (CI only)`, the last-window-before-ready-to-show test and the hide-and-show test. They need visible windows.
- Agents never force a visible local run without the coordinator's say.
- `npm run fixture` serves the fixture on `http://127.0.0.1:4321` for manual checks.

## CI

- CI runs `npm test` and `npm run test:e2e` on `macos-latest`, `ubuntu-latest` and `windows-latest`. Linux also runs `npm run check:chars`.
- One OS failing does not cancel the others (`fail-fast: false`).
- Linux runs e2e under `xvfb-run`. Windows needs no extra setup.
- The Linux runner has no `libnotify4`, so the e2e suite stubs `Notification.isSupported()` with `show()`.
- Off macOS, tests of macOS-only behaviour skip with a reason: native tab groups and the last window hiding.
- The badge tests record every `app.setBadgeCount` call and read `app.getBadgeCount()` on every OS. No test checks that the Windows taskbar or a Linux launcher draws the count. On Linux, Electron does not report the renderer sandbox flag.
- To read a failure on an OS you do not have:
  - `gh run view <run-id> --log-failed` prints the failing steps of every job.
  - The failed job uploads `test-results/` as the artifact `playwright-results-<os>`.
  - `gh run download <run-id> -n playwright-results-<os>` fetches it. Each failure has an `error-context.md`.
- CI keeps one retry for two known flakes. Both pass on retry:
  - `app.spec.js:88`, Linux only: the first screenshot after launch fails with `Unable to capture screenshot`.
  - `windows.spec.js`, the `focusWindow` helper, Linux and Windows: the focus poll times out, so OS focus did not move in time.
- Do not guess a fix from a test name. Read the failing log line first.
- A test that fails because the app is wrong on one OS gets `test.fixme(process.platform === '<os>', '<reason>')` and an issue.

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
