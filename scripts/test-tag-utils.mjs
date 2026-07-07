import assert from 'node:assert/strict';
import { tagStorageKey, findTagMeta } from '../src/lib/tagUtils.ts';

assert.equal(tagStorageKey({ id: 'red', label: 'Important' }), 'red');
assert.equal(tagStorageKey({ label: 'To Review' }), 'to-review');

const tags = [
  { id: 'red', label: 'Important', color: '#f00' },
  { id: 'blue', label: 'To Review', color: '#08f' },
];

assert.equal(findTagMeta('red', tags)?.label, 'Important');
assert.equal(findTagMeta('important', tags)?.id, 'red');
assert.equal(findTagMeta('to-review', tags)?.id, 'blue');

console.log('tagUtils: ok');
