/** Client preflight for Cloud Drive placement. The native host is authoritative. */

export const CLOUD_DRIVE_BASE_DOMAIN = 'cloud.bndz.org';

export type CloudDrivePlacement = 'cloud' | 'local';
export type CloudDriveLocalBackend = 'hyper-v' | 'wsl2' | 'none';

export type CloudDriveRecord = {
  id: string;
  name: string;
  placement: CloudDrivePlacement | string;
  provider?: string;
  state: string;
  message?: string;
  sizeGb?: number;
  region?: string;
  diskPath?: string;
  vhdxPath?: string;
  vmName?: string;
  hypervisor?: string;
  host?: string;
  port?: number;
  user?: string;
  flyOrg?: string;
  flyApp?: string;
  flyMachineId?: string;
  flyVolumeId?: string;
  keyType?: string;
  publicKey?: string;
  fingerprint?: string;
  sshCommand?: string;
  sshNote?: string;
  sshPort?: number;
  ftpsPort?: number;
  webDavPort?: number;
  endpoints?: CloudDriveEndpoint[];
  tunnelState?: string;
  tunnelMessage?: string;
  tunnelTokenConfigured?: boolean;
  tunnelHostname?: string;
  publicSlug?: string;
  publishMode?: string;
  publishMessage?: string;
  shareUrl?: string;
  machineHost?: string;
  addressGuide?: string;
  cloudflaredPresent?: boolean;
  awayGuide?: string;
  hostKeyChanged?: boolean;
  previousHost?: string;
  previousFlyVolumeId?: string;
  hostKeyNote?: string;
  snapshots?: CloudDriveSnapshot[];
};

export type CloudDriveSnapshot = {
  id: string;
  status?: string;
  createdAt?: string;
  sizeBytes?: number;
};

export type CloudDriveEndpoint = {
  id: string;
  label: string;
  copyText?: string;
  state: string;
  note?: string;
  canCopy?: boolean;
};

export type CloudDriveProbe = {
  tokenConfigured?: boolean;
  tokenValid?: boolean;
  orgSlug?: string;
  tokenMessage?: string;
  hyperV?: boolean;
  wslPresent?: boolean;
  wslVersion?: string | null;
  elevated?: boolean;
  cloudflaredPresent?: boolean;
  cloudflaredMessage?: string;
  rootfsPresent?: boolean;
  rootfsPath?: string;
  rootfsMessage?: string;
  preferred?: string;
  guidance?: string;
  publicBaseDomain?: string;
  landingUrl?: string;
  cloudflareTokenConfigured?: boolean;
  cloudflareMessage?: string;
  localBackend?: CloudDriveLocalBackend | string;
  localBackendMessage?: string;
  lastPlacement?: string | null;
  enableLocalHowTo?: string;
};

export const FLY_REGIONS = ['iad', 'ewr', 'lhr', 'fra', 'sjc', 'syd'] as const;

export function preflightLocalPath(path: string): string | null {
  const trimmed = path.trim().replace(/\//g, '\\');
  if (!trimmed) return 'Pick a folder on a drive other than the system volume.';
  if (trimmed.startsWith('\\\\')) return null;
  if (!/^[A-Za-z]:\\/.test(trimmed) && !/^[A-Za-z]:$/.test(trimmed)) {
    return 'Enter a full Windows path on another drive, for example D:\\BNDZ Drives.';
  }
  const root = trimmed.slice(0, 2).toUpperCase();
  if (root === 'C:') {
    return 'This PC placement keeps the sealed disk off the system volume (C:). Pick a folder on D:, a USB drive, or another letter.';
  }
  return null;
}

export function normalizeLocalPath(path: string): string {
  const trimmed = path.trim().replace(/\//g, '\\');
  if (/^[A-Za-z]:$/.test(trimmed)) return trimmed + '\\';
  return trimmed;
}

export function placementLabel(placement: string): string {
  return placement === 'local' ? 'This PC' : 'Cloud';
}

export function normalizeBase(raw?: string | null): string {
  let s = (raw || '').trim();
  s = s.replace(/^https?:\/\//i, '');
  const slash = s.indexOf('/');
  if (slash >= 0) s = s.slice(0, slash);
  s = s.trim().replace(/\.+$/, '').toLowerCase();
  if (!s || !isPublicHost(s)) return CLOUD_DRIVE_BASE_DOMAIN;
  return s;
}

export function landingUrl(base?: string | null): string {
  return `https://${normalizeBase(base)}/`;
}

export function zoneName(base?: string | null): string {
  const host = normalizeBase(base);
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  return parts.slice(1).join('.');
}

export function driveHost(base: string | null | undefined, slug: string): string {
  const safe = slug.trim().replace(/^\.+|\.+$/g, '').toLowerCase();
  if (!safe) return '';
  return `${safe}.${normalizeBase(base)}`;
}

export function driveUrl(base: string | null | undefined, slug: string): string {
  const host = driveHost(base, slug);
  return host ? `https://${host}/` : '';
}

export function shareLink(base: string | null | undefined, slug: string, token: string): string {
  const host = driveHost(base, slug);
  const id = token.trim();
  if (!host || !id || id.includes('/') || id.includes(' ')) return '';
  return `https://${host}/s/${id}`;
}

export function localBackend(probe: CloudDriveProbe): CloudDriveLocalBackend {
  if (probe.localBackend === 'hyper-v' || probe.localBackend === 'wsl2' || probe.localBackend === 'none') {
    return probe.localBackend;
  }
  if (probe.hyperV) return 'hyper-v';
  if (probe.wslVersion === '2') return 'wsl2';
  return 'none';
}

export function localBackendAvailable(probe: CloudDriveProbe): boolean {
  return localBackend(probe) !== 'none';
}

/** Saved choice wins. Otherwise Cloud is selected only when this PC cannot run a VM. */
export function defaultPlacement(probe: CloudDriveProbe, lastChoice?: string | null): CloudDrivePlacement {
  if (lastChoice === 'cloud' || lastChoice === 'local') return lastChoice;
  return localBackendAvailable(probe) ? 'local' : 'cloud';
}

function isPublicHost(host: string): boolean {
  if (!host || host.length > 253 || !host.includes('.')) return false;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false;
  if (host.endsWith('.fly.dev')) return false;
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)) return false;
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host);
}

