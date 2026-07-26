/** Shared Remote Mesh types — mirrors BNDZBackend MeshModels.cs */

export type MeshProviderKind = 0 | 1; // Ssh | S3
export type MeshConnectionState = 0 | 1 | 2 | 3 | 4;
export type MeshAuthKind = 0 | 1 | 2; // Agent | PrivateKey | Password

export type MeshHost = {
  id: string;
  alias: string;
  provider: MeshProviderKind;
  hostname: string;
  port: number;
  username: string;
  keyPath?: string;
  authKind: MeshAuthKind;
  jumpHostId?: string;
  hostKeyFingerprint?: string;
  s3Bucket?: string;
  s3Region?: string;
  s3Endpoint?: string;
  s3AccessKeyId?: string;
  state: MeshConnectionState;
  lastSeenUtc?: string;
  lastError?: string;
  cacheQuotaBytes?: number;
  showInNavTree?: boolean;
  remoteRootPath?: string;
  notes?: string;
  passwordPlain?: string;
};

export type MeshSyncRule = {
  id: string;
  name: string;
  localPath: string;
  remoteHostId: string;
  remotePath: string;
  pushOnSave: boolean;
  debounceMs: number;
  enabled: boolean;
  includeGlob?: string;
  excludeGlob?: string;
  lastSyncUtc?: string;
  lastStatus?: string;
  lastError?: string;
};

export const MESH_STATE_LABEL: Record<number, string> = {
  0: 'Offline',
  1: 'Connecting…',
  2: 'Online',
  3: 'Degraded',
  4: 'Error',
};

export const MESH_PROVIDER_LABEL: Record<number, string> = {
  0: 'SSH / SFTP',
  1: 'S3 Compatible',
};

export const MESH_AUTH_LABEL: Record<number, string> = {
  0: 'SSH Agent',
  1: 'Private Key',
  2: 'Password',
};

export function normalizeMeshHost(raw: Record<string, unknown>): MeshHost {
  return {
    id: String(raw.id ?? raw.Id ?? `host-${Date.now()}`),
    alias: String(raw.alias ?? raw.Alias ?? 'Remote Host'),
    provider: Number(raw.provider ?? raw.Provider ?? 0) as MeshProviderKind,
    hostname: String(raw.hostname ?? raw.Hostname ?? ''),
    port: Number(raw.port ?? raw.Port ?? 22),
    username: String(raw.username ?? raw.Username ?? ''),
    keyPath: (raw.keyPath ?? raw.KeyPath) as string | undefined,
    authKind: Number(raw.authKind ?? raw.AuthKind ?? 0) as MeshAuthKind,
    jumpHostId: (raw.jumpHostId ?? raw.JumpHostId) as string | undefined,
    hostKeyFingerprint: (raw.hostKeyFingerprint ?? raw.HostKeyFingerprint) as string | undefined,
    s3Bucket: (raw.s3Bucket ?? raw.S3Bucket) as string | undefined,
    s3Region: (raw.s3Region ?? raw.S3Region) as string | undefined,
    s3Endpoint: (raw.s3Endpoint ?? raw.S3Endpoint) as string | undefined,
    s3AccessKeyId: (raw.s3AccessKeyId ?? raw.S3AccessKeyId) as string | undefined,
    state: Number(raw.state ?? raw.State ?? 0) as MeshConnectionState,
    lastSeenUtc: (raw.lastSeenUtc ?? raw.LastSeenUtc) as string | undefined,
    lastError: (raw.lastError ?? raw.LastError) as string | undefined,
    cacheQuotaBytes: Number(raw.cacheQuotaBytes ?? raw.CacheQuotaBytes ?? 2147483648),
    showInNavTree: raw.showInNavTree !== false && raw.ShowInNavTree !== false,
    remoteRootPath: String(raw.remoteRootPath ?? raw.RemoteRootPath ?? '/'),
    notes: (raw.notes ?? raw.Notes) as string | undefined,
  };
}

export function createEmptyMeshHost(partial?: Partial<MeshHost>): MeshHost {
  return {
    id: `host-${Date.now().toString(36)}`,
    alias: 'New Host',
    provider: 0,
    hostname: '',
    port: 22,
    username: '',
    authKind: 0,
    state: 0,
    showInNavTree: true,
    remoteRootPath: '/',
    ...partial,
  };
}

export function meshHostToPayload(host: MeshHost): Record<string, unknown> {
  return {
    id: host.id,
    alias: host.alias,
    provider: host.provider,
    hostname: host.hostname,
    port: host.port,
    username: host.username,
    keyPath: host.keyPath || null,
    authKind: host.authKind,
    jumpHostId: host.jumpHostId || null,
    hostKeyFingerprint: host.hostKeyFingerprint || null,
    s3Bucket: host.s3Bucket || null,
    s3Region: host.s3Region || null,
    s3Endpoint: host.s3Endpoint || null,
    s3AccessKeyId: host.s3AccessKeyId || null,
    showInNavTree: host.showInNavTree !== false,
    remoteRootPath: host.remoteRootPath || '/',
    notes: host.notes || null,
    passwordPlain: host.passwordPlain || null,
  };
}
