import { getPaneTabLabel } from './paneLabels';
import { getTabsBehavior } from './settingsBehavior';
import type { AppConfig } from '../data/configContext';

export type TabCaptionExtras = {
  /** Live filter / omni text active for this pane. */
  filterText?: string;
  /** Per-pane regex filter. */
  filterRegex?: string;
};

/** Render a tab caption from Settings → Tabs template tokens. */
export function formatTabCaption(
  config: AppConfig | Record<string, unknown> | null | undefined,
  path: string,
  extras?: TabCaptionExtras,
): string {
  const tabs = getTabsBehavior((config || {}) as AppConfig);
  const mode = String(tabs.tabCaptions || '').toLowerCase();
  const folder = getPaneTabLabel(path);
  let base: string;
  if (!mode || mode.includes('folder') || mode === 'false') base = folder;
  else if (mode.includes('path') || mode.includes('full')) {
    base = path.replace(/^\/+/, '').replace(/\//g, '\\') || folder;
  } else {
    const tpl = String(tabs.tabCaptionTemplate || '<folder>').trim() || '<folder>';
    base = tpl
      .replace(/<folder>/gi, folder)
      .replace(/<path>/gi, path.replace(/^\/+/, '').replace(/\//g, '\\'))
      .replace(/<drive>/gi, (/^\/([A-Za-z]:)/.exec(path)?.[1] || ''))
      .replace(/<app>/gi, 'BNDZ');
  }
  if (!tabs.showFilterInformationInTabHeaders) return base;
  const filterBits: string[] = [];
  const live = String(extras?.filterText || '').trim();
  if (live && !live.startsWith('> ')) filterBits.push(live);
  const regex = String(extras?.filterRegex || '').trim();
  if (regex) filterBits.push(`/${regex}/`);
  if (!filterBits.length) return base;
  return `${base} · ${filterBits.join(' ')}`;
}
