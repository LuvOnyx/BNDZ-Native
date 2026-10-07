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
