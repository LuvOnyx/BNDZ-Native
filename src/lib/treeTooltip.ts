import type { HoverTooltipContent } from '../components/HoverTooltip';
import { formatAddressBarPath } from './displayPath';
import { toWindowsPath } from './pathUtils';

export function buildTreeTooltipContent(
  row: { label: string; path?: string },
  config: Record<string, any>,
): HoverTooltipContent | null {
  if (!row.label) return null;
  const lines: HoverTooltipContent['lines'] = [];
  if (row.path) {
    lines.push({ label: 'Path', value: formatAddressBarPath(row.path), mono: true });
    lines.push({ label: 'Target', value: toWindowsPath(row.path), mono: true });
  }
  return {
    title: row.label,
    subtitle: row.path ? 'Navigation' : 'Quick access',
    lines,
    badge: row.path ? { text: 'GO', color: '#38bdf8' } : { text: 'PIN', color: '#a855f7' },
  };
}
