#!/usr/bin/env node
// Fails on invisible or bidirectional control characters in tracked text files.
// The ranges are numeric code points, so this file holds none of the characters it looks for.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const HIDDEN_RANGES = [
  [0x00ad, 0x00ad],
  [0x061c, 0x061c],
  [0x180e, 0x180e],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x2069],
  [0xfeff, 0xfeff],
  [0xe0000, 0xe007f],
];
const ALLOWED_CONTROLS = [0x09, 0x0a, 0x0d];
const BOM = 0xfeff;
const BINARY_EXTENSIONS = new Set(['.png', '.icns', '.ico', '.jpg', '.jpeg', '.gif', '.webp', '.pdf', '.zip', '.dmg', '.woff', '.woff2', '.ttf', '.otf']);

const isAsciiControl = (codePoint) => (codePoint < 0x20 || codePoint === 0x7f) && !ALLOWED_CONTROLS.includes(codePoint);
const isHidden = (codePoint) => isAsciiControl(codePoint) || HIDDEN_RANGES.some(([low, high]) => codePoint >= low && codePoint <= high);

// Returns [{ line, column, codePoint }], 1-based. A byte order mark at the very start of the text is allowed.
function findHiddenChars(text) {
  const found = [];
  let line = 1;
  let column = 0;
  let first = true;
  for (const ch of text) {
    const codePoint = ch.codePointAt(0);
    column += 1;
    if (isHidden(codePoint) && !(first && codePoint === BOM)) found.push({ line, column, codePoint });
    if (codePoint === 0x0a) {
      line += 1;
      column = 0;
    }
    first = false;
  }
  return found;
}

const hex = (codePoint) => `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;

// Returns the text of a file, or null when it is missing, as a tracked file deleted from the work tree is.
function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function main() {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter((file) => file && !BINARY_EXTENSIONS.has(path.extname(file).toLowerCase()));
  let failures = 0;
  for (const file of files) {
    const text = readText(path.join(root, file));
    if (text === null) continue;
    for (const { line, column, codePoint } of findHiddenChars(text)) {
      console.error(`${file}:${line}:${column} ${hex(codePoint)}`);
      failures += 1;
    }
  }
  if (failures > 0) {
    console.error(`${failures} hidden characters found`);
    process.exit(1);
  }
  console.log(`no hidden characters in ${files.length} files`);
}

if (require.main === module) main();

module.exports = { findHiddenChars, readText };
