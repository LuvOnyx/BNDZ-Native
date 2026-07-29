import { formatStorageSize } from './storageOrganize';

export type CleanupRisk = 'safe' | 'moderate' | 'advanced';

export type CleanupScanItem = {
  id: string;
  path: string;
  name: string;
  size: number;
  isDirectory: boolean;
  detail?: string;
  defaultSelected: boolean;
  selected?: boolean;
};

export type CleanupScanCategory = {
  id: string;
  name: string;
  description: string;
  risk: CleanupRisk;
  totalBytes: number;
  itemCount: number;
  items: CleanupScanItem[];
  expanded?: boolean;
  selected?: boolean;
};

export type InstalledApp = {
  id: string;
  name: string;
  publisher?: string;
  version?: string;
  installDate?: string;
  estimatedSizeBytes: number;
  installLocation?: string;
  canUninstall: boolean;
  isSystemComponent: boolean;
  isStoreApp: boolean;
  source: string;
};

export const CLEANUP_CATEGORY_PRESETS: Array<{ id: string; label: string; icon: string; risk: CleanupRisk }> = [
  { id: 'user_temp', label: 'User temp', icon: 'trash_ui', risk: 'safe' },
  { id: 'windows_temp', label: 'Windows temp', icon: 'trash_ui', risk: 'moderate' },
  { id: 'recycle_bin', label: 'Recycle Bin', icon: 'trash_ui', risk: 'safe' },
  { id: 'thumbnail_cache', label: 'Thumbnail cache', icon: 'eye_ui', risk: 'safe' },
  { id: 'browser_chrome', label: 'Chrome cache', icon: 'globe_ui', risk: 'moderate' },
  { id: 'browser_edge', label: 'Edge cache', icon: 'globe_ui', risk: 'moderate' },
  { id: 'browser_firefox', label: 'Firefox cache', icon: 'globe_ui', risk: 'moderate' },
  { id: 'crash_dumps', label: 'Crash dumps', icon: 'error_ui', risk: 'moderate' },
  { id: 'recent_shortcuts', label: 'Recent shortcuts', icon: 'clock_ui', risk: 'safe' },
  { id: 'downloads_temp', label: 'Download clutter', icon: 'downloads', risk: 'moderate' },
  { id: 'large_files', label: 'Large files', icon: 'hard_drive_ui', risk: 'advanced' },
  { id: 'large_folders', label: 'Large folders', icon: 'folder_open_ui', risk: 'advanced' },
  { id: 'empty_folders', label: 'Empty folders', icon: 'folder_open_ui', risk: 'moderate' },
];

export function riskLabel(risk: CleanupRisk): string {
  if (risk === 'safe') return 'Safe';
  if (risk === 'moderate') return 'Review';
  return 'Advanced';
}

export function riskClass(risk: CleanupRisk): string {
  if (risk === 'safe') return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25';
  if (risk === 'moderate') return 'text-amber-300 bg-amber-500/10 border-amber-500/25';
  return 'text-rose-300 bg-rose-500/10 border-rose-500/25';
}

export function normalizeScanCategories(raw: CleanupScanCategory[]): CleanupScanCategory[] {
  return raw.map(cat => ({
    ...cat,
    selected: cat.risk === 'safe',
    expanded: false,
    items: (cat.items || []).map(item => ({
      ...item,
      selected: item.defaultSelected ?? cat.risk === 'safe',
    })),
  }));
}

export function categorySelectedBytes(cat: CleanupScanCategory): number {
  if (cat.id === 'recycle_bin' && cat.selected) return cat.totalBytes;
  return cat.items.filter(i => i.selected).reduce((s, i) => s + i.size, 0);
}

export function totalSelectedBytes(categories: CleanupScanCategory[]): number {
  return categories.reduce((s, c) => s + (c.selected ? categorySelectedBytes(c) : 0), 0);
}

export function totalSelectedCount(categories: CleanupScanCategory[]): number {
  let n = 0;
  for (const c of categories) {
    if (!c.selected) continue;
    if (c.id === 'recycle_bin') { n += c.itemCount || 1; continue; }
    n += c.items.filter(i => i.selected).length;
  }
  return n;
}

export function buildExecutePayload(categories: CleanupScanCategory[]): Array<{
  categoryId: string;
  path: string;
  isDirectory: boolean;
  size: number;
}> {
  const out: Array<{ categoryId: string; path: string; isDirectory: boolean; size: number }> = [];
  for (const cat of categories) {
    if (!cat.selected) continue;
    if (cat.id === 'recycle_bin') {
      out.push({ categoryId: 'recycle_bin', path: 'shell:RecycleBin', isDirectory: true, size: cat.totalBytes });
      continue;
    }
    for (const item of cat.items) {
      if (!item.selected) continue;
      out.push({
        categoryId: cat.id,
        path: item.path,
        isDirectory: item.isDirectory,
        size: item.size,
      });
    }
  }
  return out;
}

export function formatAppSize(bytes: number): string {
  if (!bytes) return '—';
  return formatStorageSize(bytes);
}

export function formatInstallDate(raw?: string): string {
  if (!raw || raw.length < 8) return raw || '—';
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  return raw;
}
