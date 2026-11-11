const test = require('node:test');
const assert = require('node:assert/strict');
const { isAppOrigin, decide, isPermissionAllowed } = require('../../src/main/links');

const RECORD = 'https://app.hubspot.com/contacts/4242/record/0-1/101';
const LOGIN = 'https://app.hubspot.com/login';
const OKTA = 'https://example-corp.okta.com/app/hubspot/sso/saml';
const OVERRIDE = 'http://127.0.0.1:4321';

test('isAppOrigin accepts HubSpot app hosts in every data region', () => {
  assert.equal(isAppOrigin('https://app.hubspot.com'), true);
  assert.equal(isAppOrigin('https://app-eu1.hubspot.com/contacts/1'), true);
  assert.equal(isAppOrigin('https://app-na2.hubspot.com'), true);
});

test('isAppOrigin rejects look-alike hosts, plain http and invalid input', () => {
  for (const url of [
    'https://hubspot.com.evil.example',
    'https://evilhubspot.com',
    'https://app.hubspot.com.evil.example',
    'http://app.hubspot.com',
    'https://knowledge.hubspot.com',
    'https://app-eu.hubspot.com',
    'https://app-EU1.hubspot.com.evil.example',
    'https://app.hubspot.com:8443',
    'not a url',
    '',
    undefined,
  ]) {
    assert.equal(isAppOrigin(url), false, url);
  }
});

test('isAppOrigin treats only the exact override origin as app', () => {
  assert.equal(isAppOrigin(OVERRIDE, { base: OVERRIDE }), true);
  assert.equal(isAppOrigin('http://127.0.0.1:4322', { base: OVERRIDE }), false);
  assert.equal(isAppOrigin(OVERRIDE), false);
});

test('decide keeps app links in the app and sends other HubSpot sites out', () => {
  assert.equal(decide({ url: 'https://app-eu1.hubspot.com/contacts/1', currentUrl: RECORD, kind: 'navigate' }), 'allow');
  assert.equal(decide({ url: 'https://app.hubspot.com/deals/1', currentUrl: RECORD, kind: 'open' }), 'allow');
  assert.equal(decide({ url: 'https://knowledge.hubspot.com/', currentUrl: RECORD, kind: 'navigate' }), 'external');
  assert.equal(decide({ url: 'https://app.hubspot.com.evil.example/', currentUrl: RECORD, kind: 'open' }), 'external');
});

test('decide lets any identity provider finish sign-in, but only during sign-in', () => {
  assert.equal(decide({ url: OKTA, currentUrl: LOGIN, kind: 'navigate' }), 'allow');
  assert.equal(decide({ url: OKTA, currentUrl: 'https://app.hubspot.com/sso/start', kind: 'navigate' }), 'allow');
  assert.equal(decide({ url: OKTA, currentUrl: 'https://app.hubspot.com/oauth/authorize', kind: 'navigate' }), 'allow');
  assert.equal(decide({ url: 'https://idp2.example/next', currentUrl: OKTA, kind: 'navigate' }), 'allow');
  assert.equal(decide({ url: OKTA, currentUrl: RECORD, kind: 'navigate' }), 'external');
  assert.equal(decide({ url: OKTA, currentUrl: 'https://app.hubspot.com/loginx', kind: 'navigate' }), 'external');
  assert.equal(decide({ url: OKTA, currentUrl: LOGIN, kind: 'open' }), 'external');
});

test('decide refuses unsafe schemes and sends mail and phone links out', () => {
  assert.equal(decide({ url: 'javascript:alert(1)', currentUrl: LOGIN, kind: 'navigate' }), 'deny');
  assert.equal(decide({ url: 'file:///etc/passwd', currentUrl: RECORD, kind: 'open' }), 'deny');
  assert.equal(decide({ url: 'data:text/html,hi', currentUrl: RECORD, kind: 'navigate' }), 'deny');
  assert.equal(decide({ url: 'http://app.hubspot.com/', currentUrl: RECORD, kind: 'navigate' }), 'deny');
  assert.equal(decide({ url: 'not a url', currentUrl: RECORD, kind: 'navigate' }), 'deny');
  assert.equal(decide({ url: 'mailto:someone@example.com', currentUrl: RECORD, kind: 'navigate' }), 'external');
  assert.equal(decide({ url: 'tel:+441234567890', currentUrl: RECORD, kind: 'open' }), 'external');
});

test('decide under the dev override keeps the override origin and nothing else', () => {
  const base = OVERRIDE;
  const dashboard = `${OVERRIDE}/reports-dashboard/4242`;
  assert.equal(decide({ url: `${OVERRIDE}/contacts/4242/record/0-1/101`, currentUrl: dashboard, kind: 'navigate', base }), 'allow');
  assert.equal(decide({ url: 'http://127.0.0.1:4322/idp', currentUrl: dashboard, kind: 'navigate', base }), 'external');
  assert.equal(decide({ url: 'http://127.0.0.1:4322/idp', currentUrl: `${OVERRIDE}/login`, kind: 'navigate', base }), 'allow');
  assert.equal(decide({ url: 'http://evil.example/', currentUrl: `${OVERRIDE}/login`, kind: 'navigate', base }), 'deny');
});

test('isPermissionAllowed grants app permissions to app origins only', () => {
  assert.equal(isPermissionAllowed('notifications', 'https://app.hubspot.com'), true);
  assert.equal(isPermissionAllowed('clipboard-sanitized-write', 'https://app-eu1.hubspot.com'), true);
  assert.equal(isPermissionAllowed('notifications', 'https://hubspot.com.evil.example'), false);
  assert.equal(isPermissionAllowed('notifications', OKTA), false);
  assert.equal(isPermissionAllowed('geolocation', 'https://app.hubspot.com'), false);
  assert.equal(isPermissionAllowed('notifications', OVERRIDE, { base: OVERRIDE }), true);
  assert.equal(isPermissionAllowed('notifications', 'http://127.0.0.1:4322', { base: OVERRIDE }), false);
});
