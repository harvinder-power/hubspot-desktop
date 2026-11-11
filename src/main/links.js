// Link policy: which URLs stay in the app, open in the browser, or are refused.
// Pure module. It must not require electron, so node --test can load it.
const { DEFAULT_BASE_URL } = require('./base-url');

const REGION_HOST = /^app-[a-z]{2}[0-9]+\.hubspot\.com$/;
const SIGN_IN_PATHS = ['/login', '/sso', '/oauth'];
const EXTERNAL_SCHEMES = ['mailto:', 'tel:'];
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

function isInSignInFlow(currentUrl, base) {
  if (!isAppOrigin(currentUrl, { base })) return true;
  const { pathname } = parse(currentUrl);
  return SIGN_IN_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(prefix + '/'));
}

// http: is only usable in dev runs whose override base is itself http, and only on that host.
function isPermittedScheme(url, base) {
  if (url.protocol === 'https:') return true;
  const baseUrl = parse(base);
  return url.protocol === 'http:' && baseUrl?.protocol === 'http:' && url.hostname === baseUrl.hostname;
}

// Ordered rules. decide() returns the result of the first row whose test passes.
const RULES = [
  { name: 'unparseable', test: ({ target }) => !target, result: 'deny' },
  { name: 'mail-or-phone', test: ({ target }) => EXTERNAL_SCHEMES.includes(target.protocol), result: 'external' },
  { name: 'unsafe-scheme', test: ({ target, base }) => !isPermittedScheme(target, base), result: 'deny' },
  { name: 'app-origin', test: ({ target, base }) => isAppOrigin(target.href, { base }), result: 'allow' },
  {
    name: 'sign-in-flow',
    test: ({ kind, currentUrl, base }) => kind === 'navigate' && isInSignInFlow(currentUrl, base),
    result: 'allow',
  },
  { name: 'everything-else', test: () => true, result: 'external' },
];

function decide({ url, currentUrl, kind, base = DEFAULT_BASE_URL }) {
  const context = { target: parse(url), currentUrl, kind, base };
  return RULES.find((rule) => rule.test(context)).result;
}

function isPermissionAllowed(permission, origin, { base = DEFAULT_BASE_URL } = {}) {
  return APP_PERMISSIONS.includes(permission) && isAppOrigin(origin, { base });
}

module.exports = { isAppOrigin, decide, isPermissionAllowed, RULES };
