export function formatFolderSizeLabel(
  cached: number | null | undefined,
  config: {
    alwaysShowFolderSizes?: boolean;
    cacheFolderSizes?: boolean;
    showCachedFolderSizesOnly?: boolean;
  },
  formatSize: (n: number) => string,
): string {
  if (cached != null && cached >= 0) return formatSize(cached);
  if (config.showCachedFolderSizesOnly) return '';
  if (config.alwaysShowFolderSizes || config.cacheFolderSizes) return '…';
  return '';
}
