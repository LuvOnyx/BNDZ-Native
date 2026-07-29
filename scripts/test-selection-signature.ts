import assert from 'node:assert/strict';
import {
  classifyMedia,
  deriveSelectionSignature,
  signatureLayoutVariant,
} from '../src/workstation/selectionSignature';

assert.equal(classifyMedia('C:\\pics\\photo.jpg'), 'image');
assert.equal(classifyMedia('C:\\music\\track.flac'), 'audio');
assert.equal(classifyMedia('C:\\dev\\main.py'), 'code');
assert.equal(classifyMedia('C:\\folder', 'directory'), 'folder');

const empty = deriveSelectionSignature([]);
assert.deepEqual(empty, { kind: 'empty' });

const single = deriveSelectionSignature(['D:\\a\\b.png'], ['file']);
assert.equal(single.kind, 'single');
if (single.kind === 'single') {
  assert.equal(single.media, 'image');
  assert.equal(single.path, 'D:\\a\\b.png');
}

const multi = deriveSelectionSignature(
  ['D:\\a\\1.png', 'D:\\a\\2.png', 'D:\\b\\x.wav'],
  ['file', 'file', 'file'],
);
assert.equal(multi.kind, 'multi');
if (multi.kind === 'multi') {
  assert.equal(multi.count, 3);
  assert.equal(multi.dominantMedia, 'image');
}

assert.equal(signatureLayoutVariant({ kind: 'empty' }), 'collapsed');
assert.equal(signatureLayoutVariant({ kind: 'multi', count: 3, dominantMedia: 'image', paths: [] }), 'fan');
assert.equal(
  signatureLayoutVariant({ kind: 'single', media: 'audio', path: 'x', name: 'x' }),
  'wide',
);

console.log('test-selection-signature: ok');
