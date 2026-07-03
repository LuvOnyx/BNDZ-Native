/**
 * Unit smoke for storage organize helpers (run: node scripts/test-storage-organize.mjs)
 */
import assert from 'node:assert/strict';
import {
  buildOrganizePlan,
  buildDuplicateCleanupPreview,
  bucketForFile,
  formatStorageSize,
  panePathFromWin,
  winPathFromPane,
} from '../src/lib/storageOrganize.ts';

assert.equal(bucketForFile('photo.png'), 'Images');
assert.equal(bucketForFile('notes.pdf'), 'Documents');
assert.equal(bucketForFile('app.tsx'), 'Code');
assert.equal(bucketForFile('unknown.xyz'), 'Other');

const plan = buildOrganizePlan('C:\\work', [
  { type: 'file', name: 'a.png' },
  { type: 'file', name: 'b.pdf' },
  { type: 'directory', name: 'subdir' },
], '/C:/work');
assert.equal(plan.length, 2);
assert.equal(plan[0].bucket, 'Images');
assert.equal(plan[0].dest, 'C:\\work\\Images\\a.png');

const preview = buildDuplicateCleanupPreview([
  { hash: 'abc', size: 1024, paths: ['C:\\a\\one.txt', 'C:\\b\\two.txt'] },
], 'first');
assert.equal(preview.length, 1);
assert.equal(preview[0].deletePaths.length, 1);
assert.equal(preview[0].reclaimable, 1024);

assert.equal(formatStorageSize(0), '0 B');
assert.equal(formatStorageSize(1536).includes('KB'), true);
assert.equal(panePathFromWin('C:\\Users\\test'), '/C:/Users/test');
assert.equal(winPathFromPane('/C:/Users/test'), 'C:\\Users\\test');

console.log('storage organize unit tests passed');
