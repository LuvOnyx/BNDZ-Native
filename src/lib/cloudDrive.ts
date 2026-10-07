/** Client preflight for Cloud Drive placement. The native host is authoritative. */

export type CloudDrivePlacement = 'cloud' | 'local';

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
  preferred?: string;
  guidance?: string;
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
    return { ok: false, error: 'That is the Fly machine address. Save a hostname you control, such as files.example.com.' };
  }
  if (s.length > 253 || !s.includes('.') || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(s)) {
    return { ok: false, error: 'Enter a public hostname such as drive.example.com, without a path.' };
  }
  return { ok: true, hostname: s };
}

/** Layout fixture for the shell preview. Live drives come from the host. */
export function layoutPreviewDrives(): CloudDriveRecord[] {
  return [
    {
      id: 'preview-local',
      name: 'Desk vault',
      placement: 'local',
      state: 'running',
      sizeGb: 40,
      diskPath: 'D:\\BNDZ Drives\\BNDZ\\CloudDrives\\preview-local',
      hypervisor: 'hyper-v',
      host: '127.0.0.1',
      sshPort: 22210,
      ftpsPort: 21210,
      webDavPort: 18110,
      fingerprint: 'SHA256:preview',
      hostKeyNote: 'Same sealed disk. The client key on this PC is unchanged (SHA256:preview). The guest SSH host key travels with the VHDX.',
      sshCommand: 'ssh -p 22210 bndz@127.0.0.1',
      publicKey: 'ssh-ed25519 AAAA preview',
      tunnelState: 'token-needed',
      tunnelHostname: 'desk.example.com',
      shareUrl: 'https://desk.example.com/',
      machineHost: '127.0.0.1',
      addressGuide: 'The link you send is a hostname you own. In Cloudflare Tunnel, point an HTTP public hostname at http://127.0.0.1:18110/ for the panel. BNDZ does not mint a public name.',
      tunnelMessage: 'Paste a Cloudflare Tunnel token. BNDZ stores it with Windows DPAPI and does not show it again.',
      tunnelTokenConfigured: false,
      awayGuide: 'Cloudflare Tunnel publishes this PC drive. It is not Cloudflare Containers and it does not replace the disk. The hostname you save above is the link you send.',
      endpoints: [
        { id: 'ssh', label: 'SSH', copyText: 'ssh -p 22210 bndz@127.0.0.1', state: 'pending', canCopy: true, note: 'Uses the machine address. Nothing is listening yet — this PC has no guest image installed.' },
        { id: 'sftp', label: 'SFTP', copyText: 'sftp -P 22210 bndz@127.0.0.1', state: 'pending', canCopy: true, note: 'Same port as SSH. The client flag is a capital P.' },
        { id: 'ftp', label: 'FTP', copyText: '', state: 'unavailable', canCopy: false, note: 'Plain FTP is off, including anonymous login. Use FTPS.' },
        { id: 'ftps', label: 'FTPS', copyText: 'ftps://bndz@127.0.0.1:21210/', state: 'pending', canCopy: true, note: 'On the machine address. Sign-in password stays hidden.' },
        { id: 'webdav', label: 'WebDAV', copyText: 'http://127.0.0.1:18111/', state: 'pending', canCopy: true, note: 'On the machine address, separate from the link you send.' },
        { id: 'panel', label: 'Send this', copyText: 'https://desk.example.com/', state: 'pending', canCopy: true, note: 'This is the link you send. Sign in, then open Settings.' },
        { id: 'machine', label: 'Machine', copyText: 'http://127.0.0.1:18110/', state: 'pending', canCopy: true, note: 'Loopback on this PC. Away access uses the hostname above.' },
      ],
    },
    {
      id: 'preview-cloud',
      name: 'Field reel',
      placement: 'cloud',
      state: 'stopped',
      sizeGb: 20,
      region: 'iad',
      flyApp: 'bndz-preview',
      flyVolumeId: 'vol_preview',
      hostKeyChanged: true,
      previousHost: 'bndz-preview.fly.dev',
      hostKeyNote: 'Client key unchanged (SHA256:preview). The machine was replaced, so the SSH server host key is new. On the next SSH or SFTP connection, confirm the new host key. The app address stays the same.',
      snapshots: [
        { id: 'vs_preview', status: 'created', createdAt: '2026-10-07T12:00:00Z', sizeBytes: 20 * 1024 * 1024 },
      ],
      sshCommand: 'ssh -p 22211 bndz@bndz-preview.fly.dev',
      tunnelHostname: 'reel.example.com',
      shareUrl: 'https://reel.example.com/',
      machineHost: 'bndz-preview.fly.dev',
      addressGuide: 'Save a hostname you control, such as files.example.com. In Cloudflare DNS add a CNAME to bndz-preview.fly.dev, then add the certificate: fly certs add files.example.com -a bndz-preview. SSH stays on the machine address.',
      tunnelState: 'cloud',
      tunnelMessage: 'Fly publishes this machine. The link you send is the hostname you save, not the machine address.',
      endpoints: [
        { id: 'ssh', label: 'SSH', copyText: 'ssh -p 22211 bndz@bndz-preview.fly.dev', state: 'pending', canCopy: true, note: 'Uses the machine address. Not the link you send.' },
        { id: 'sftp', label: 'SFTP', copyText: 'sftp -P 22211 bndz@bndz-preview.fly.dev', state: 'pending', canCopy: true, note: 'SFTP uses the same port as SSH (capital -P).' },
        { id: 'ftp', label: 'FTP', copyText: '', state: 'unavailable', canCopy: false, note: 'Plain FTP is off, including anonymous login. Use FTPS.' },
        { id: 'ftps', label: 'FTPS', copyText: 'ftps://bndz@bndz-preview.fly.dev:21211/', state: 'pending', canCopy: true, note: 'On the machine address. Passive data ports are not published.' },
        { id: 'webdav', label: 'WebDAV', copyText: 'http://bndz-preview.fly.dev:18111/', state: 'pending', canCopy: true, note: 'On the machine address, separate from the link you send.' },
        { id: 'panel', label: 'Send this', copyText: 'https://reel.example.com/', state: 'pending', canCopy: true, note: 'This is the link you send. Sign in, then open Settings.' },
        { id: 'machine', label: 'Machine', copyText: 'https://bndz-preview.fly.dev/', state: 'pending', canCopy: true, note: 'Fly machine address for SSH and FTPS. Do not send this.' },
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
    if (!probe.hyperV && probe.wslVersion !== '2') {
      return 'Turn on Hyper-V, or install WSL2 with wsl --install. Docker is not used.';
    }
    if (probe.hyperV && !probe.elevated) {
      return 'Hyper-V is installed. Run BNDZ as administrator before Start so the VM can be created.';
    }
    return 'Create the drive. The guest image is not installed yet, so SSH and the web panel will not answer until it is.';
  }
  if (!probe.tokenConfigured) {
    return 'Paste a Fly token from your own org, then save it. BNDZ does not share one cloud account.';
  }
  return 'Create the drive. After Start, save a hostname you control. That name is the link you send, not the Fly machine address.';
}

export function driveHint(drive: CloudDriveRecord): string {
  const local = drive.placement === 'local';
  if (drive.state === 'error') {
    return drive.message || 'That did not finish. Try Start again after the note above is fixed.';
  }
  if (local) {
    return drive.state === 'running'
      ? 'Hyper-V says the VM is running. This PC has no guest image yet, so the web panel and SSH are not answering.'
      : 'Start when Hyper-V is ready. The web panel is on the guest image, which is not installed yet.';
  }
  const pretty = (drive.tunnelHostname || '').trim();
  if (!drive.flyApp) {
    return 'Saved here only. Set the drive image, then Start. After it is up, save a hostname you control. That name is the link you send.';
  }
  if (drive.state === 'running') {
    return pretty
      ? `Send https://${pretty}/ . Sign in there, then open Settings for your own name and password. SSH stays on the machine address.`
      : 'Save a hostname you control, such as files.example.com, before you send this drive. SSH stays on the Fly machine address.';
  }
  return pretty
    ? `Start the machine, then send https://${pretty}/ .`
    : 'Start the machine, then save a hostname you control. The Fly machine address is for SSH, not the link you text.';
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
