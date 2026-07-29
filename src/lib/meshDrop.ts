/** Mesh Drop pairing helpers — mirrors BNDZBackend/Services/MeshDrop/MeshDropSignaling.cs */

const PREFIX = 'BNDZMD:';

export function isMeshDropCode(code: string): boolean {
  return (code || '').trim().toUpperCase().startsWith(PREFIX);
}

export function meshDropCodeChecksum(code: string): string {
  let h = 0;
  const s = (code || '').trim();
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(16).slice(0, 6).toUpperCase();
}

export function decodeMeshDropPayload(code: string): Record<string, unknown> | null {
  const trimmed = (code || '').trim();
  const raw = trimmed.toUpperCase().startsWith(PREFIX) ? trimmed.slice(PREFIX.length) : trimmed;
  const b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? b64 : b64 + '='.repeat(4 - (b64.length % 4));
  try {
    const binary = atob(pad);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const inflated = inflateGzip(bytes);
    if (!inflated) return null;
    return JSON.parse(new TextDecoder().decode(inflated));
  } catch {
    return null;
  }
}

function inflateGzip(bytes: Uint8Array): Uint8Array | null {
  if (typeof DecompressionStream === 'undefined') return null;
  try {
    const ds = new DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    void writer.write(bytes);
    void writer.close();
    // sync path unavailable — caller uses backend round-trip in tests
    return null;
  } catch {
    return null;
  }
}
