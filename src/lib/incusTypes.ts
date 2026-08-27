/** Incus ephemeral types — mirrors BNDZBackend Services/Mesh/Incus/IncusModels.cs */

export type IncusEndpoint = {
  id: string;
  alias: string;
  apiUrl: string;
  serverFingerprint?: string;
  project?: string;
  defaultImage: string;
  defaultImageServer: string;
  defaultInstanceType: string;
  defaultSshUser: string;
  defaultSshPort: number;
  defaultSshKeyPath?: string;
  allowInsecureTls: boolean;
  notes?: string;
  lastError?: string;
  lastSeenUtc?: string;
  trusted: boolean;
  trustTokenPlain?: string;
};

export type IncusEphemeralInstance = {
  id: string;
  endpointId: string;
  instanceName: string;
  status: string;
  ipv4?: string;
  ipv6?: string;
  meshHostId?: string;
  imageAlias: string;
  instanceType: string;
  ephemeral: boolean;
  createdUtc: string;
  lastError?: string;
  notes?: string;
};

export function normalizeIncusEndpoint(raw: Record<string, unknown>): IncusEndpoint {
  return {
    id: String(raw.id ?? raw.Id ?? `incus-${Date.now().toString(36)}`),
    alias: String(raw.alias ?? raw.Alias ?? 'Incus'),
    apiUrl: String(raw.apiUrl ?? raw.ApiUrl ?? ''),
    serverFingerprint: (raw.serverFingerprint ?? raw.ServerFingerprint) as string | undefined,
    project: String(raw.project ?? raw.Project ?? 'default'),
    defaultImage: String(raw.defaultImage ?? raw.DefaultImage ?? 'ubuntu/24.04/cloud'),
    defaultImageServer: String(raw.defaultImageServer ?? raw.DefaultImageServer ?? 'https://images.linuxcontainers.org'),
    defaultInstanceType: String(raw.defaultInstanceType ?? raw.DefaultInstanceType ?? 'container'),
    defaultSshUser: String(raw.defaultSshUser ?? raw.DefaultSshUser ?? 'root'),
    defaultSshPort: Number(raw.defaultSshPort ?? raw.DefaultSshPort ?? 22),
    defaultSshKeyPath: (raw.defaultSshKeyPath ?? raw.DefaultSshKeyPath) as string | undefined,
    allowInsecureTls: Boolean(raw.allowInsecureTls ?? raw.AllowInsecureTls ?? false),
    notes: (raw.notes ?? raw.Notes) as string | undefined,
    lastError: (raw.lastError ?? raw.LastError) as string | undefined,
    lastSeenUtc: (raw.lastSeenUtc ?? raw.LastSeenUtc) as string | undefined,
    trusted: Boolean(raw.trusted ?? raw.Trusted ?? false),
  };
}

export function normalizeIncusEphemeral(raw: Record<string, unknown>): IncusEphemeralInstance {
  return {
    id: String(raw.id ?? raw.Id ?? ''),
    endpointId: String(raw.endpointId ?? raw.EndpointId ?? ''),
    instanceName: String(raw.instanceName ?? raw.InstanceName ?? ''),
    status: String(raw.status ?? raw.Status ?? 'Unknown'),
    ipv4: (raw.ipv4 ?? raw.Ipv4) as string | undefined,
    ipv6: (raw.ipv6 ?? raw.Ipv6) as string | undefined,
    meshHostId: (raw.meshHostId ?? raw.MeshHostId) as string | undefined,
    imageAlias: String(raw.imageAlias ?? raw.ImageAlias ?? ''),
    instanceType: String(raw.instanceType ?? raw.InstanceType ?? 'container'),
    ephemeral: raw.ephemeral !== false && raw.Ephemeral !== false,
    createdUtc: String(raw.createdUtc ?? raw.CreatedUtc ?? new Date().toISOString()),
    lastError: (raw.lastError ?? raw.LastError) as string | undefined,
    notes: (raw.notes ?? raw.Notes) as string | undefined,
  };
}

export function createEmptyIncusEndpoint(partial?: Partial<IncusEndpoint>): IncusEndpoint {
  return {
    id: `incus-${Date.now().toString(36)}`,
    alias: 'Incus lab',
    apiUrl: 'https://',
    project: 'default',
    defaultImage: 'ubuntu/24.04/cloud',
    defaultImageServer: 'https://images.linuxcontainers.org',
    defaultInstanceType: 'container',
    defaultSshUser: 'root',
    defaultSshPort: 22,
    allowInsecureTls: false,
    trusted: false,
    ...partial,
  };
}

export function incusEndpointToPayload(e: IncusEndpoint): Record<string, unknown> {
  return {
    id: e.id,
    alias: e.alias,
    apiUrl: e.apiUrl,
    serverFingerprint: e.serverFingerprint || null,
    project: e.project || 'default',
    defaultImage: e.defaultImage,
    defaultImageServer: e.defaultImageServer,
    defaultInstanceType: e.defaultInstanceType,
    defaultSshUser: e.defaultSshUser,
    defaultSshPort: e.defaultSshPort,
    defaultSshKeyPath: e.defaultSshKeyPath || null,
    allowInsecureTls: e.allowInsecureTls === true,
    notes: e.notes || null,
    trustTokenPlain: e.trustTokenPlain || null,
  };
}
