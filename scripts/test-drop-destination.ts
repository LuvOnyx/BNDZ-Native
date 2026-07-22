import assert from 'node:assert/strict';
import {
  getParentWinPath,
  isDropIntoDraggedSource,
  isSameDropLocation,
  normalizeWinPathForCompare,
  shouldCommitInternalFileDrop,
} from '../src/lib/dropDestination';

assert.equal(normalizeWinPathForCompare('C:\\Users\\a\\b\\'), 'c:\\users\\a\\b');
assert.equal(normalizeWinPathForCompare('/C:/Users/a/b'), 'c:\\users\\a\\b');
assert.equal(normalizeWinPathForCompare('C:'), 'c:\\');
assert.equal(normalizeWinPathForCompare('/C:'), 'c:\\');

assert.equal(getParentWinPath('C:\\Users\\a\\file.txt'), 'C:\\Users\\a');
assert.equal(getParentWinPath('C:\\file.txt'), 'C:\\');
assert.equal(normalizeWinPathForCompare(getParentWinPath('C:\\file.txt')), 'c:\\');

assert.equal(
  isSameDropLocation(['C:\\Users\\a\\file.txt'], 'C:\\Users\\a'),
  true,
);
assert.equal(
  isSameDropLocation(['C:\\Users\\a\\file.txt'], 'C:\\Users\\a\\'),
  true,
);
assert.equal(
  isSameDropLocation(['C:\\Users\\a\\file.txt'], '/C:/Users/a'),
  true,
);
assert.equal(
  isSameDropLocation(['C:\\file.txt'], 'C:\\'),
  true,
);
assert.equal(
  isSameDropLocation(['C:\\Users\\a\\file.txt'], 'C:\\Users\\b'),
  false,
);

assert.equal(
  isDropIntoDraggedSource(['C:\\Users\\a\\Folder'], 'C:\\Users\\a\\Folder'),
  true,
);
assert.equal(
  isDropIntoDraggedSource(['C:\\Users\\a\\Folder'], 'C:\\Users\\a\\Folder\\child'),
  true,
);
assert.equal(
  isDropIntoDraggedSource(['C:\\Users\\a\\Folder'], 'C:\\Users\\a\\Other'),
  false,
);

// Put-back: same folder, tiny travel → do not commit move
assert.equal(
  shouldCommitInternalFileDrop({
    sourcePaths: ['C:\\Users\\a\\file.txt'],
    destDir: 'C:\\Users\\a',
    op: 'move',
    hasForeignTarget: false,
    pointerTravelPx: 4,
  }),
  false,
);

// Accidental drop into self (folder onto itself)
assert.equal(
  shouldCommitInternalFileDrop({
    sourcePaths: ['C:\\Users\\a\\Folder'],
    destDir: 'C:\\Users\\a\\Folder',
    op: 'move',
    hasForeignTarget: true,
    pointerTravelPx: 80,
  }),
  false,
);

// Real move into another folder
assert.equal(
  shouldCommitInternalFileDrop({
    sourcePaths: ['C:\\Users\\a\\file.txt'],
    destDir: 'C:\\Users\\a\\Folder',
    op: 'move',
    hasForeignTarget: true,
    pointerTravelPx: 80,
  }),
  true,
);

// Copy into same folder is allowed
assert.equal(
  shouldCommitInternalFileDrop({
    sourcePaths: ['C:\\Users\\a\\file.txt'],
    destDir: 'C:\\Users\\a',
    op: 'copy',
    hasForeignTarget: false,
    pointerTravelPx: 80,
  }),
  true,
);

console.log('dropDestination unit tests passed');
