const test = require('node:test');
const assert = require('node:assert/strict');
const { isAppOrigin, pageKind, lockedTitle, decide, isPermissionAllowed, RULES, SIGN_IN_PATHS } = require('../../src/main/links');

const RECORD = 'https://app.hubspot.com/contacts/4242/record/0-1/101';
const LOGIN = 'https://app.hubspot.com/login';
const OAUTH = 'https://app.hubspot.com/oauth/authorize?redirect_uri=https%3A%2F%2Fevil.example';
const OKTA = 'https://example-corp.okta.com/app/hubspot/sso/saml';
const IDP2 = 'https://idp2.example/next';
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

test('pageKind names the committed page', () => {
  const cases = [
    ['', 'none'],
    [LOGIN, 'app-sign-in'],
    ['https://app.hubspot.com/login/sso', 'app-sign-in'],
    ['https://app.hubspot.com/sso/x', 'app-sign-in'],
    [OAUTH, 'app'],
    ['https://app.hubspot.com/loginx', 'app'],
    ['https://app.hubspot.com/LOGIN', 'app'],
    [RECORD, 'app'],
    ['https://app-eu1.hubspot.com/contacts/1', 'app'],
    [OKTA, 'outside'],
    ['about:blank', 'outside'],
    ['https://app.hubspot.com.evil.example/login', 'outside'],
    ['https://evil.example/login', 'outside'],
    [undefined, 'outside'],
  ];
  for (const [url, kind] of cases) assert.equal(pageKind(url), kind, String(url));
  assert.equal(pageKind(`${OVERRIDE}/login`, { base: OVERRIDE }), 'app-sign-in');
  assert.equal(pageKind('http://127.0.0.1:4322/idp', { base: OVERRIDE }), 'outside');
});

test('lockedTitle is null for app pages and the empty page, and names the host otherwise', () => {
  assert.equal(lockedTitle(RECORD), null);
  assert.equal(lockedTitle(LOGIN), null);
  assert.equal(lockedTitle(''), null);
  assert.equal(lockedTitle('https://idp.example/authorize?x=1'), 'idp.example (external page)');
  assert.equal(lockedTitle('https://аpple.com/'), 'xn--pple-43d.com (external page)');
  assert.equal(lockedTitle('about:blank'), 'about: (external page)');
  assert.equal(lockedTitle('https://app.hubspot.com.evil.example/'), 'app.hubspot.com.evil.example (external page)');
  assert.equal(lockedTitle('http://127.0.0.1:4322/idp', { base: OVERRIDE }), '127.0.0.1 (external page)');
});

test('the rules table keeps its order', () => {
  assert.deepEqual(RULES.map((rule) => rule.name), [
    'blank-popup-from-app',
    'unparseable',
    'blob',
    'external-scheme',
    'unsafe-scheme',
    'app-origin',
    'navigate-from-non-app-page',
    'sign-in-popup',
    'everything-else',
  ]);
});

test('rule blank-popup-from-app: an app page may open an empty or about:blank child', () => {
  assert.equal(decide({ url: '', currentUrl: RECORD, kind: 'open' }), 'allow');
  assert.equal(decide({ url: 'about:blank', currentUrl: RECORD, kind: 'open' }), 'allow');
  assert.equal(decide({ url: 'about:blank', currentUrl: LOGIN, kind: 'open' }), 'allow');
  assert.equal(decide({ url: 'about:blank', currentUrl: OKTA, kind: 'open' }), 'deny');
  assert.equal(decide({ url: 'about:blank', currentUrl: '', kind: 'open' }), 'deny');
  assert.equal(decide({ url: 'about:blank', currentUrl: RECORD, kind: 'navigate' }), 'deny');
});

test('rule unparseable: invalid targets are refused', () => {
  assert.equal(decide({ url: 'not a url', currentUrl: RECORD, kind: 'navigate' }), 'deny');
  assert.equal(decide({ url: '', currentUrl: OKTA, kind: 'navigate' }), 'deny');
  assert.equal(decide({ url: undefined, currentUrl: RECORD, kind: 'open' }), 'deny');
  assert.equal(decide({ url: '', currentUrl: undefined, kind: 'open' }), 'deny');
});

test('rule blob: only blobs of an app origin are allowed', () => {
  assert.equal(decide({ url: 'blob:https://app.hubspot.com/x', currentUrl: RECORD, kind: 'open' }), 'allow');
  assert.equal(decide({ url: 'blob:https://evil.example/x', currentUrl: RECORD, kind: 'open' }), 'deny');
  assert.equal(decide({ url: 'blob:https://evil.example/x', currentUrl: OKTA, kind: 'navigate' }), 'deny');
});

test('rule external-scheme: mail, phone and message links open externally', () => {
  assert.equal(decide({ url: 'mailto:someone@example.com', currentUrl: RECORD, kind: 'navigate' }), 'external');
  assert.equal(decide({ url: 'tel:+441234567890', currentUrl: RECORD, kind: 'open' }), 'external');
  assert.equal(decide({ url: 'sms:+441234567890', currentUrl: RECORD, kind: 'navigate' }), 'external');
  assert.equal(decide({ url: 'callto:someone', currentUrl: RECORD, kind: 'navigate' }), 'external');
  assert.equal(decide({ url: 'mailto:help@example.com', currentUrl: OKTA, kind: 'navigate' }), 'external');
});

