const test = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('../fixture/server');

test('fixture server imitates HubSpot URL shapes', async (t) => {
  const fixture = await start(0, { portalId: '4242' });
  t.after(() => fixture.close());

  const title = (html) => html.match(/<title>(.*)<\/title>/)[1];

  await t.test('root redirects to the dashboard of the configured portal', async () => {
    const res = await fetch(`${fixture.url}/`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/reports-dashboard/4242');
  });

  await t.test('any path echoes the path in title and heading, with HubSpot-shaped links', async () => {
    const html = await (await fetch(`${fixture.url}/contacts/4242/objects/0-1/views/all/list`)).text();
    assert.equal(title(html), '/contacts/4242/objects/0-1/views/all/list');
    assert.match(html, /<h1>\/contacts\/4242\/objects\/0-1\/views\/all\/list<\/h1>/);
    assert.match(html, /href="\/contacts\/4242\/record\/0-1\/101"/);
    assert.match(html, /href="\/contacts\/4242\/record\/0-3\/202"/);
    assert.match(html, /href="https:\/\/example.com"/);
    assert.match(html, /target="_blank"/);
    assert.match(html, /new Notification\('Test', \{ body: 'x' \}\)/);
  });

  await t.test('title route renders an unread count title', async () => {
    const html = await (await fetch(`${fixture.url}/title/7`)).text();
    assert.equal(title(html), '(7) Inbox');
  });

  await t.test('editor route has a contenteditable editor and a text input', async () => {
    const html = await (await fetch(`${fixture.url}/editor`)).text();
    assert.match(html, /contenteditable="true"/);
    assert.match(html, /<input id="text-input" type="text">/);
  });

  await t.test('frame host embeds a same-origin frame that pushes another portal path', async () => {
    const host = await (await fetch(`${fixture.url}/frame-host`)).text();
    assert.match(host, /<iframe id="child-frame" src="\/frame-child"><\/iframe>/);
    const child = await (await fetch(`${fixture.url}/frame-child`)).text();
    assert.match(child, /history\.pushState\(\{\}, '', '\/contacts\/99\/objects\/0-1\/views\/all\/list'\)/);
  });
});

test('fixture server imitates a sign-in flow through an identity provider', async (t) => {
  const idp = await start(0);
  const app = await start(0, { portalId: '4242', idpOrigin: idp.url });
  t.after(() => Promise.all([idp.close(), app.close()]));
  const href = (html, id) => html.match(new RegExp(`id="${id}" href="([^"]*)"`))[1].replace(/&amp;/g, '&');

  const login = await (await fetch(`${app.url}/login`)).text();
  const idpUrl = href(login, 'idp-link');
  const returnTo = `${app.url}/reports-dashboard/4242`;
  assert.equal(idpUrl, `${idp.url}/idp/authorize?return_to=${encodeURIComponent(returnTo)}`);

  const provider = await (await fetch(idpUrl)).text();
  assert.equal(href(provider, 'return-link'), returnTo);

  const redirect = await fetch(`${app.url}/redirect-out`, { redirect: 'manual' });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('location'), idpUrl);

  const noContent = await fetch(`${app.url}/no-content`, { redirect: 'manual' });
  assert.equal(noContent.status, 204);

  const started = Date.now();
  const slow = await fetch(`${app.url}/slow`);
  assert.equal(slow.status, 200);
  assert.ok(Date.now() - started >= 1900);
});

test('fixture server can chain to a second provider and start at the provider', async (t) => {
  const idp = await start(0);
  const chain = await start(0);
  const app = await start(0, { portalId: '4242', idpOrigin: idp.url, chainOrigin: chain.url });
  const idpFirst = await start(0, { portalId: '4242', idpOrigin: idp.url, rootToIdp: true });
  t.after(() => Promise.all([idp.close(), chain.close(), app.close(), idpFirst.close()]));

  const chained = await fetch(`${app.url}/chain-out`, { redirect: 'manual' });
  assert.equal(chained.status, 302);
  const appReturn = encodeURIComponent(`${app.url}/reports-dashboard/4242`);
  assert.equal(chained.headers.get('location'), `${chain.url}/idp/authorize?return_to=${appReturn}`);

  const root = await fetch(`${idpFirst.url}/`, { redirect: 'manual' });
  assert.equal(root.status, 302);
  const firstReturn = encodeURIComponent(`${idpFirst.url}/reports-dashboard/4242`);
  assert.equal(root.headers.get('location'), `${idp.url}/idp/authorize?return_to=${firstReturn}`);
});
