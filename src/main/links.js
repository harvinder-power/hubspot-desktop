// Link policy: which URLs stay in the app, open in the browser, or are refused.
// Pure module. It must not require electron, so node --test can load it.
const { DEFAULT_BASE_URL } = require('./base-url');

// Each window is in one mode. It starts in 'app'. It enters 'signin' when an app sign-in
// page sends it to another origin, and leaves 'signin' when it reaches an app origin again.
const MODE = { app: 'app', signin: 'signin' };

const REGION_HOST = /^app-[a-z]{2}[0-9]+\.hubspot\.com$/;
// Unverified: nobody has yet checked these against HubSpot's real sign-in pages.
const SIGN_IN_PATHS = ['/login', '/sso'];
// Allowlist. No other scheme ever reaches shell.openExternal.
const EXTERNAL_SCHEMES = ['mailto:', 'tel:', 'sms:', 'callto:'];
const APP_PERMISSIONS = ['notifications', 'media', 'clipboard-read', 'clipboard-sanitized-write'];

function parse(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function overrideOrigin(base) {
  const parsed = base && parse(base);
  if (!parsed || parsed.origin === DEFAULT_BASE_URL) return null;
  return parsed.origin;
}

function isAppOrigin(urlOrOrigin, { base = DEFAULT_BASE_URL } = {}) {
  const url = parse(urlOrOrigin);
  if (!url) return false;
  if (url.origin === overrideOrigin(base)) return true;
  if (url.protocol !== 'https:' || url.port !== '' || url.username || url.password) return false;
  return url.hostname === 'app.hubspot.com' || REGION_HOST.test(url.hostname);
}

function isSignInPage(currentUrl, base) {
  if (!isAppOrigin(currentUrl, { base })) return false;
  const { pathname } = parse(currentUrl);
  return SIGN_IN_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(prefix + '/'));
}

// http: is only usable in dev runs whose override base is itself http, and only on that host.
function isPermittedScheme(url, base) {
  if (url.protocol === 'https:') return true;
  const baseUrl = parse(base);
  return url.protocol === 'http:' && baseUrl?.protocol === 'http:' && url.hostname === baseUrl.hostname;
}

// Ordered rules. decide() applies the first row whose test passes.
// `mode` is the mode after the decision; a row without `mode` leaves it unchanged.
// For kind 'open', an allowed row's mode is the mode the new child window starts in.
const RULES = [
  {
    name: 'blank-popup-from-app',
    test: ({ url, kind, currentUrl, base }) =>
      kind === 'open' && (url === '' || url === 'about:blank') && isAppOrigin(currentUrl, { base }),
    action: 'allow',
    mode: MODE.app,
  },
  { name: 'unparseable', test: ({ target }) => !target, action: 'deny' },
  {
    name: 'blob',
    test: ({ target }) => target.protocol === 'blob:',
    action: ({ target, base }) => (isAppOrigin(target.origin, { base }) ? 'allow' : 'deny'),
  },
  { name: 'external-scheme', test: ({ target }) => EXTERNAL_SCHEMES.includes(target.protocol), action: 'external' },
  { name: 'unsafe-scheme', test: ({ target, base }) => !isPermittedScheme(target, base), action: 'deny' },
  { name: 'app-origin', test: ({ target, base }) => isAppOrigin(target.href, { base }), action: 'allow', mode: MODE.app },
  {
    name: 'enter-sign-in',
    test: ({ mode, currentUrl, base }) => mode === MODE.app && isSignInPage(currentUrl, base),
    action: 'allow',
    mode: MODE.signin,
  },
  {
    name: 'continue-sign-in',
    test: ({ mode, kind }) => mode === MODE.signin && kind === 'navigate',
    action: 'allow',
  },
  { name: 'everything-else', test: () => true, action: 'external' },
];

function decide({ url, currentUrl, mode = MODE.app, kind, base = DEFAULT_BASE_URL }) {
  const context = { url, target: parse(url), currentUrl, mode, kind, base };
  const rule = RULES.find((row) => row.test(context));
  const action = typeof rule.action === 'function' ? rule.action(context) : rule.action;
  return { action, mode: rule.mode ?? mode };
}

function isPermissionAllowed(permission, origin, { base = DEFAULT_BASE_URL } = {}) {
  return APP_PERMISSIONS.includes(permission) && isAppOrigin(origin, { base });
}

module.exports = { MODE, SIGN_IN_PATHS, isAppOrigin, decide, isPermissionAllowed, RULES };
