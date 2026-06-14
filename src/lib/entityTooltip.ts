import type { HoverTooltipContent } from '../components/HoverTooltip';
import { formatFsDateTime } from './listColumns';
import { formatFolderSizeLabel } from './folderSizeDisplay';
import { joinPanePath, toWindowsPath } from './pathUtils';

function formatSize(bytes?: number): string {
  if (bytes == null || bytes === 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export function buildEntityTooltipContent(
  entity: any,
  panePath: string,
  config: Record<string, any>,
  folderSizeMap: Record<string, number | undefined>,
  formatSizeFn: (n?: number) => string = formatSize,
): HoverTooltipContent | null {
  if (!entity) return null;
  const isDir = entity.type === 'directory';
  const fullPath = toWindowsPath(entity.path || joinPanePath(panePath, entity));
  const lines: HoverTooltipContent['lines'] = [];

  if (isDir) {
    const cached = folderSizeMap[fullPath.toLowerCase()];
    const sizeLabel = formatFolderSizeLabel(cached, {
      alwaysShowFolderSizes: config.alwaysShowFolderSizes,
      cacheFolderSizes: config.cacheFolderSizes,
      showCachedFolderSizesOnly: config.showCachedFolderSizesOnly,
    }, formatSizeFn);
    if (sizeLabel) lines.push({ label: 'Size', value: sizeLabel });
  } else if (entity.size != null) {
    lines.push({ label: 'Size', value: formatSizeFn(entity.size) });
  }

  if (entity.modified) lines.push({ label: 'Modified', value: formatFsDateTime(entity.modified) });
  if (entity.created) lines.push({ label: 'Created', value: formatFsDateTime(entity.created) });
  if (entity.typeDescription) lines.push({ label: 'Type', value: entity.typeDescription });
  else if (entity.extension) lines.push({ label: 'Type', value: `${entity.extension.toUpperCase()} file` });

  if (entity.tags?.length) {
    lines.push({ label: 'Tags', value: entity.tags.join(', '), accent: '#fbbf24' });
  }

  if (config.hoverTooltipShowPath !== false) {
    lines.push({ label: 'Path', value: fullPath.replace(/^\\+/, ''), mono: true });
  }

  return {
    title: entity.name,
    subtitle: isDir ? 'Folder' : entity.extension ? `.${entity.extension} file` : 'File',
    lines,
    badge: isDir
      ? { text: 'DIR', color: '#dcb67a' }
      : { text: (entity.extension || 'FILE').toUpperCase().slice(0, 6), color: '#60a5fa' },
  };
}
