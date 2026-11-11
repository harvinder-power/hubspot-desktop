const test = require('node:test');
const assert = require('node:assert/strict');
const { INITIAL, FIND_MENU_ITEMS, reduce, countLabel, parseBarEvent, routeBarEvent, barBounds } = require('../../src/main/find');

const closed = INITIAL;
const openEmpty = { open: true, query: '', active: 0, total: 0, pending: false };
const openFound = { open: true, query: 'deal', active: 2, total: 5, pending: false };
const openNone = { open: true, query: 'zzz', active: 0, total: 0, pending: false };
const closedWithQuery = { open: false, query: 'deal', active: 0, total: 0, pending: false };
const openPending = { ...openFound, pending: true };

const STOP = { stop: true };
const find = (text, forward, findNext) => ({ find: { text, forward, findNext } });

// [name, state, event, expected state, expected effect]
const CASES = [
  ['closed: open with no last query', closed, { type: 'open' }, openEmpty, null],
  ['closed: open restores the last query, searches it again and waits for its result', closedWithQuery, { type: 'open' }, { ...closedWithQuery, open: true, pending: true }, find('deal', true, true)],
  ['closed: close does nothing', closed, { type: 'close' }, closed, null],
  ['closed: query is ignored', closed, { type: 'query', text: 'deal' }, closed, null],
  ['closed: next does nothing', closedWithQuery, { type: 'next' }, closedWithQuery, null],
  ['closed: previous does nothing', closedWithQuery, { type: 'previous' }, closedWithQuery, null],
  ['closed: a late result is ignored', closedWithQuery, { type: 'result', active: 1, total: 3 }, closedWithQuery, null],

  ['open, empty: open again changes nothing', openEmpty, { type: 'open' }, openEmpty, null],
  ['open, empty: close stops', openEmpty, { type: 'close' }, closed, STOP],
  ['open, empty: query starts a new search and waits for its result', openEmpty, { type: 'query', text: 'deal' }, { ...openEmpty, query: 'deal', pending: true }, find('deal', true, true)],
  ['open, empty: empty query does nothing', openEmpty, { type: 'query', text: '' }, openEmpty, null],
  ['open, empty: next does nothing', openEmpty, { type: 'next' }, openEmpty, null],
  ['open, empty: previous does nothing', openEmpty, { type: 'previous' }, openEmpty, null],
  ['open, empty: result is ignored', openEmpty, { type: 'result', active: 1, total: 3 }, openEmpty, null],

  ['open, found: open again changes nothing', openFound, { type: 'open' }, openFound, null],
  ['open, found: close stops, clears counts and keeps the query', openFound, { type: 'close' }, closedWithQuery, STOP],
  ['open, found: new query waits for its result', openFound, { type: 'query', text: 'deals' }, { ...openPending, query: 'deals' }, find('deals', true, true)],
  ['open, found: same query does nothing', openFound, { type: 'query', text: 'deal' }, openFound, null],
  ['open, found: empty query stops and zeroes the counts', openFound, { type: 'query', text: '' }, openEmpty, STOP],
  ['open, found: next steps forward in the session', openFound, { type: 'next' }, openFound, find('deal', true, false)],
  ['open, found: previous steps backward in the session', openFound, { type: 'previous' }, openFound, find('deal', false, false)],
  ['open, found: next from the last match only requests; Chromium wraps', { ...openFound, active: 5 }, { type: 'next' }, { ...openFound, active: 5 }, find('deal', true, false)],
  ['open, found: result sets the counts', openFound, { type: 'result', active: 3, total: 5 }, { ...openFound, active: 3 }, null],

  ['open, none: next still asks Chromium', openNone, { type: 'next' }, openNone, find('zzz', true, false)],
  ['open, none: query starts a new search and waits for its result', openNone, { type: 'query', text: 'deal' }, { ...openNone, query: 'deal', pending: true }, find('deal', true, true)],
  ['open, none: empty query stops', openNone, { type: 'query', text: '' }, openEmpty, STOP],
  ['open, none: close stops', openNone, { type: 'close' }, { ...openNone, open: false }, STOP],
  ['open, none: result with matches sets the counts', openNone, { type: 'result', active: 1, total: 2 }, { ...openNone, active: 1, total: 2 }, null],

  ['closed: navigated does nothing', closedWithQuery, { type: 'navigated' }, closedWithQuery, null],
  ['open, empty: navigated does nothing', openEmpty, { type: 'navigated' }, openEmpty, null],
  ['open, found: navigated searches the query again in a new session and waits', openFound, { type: 'navigated' }, openPending, find('deal', true, true)],
  ['open, none: navigated searches the query again and waits', openNone, { type: 'navigated' }, { ...openNone, pending: true }, find('zzz', true, true)],

  ['open, pending: result sets the counts and ends the wait', openPending, { type: 'result', active: 1, total: 4 }, { ...openFound, active: 1, total: 4 }, null],
  ['open, pending: close stops and ends the wait', openPending, { type: 'close' }, closedWithQuery, STOP],
  ['open, pending: empty query stops and ends the wait', openPending, { type: 'query', text: '' }, openEmpty, STOP],

  ['unknown event does nothing', openFound, { type: 'reload' }, openFound, null],
];

