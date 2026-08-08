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

export type FilterByNameOptions = {
  matchCase?: boolean;
  /** When true, also test extension / typeDescription (Find → multi-column matching). */
  multiColumn?: boolean;
  /** Settings → Use localized search and filter patterns (Unicode-aware includes). */
  localized?: boolean;
  /** Also match against directory / full path (Find Files Location autocomplete / path tips). */
  includePath?: boolean;
};

/** Filter by name using regex when valid, otherwise fuzzy match. */
export function filterByName<T extends { name: string; extension?: string; typeDescription?: string; path?: string }>(
  items: T[],
  query: string,
  options: FilterByNameOptions = {},
): T[] {
  const q = query.trim();
  if (!q) return items;
  const flags = options.matchCase ? '' : 'i';
  const haystack = (item: T) => {
    const parts = options.multiColumn
      ? [item.name, item.extension, item.typeDescription]
      : [item.name];
    if (options.includePath && item.path) parts.push(item.path);
    return parts.filter(Boolean).join(' ');
  };
  const localizedIncludes = (hay: string, needle: string) => {
    if (options.matchCase) return hay.includes(needle);
    if (!options.localized) return hay.toLowerCase().includes(needle.toLowerCase());
    try {
      return hay.toLocaleLowerCase().includes(needle.toLocaleLowerCase());
    } catch {
      return hay.toLowerCase().includes(needle.toLowerCase());
    }
  };
  try {
    const regex = new RegExp(q, flags);
    return items.filter(item => regex.test(haystack(item)));
  } catch {
    if (options.matchCase || options.localized) {
      return items.filter(item => localizedIncludes(haystack(item), q));
    }
    return fuzzyFilterByName(items, q);
  }
}
