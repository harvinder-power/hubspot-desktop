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
});
