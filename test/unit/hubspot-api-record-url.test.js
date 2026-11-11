const test = require('node:test');
const assert = require('node:assert/strict');
const { recordUrl } = require('../../src/main/hubspot-api');

const appOrigin = 'https://app-eu1.hubspot.com';

test('recordUrl builds the web-app record URL for every known type', () => {
  const urls = ['contacts', 'companies', 'deals', 'tickets', 'tasks'].map((type) => recordUrl({ appOrigin, portalId: '4242', type, id: '101' }));
  assert.deepEqual(urls, [
    'https://app-eu1.hubspot.com/contacts/4242/record/0-1/101',
    'https://app-eu1.hubspot.com/contacts/4242/record/0-2/101',
    'https://app-eu1.hubspot.com/contacts/4242/record/0-3/101',
    'https://app-eu1.hubspot.com/contacts/4242/record/0-5/101',
    'https://app-eu1.hubspot.com/contacts/4242/record/0-27/101',
  ]);
});

test('recordUrl returns null for a type with no known URL or missing parts', () => {
  assert.equal(recordUrl({ appOrigin, portalId: '4242', type: 'meetings', id: '1' }), null);
  assert.equal(recordUrl({ appOrigin, portalId: '4242', type: 'toString', id: '1' }), null);
  assert.equal(recordUrl({ appOrigin: null, portalId: '4242', type: 'contacts', id: '1' }), null);
});

test('recordUrl encodes path segments', () => {
  assert.equal(recordUrl({ appOrigin, portalId: '42', type: 'deals', id: '1/../x' }), 'https://app-eu1.hubspot.com/contacts/42/record/0-3/1%2F..%2Fx');
});
