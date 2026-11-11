// Link policy: which URLs stay in the app, open in the browser, or are refused.
// Pure module. It must not require electron, so node --test can load it.
const { DEFAULT_BASE_URL } = require('./base-url');

const REGION_HOST = /^app-[a-z]{2}[0-9]+\.hubspot\.com$/;
// Unverified: nobody has yet checked these against HubSpot's real sign-in pages.
const SIGN_IN_PATHS = ['/login', '/sso'];
// Allowlist. With http: and https:, no other scheme ever reaches shell.openExternal.
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

// The kind of the page a window has committed: 'none' (nothing yet), 'blank' (about:blank, which
// window.open('') and window.open('about:blank') commit), 'app-sign-in', 'app', or 'outside'
// (every other URL, including data: and error pages).
function pageKind(committedUrl, { base = DEFAULT_BASE_URL } = {}) {
  if (committedUrl === '') return 'none';
  if (committedUrl === 'about:blank') return 'blank';
  if (!isAppOrigin(committedUrl, { base })) return 'outside';
  const { pathname } = parse(committedUrl);
  const signIn = SIGN_IN_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(prefix + '/'));
  return signIn ? 'app-sign-in' : 'app';
}

// The kind of a window a page opens, fixed from the URL it requests: 'app' for an app URL or a blank
// page (which only an app page may open), else 'outside-popup'. Only an app window may join the tab group.
function childWindowKind(requestedUrl, { base = DEFAULT_BASE_URL } = {}) {
  const blank = requestedUrl === '' || requestedUrl === 'about:blank';
  return blank || isAppOrigin(requestedUrl, { base }) ? 'app' : 'outside-popup';
}

// Page kinds a window may be tabbed on. A sign-in page counts: it is an app page the user signs in on.
const TAB_PAGE_KINDS = ['app', 'app-sign-in'];

// Whether a window may be in a native tab group, or host one, read from its committed state:
// registry membership and the kind of the page it has committed. Every other window is separate.
function tabEligible({ inRegistry, committedKind }) {
  return inRegistry === true && TAB_PAGE_KINDS.includes(committedKind);
}

const isWebUrl = (url) => ['http:', 'https:'].includes(parse(url)?.protocol);

// The window title for a page that may not choose its own, host first. Null means the page owns its title.
// `origin` is the origin of the committed document (the main frame's origin), not of its URL.
// An app page owns its title. An empty or blank document inherits the origin of the page that created
// or navigated it, so it owns its title only when that origin is the app origin: the app can title
// a page it writes into, and an outside page that writes into or navigates a window cannot.
function lockedTitle(committedUrl, { base = DEFAULT_BASE_URL, origin = 'null' } = {}) {
  const kind = pageKind(committedUrl, { base });
  if (kind === 'app' || kind === 'app-sign-in') return null;
  if ((kind === 'none' || kind === 'blank') && isAppOrigin(origin, { base })) return null;
  const url = parse(committedUrl);
  return `${url?.hostname || url?.protocol || 'unknown'} (external page)`;
}

// http: is only usable in dev runs whose override base is itself http, and only on that host.
// 127.0.0.1 and localhost count as one host, so a test can show two outside hostnames.
const LOOPBACK = ['127.0.0.1', 'localhost'];
const sameDevHost = (a, b) => a === b || (LOOPBACK.includes(a) && LOOPBACK.includes(b));
function isPermittedScheme(url, base) {
  if (url.protocol === 'https:') return true;
  const baseUrl = parse(base);
  return url.protocol === 'http:' && baseUrl?.protocol === 'http:' && sameDevHost(url.hostname, baseUrl.hostname);
}

// Ordered rules. decide() applies the first row whose test passes.
// `page` is the kind of the page the asking window has committed.
// Every page test is false for 'blank', so a blank page gets what a non-web outside page gets.
// An outside page gains nothing by going blank: it is trusted no more, and the empty page has no script.
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
  // An http: link never loads in a window. From an app page (or the blank popup it writes) it opens in the browser.
  // During sign-in it stays refused, so a provider cannot downgrade the flow or hand a sign-in URL to plain http.
  {
    name: 'http-from-app',
    test: ({ target, page, base }) =>
      target.protocol === 'http:' && (page === 'app' || page === 'blank') && !isPermittedScheme(target, base),
    action: 'external',
  },
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

module.exports = { SIGN_IN_PATHS, isAppOrigin, pageKind, childWindowKind, tabEligible, lockedTitle, decide, isPermissionAllowed, RULES };
