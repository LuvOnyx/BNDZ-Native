/** Virtual catalog paths — `/vf` and `/vf/{id}` */

export const VF_ROOT = '/vf';
export const VF_PREFIX = '/vf/';

export function isVirtualCatalogRoot(path: string): boolean {
  const n = path.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
  return n === VF_ROOT || n === 'vf://' || n.toLowerCase() === 'vf:';
}

export function isVirtualCatalogPath(path: string): boolean {
  const n = path.replace(/\\/g, '/');
  return isVirtualCatalogRoot(n) || n.startsWith(VF_PREFIX) || n.startsWith('vf://');
}

export function parseVirtualCatalogId(path: string): string | null {
  const n = path.replace(/\\/g, '/').replace(/\/+$/, '');
  if (isVirtualCatalogRoot(n)) return null;
  if (n.startsWith(VF_PREFIX)) return n.slice(VF_PREFIX.length).split('/')[0] || null;
  if (n.startsWith('vf://')) return n.slice(5).split('/')[0] || null;
  return null;
}

export function catalogVirtualPath(idOrSlug: string): string {
  const slug = idOrSlug.trim().replace(/^vf:\/\//i, '').replace(/^\/vf\//i, '');
  return `${VF_PREFIX}${slug}`;
}

export function parseUserCatalogPath(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  if (isVirtualCatalogPath(raw)) {
    const n = raw.replace(/\\/g, '/');
    if (isVirtualCatalogRoot(n)) return VF_ROOT;
    const id = parseVirtualCatalogId(n);
    return id ? catalogVirtualPath(id) : VF_ROOT;
  }
  if (raw.startsWith('::')) {
    const slug = raw.slice(2).trim().split(/\s+/)[0];
    if (slug) return catalogVirtualPath(slug);
  }
  return null;
}

export function formatVirtualPathLabel(path: string, catalogName?: string): string {
  if (isVirtualCatalogRoot(path)) return 'Catalog';
  const id = parseVirtualCatalogId(path);
  return catalogName || id || 'Catalog';
}
