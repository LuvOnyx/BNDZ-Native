import assert from 'node:assert/strict';
import { layoutPreviewDrives, normalizeLocalPath, normalizeTunnelHostname, placementLabel, preflightLocalPath, stateLabel } from '../src/lib/cloudDrive';

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

assert.deepEqual(normalizeTunnelHostname(''), { ok: true, hostname: '' });
assert.deepEqual(normalizeTunnelHostname('https://Drive.Example.com/files'), { ok: true, hostname: 'drive.example.com' });
assert.equal(normalizeTunnelHostname('localhost').ok, false);
assert.equal(normalizeTunnelHostname('not a host').ok, false);

const [localPreview, cloudPreview] = layoutPreviewDrives();
assert.equal(localPreview.placement, 'local');
assert.match(localPreview.endpoints?.find(e => e.id === 'ssh')?.copyText || '', /^ssh -p \d+ bndz@127\.0\.0\.1$/);
assert.match(localPreview.endpoints?.find(e => e.id === 'sftp')?.copyText || '', /^sftp -P \d+ /);
assert.equal(localPreview.endpoints?.find(e => e.id === 'ftp')?.canCopy, false);
assert.match(localPreview.awayGuide || '', /Cloudflare Tunnel/);
assert.doesNotMatch(localPreview.awayGuide || '', /Docker Desktop/i);
assert.equal(cloudPreview.placement, 'cloud');
assert.equal(cloudPreview.endpoints?.find(e => e.id === 'panel')?.canCopy, true);
assert.match(cloudPreview.tunnelMessage || '', /This PC/);

console.log('test-cloud-drive: ok');
