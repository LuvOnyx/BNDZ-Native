export function formatFolderSizeLabel(
  cached: number | null | undefined,
  config: {
    alwaysShowFolderSizes?: boolean;
    cacheFolderSizes?: boolean;
    showCachedFolderSizesOnly?: boolean;
    showItemCountWithFolderSizes?: boolean;
  },
  formatSize: (n: number) => string,
  itemCount?: number | null,
): string {
  let base = '';
  if (cached != null && cached >= 0) base = formatSize(cached);
  else if (config.showCachedFolderSizesOnly) base = '';
  else if (config.alwaysShowFolderSizes || config.cacheFolderSizes) base = '…';
  else base = '';

  if (!config.showItemCountWithFolderSizes) return base;
  if (itemCount == null || itemCount < 0) return base;
  const countPart = `${itemCount} item${itemCount === 1 ? '' : 's'}`;
  return base ? `${base} · ${countPart}` : countPart;
}