/** Client check before the host stores a Cloudflare hostname. Empty clears it. */
export function normalizeTunnelHostname(raw: string): { ok: true; hostname: string } | { ok: false; error: string } {
  let s = raw.trim();
  if (!s) return { ok: true, hostname: '' };
  s = s.replace(/^https?:\/\//i, '');
  const slash = s.indexOf('/');
  if (slash >= 0) s = s.slice(0, slash);
  s = s.trim().replace(/\.+$/, '').toLowerCase();
  if (s === 'localhost' || s === '127.0.0.1' || s === '::1') {
    return { ok: false, error: 'Away access needs a public hostname, not localhost.' };
  }
  if (s.endsWith('.fly.dev')) {
    return { ok: false, error: 'That is a machine address. Drives use a name on cloud.bndz.org.' };
  }
  if (s.length > 253 || !s.includes('.') || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(s)) {
    return { ok: false, error: 'Enter a public hostname such as drive.example.com, without a path.' };
  }
  return { ok: true, hostname: s };
}

/** Layout fixture for the shell preview. Live drives come from the host. */
export function layoutPreviewDrives(): CloudDriveRecord[] {
  const desk = driveUrl(CLOUD_DRIVE_BASE_DOMAIN, 'desk');
  const reel = driveUrl(CLOUD_DRIVE_BASE_DOMAIN, 'reel');
  return [
    {
      id: 'preview-local',
      name: 'Desk vault',
      placement: 'local',
      state: 'running',
      sizeGb: 40,
      diskPath: 'D:\\BNDZ Drives\\BNDZ\\CloudDrives\\preview-local',
      hypervisor: 'hyper-v',
      host: driveHost(CLOUD_DRIVE_BASE_DOMAIN, 'desk'),
      publicSlug: 'desk',
      publishMode: 'dry-run',
      fingerprint: 'SHA256:preview',
      hostKeyNote: 'Data disk kept. The client key on this PC is unchanged (SHA256:preview). The guest SSH host key is on this PC\'s OS disk and is new after a move.',
      sshCommand: 'ssh bndz@desk.cloud.bndz.org',
      publicKey: 'ssh-ed25519 AAAA preview',
      tunnelState: 'dry-run',
      tunnelHostname: 'desk.cloud.bndz.org',
      shareUrl: desk,
      addressGuide: `Send ${desk} Share links use that name. ${landingUrl()} is the account page. The tunnel runs inside the drive.`,
      tunnelMessage: 'Address reserved. Save a Cloudflare API token to publish the tunnel route and DNS record.',
      tunnelTokenConfigured: false,
      awayGuide: 'Cloudflare Tunnel publishes https://desk.cloud.bndz.org/ from inside the drive. It is not Cloudflare Containers and it does not replace the disk.',
      endpoints: [
        { id: 'ssh', label: 'SSH', copyText: 'ssh bndz@desk.cloud.bndz.org', state: 'pending', canCopy: true, note: 'Uses desk.cloud.bndz.org.' },
        { id: 'sftp', label: 'SFTP', copyText: 'sftp bndz@desk.cloud.bndz.org', state: 'pending', canCopy: true, note: 'Same name as SSH.' },
        { id: 'ftp', label: 'FTP', copyText: '', state: 'unavailable', canCopy: false, note: 'Plain FTP is off, including anonymous login. Use FTPS.' },
        { id: 'ftps', label: 'FTPS', copyText: 'ftps://bndz@desk.cloud.bndz.org/', state: 'pending', canCopy: true, note: 'Same name as the panel. Sign-in password stays hidden.' },
        { id: 'webdav', label: 'WebDAV', copyText: 'https://desk.cloud.bndz.org/dav/', state: 'pending', canCopy: true, note: 'Same name as the panel, under /dav/.' },
        { id: 'panel', label: 'Send this', copyText: desk, state: 'pending', canCopy: true, note: 'This is the link you send. Sign in, then open Settings.' },
      ],
    },
    {
      id: 'preview-cloud',
      name: 'Field reel',
      placement: 'cloud',
      state: 'stopped',
      sizeGb: 20,
      region: 'iad',
      publicSlug: 'reel',
      publishMode: 'dry-run',
      host: driveHost(CLOUD_DRIVE_BASE_DOMAIN, 'reel'),
      hostKeyChanged: true,
      hostKeyNote: 'Client key unchanged (SHA256:preview). The machine was replaced, so the SSH server host key is new. On the next SSH or SFTP connection, confirm the new host key. The address stays the same.',
      snapshots: [
        { id: 'vs_preview', status: 'created', createdAt: '2026-10-07T12:00:00Z', sizeBytes: 20 * 1024 * 1024 },
      ],
      sshCommand: 'ssh bndz@reel.cloud.bndz.org',
      tunnelHostname: 'reel.cloud.bndz.org',
      shareUrl: reel,
      addressGuide: `Send ${reel} Share links use that name. ${landingUrl()} is the account page. The tunnel runs inside the drive.`,
      tunnelState: 'dry-run',
      tunnelMessage: 'Address reserved as https://reel.cloud.bndz.org/. Save a Cloudflare API token to publish the tunnel route and DNS record.',
      endpoints: [
        { id: 'ssh', label: 'SSH', copyText: 'ssh bndz@reel.cloud.bndz.org', state: 'pending', canCopy: true, note: 'Uses reel.cloud.bndz.org.' },
        { id: 'sftp', label: 'SFTP', copyText: 'sftp bndz@reel.cloud.bndz.org', state: 'pending', canCopy: true, note: 'Same name as SSH.' },
        { id: 'ftp', label: 'FTP', copyText: '', state: 'unavailable', canCopy: false, note: 'Plain FTP is off, including anonymous login. Use FTPS.' },
        { id: 'ftps', label: 'FTPS', copyText: 'ftps://bndz@reel.cloud.bndz.org/', state: 'pending', canCopy: true, note: 'Same name as the panel.' },
        { id: 'webdav', label: 'WebDAV', copyText: 'https://reel.cloud.bndz.org/dav/', state: 'pending', canCopy: true, note: 'Same name as the panel, under /dav/.' },
        { id: 'panel', label: 'Send this', copyText: reel, state: 'pending', canCopy: true, note: 'This is the link you send. Sign in, then open Settings.' },
      ],
    },
  ];
}

export function nextAction(probe: CloudDriveProbe, placement: string, diskPath = ''): string {
  if (placement === 'local') {
    if (diskPath.trim()) {
      const pathError = preflightLocalPath(diskPath);
      if (pathError) return pathError;
    } else {
      return 'Pick a folder on D: or another drive. The sealed disk is created there, not on C:.';
    }
    const backend = localBackend(probe);
    if (backend === 'none') {
      return probe.localBackendMessage
        || 'Hyper-V and WSL2 are off, so the VM cannot start yet. You can still put the disk on a drive you pick. Enable Hyper-V, then start the drive.';
    }
    if (backend === 'wsl2') {
      return 'Create. This PC will run the drive with WSL2 and attach the sealed disk. It will not make a second copy.';
    }
    if (!probe.elevated) {
      return 'Hyper-V is installed. Windows asks for administrator approval when the drive starts. The disk stays on the folder you pick.';
    }
    if (!probe.rootfsPresent) {
      return probe.rootfsMessage
        || 'Pinned rootfs is not on this PC. Run scripts/fetch-cloud-drive-rootfs.ps1 from an elevated PowerShell. Docker is not used.';
    }
    return 'Create. Start boots pinned Ubuntu. The sealed VHDX is only the data disk and is not recreated.';
  }
  if (!probe.tokenConfigured) {
    return 'Paste a Fly token from your own org, then save it. BNDZ does not share one cloud account.';
  }
  const base = probe.publicBaseDomain || CLOUD_DRIVE_BASE_DOMAIN;
  return `Create the drive. Its address is a hostname on ${base}.`;
}

export function driveHint(drive: CloudDriveRecord): string {
  const local = drive.placement === 'local';
  const pretty = (drive.shareUrl || '').trim()
    || ((drive.tunnelHostname || '').trim() ? `https://${drive.tunnelHostname}/` : '');
  if (drive.state === 'error') {
    return drive.message || 'That did not finish. Try Start again after the note above is fixed.';
  }
  if (local) {
    return drive.state === 'running'
      ? (pretty ? `Send ${pretty}. The sealed data disk is not recreated.` : 'The drive is running on this PC. The sealed data disk is not recreated.')
      : 'Start the drive. The sealed VHDX is the data disk and is not recreated.';
  }
  if (drive.state === 'running') {
    return pretty
      ? `Send ${pretty}. Sign in there, then open Settings for your own name and password.`
      : 'The address is a hostname on cloud.bndz.org. Start publishes it when a Cloudflare token is saved.';
  }
  return pretty
    ? `Start the machine, then send ${pretty}.`
    : 'Start the machine. The address is a hostname on cloud.bndz.org.';
}

/** Client check before the host copies a sealed folder. The host repeats it. */
export function exportFolderError(source: string, destinationParent: string, driveId: string): string | null {
  const id = driveId.trim();
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(id)) return 'That drive id cannot be used as a folder name.';
  const src = pathKey(source);
  const dest = pathKey(destinationParent);
  if (!src || !dest) return 'Pick the folder to copy the sealed disk into.';
  if (!isAbsolute(src) || !isAbsolute(dest)) return 'Enter a full path on another drive, for example E:\\BNDZ Drives.';
  if (isSystemVolume(src) || isSystemVolume(dest)) {
    return 'Keep the sealed disk off the system volume (C:). Pick a folder on D:, a USB drive, or another letter.';
  }
  const slot = pathKey(destinationSlot(destinationParent, id));
  if (src === slot || src === dest) return 'Pick a different folder. That is already this sealed disk.';
  if (nested(src, dest) || nested(dest, src) || nested(src, slot) || nested(slot, src)) {
    return 'The copy cannot sit inside the sealed folder, and the sealed folder cannot sit inside the copy.';
  }
  return null;
}

