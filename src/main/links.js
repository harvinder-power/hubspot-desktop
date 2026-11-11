// Link policy: which URLs stay in the app, open in the browser, or are refused.
// Pure module. It must not require electron, so node --test can load it.
const { DEFAULT_BASE_URL } = require('./base-url');

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

// The kind of the page a window has committed: 'none' (nothing yet), 'app-sign-in',
// 'app', or 'outside' (every other URL, including about:blank, data: and error pages).
function pageKind(committedUrl, { base = DEFAULT_BASE_URL } = {}) {
  if (committedUrl === '') return 'none';
  if (!isAppOrigin(committedUrl, { base })) return 'outside';
  const { pathname } = parse(committedUrl);
  const signIn = SIGN_IN_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(prefix + '/'));
  return signIn ? 'app-sign-in' : 'app';
}

const isWebUrl = (url) => ['http:', 'https:'].includes(parse(url)?.protocol);

// The window title for an outside page, host first. Null means the page owns its title.
function lockedTitle(committedUrl, { base = DEFAULT_BASE_URL } = {}) {
  if (pageKind(committedUrl, { base }) !== 'outside') return null;
  const url = parse(committedUrl);
  return `${url?.hostname || url?.protocol || 'unknown'} (external page)`;
}

// http: is only usable in dev runs whose override base is itself http, and only on that host.
function isPermittedScheme(url, base) {
  if (url.protocol === 'https:') return true;
  const baseUrl = parse(base);
  return url.protocol === 'http:' && baseUrl?.protocol === 'http:' && url.hostname === baseUrl.hostname;
}

// Ordered rules. decide() applies the first row whose test passes.
// `page` is the kind of the page the asking window has committed.
const RULES = [
  {
    name: 'blank-popup-from-app',
    test: ({ url, kind, page }) =>
      kind === 'open' && (url === '' || url === 'about:blank') && (page === 'app' || page === 'app-sign-in'),
    action: 'allow',
  },
  { name: 'unparseable', test: ({ target }) => !target, action: 'deny' },
  {
    name: 'blob',
    test: ({ target }) => target.protocol === 'blob:',
    action: ({ target, base }) => (isAppOrigin(target.origin, { base }) ? 'allow' : 'deny'),
  },
  { name: 'external-scheme', test: ({ target }) => EXTERNAL_SCHEMES.includes(target.protocol), action: 'external' },
  { name: 'unsafe-scheme', test: ({ target, base }) => !isPermittedScheme(target, base), action: 'deny' },
  { name: 'app-origin', test: ({ target, base }) => isAppOrigin(target.href, { base }), action: 'allow' },
  {
    name: 'navigate-from-non-app-page',
    test: ({ kind, page, currentUrl }) =>
      kind === 'navigate' && (page === 'none' || page === 'app-sign-in' || (page === 'outside' && isWebUrl(currentUrl))),
    action: 'allow',
  },
  { name: 'sign-in-popup', test: ({ kind, page }) => kind === 'open' && page === 'app-sign-in', action: 'allow' },
  { name: 'everything-else', test: () => true, action: 'external' },
];

// Returns 'allow', 'external' or 'deny'. `currentUrl` is the committed URL of the asking window.
function decide({ url, currentUrl, kind, base = DEFAULT_BASE_URL }) {
  const context = { url, target: parse(url), currentUrl, page: pageKind(currentUrl, { base }), kind, base };
  const rule = RULES.find((row) => row.test(context));
  return typeof rule.action === 'function' ? rule.action(context) : rule.action;
}

function isPermissionAllowed(permission, origin, { base = DEFAULT_BASE_URL } = {}) {
  return APP_PERMISSIONS.includes(permission) && isAppOrigin(origin, { base });
}

module.exports = { SIGN_IN_PATHS, isAppOrigin, pageKind, lockedTitle, decide, isPermissionAllowed, RULES };
