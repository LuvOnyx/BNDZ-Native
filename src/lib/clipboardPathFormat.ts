import type { AppConfig } from '../data/configContext';
import { readSettingBool } from './settingsWiring';

/** Format path(s) for clipboard Copy Path — honors trailing-slash setting. */
export function formatPathsForClipboard(config: AppConfig | Record<string, unknown> | null | undefined, paths: string | string[]): string {
  const list = (Array.isArray(paths) ? paths : [paths]).filter(Boolean).map(String);
  const trailing = readSettingBool((config || {}) as AppConfig, 'copyPathsToTheClipboardWithATrailingSlash');
  const formatted = list.map((p) => {
    let out = p.replace(/\//g, '\\');
    if (!trailing) return out;
    // Directories conventionally end with \ ; files stay as-is unless already trailing.
    const looksDir = !(/\.[^\\/.]+$/.test(out.split('\\').pop() || '')) || out.endsWith('\\');
    if (looksDir && !out.endsWith('\\')) out += '\\';
    else if (!looksDir && trailing && out.endsWith('\\')) {
      /* keep file paths without forced slash */
    }
    return out;
  });
  return formatted.join('\n');
}
