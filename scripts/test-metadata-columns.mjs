/**
 * Unit tests for custom column patterns and tree/list item visibility.
 * Run: tsx scripts/test-metadata-columns.mjs
 */
import assert from 'assert';
import {
  matchesColumnPattern,
  pickCustomColumnForEntity,
  resolveCustomColumns,
} from '../src/lib/customColumns.ts';
import {
  classifyTreeListItemTypes,
  isTreeListItemVisible,
  filterTreeListEntities,
} from '../src/lib/treeListItemFilter.ts';

// Custom column patterns
assert.strictEqual(matchesColumnPattern('{Photo}', { extension: 'jpg', type: 'file' }), true);
assert.strictEqual(matchesColumnPattern('{Photo}', { extension: 'txt', type: 'file' }), false);
assert.strictEqual(matchesColumnPattern('*.png;*.gif', { extension: 'png', type: 'file' }), true);
assert.strictEqual(matchesColumnPattern('*.*', { extension: 'dat', type: 'file' }), true);
assert.strictEqual(matchesColumnPattern('*.*', { extension: '', type: 'directory' }), false);

const cols = resolveCustomColumns().map(c => ({ ...c, enabled: true }));
const photoCol = pickCustomColumnForEntity(cols, { extension: 'jpg', type: 'file' });
assert.ok(photoCol?.propertyKey === 'Dimensions' || photoCol?.propertyKey === 'Date Taken');

// Tree/list item filter
const junction = { name: 'Target', type: 'directory', attributes: ['reparse'] };
assert.deepStrictEqual(classifyTreeListItemTypes(junction), ['folders', 'junctions']);
assert.strictEqual(isTreeListItemVisible(junction, { treeListVisibleItemTypes: ['folders', 'files', 'junctions'] }), true);
assert.strictEqual(isTreeListItemVisible(junction, { treeListVisibleItemTypes: ['folders', 'files'] }), false);

const desktopIni = { name: 'desktop.ini', type: 'file', extension: 'ini' };
assert.strictEqual(isTreeListItemVisible(desktopIni, { treeListVisibleItemTypes: ['folders', 'files'] }), false);
assert.strictEqual(isTreeListItemVisible(desktopIni, { treeListVisibleItemTypes: ['folders', 'files', 'desktop_ini'] }), true);

const hiddenFile = { name: 'secret.txt', type: 'file', extension: 'txt', attributes: ['hidden'] };
assert.strictEqual(isTreeListItemVisible(hiddenFile, { showHiddenSystemFoldersInTree: false }), false);
assert.strictEqual(isTreeListItemVisible(hiddenFile, { showHiddenSystemFoldersInTree: true, treeListVisibleItemTypes: ['folders', 'files'] }), true);

const filtered = filterTreeListEntities(
  [junction, { name: 'normal', type: 'directory', attributes: [] }],
  { treeListVisibleItemTypes: ['folders', 'files'] },
);
assert.strictEqual(filtered.length, 1);
assert.strictEqual(filtered[0].name, 'normal');

const defaults = resolveCustomColumns();
assert.strictEqual(defaults.every(c => !c.enabled), true, 'metadata columns should be off by default');

console.log('metadata columns + tree/list filter tests passed');
