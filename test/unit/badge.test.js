const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { unreadFromTitle, totalUnread, watchBadge } = require('../../src/main/badge');

const base = 'http://127.0.0.1:4321';

// One app window on an app page titled '(3) Inbox', watched through a fake registry.
function watchedWindow() {
  const calls = [];
  const contents = Object.assign(new EventEmitter(), { getURL: () => `${base}/contacts`, getTitle: () => '(3) Inbox' });
  const win = Object.assign(new EventEmitter(), { webContents: contents });
  watchBadge({ registry: { onWindow: (listener) => listener(win) }, base, setCount: (count) => calls.push(count) });
  contents.emit('did-navigate');
  return { contents, calls };
}

test('a failed main-frame load drops the window count, and a stopped or subframe load keeps it', () => {
  const table = [
    [[-105, 'x', 'http://127.0.0.1:1/', true], 0],
    [[-20, 'x', `${base}/blocked`, true], 0],
    [[-3, 'x', `${base}/download`, true], 3],
    [[-105, 'x', 'http://127.0.0.1:1/', false], 3],
  ];
  for (const [args, expected] of table) {
    const { contents, calls } = watchedWindow();
    contents.emit('did-fail-load', {}, ...args);
    assert.equal(calls.at(-1), expected, `did-fail-load ${args.join(' ')}`);
  }
});

test('a gone renderer drops the window count', () => {
  const { contents, calls } = watchedWindow();
  assert.equal(calls.at(-1), 3);
  contents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
  assert.equal(calls.at(-1), 0);
});

test('unreadFromTitle reads the leading count of a title', () => {
  const table = [
    ['(3) Inbox', 3],
    ['Inbox', 0],
    ['(0) x', 0],
    ['(12) a (5)', 12],
    ['(99+) x', 99],
    ['( 3 ) x', 0],
    ['(3x)', 0],
    ['Acme (5) Ltd', 0],
    ['(12345) x', 12345],
    ['(123456) x', 0],
    [`(${'9'.repeat(398)})`, 0],
    [`(3) ${'a'.repeat(396)}`, 3],
    ['', 0],
    [undefined, 0],
    [null, 0],
    [3, 0],
    [{ toString: () => '(3) Inbox' }, 0],
  ];
  for (const [title, expected] of table) {
    assert.equal(unreadFromTitle(title), expected, `title ${JSON.stringify(String(title)).slice(0, 40)}`);
  }
});

test('totalUnread is the largest count of all windows', () => {
  assert.equal(totalUnread([]), 0);
  assert.equal(totalUnread([0, 0]), 0);
  assert.equal(totalUnread([3, 7, 2]), 7);
  assert.equal(totalUnread(new Map([['a', 4], ['b', 1]]).values()), 4);
});
