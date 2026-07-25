/** Rule-based smart collections — LocalAppData-style JSON in localStorage for Launch. */

export type SmartCollection = {
  id: string;
  name: string;
  query: string;
  scopePath?: string;
  searchContent?: boolean;
  createdAt: number;
};

const KEY = 'bndz-smart-collections-v1';

export function loadSmartCollections(): SmartCollection[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSmartCollections(items: SmartCollection[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items.slice(0, 48)));
  } catch { /* ignore */ }
}

export function upsertSmartCollection(item: Omit<SmartCollection, 'id' | 'createdAt'> & { id?: string }): SmartCollection[] {
  const list = loadSmartCollections();
  const id = item.id || `sc_${Date.now().toString(36)}`;
  const next: SmartCollection = {
    id,
    name: item.name.trim() || 'Untitled',
    query: item.query.trim(),
    scopePath: item.scopePath,
    searchContent: !!item.searchContent,
    createdAt: Date.now(),
  };
  const idx = list.findIndex(x => x.id === id);
  if (idx >= 0) list[idx] = { ...list[idx], ...next, createdAt: list[idx].createdAt };
  else list.unshift(next);
  saveSmartCollections(list);
  return list;
}

export function removeSmartCollection(id: string): SmartCollection[] {
  const list = loadSmartCollections().filter(x => x.id !== id);
  saveSmartCollections(list);
  return list;
}
