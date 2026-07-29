import assert from 'node:assert/strict';
import {
  BNDZ_RAM_ROOT,
  isBndzRamPath,
  parseBndzRamZoneId,
  bndzRamVirtualPath,
  isBndzVirtualPath,
} from '../src/lib/bndzVirtualViews';

assert.equal(isBndzRamPath('/bndz/ram'), true);
assert.equal(isBndzRamPath('/bndz/ram/abc123'), true);
assert.equal(isBndzRamPath('/bndz/home'), false);

assert.equal(parseBndzRamZoneId('/bndz/ram/zone42'), 'zone42');
assert.equal(parseBndzRamZoneId('/bndz/ram/zone42/sub'), 'zone42');
assert.equal(parseBndzRamZoneId('/bndz/home'), null);

assert.equal(bndzRamVirtualPath('abc'), `${BNDZ_RAM_ROOT}/abc`);
assert.equal(isBndzVirtualPath(bndzRamVirtualPath('test')), true);

console.log('test-ram-staging-paths: ok');
