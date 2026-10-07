import assert from 'node:assert/strict';
import { destinationSlot, driveHint, exportFolderError, formatSnapshotSize, layoutPreviewDrives, nextAction, normalizeLocalPath, normalizeTunnelHostname, placementLabel, preflightLocalPath, stateLabel } from '../src/lib/cloudDrive';

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
assert.equal(normalizeTunnelHostname('bndz-preview.fly.dev').ok, false);
const flyHost = normalizeTunnelHostname('https://app.fly.dev/');
assert.equal(flyHost.ok, false);
if (!flyHost.ok) assert.match(flyHost.error, /machine address/);

const [localPreview, cloudPreview] = layoutPreviewDrives();
assert.equal(localPreview.placement, 'local');
assert.match(localPreview.endpoints?.find(e => e.id === 'ssh')?.copyText || '', /^ssh -p \d+ bndz@127\.0\.0\.1$/);
assert.match(localPreview.endpoints?.find(e => e.id === 'sftp')?.copyText || '', /^sftp -P \d+ /);
assert.equal(localPreview.endpoints?.find(e => e.id === 'ftp')?.canCopy, false);
assert.match(localPreview.awayGuide || '', /Cloudflare Tunnel/);
assert.doesNotMatch(localPreview.awayGuide || '', /Docker Desktop/i);
assert.equal(cloudPreview.placement, 'cloud');
assert.equal(cloudPreview.endpoints?.find(e => e.id === 'panel')?.canCopy, true);
assert.match(localPreview.endpoints?.find(e => e.id === 'panel')?.copyText || '', /^https:\/\/desk\.example\.com\/$/);
assert.match(localPreview.endpoints?.find(e => e.id === 'machine')?.copyText || '', /^http:\/\/127\.0\.0\.1:\d+\/$/);
assert.match(cloudPreview.endpoints?.find(e => e.id === 'panel')?.copyText || '', /^https:\/\/reel\.example\.com\/$/);
assert.doesNotMatch(cloudPreview.endpoints?.find(e => e.id === 'panel')?.copyText || '', /fly\.dev/);
assert.match(cloudPreview.endpoints?.find(e => e.id === 'machine')?.copyText || '', /fly\.dev/);
assert.match(cloudPreview.addressGuide || '', /fly certs add/);
assert.notEqual(
  localPreview.endpoints?.find(e => e.id === 'panel')?.copyText,
  localPreview.endpoints?.find(e => e.id === 'webdav')?.copyText,
);
assert.match(cloudPreview.tunnelMessage || '', /hostname you save/);
assert.match(nextAction({}, 'cloud'), /Fly token/);
assert.match(nextAction({ tokenConfigured: true }, 'cloud'), /hostname/);
assert.match(nextAction({}, 'local', 'C:\\Users\\mikey'), /system volume/);
assert.match(driveHint({ id: 'x', name: 'n', placement: 'local', state: 'stopped' }), /guest image/);
assert.match(driveHint({ id: 'x', name: 'n', placement: 'cloud', state: 'running', flyApp: 'bndz-demo' }), /hostname/);
assert.match(driveHint({ id: 'x', name: 'n', placement: 'cloud', state: 'running', flyApp: 'bndz-demo', tunnelHostname: 'files.example.com' }), /files\.example\.com/);
assert.doesNotMatch(driveHint({ id: 'x', name: 'n', placement: 'cloud', state: 'running', flyApp: 'bndz-demo', tunnelHostname: 'files.example.com' }), /fly\.dev/);

const source = 'D:\\BNDZ\\CloudDrives\\cdabc123';
assert.equal(exportFolderError(source, 'E:\\Backups', 'cdabc123'), null);
assert.equal(destinationSlot('E:\\Backups', 'cdabc123'), 'E:\\Backups\\BNDZ\\CloudDrives\\cdabc123');
assert.match(exportFolderError(source, 'C:\\Users\\mikey', 'cdabc123') || '', /system volume/);
assert.match(exportFolderError(source, source, 'cdabc123') || '', /already this sealed disk/);
assert.match(exportFolderError(source, 'D:\\BNDZ\\CloudDrives\\cdabc123\\nested', 'cdabc123') || '', /inside/);
assert.match(exportFolderError('relative', 'E:\\Backups', 'cdabc123') || '', /full path/);
assert.equal(formatSnapshotSize(20 * 1024 * 1024), '20 MB');
assert.equal(cloudPreview.snapshots?.[0]?.id, 'vs_preview');
assert.match(cloudPreview.hostKeyNote || '', /host key/);
assert.match(localPreview.hostKeyNote || '', /unchanged/);

console.log('test-cloud-drive: ok');
