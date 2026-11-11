// Fake HubSpot for tests. Imitates HubSpot URL shapes only; no real data.
const http = require('node:http');

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function page(title, body) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body>${body}</body></html>`;
}

function hubPage(path, portalId) {
  const links = {
    contact: `/contacts/${portalId}/record/0-1/101`,
    deal: `/contacts/${portalId}/record/0-3/202`,
    list: `/contacts/${portalId}/objects/0-1/views/all/list`,
  };
  return page(path, `
<h1>${escapeHtml(path)}</h1>
<ul>
  <li><a id="contact-link" href="${links.contact}">Contact record</a></li>
  <li><a id="deal-link" href="${links.deal}">Deal record</a></li>
  <li><a id="external-link" href="https://example.com">External site</a></li>
  <li><a id="blank-link" href="${links.list}" target="_blank">Contacts list in new window</a></li>
  <li><a id="editor-link" href="/editor">Editor</a></li>
</ul>
<button id="notify" onclick="new Notification('Test', { body: 'x' })">Notify</button>`);
}

function editorPage() {
  return page('Editor', `
<h1>Editor</h1>
<div id="editor" contenteditable="true" style="border:1px solid #888;min-height:4em"></div>
<input id="text-input" type="text">`);
}

// Sign-in page. Links to an identity provider on another origin, as SSO does.
function loginPage(idpOrigin, returnTo) {
  const href = `${idpOrigin}/idp/authorize?return_to=${encodeURIComponent(returnTo)}`;
  return page('Log in', `
<h1>Log in</h1>
<a id="idp-link" href="${escapeHtml(href)}">Sign in with your identity provider</a>`);
}

// Identity provider page. Links back to the return_to URL, as a completed sign-in does.
function idpPage(returnTo) {
  return page('Identity provider', `
<h1>Identity provider</h1>
<a id="return-link" href="${escapeHtml(returnTo)}">Continue to HubSpot</a>`);
}

function handle(req, res, portalId, idpOrigin) {
  const { pathname, searchParams } = new URL(req.url, 'http://fixture');
  if (pathname === '/') {
    res.writeHead(302, { Location: `/reports-dashboard/${portalId}` });
    return res.end();
  }
  // Server redirect to the identity provider, as some sign-in starts do.
  if (pathname === '/redirect-out') {
    const returnTo = `http://${req.headers.host}/reports-dashboard/${portalId}`;
    res.writeHead(302, { Location: `${idpOrigin}/idp/authorize?return_to=${encodeURIComponent(returnTo)}` });
    return res.end();
  }
  const title = pathname.match(/^\/title\/(\d+)$/);
  let html;
  if (title) html = page(`(${title[1]}) Inbox`, `<h1>(${title[1]}) Inbox</h1>`);
  else if (pathname === '/editor') html = editorPage();
  else if (pathname === '/login') html = loginPage(idpOrigin, `http://${req.headers.host}/reports-dashboard/${portalId}`);
  else if (pathname === '/idp/authorize') html = idpPage(searchParams.get('return_to') || '/');
  else html = hubPage(pathname, portalId);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function start(port = 0, { portalId = '111', idpOrigin = '' } = {}) {
  const server = http.createServer((req, res) => handle(req, res, portalId, idpOrigin));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        portalId,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

module.exports = { start };

if (require.main === module) {
  start(Number(process.env.PORT) || 4321).then(({ url }) => console.log(`Fixture listening on ${url}`));
}
