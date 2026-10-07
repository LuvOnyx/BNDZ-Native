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
  cloudflaredPresent?: boolean;
  awayGuide?: string;
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
      sshCommand: 'ssh -p 22210 bndz@127.0.0.1',
      publicKey: 'ssh-ed25519 AAAA preview',
      tunnelState: 'token-needed',
      tunnelMessage: 'Paste a Cloudflare Tunnel token. BNDZ stores it with Windows DPAPI and does not show it again.',
      tunnelTokenConfigured: false,
      awayGuide: 'Cloudflare Tunnel publishes this PC drive. It is not Cloudflare Containers and it does not replace the disk. Point hostnames at ssh://127.0.0.1:22210 and http://127.0.0.1:18110/ for the web panel.',
      endpoints: [
        { id: 'ssh', label: 'SSH', copyText: 'ssh -p 22210 bndz@127.0.0.1', state: 'pending', canCopy: true, note: 'Nothing is listening yet — this PC has no guest image installed.' },
        { id: 'sftp', label: 'SFTP', copyText: 'sftp -P 22210 bndz@127.0.0.1', state: 'pending', canCopy: true, note: 'Same port as SSH. The client flag is a capital P.' },
        { id: 'ftp', label: 'FTP', copyText: '', state: 'unavailable', canCopy: false, note: 'Plain FTP is off, including anonymous login. Use FTPS.' },
        { id: 'ftps', label: 'FTPS', copyText: 'ftps://bndz@127.0.0.1:21210/', state: 'pending', canCopy: true, note: 'Sign-in password stays hidden. Use Copy FTPS password.' },
        { id: 'webdav', label: 'WebDAV', copyText: 'http://127.0.0.1:18111/', state: 'pending', canCopy: true, note: 'Separate from the web panel.' },
        { id: 'panel', label: 'Panel URL', copyText: 'http://127.0.0.1:18110/', state: 'pending', canCopy: true, note: 'Browser login for files and share links. User bndz.' },
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
      sshCommand: 'ssh -p 22211 bndz@bndz-preview.fly.dev',
      tunnelState: 'cloud',
      tunnelMessage: 'Fly publishes this machine. Cloudflare Tunnel is the away path for This PC drives.',
      endpoints: [
        { id: 'ssh', label: 'SSH', copyText: 'ssh -p 22211 bndz@bndz-preview.fly.dev', state: 'pending', canCopy: true, note: 'Not listening until a pinned image boots.' },
        { id: 'sftp', label: 'SFTP', copyText: 'sftp -P 22211 bndz@bndz-preview.fly.dev', state: 'pending', canCopy: true, note: 'SFTP uses the same port as SSH (capital -P).' },
        { id: 'ftp', label: 'FTP', copyText: '', state: 'unavailable', canCopy: false, note: 'Plain FTP is off, including anonymous login. Use FTPS.' },
        { id: 'ftps', label: 'FTPS', copyText: 'ftps://bndz@bndz-preview.fly.dev:21211/', state: 'pending', canCopy: true, note: 'Passive data ports are not published through Fly in this slice.' },
        { id: 'webdav', label: 'WebDAV', copyText: 'http://bndz-preview.fly.dev:18111/', state: 'pending', canCopy: true, note: 'Separate from the web panel.' },
        { id: 'panel', label: 'Panel URL', copyText: 'https://bndz-preview.fly.dev/', state: 'pending', canCopy: true, note: 'Browser login for files and share links. User bndz.' },
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
  return 'Create the drive. A Fly machine is created only after a drive image is set, then you Start it.';
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
  if (!drive.flyApp) {
    return 'Saved here only. Set the drive image, then Start, to create the Fly machine and open the web panel.';
  }
  if (drive.state === 'running') {
    return 'Open the panel URL and sign in as bndz. Use Copy FTPS password. Share links are created in that panel.';
  }
  return 'Start the machine, then open the panel URL. Sign in as bndz with the drive password.';
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
