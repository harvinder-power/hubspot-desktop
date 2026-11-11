const test = require('node:test');
const assert = require('node:assert/strict');
const { unreadFromTitle, totalUnread } = require('../../src/main/badge');

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
