import assert from 'node:assert/strict';
import { CLOUD_DRIVE_BASE_DOMAIN, defaultPlacement, destinationSlot, driveHint, driveUrl, exportFolderError, formatSnapshotSize, landingUrl, layoutPreviewDrives, localBackend, nextAction, normalizeLocalPath, normalizeTunnelHostname, originHost, placementLabel, preflightLocalPath, shareLink, slugify, stateLabel, validateSlug, zoneName } from '../src/lib/cloudDrive';

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
const previewText = JSON.stringify(layoutPreviewDrives());
assert.doesNotMatch(previewText, /fly\.dev/);
assert.doesNotMatch(previewText, /\b(?:\d{1,3}\.){3}\d{1,3}\b/);
assert.equal(localPreview.placement, 'local');
assert.equal(localPreview.endpoints?.find(e => e.id === 'ssh')?.copyText, '');
assert.equal(localPreview.endpoints?.find(e => e.id === 'sftp')?.copyText, '');
assert.equal(localPreview.endpoints?.find(e => e.id === 'ftp')?.canCopy, false);
assert.equal(localPreview.endpoints?.find(e => e.id === 'machine'), undefined);
assert.match(localPreview.awayGuide || '', /Cloudflare Tunnel/);
assert.doesNotMatch(localPreview.awayGuide || '', /Docker Desktop/i);
assert.equal(cloudPreview.placement, 'cloud');
assert.equal(cloudPreview.endpoints?.find(e => e.id === 'panel')?.canCopy, true);
assert.equal(localPreview.endpoints?.find(e => e.id === 'panel')?.copyText, 'https://cloud.bndz.org/desk/');
assert.equal(cloudPreview.endpoints?.find(e => e.id === 'panel')?.copyText, 'https://cloud.bndz.org/reel/');
assert.equal(localPreview.endpoints?.find(e => e.id === 'webdav')?.copyText, 'https://cloud.bndz.org/desk/dav/');
assert.equal(cloudPreview.endpoints?.find(e => e.id === 'machine'), undefined);
assert.match(cloudPreview.addressGuide || '', /cloud\.bndz\.org/);
assert.notEqual(
  localPreview.endpoints?.find(e => e.id === 'panel')?.copyText,
  localPreview.endpoints?.find(e => e.id === 'webdav')?.copyText,
);
assert.match(cloudPreview.tunnelMessage || '', /Cloudflare API token/);
assert.match(nextAction({}, 'cloud'), /Fly token/);
assert.match(nextAction({ tokenConfigured: true }, 'cloud'), /path/);
assert.doesNotMatch(nextAction({ tokenConfigured: true }, 'cloud'), /Hyper-V/);
assert.match(nextAction({}, 'local', 'C:\\Users\\mikey'), /system volume/);
assert.match(driveHint({ id: 'x', name: 'n', placement: 'local', state: 'stopped' }), /data disk|not recreated/);
assert.match(nextAction({ hyperV: true, elevated: true, rootfsPresent: false }, 'local', 'D:\\BNDZ'), /rootfs|Ubuntu/);
assert.match(nextAction({ hyperV: true, elevated: true, rootfsPresent: true }, 'local', 'D:\\BNDZ'), /not recreated|data disk/);
assert.match(driveHint({ id: 'x', name: 'n', placement: 'cloud', state: 'running', flyApp: 'bndz-demo' }), /path/);
assert.match(driveHint({ id: 'x', name: 'n', placement: 'cloud', state: 'running', flyApp: 'bndz-demo', tunnelHostname: 'files.example.com' }), /files\.example\.com/);
assert.doesNotMatch(driveHint({ id: 'x', name: 'n', placement: 'cloud', state: 'running', flyApp: 'bndz-demo', tunnelHostname: 'files.example.com' }), /fly\.dev/);

assert.equal(CLOUD_DRIVE_BASE_DOMAIN, 'cloud.bndz.org');
assert.equal(zoneName('cloud.bndz.org'), 'bndz.org');
assert.equal(zoneName('example.com'), 'example.com');
assert.equal(landingUrl(''), 'https://cloud.bndz.org/');
assert.equal(driveUrl('cloud.bndz.org', 'desk'), 'https://cloud.bndz.org/desk/');
assert.equal(shareLink('cloud.bndz.org', 'desk', 'tok_1'), 'https://cloud.bndz.org/s/tok_1');
assert.equal(shareLink('cloud.bndz.org', 'desk', 'a/b'), '');
assert.equal(originHost('cloud.bndz.org', 'desk'), 'd-desk.bndz.org');
assert.equal(validateSlug('Desk'), 'Use lowercase letters, numbers, and hyphens.');
assert.equal(validateSlug('-no'), 'The path cannot start or end with a hyphen.');
assert.equal(validateSlug('s'), 'That path is reserved.');
assert.equal(validateSlug('a'.repeat(62)), 'The path cannot be longer than 61 characters.');
assert.equal(validateSlug('desk'), null);
assert.equal(slugify('Private Drive'), 'private-drive');
assert.equal(localBackend({ hyperV: true }), 'hyper-v');
assert.equal(localBackend({ wslVersion: '2' }), 'wsl2');
assert.equal(localBackend({}), 'none');
assert.equal(defaultPlacement({ hyperV: true }, null), 'local');
assert.equal(defaultPlacement({ wslVersion: '2' }, undefined), 'local');
assert.equal(defaultPlacement({}, null), 'cloud');
assert.equal(defaultPlacement({ hyperV: true }, 'cloud'), 'cloud');
assert.equal(defaultPlacement({}, 'local'), 'local');
assert.equal(defaultPlacement({ hyperV: true }, 'somewhere'), 'local');

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
