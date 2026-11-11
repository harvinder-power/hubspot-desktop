const { _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..', '..');
const evidenceDir = process.env.EVIDENCE_DIR || path.join(repoRoot, 'test-results', 'evidence');

// Launches the app against `baseUrl` with its own user-data directory and a stubbed shell.openExternal.
async function launchApp(baseUrl) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hubspot-desktop-e2e-'));
  const electronApp = await electron.launch({
    args: [repoRoot],
    env: { ...process.env, HUBSPOT_DESKTOP_BASE_URL: baseUrl, HUBSPOT_DESKTOP_USER_DATA: dir },
  });
  await electronApp.evaluate(({ shell }) => {
    globalThis.openedExternally = [];
    shell.openExternal = async (url) => {
      globalThis.openedExternally.push(url);
    };
  });
  return { electronApp, dir };
}

// Every test starts from an explicit page with an empty openedExternally list.
async function startAt(electronApp, page, url) {
  await page.goto(url);
  await electronApp.evaluate(() => { globalThis.openedExternally = []; });
}

module.exports = { repoRoot, evidenceDir, launchApp, startAt };
