/** Normalize backend directory entries so UI sort/display never sees missing `name`. */
function inferExtensionFromName(name: string): string | undefined {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return undefined;
  return name.slice(dot + 1).toLowerCase();
}

function normalizeModified(value: unknown): string | number | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value;
    return new Date(ms).toISOString();
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const n = Number(value);
    const ms = n < 1e12 ? n * 1000 : n;
    return new Date(ms).toISOString();
  }
  return value as string;
}

const normalizeDateField = normalizeModified;

export function normalizeDirEntry(item: any, index = 0): any {
  if (!item || typeof item !== 'object') {
    return { id: `item-${index}`, name: 'Unknown', type: 'file' };
  }
  // Accept both camelCase (preferred) and PascalCase (shell records before enrichment fix).
  const name = item.name ?? item.Name ?? item.label ?? item.Label ?? item.displayName ?? item.DisplayName ?? item.id ?? item.Id;
  const rawType = item.type ?? item.Type;
  const isDir = rawType === 'directory' || item.isDirectory === true || item.IsDirectory === true;
  const path = item.path ?? item.Path;
  const id = item.id ?? item.Id ?? path ?? name ?? `item-${index}`;
  const nameStr = name != null ? String(name) : `Item ${index + 1}`;
  let extension = item.extension ?? item.Extension ?? item.ext ?? item.Ext;
  if (!extension && !isDir) extension = inferExtensionFromName(nameStr);
  if (typeof extension === 'string') extension = extension.replace(/^\./, '').toLowerCase();
  return {
    ...item,
    id: id != null ? String(id) : `item-${index}`,
    name: nameStr,
    path: path != null ? String(path) : item.path,
    fsPath: item.fsPath ?? item.FsPath ?? (path != null ? String(path).replace(/\//g, '\\') : undefined),
    type: isDir ? 'directory' : (rawType || 'file'),
    size: item.size != null ? Number(item.size) : (item.Size != null ? Number(item.Size) : (isDir ? 0 : undefined)),
    extension,
    mediaKind: item.mediaKind ?? item.MediaKind,
    modified: normalizeModified(item.modified ?? item.Modified),
    created: normalizeDateField(item.created ?? item.Created ?? item.createdAt ?? item.CreatedAt),
    tags: Array.isArray(item.tags) ? item.tags : (Array.isArray(item.Tags) ? item.Tags : []),
  };
}

export function normalizeDirEntries(data: any[] | null | undefined): any[] {
  return (data || []).map((item, i) => normalizeDirEntry(item, i));
}
