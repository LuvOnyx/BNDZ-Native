/** XYplorer-style status bar template tokens. */

import { withPermanentVariables } from './permanentVariables';

export function renderStatusBarTemplate(
  template: string,
  vars: {
    items?: number;
    selected?: number;
    path?: string;
    free?: string;
    volumes?: number;
    app?: string;
    ver?: string;
    selectionSummary?: string;
    durationMs?: number;
    clipboard?: string;
  },
  config?: { rememberPermanentVariables?: boolean; permanentVariables?: unknown },
): string {
  const itemCount = vars.items ?? 0;
  const selectedCount = vars.selected ?? 0;
  const durationLabel = formatDuration(vars.durationMs);

  const map: Record<string, string> = {
    items: String(itemCount),
    selected: String(selectedCount),
    path: vars.path ?? '',
    free: vars.free ?? '',
    volumes: String(vars.volumes ?? 0),
    app: vars.app ?? 'BNDZ',
    ver: vars.ver ?? '',
    clipboard: vars.clipboard ?? '',
    's:items': String(itemCount),
    's:selected': String(selectedCount),
    's:path': vars.path ?? '',
    's:free': vars.free ?? '',
    's:dimension': `${itemCount} item(s)`,
    's:duration': durationLabel,
    's:selection': vars.selectionSummary ?? (selectedCount > 0 ? `${selectedCount} selected` : ''),
    's:clipboard': vars.clipboard ?? '',
    '<items>': String(itemCount),
    '<selected>': String(selectedCount),
    '<path>': vars.path ?? '',
    '<free>': vars.free ?? '',
    '<app>': vars.app ?? 'BNDZ',
    '<ver>': vars.ver ?? '',
  };

  const rendered = template
    .replace(/<([^>]+)>/g, (_, raw: string) => {
      const key = raw.trim();
      // Leave <p:name> / <var:name> for permanent-variable expansion.
      if (/^(p|var):/i.test(key)) return `<${key}>`;
      return map[key.toLowerCase()] ?? map[key] ?? '';
    })
    .replace(/\s{2,}/g, ' ')
    .trim();

  return config ? withPermanentVariables(rendered, config) : rendered;
}

function formatDuration(ms?: number): string {
  if (ms == null || ms < 0) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  const rem = Math.round(sec % 60);
  return `${min}m ${rem}s`;
}
