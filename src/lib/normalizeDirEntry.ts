/** Normalize backend directory entries so UI sort/display never sees missing `name`. */
export function normalizeDirEntry(item: any, index = 0): any {
  if (!item || typeof item !== 'object') {
    return { id: `item-${index}`, name: 'Unknown', type: 'file' };
  }
  const name = item.name ?? item.label ?? item.displayName ?? item.id;
  return {
    ...item,
    id: item.id ?? name ?? `item-${index}`,
    name: name != null ? String(name) : `Item ${index + 1}`,
    size: item.size != null ? Number(item.size) : (item.type === 'directory' ? 0 : undefined),
    tags: Array.isArray(item.tags) ? item.tags : [],
  };
}

export function normalizeDirEntries(data: any[] | null | undefined): any[] {
  return (data || []).map((item, i) => normalizeDirEntry(item, i));
}
