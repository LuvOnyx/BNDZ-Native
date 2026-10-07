import assert from 'node:assert/strict';
import { normalizeLocalPath, placementLabel, preflightLocalPath, stateLabel } from '../src/lib/cloudDrive';

assert.equal(preflightLocalPath(''), 'Pick a folder on a drive other than the system volume.');
assert.match(preflightLocalPath('C:\\Users\\mikey') || '', /system volume/);
assert.match(preflightLocalPath('c:/Windows') || '', /system volume/);
assert.equal(preflightLocalPath('relative\\folder'), 'Enter a full Windows path on another drive, for example D:\\BNDZ Drives.');
assert.equal(preflightLocalPath('D:\\BNDZ Drives'), null);
assert.equal(preflightLocalPath('E:'), null);
assert.equal(preflightLocalPath('\\\\nas\\share\\drives'), null);

assert.equal(normalizeLocalPath('D:'), 'D:\\');
assert.equal(normalizeLocalPath('D:/BNDZ'), 'D:\\BNDZ');

assert.equal(placementLabel('local'), 'This PC');
assert.equal(placementLabel('cloud'), 'Cloud');
assert.equal(stateLabel('creating'), 'Creating');
assert.equal(stateLabel('error'), 'Needs attention');

console.log('test-cloud-drive: ok');
