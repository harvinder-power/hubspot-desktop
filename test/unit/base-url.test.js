const test = require('node:test');
const assert = require('node:assert/strict');
const { baseUrl } = require('../../src/main/base-url');

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