export function destinationSlot(destinationParent: string, driveId: string): string {
  const dest = destinationParent.trim().replace(/[\\/]+$/, '');
  const slash = Math.max(dest.lastIndexOf('\\'), dest.lastIndexOf('/'));
  const leaf = slash >= 0 ? dest.slice(slash + 1) : dest;
  if (leaf.toLowerCase() === driveId.toLowerCase()) return dest;
  const sep = dest.includes('/') && !dest.includes('\\') ? '/' : '\\';
  return `${dest}${sep}BNDZ${sep}CloudDrives${sep}${driveId}`;
}

export function formatSnapshotSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function pathKey(path: string): string {
  let p = path.trim().replace(/^"|"$/g, '').replace(/\//g, '\\');
  if (/^[A-Za-z]:$/.test(p)) p += '\\';
  const unc = p.startsWith('\\\\');
  let body = unc ? p.slice(2) : p;
  while (body.includes('\\\\')) body = body.replace(/\\\\/g, '\\');
  p = unc ? `\\\\${body}` : body;
  if (!(p.length === 3 && p[1] === ':') && p.length > 3 && p.endsWith('\\')) p = p.replace(/\\+$/, '');
  return p.toUpperCase();
}

function isAbsolute(key: string): boolean {
  if (key.startsWith('\\\\')) return true;
  if (key.length >= 3 && key[1] === ':' && key[2] === '\\') return true;
  if (key.startsWith('\\')) return true;
  return false;
}

function isSystemVolume(key: string): boolean {
  return key.startsWith('C:\\') || key === 'C:';
}

function nested(parent: string, child: string): boolean {
  if (parent === child) return false;
  const p = parent.endsWith('\\') ? parent : `${parent}\\`;
  return child.startsWith(p);
}

export function stateLabel(state: string): string {
  switch (state) {
    case 'creating': return 'Creating';
    case 'running': return 'Running';
    case 'stopped': return 'Stopped';
    case 'error': return 'Needs attention';
    case 'deleting': return 'Deleting';
    default: return state || 'Unknown';
  }
}
