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

export type IncusServerInstance = {
  name: string;
  status: string;
  type: string;
  ephemeral: boolean;
  project?: string;
  tracked?: boolean;
};

export function normalizeIncusServerInstance(raw: Record<string, unknown>, tracked?: Set<string>): IncusServerInstance {
  const name = String(raw.name ?? raw.Name ?? '');
  return {
    name,
    status: String(raw.status ?? raw.Status ?? 'Unknown'),
    type: String(raw.type ?? raw.Type ?? 'container'),
    ephemeral: Boolean(raw.ephemeral ?? raw.Ephemeral ?? false),
    project: (raw.project ?? raw.Project) as string | undefined,
    tracked: tracked ? tracked.has(name.toLowerCase()) : undefined,
  };
}

export function normalizeIncusEndpoint(raw: Record<string, unknown>): IncusEndpoint {
  return {
    id: String(raw.id ?? raw.Id ?? `incus-${Date.now().toString(36)}`),
    alias: String(raw.alias ?? raw.Alias ?? 'VPS host'),
    apiUrl: String(raw.apiUrl ?? raw.ApiUrl ?? ''),
    serverFingerprint: (raw.serverFingerprint ?? raw.ServerFingerprint) as string | undefined,
    project: String(raw.project ?? raw.Project ?? 'default'),
    defaultImage: String(raw.defaultImage ?? raw.DefaultImage ?? 'ubuntu/24.04/cloud'),
    defaultImageServer: String(raw.defaultImageServer ?? raw.DefaultImageServer ?? 'https://images.linuxcontainers.org'),
    defaultInstanceType: String(raw.defaultInstanceType ?? raw.DefaultInstanceType ?? 'container'),
    defaultSshUser: String(raw.defaultSshUser ?? raw.DefaultSshUser ?? 'ubuntu'),
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
    id: `mesh-vps-${Date.now().toString(36)}`,
    alias: 'My VPS host',
    apiUrl: 'https://',
    project: 'default',
    defaultImage: 'ubuntu/24.04/cloud',
    defaultImageServer: 'https://images.linuxcontainers.org',
    defaultInstanceType: 'container',
    defaultSshUser: 'ubuntu',
    defaultSshPort: 22,
    allowInsecureTls: false,
    trusted: false,
    ...partial,
  };
}

/** Reject empty hosts like https:// or https://:8443 (DNS lookup for "https"). */
export function validateMeshVpsApiUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  const trimmed = (raw || '').trim().replace(/\/+$/, '');
  if (!trimmed || trimmed === 'https:' || trimmed === 'http:') {
    return { ok: false, error: 'Enter a real host URL, e.g. https://192.168.1.10:8443' };
  }
  let candidate = trimmed;
  if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`;
  try {
    const u = new URL(candidate);
    const host = (u.hostname || '').trim();
    if (!host || host === 'https' || host === 'http') {
      return { ok: false, error: 'URL is missing a hostname. Example: https://192.168.1.10:8443' };
    }
    return { ok: true, url: u.origin };
  } catch {
    return { ok: false, error: `Invalid URL: ${raw}` };
  }
}

export function meshVpsApiUrlLooksLocal(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

export function incusEndpointToPayload(e: IncusEndpoint): Record<string, unknown> {
  const validated = validateMeshVpsApiUrl(e.apiUrl);
  const apiUrl = validated.ok ? validated.url : e.apiUrl.trim();
  return {
    id: e.id,
    alias: e.alias,
    apiUrl,
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

/** Web admin UI — same origin as the HTTPS API when the server ships a UI. */
export function incusAdminWebUrl(apiUrl: string): string {
  const validated = validateMeshVpsApiUrl(apiUrl);
  if (validated.ok) return validated.url;
  const trimmed = apiUrl.trim();
  if (!trimmed) return '';
  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
}
