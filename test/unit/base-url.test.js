const test = require('node:test');
const assert = require('node:assert/strict');
const { baseUrl, portalPrefix } = require('../../src/main/base-url');

const dev = { isPackaged: false };
const packaged = { isPackaged: true };
const override = { HUBSPOT_DESKTOP_BASE_URL: 'http://127.0.0.1:4321/' };

test('baseUrl returns the HubSpot host when no override is set', () => {
  assert.equal(baseUrl(dev, {}), 'https://app.hubspot.com');
});

test('baseUrl returns the override without a trailing slash in unpackaged runs', () => {
  assert.equal(baseUrl(dev, override), 'http://127.0.0.1:4321');
});

test('baseUrl ignores the override in packaged builds', () => {
  assert.equal(baseUrl(packaged, override), 'https://app.hubspot.com');
});

test('portalPrefix extracts the app and portal from a HubSpot record URL', () => {
  assert.equal(
    portalPrefix('https://app.hubspot.com/contacts/26291371/record/0-3/539347590370', 'https://app.hubspot.com'),
    'https://app.hubspot.com/contacts/26291371'
  );
});

test('portalPrefix accepts the override origin', () => {
  assert.equal(
    portalPrefix('http://127.0.0.1:4321/tasks/4242/view/all', 'http://127.0.0.1:4321'),
    'http://127.0.0.1:4321/tasks/4242'
  );
});

test('portalPrefix returns null for another origin or a URL without a portal', () => {
  assert.equal(portalPrefix('https://example.com/contacts/1/record', 'https://app.hubspot.com'), null);
  assert.equal(portalPrefix('https://app.hubspot.com/login', 'https://app.hubspot.com'), null);
});
