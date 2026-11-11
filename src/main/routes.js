// App destinations and the portal context they resolve against.
// Pure module. It must not require electron, so node --test can load it.
const { DEFAULT_BASE_URL } = require('./base-url');
const { pageKind } = require('./links');

// Menu order. Accelerators are CmdOrCtrl+1 to CmdOrCtrl+8 in this order.
const ROUTES = Object.freeze(
  [
    { id: 'dashboards', label: 'Dashboards', path: (p) => `/reports-dashboard/${p}` },
    { id: 'contacts', label: 'Contacts', path: (p) => `/contacts/${p}/objects/0-1/views/all/list` },
    { id: 'companies', label: 'Companies', path: (p) => `/contacts/${p}/objects/0-2/views/all/list` },
    { id: 'deals', label: 'Deals', path: (p) => `/contacts/${p}/objects/0-3/views/all/board` },
    { id: 'tickets', label: 'Tickets', path: (p) => `/contacts/${p}/objects/0-5/views/all/list` },
    { id: 'tasks', label: 'Tasks', path: (p) => `/tasks/${p}/view/all` },
    { id: 'inbox', label: 'Inbox', path: (p) => `/live-messages/${p}` },
    { id: 'meetings', label: 'Meetings', path: (p) => `/meetings/${p}` },
  ].map((route, index) => Object.freeze({ ...route, accelerator: `CmdOrCtrl+${index + 1}` }))
);

const PORTAL_PATH = /^\/[^/]+\/(\d+)(?:\/|$)/;

// { origin, portalId } for an app page (not a sign-in page) whose path starts /<segment>/<digits>, else null.
function portalContext(url, { base = DEFAULT_BASE_URL } = {}) {
  if (pageKind(url, { base }) !== 'app') return null;
  const { origin, pathname } = new URL(url);
  const match = pathname.match(PORTAL_PATH);
  return match ? { origin, portalId: match[1] } : null;
}

// With no context, the app root: HubSpot sends it to sign-in or to the portal home.
function resolve(routeId, context, { base = DEFAULT_BASE_URL } = {}) {
  const route = ROUTES.find((r) => r.id === routeId);
  if (!route) throw new Error(`Unknown route: ${routeId}`);
  if (!context) return `${base}/`;
  return context.origin + route.path(context.portalId);
}

// The last portal context of the main frame. `opener` says what opened the window: null (the app's own
// menus and buttons), 'app' (an app page) or 'outside' (an outside page).
// An app sign-in page clears it (signed out), unless a page opened that window and other windows remain:
// a link to /login in a new window does not sign out the other windows. A window an outside page opened
// never sets it. An outside page (mid sign-in) or an app page without a portal ID keeps the previous one.
function portalTracker({ base = DEFAULT_BASE_URL } = {}) {
  let last = null;
  return {
    observe(url, { opener = null, alone = false } = {}) {
      if (pageKind(url, { base }) === 'app-sign-in' && (opener === null || alone)) last = null;
      else if (opener !== 'outside') last = portalContext(url, { base }) ?? last;
    },
    get context() {
      return last;
    },
  };
}

module.exports = { ROUTES, portalContext, resolve, portalTracker };
