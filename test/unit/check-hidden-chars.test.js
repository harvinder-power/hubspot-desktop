const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { findHiddenChars, readText } = require('../../scripts/check-hidden-chars');

const repoRoot = path.join(__dirname, '..', '..');
const char = (codePoint) => String.fromCodePoint(codePoint);

test('each hidden range fails with line, column and code point', () => {
  const codePoints = [
    0x200b, 0x200f, 0x202a, 0x202e, 0x2060, 0x2069, 0xfeff, 0x00, 0x08, 0x0b, 0x1b, 0x1f, 0x7f,
    0x00ad, 0x061c, 0x180e, 0x2028, 0x2029, 0xe0000, 0xe0001, 0xe007f,
  ];
  for (const codePoint of codePoints) {
    const text = `first line\nab${char(codePoint)}cd\n`;
    assert.deepEqual(findHiddenChars(text), [{ line: 2, column: 3, codePoint }], `U+${codePoint.toString(16)}`);
  }
});

test('a byte order mark at the start of a file passes, and a later one fails', () => {
  assert.deepEqual(findHiddenChars(`${char(0xfeff)}text`), []);
  assert.deepEqual(findHiddenChars(`${char(0xfeff)}a${char(0xfeff)}`), [{ line: 1, column: 3, codePoint: 0xfeff }]);
});

test('plain ASCII with tab, newline and carriage return passes', () => {
  assert.deepEqual(findHiddenChars('const a = 1;\r\n\tb();\n'), []);
});

test('ordinary non-ASCII punctuation and symbols pass', () => {
  const ordinary = [0x2014, 0x2013, 0x2019, 0x201c, 0x2026, 0x2318, 0x21e7, 0x2325, 0x2192, 0x00e9, 0x1f600, 0x200a, 0x2010, 0x202f, 0x205f, 0x206a, 0x00a0,
    0x00ac, 0x00ae, 0x061b, 0x061d, 0x180d, 0x180f, 0x2027, 0xdffff, 0xe0080];
  assert.deepEqual(findHiddenChars(ordinary.map(char).join(' ')), []);
});

test('a missing tracked file is skipped, and a present one is read', () => {
  assert.equal(readText(path.join(repoRoot, 'no-such-file.txt')), null);
  assert.equal(readText(path.join(repoRoot, 'package.json')), fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
});

test('npm run check:chars passes on the repo', () => {
  const output = execFileSync(process.execPath, [path.join(repoRoot, 'scripts', 'check-hidden-chars.js')], { cwd: repoRoot, encoding: 'utf8' });
  assert.match(output, /no hidden characters in \d+ files/);
});

test('CI runs the check', () => {
  const ci = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(ci, /run: npm run check:chars/);
});