test('rule unsafe-scheme: other schemes are refused from every page', () => {
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hi', 'vbscript:msgbox(1)', 'http://app.hubspot.com/']) {
    assert.equal(decide({ url, currentUrl: RECORD, kind: 'navigate' }), 'deny', url);
    assert.equal(decide({ url, currentUrl: LOGIN, kind: 'open' }), 'deny', url);
    assert.equal(decide({ url, currentUrl: OKTA, kind: 'navigate' }), 'deny', url);
    assert.equal(decide({ url, currentUrl: '', kind: 'navigate' }), 'deny', url);
  }
});

test('rule app-origin: app links stay in the app from every page', () => {
  assert.equal(decide({ url: 'https://app-eu1.hubspot.com/contacts/1', currentUrl: RECORD, kind: 'navigate' }), 'allow');
  assert.equal(decide({ url: 'https://app.hubspot.com/deals/1', currentUrl: RECORD, kind: 'open' }), 'allow');
  assert.equal(decide({ url: RECORD, currentUrl: OKTA, kind: 'navigate' }), 'allow');
  assert.equal(decide({ url: RECORD, currentUrl: 'https://idp2.example/', kind: 'open' }), 'allow');
  assert.equal(decide({ url: RECORD, currentUrl: 'about:blank', kind: 'navigate' }), 'allow');
});

test('rule navigate-from-non-app-page: first loads, sign-in pages and provider chains may navigate', () => {
  assert.equal(decide({ url: OKTA, currentUrl: LOGIN, kind: 'navigate' }), 'allow');
  assert.equal(decide({ url: OKTA, currentUrl: 'https://app.hubspot.com/login/sso', kind: 'navigate' }), 'allow');
  assert.equal(decide({ url: OKTA, currentUrl: 'https://app-eu1.hubspot.com/sso/start', kind: 'navigate' }), 'allow');
  assert.equal(decide({ url: IDP2, currentUrl: OKTA, kind: 'navigate' }), 'allow');
  assert.equal(decide({ url: OKTA, currentUrl: '', kind: 'navigate' }), 'allow');
});

test('rule navigate-from-non-app-page: a committed non-web outside page grants nothing', () => {
  for (const currentUrl of ['about:blank', 'data:text/html,hi', 'chrome-error://chromewebdata/', 'not a url', undefined]) {
    assert.equal(decide({ url: OKTA, currentUrl, kind: 'navigate' }), 'external', String(currentUrl));
  }
});

test('rule sign-in-popup: an app sign-in page may open a provider popup', () => {
  assert.equal(decide({ url: OKTA, currentUrl: LOGIN, kind: 'open' }), 'allow');
  assert.equal(decide({ url: OKTA, currentUrl: 'https://app.hubspot.com/sso/x', kind: 'open' }), 'allow');
});

test('rule everything-else: other targets open externally', () => {
  assert.equal(decide({ url: OKTA, currentUrl: RECORD, kind: 'navigate' }), 'external');
  assert.equal(decide({ url: 'https://knowledge.hubspot.com/', currentUrl: RECORD, kind: 'navigate' }), 'external');
  assert.equal(decide({ url: 'https://app.hubspot.com.evil.example/', currentUrl: RECORD, kind: 'open' }), 'external');
  assert.equal(decide({ url: OKTA, currentUrl: OAUTH, kind: 'navigate' }), 'external');
  assert.equal(decide({ url: OKTA, currentUrl: 'https://app.hubspot.com/loginx', kind: 'navigate' }), 'external');
  assert.equal(decide({ url: IDP2, currentUrl: OKTA, kind: 'open' }), 'external');
  assert.equal(decide({ url: OKTA, currentUrl: '', kind: 'open' }), 'external');
  assert.equal(decide({ url: OKTA, currentUrl: 'about:blank', kind: 'open' }), 'external');
});

test('decide under the dev override keeps the override origin and nothing else', () => {
  const base = OVERRIDE;
  const dashboard = `${OVERRIDE}/reports-dashboard/4242`;
  const idp = 'http://127.0.0.1:4322/idp';
  assert.equal(decide({ url: `${OVERRIDE}/contacts/4242/record/0-1/101`, currentUrl: dashboard, kind: 'navigate', base }), 'allow');
  assert.equal(decide({ url: idp, currentUrl: dashboard, kind: 'navigate', base }), 'external');
  assert.equal(decide({ url: idp, currentUrl: `${OVERRIDE}/login`, kind: 'navigate', base }), 'allow');
  assert.equal(decide({ url: 'http://127.0.0.1:4323/next', currentUrl: idp, kind: 'navigate', base }), 'allow');
  assert.equal(decide({ url: dashboard, currentUrl: idp, kind: 'navigate', base }), 'allow');
  assert.equal(decide({ url: 'http://evil.example/', currentUrl: `${OVERRIDE}/login`, kind: 'navigate', base }), 'deny');
  assert.equal(decide({ url: `blob:${OVERRIDE}/uuid`, currentUrl: dashboard, kind: 'open', base }), 'allow');
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
