import uFuzzy from '@leeoniya/ufuzzy';

const uf = new uFuzzy({});

/** Fast fuzzy filter for in-pane file list filtering. Returns items in relevance order. */
export function fuzzyFilterByName<T extends { name: string }>(items: T[], query: string): T[] {
  const q = query.trim();
  if (!q) return items;

  const haystack = items.map(i => i.name);
  const idxs = uf.filter(haystack, q);
  if (!idxs || idxs.length === 0) return [];

  const info = uf.info(idxs, haystack, q);
  const order = uf.sort(info, haystack, q);
  return order.map(i => items[idxs[i]]);
}

/** Filter by name using regex when valid, otherwise fuzzy match. */
export function filterByName<T extends { name: string }>(items: T[], query: string): T[] {
  const q = query.trim();
  if (!q) return items;
  try {
    const regex = new RegExp(q, 'i');
    return items.filter(item => regex.test(item.name));
  } catch {
    return fuzzyFilterByName(items, q);
  }
}