for (const [name, state, event, expectedState, expectedEffect] of CASES) {
  test(`reduce: ${name}`, () => {
    assert.deepEqual(reduce(state, event), { state: expectedState, effect: expectedEffect });
  });
}

test('countLabel shows the position, No results, or nothing for an empty query or a pending search', () => {
  assert.equal(countLabel(openFound), '2 of 5');
  assert.equal(countLabel(openNone), 'No results');
  assert.equal(countLabel(openEmpty), '');
  assert.equal(countLabel(openPending), '');
  assert.equal(countLabel({ ...openNone, pending: true }), '');
});

test('parseBarEvent accepts only the bar events, and caps the query', () => {
  assert.deepEqual(parseBarEvent({ type: 'next', extra: 1 }), { type: 'next' });
  assert.deepEqual(parseBarEvent({ type: 'query', text: 'deal' }), { type: 'query', text: 'deal' });
  assert.equal(parseBarEvent({ type: 'query', text: 'x'.repeat(600) }).text.length, 500);
  assert.equal(parseBarEvent({ type: 'query', text: 42 }), null);
  assert.equal(parseBarEvent({ type: 'open' }), null);
  assert.equal(parseBarEvent({ type: 'result', active: 1, total: 1 }), null);
  assert.equal(parseBarEvent(null), null);
});

test('routeBarEvent drives the bar that sent the event and ignores any other sender', () => {
  const received = [];
  const barContents = { id: 'bar' };
  const pageContents = { id: 'page' };
  const bars = new Map([[barContents, { dispatch: (event) => received.push(event) }]]);
  routeBarEvent(bars, pageContents, { type: 'query', text: 'deal' });
  routeBarEvent(bars, barContents, { type: 'open' });
  assert.deepEqual(received, []);
  routeBarEvent(bars, barContents, { type: 'query', text: 'deal' });
  assert.deepEqual(received, [{ type: 'query', text: 'deal' }]);
});

test('barBounds is the drawn bar, 8px from the right edge, never at a negative x', () => {
  const bar = { y: 0, width: 344, height: 36 };
  assert.deepEqual(barBounds({ width: 1400, height: 900 }), { x: 1048, ...bar });
  assert.deepEqual(barBounds({ width: 800, height: 600 }), { x: 448, ...bar });
  assert.deepEqual(barBounds({ width: 352, height: 600 }), { x: 0, ...bar });
  assert.deepEqual(barBounds({ width: 300, height: 600 }), { x: 0, ...bar });
  assert.deepEqual(barBounds({ width: 0, height: 0 }), { x: 0, ...bar });
});

test('the Edit menu find items and their shortcuts', () => {
  assert.deepEqual(
    FIND_MENU_ITEMS.map(({ label, accelerator }) => [label, accelerator]),
    [['Find...', 'CmdOrCtrl+F'], ['Find Next', 'CmdOrCtrl+G'], ['Find Previous', 'CmdOrCtrl+Shift+G']]
  );
});
