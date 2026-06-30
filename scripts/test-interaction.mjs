/**
 * Smoke tests for interaction helpers (run: node scripts/test-interaction.mjs)
 */
import assert from 'node:assert/strict';
import {
  setMarqueeActive,
  isMarqueeActive,
  beginDragSession,
  trackDragPointer,
  shouldAllowDragStart,
  clearDragSession,
  markPointerDown,
  DRAG_THRESHOLD,
} from '../src/lib/dragController.ts';

setMarqueeActive(false);
assert.equal(isMarqueeActive(), false);

setMarqueeActive(true);
assert.equal(shouldAllowDragStart(false), false);
setMarqueeActive(false);

beginDragSession(1, 100, 100);
assert.equal(shouldAllowDragStart(false), false);
trackDragPointer(100 + DRAG_THRESHOLD + 1, 100);
assert.equal(shouldAllowDragStart(false), true);
clearDragSession();

markPointerDown();
assert.equal(shouldAllowDragStart(false), false);

console.log('interaction smoke tests passed');

import { resolveAppearance, applyAppearanceVariants } from '../src/lib/appearanceVariants.ts';

const fakeDoc = { dataset: {}, style: { setProperty: () => {} } };
applyAppearanceVariants({
  appearanceSelectionStyle: 'xyplorer',
  appearanceChromePalette: 'cool',
  appearanceDensity: 'compact',
}, fakeDoc);
assert.equal(fakeDoc.dataset.selectionStyle, 'xyplorer');
assert.equal(resolveAppearance({ appearanceSelectionStyle: 'glow' }).selection, 'glow');

console.log('appearance variant tests passed');

import { normalizeDirEntries } from '../src/lib/normalizeDirEntry.ts';
const norm = normalizeDirEntries([{ id: 'x' }, { label: 'Docs', type: 'directory' }]);
assert.equal(norm[0].name, 'x');
assert.equal(norm[1].name, 'Docs');
console.log('normalize dir entry tests passed');
