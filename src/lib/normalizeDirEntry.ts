/** Normalize backend directory entries so UI sort/display never sees missing `name`. */
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
  return {
    ...item,
    id: id != null ? String(id) : `item-${index}`,
    name: name != null ? String(name) : `Item ${index + 1}`,
    path: path != null ? String(path) : item.path,
    type: isDir ? 'directory' : (rawType || 'file'),
    size: item.size != null ? Number(item.size) : (item.Size != null ? Number(item.Size) : (isDir ? 0 : undefined)),
    extension: item.extension ?? item.Extension,
    modified: item.modified ?? item.Modified,
    tags: Array.isArray(item.tags) ? item.tags : (Array.isArray(item.Tags) ? item.Tags : []),
  };
}

export function normalizeDirEntries(data: any[] | null | undefined): any[] {
  return (data || []).map((item, i) => normalizeDirEntry(item, i));
}
