import assert from 'node:assert/strict';
import { escapeRegExp, safeRegExp, stripExtensionSuffix } from '../src/lib/safeRegex';
import { getDisplayName } from '../src/lib/settingsRuntime';

// The crash on 2026-10-08: extension text with regex characters built into /\.<ext>$/i.
assert.equal(stripExtensionSuffix('archive.?7)', '?7)'), 'archive');
assert.equal(stripExtensionSuffix('Photo.JPG', 'jpg'), 'Photo');
assert.equal(stripExtensionSuffix('Photo.JPG', '.jpg'), 'Photo');
assert.equal(stripExtensionSuffix('jpg', 'jpg'), 'jpg');
assert.equal(stripExtensionSuffix('readme', ''), 'readme');
assert.equal(stripExtensionSuffix('a.b(c', 'b(c'), 'a');

assert.equal(safeRegExp('\\.?7)$', 'i'), null);
assert.ok(safeRegExp('^a.*b$')?.test('axxb'));
const lit = new RegExp(escapeRegExp('a(b)?.c[1]'));
assert.ok(lit.test('xa(b)?.c[1]y'));
assert.ok(!lit.test('abc1'));

const name = getDisplayName(
  { name: 'weird.?7)', extension: '?7)', type: 'file' },
  { showFileExtensions: false } as any,
);
assert.equal(name, 'weird');

console.log('safe-regex: ok');
