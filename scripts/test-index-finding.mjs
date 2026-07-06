/**
 * Unit smoke for index/finding helpers (run: node scripts/test-index-finding.mjs)
 */
import assert from 'node:assert/strict';
import { buildGlobalSearchArgs, resolveSearchRoot, normalizeSearchResults } from '../src/lib/globalSearchCall.ts';
import { isPathUnderIndexedRoot, mapFindingEngine } from '../src/lib/indexedRoots.ts';
import { createFindingTab, findingTabLabel, isFindingTab } from '../src/lib/findingTab.ts';
import { setPathCacheEntry, removePathCacheKeys } from '../src/lib/pathCacheLru.ts';

const baseConfig = {
  globalSearchLimit: 500,
  enableEverythingSearch: true,
  enableBndzIndexedSearch: true,
  enableExtendedPatternMatching: false,
  searchFileContent: false,
  enableSmartBooleanQueryParsing: false,
};

assert.equal(resolveSearchRoot('folder', '/C:/Users/test'), '/C:/Users/test');
assert.equal(resolveSearchRoot('location', '/C:/Users/test/docs'), '/C:');
assert.equal(resolveSearchRoot('library', '/C:/Users/test'), '');

const args = buildGlobalSearchArgs(baseConfig, 'invoice', 'folder', '/C:/work');
assert.equal(args.query, 'invoice');
assert.equal(args.rootPath, '/C:/work');
assert.equal(args.useEverything, true);

const normalized = normalizeSearchResults([{ name: 'a.txt', isDirectory: false }, { name: 'dir', isDirectory: true }]);
assert.equal(normalized[0].type, 'file');
assert.equal(normalized[1].type, 'directory');

assert.equal(isPathUnderIndexedRoot('/C:/Users/docs/file.txt', ['/C:/Users/docs']), true);
assert.equal(isPathUnderIndexedRoot('/C:/Other', ['/C:/Users/docs']), false);
assert.equal(isPathUnderIndexedRoot(undefined, ['/C:/Users/docs']), false);

assert.equal(mapFindingEngine('indexed+everything'), 'indexed+everything');
assert.equal(mapFindingEngine('everything'), 'everything');
assert.equal(mapFindingEngine('indexed'), 'indexed');

const tab = createFindingTab('*.pdf', '/C:/work', baseConfig);
assert.equal(isFindingTab(tab), true);
assert.equal(tab.findingQuery, '*.pdf');
assert.equal(tab.findingScope, 'library');
assert.ok(findingTabLabel({ ...tab, findingEngine: 'indexed+everything' }).includes('IDX+EV'));

const cache = {};
const c1 = setPathCacheEntry(cache, '/C:/a', ['a']);
const c2 = setPathCacheEntry(c1, '/C:/b', ['b']);
assert.equal(c2['/C:/a']?.[0], 'a');
assert.equal(c2['/C:/b']?.[0], 'b');
const c3 = removePathCacheKeys(c2, ['/C:/a']);
assert.equal(c3['/C:/a'], undefined);
assert.equal(c3['/C:/b']?.[0], 'b');

console.log('index/finding unit tests passed');
