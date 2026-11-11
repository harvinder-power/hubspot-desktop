const test = require('node:test');
const assert = require('node:assert/strict');
const { isAppOrigin, decide, isPermissionAllowed, RULES, SIGN_IN_PATHS } = require('../../src/main/links');

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

test('isAppOrigin rejects userinfo in an app URL', () => {
  assert.equal(isAppOrigin('https://u:p@app.hubspot.com'), false);
  assert.equal(isAppOrigin('https://u@app.hubspot.com/contacts/1'), false);
});

test('SIGN_IN_PATHS is /login and /sso only', () => {
  assert.deepEqual(SIGN_IN_PATHS, ['/login', '/sso']);
});

test('the rules table keeps its order', () => {
  assert.deepEqual(RULES.map((rule) => rule.name), [
    'blank-popup-from-app',
    'unparseable',
    'blob',
    'external-scheme',
    'unsafe-scheme',
    'app-origin',
    'enter-sign-in',
    'continue-sign-in',
    'everything-else',
  ]);
});

const APP = { action: 'allow', mode: 'app' };
const SIGNIN = { action: 'allow', mode: 'signin' };

test('rule blank-popup-from-app: an app page may open an empty or about:blank child', () => {
  assert.deepEqual(decide({ url: '', currentUrl: RECORD, kind: 'open' }), APP);
  assert.deepEqual(decide({ url: 'about:blank', currentUrl: RECORD, kind: 'open' }), APP);
  assert.deepEqual(decide({ url: 'about:blank', currentUrl: OKTA, mode: 'signin', kind: 'open' }), { action: 'deny', mode: 'signin' });
  assert.deepEqual(decide({ url: 'about:blank', currentUrl: OKTA, kind: 'open' }), { action: 'deny', mode: 'app' });
  assert.deepEqual(decide({ url: 'about:blank', currentUrl: RECORD, kind: 'navigate' }), { action: 'deny', mode: 'app' });
});

test('rule unparseable: invalid targets are refused and the mode does not change', () => {
  assert.deepEqual(decide({ url: 'not a url', currentUrl: RECORD, kind: 'navigate' }), { action: 'deny', mode: 'app' });
  assert.deepEqual(decide({ url: '', currentUrl: OKTA, mode: 'signin', kind: 'navigate' }), { action: 'deny', mode: 'signin' });
  assert.deepEqual(decide({ url: undefined, currentUrl: RECORD, kind: 'open' }), { action: 'deny', mode: 'app' });
});

test('rule blob: only blobs of an app origin are allowed', () => {
  assert.deepEqual(decide({ url: 'blob:https://app.hubspot.com/x', currentUrl: RECORD, kind: 'open' }), APP);
  assert.deepEqual(decide({ url: 'blob:https://evil.example/x', currentUrl: RECORD, kind: 'open' }), { action: 'deny', mode: 'app' });
  assert.deepEqual(decide({ url: 'blob:https://evil.example/x', currentUrl: OKTA, mode: 'signin', kind: 'navigate' }), {
    action: 'deny',
    mode: 'signin',
  });
});

test('rule external-scheme: mail, phone and message links open externally', () => {
  assert.deepEqual(decide({ url: 'mailto:someone@example.com', currentUrl: RECORD, kind: 'navigate' }), { action: 'external', mode: 'app' });
  assert.deepEqual(decide({ url: 'tel:+441234567890', currentUrl: RECORD, kind: 'open' }), { action: 'external', mode: 'app' });
  assert.deepEqual(decide({ url: 'sms:+441234567890', currentUrl: RECORD, kind: 'navigate' }), { action: 'external', mode: 'app' });
  assert.deepEqual(decide({ url: 'callto:someone', currentUrl: RECORD, kind: 'navigate' }), { action: 'external', mode: 'app' });
  assert.deepEqual(decide({ url: 'mailto:help@example.com', currentUrl: OKTA, mode: 'signin', kind: 'navigate' }), {
    action: 'external',
    mode: 'signin',
  });
});

test('rule unsafe-scheme: other schemes are refused, also during sign-in', () => {
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hi', 'vbscript:msgbox(1)', 'http://app.hubspot.com/']) {
    assert.deepEqual(decide({ url, currentUrl: RECORD, kind: 'navigate' }), { action: 'deny', mode: 'app' }, url);
    assert.deepEqual(decide({ url, currentUrl: LOGIN, kind: 'open' }), { action: 'deny', mode: 'app' }, url);
    assert.deepEqual(decide({ url, currentUrl: OKTA, mode: 'signin', kind: 'navigate' }), { action: 'deny', mode: 'signin' }, url);
  }
});

test('rule app-origin: app links stay in the app and end sign-in', () => {
  assert.deepEqual(decide({ url: 'https://app-eu1.hubspot.com/contacts/1', currentUrl: RECORD, kind: 'navigate' }), APP);
  assert.deepEqual(decide({ url: 'https://app.hubspot.com/deals/1', currentUrl: RECORD, kind: 'open' }), APP);
  assert.deepEqual(decide({ url: RECORD, currentUrl: OKTA, mode: 'signin', kind: 'navigate' }), APP);
  assert.deepEqual(decide({ url: RECORD, currentUrl: 'https://idp2.example/', mode: 'signin', kind: 'open' }), APP);
});

test('rule enter-sign-in: an app sign-in page may go to an identity provider', () => {
  assert.deepEqual(decide({ url: OKTA, currentUrl: LOGIN, mode: 'app', kind: 'navigate' }), SIGNIN);
  assert.deepEqual(decide({ url: OKTA, currentUrl: 'https://app.hubspot.com/login/sso', kind: 'navigate' }), SIGNIN);
  assert.deepEqual(decide({ url: OKTA, currentUrl: 'https://app-eu1.hubspot.com/sso/start', kind: 'navigate' }), SIGNIN);
  assert.deepEqual(decide({ url: OKTA, currentUrl: LOGIN, kind: 'open' }), SIGNIN);
});

test('rule enter-sign-in: only exact sign-in path segments count', () => {
  for (const currentUrl of [
    'https://app.hubspot.com/oauth/authorize?redirect_uri=https%3A%2F%2Fevil.example',
    'https://app.hubspot.com/loginx',
    'https://app.hubspot.com/login-verify',
    'https://app.hubspot.com/sso-login',
    'https://app.hubspot.com/LOGIN',
    'https://evil.example/login',
  ]) {
    assert.deepEqual(decide({ url: OKTA, currentUrl, kind: 'navigate' }), { action: 'external', mode: 'app' }, currentUrl);
  }
});

test('rule continue-sign-in: during sign-in, navigation may chain through more hosts', () => {
  assert.deepEqual(decide({ url: 'https://idp2.example/next', currentUrl: OKTA, mode: 'signin', kind: 'navigate' }), SIGNIN);
});

test('rule everything-else: other targets open externally and the mode does not change', () => {
  assert.deepEqual(decide({ url: OKTA, currentUrl: RECORD, mode: 'app', kind: 'navigate' }), { action: 'external', mode: 'app' });
  assert.deepEqual(decide({ url: 'https://knowledge.hubspot.com/', currentUrl: RECORD, kind: 'navigate' }), { action: 'external', mode: 'app' });
  assert.deepEqual(decide({ url: 'https://app.hubspot.com.evil.example/', currentUrl: RECORD, kind: 'open' }), { action: 'external', mode: 'app' });
  assert.deepEqual(decide({ url: 'https://idp2.example/', currentUrl: OKTA, mode: 'signin', kind: 'open' }), { action: 'external', mode: 'signin' });
});

test('a non-app page in app mode grants nothing (the old hole)', () => {
  assert.deepEqual(decide({ url: 'https://evil.example/', currentUrl: OKTA, mode: 'app', kind: 'navigate' }), { action: 'external', mode: 'app' });
  assert.deepEqual(decide({ url: 'https://evil.example/', currentUrl: OKTA, kind: 'navigate' }), { action: 'external', mode: 'app' });
});

test('an empty, blank or missing current URL grants nothing', () => {
  for (const currentUrl of ['', 'about:blank', undefined, 'not a url']) {
    assert.deepEqual(decide({ url: OKTA, currentUrl, kind: 'navigate' }), { action: 'external', mode: 'app' }, String(currentUrl));
    assert.deepEqual(decide({ url: OKTA, currentUrl, kind: 'open' }), { action: 'external', mode: 'app' }, String(currentUrl));
  }
  assert.deepEqual(decide({ url: '', currentUrl: undefined, kind: 'open' }), { action: 'deny', mode: 'app' });
});

test('decide under the dev override keeps the override origin and nothing else', () => {
  const base = OVERRIDE;
  const dashboard = `${OVERRIDE}/reports-dashboard/4242`;
  const idp = 'http://127.0.0.1:4322/idp';
  assert.deepEqual(decide({ url: `${OVERRIDE}/contacts/4242/record/0-1/101`, currentUrl: dashboard, kind: 'navigate', base }), APP);
  assert.deepEqual(decide({ url: idp, currentUrl: dashboard, kind: 'navigate', base }), { action: 'external', mode: 'app' });
  assert.deepEqual(decide({ url: idp, currentUrl: `${OVERRIDE}/login`, kind: 'navigate', base }), SIGNIN);
  assert.deepEqual(decide({ url: 'http://127.0.0.1:4323/next', currentUrl: idp, mode: 'signin', kind: 'navigate', base }), SIGNIN);
  assert.deepEqual(decide({ url: 'http://evil.example/', currentUrl: `${OVERRIDE}/login`, kind: 'navigate', base }), { action: 'deny', mode: 'app' });
  assert.deepEqual(decide({ url: `blob:${OVERRIDE}/uuid`, currentUrl: dashboard, kind: 'open', base }), APP);
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
