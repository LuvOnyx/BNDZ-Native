/** Searchable index + fuzzy search for Configuration → Jump to Setting. */

import { fuzzyFilterByName } from './fuzzyFilter';
import { JUMP_SETTING_INDEX as GENERATED_INDEX } from './jumpToSettingIndex.data';

export interface JumpSettingEntry {
  tab: string;
  label: string;
  /** Config key when available — used to scroll/highlight after jump. */
  key?: string;
  /** What the setting does / how users describe it. */
  description?: string;
  keywords: string[];
}

/** Hand-curated extras for tabs/controls that are mostly selects, themes, or section hubs. */
const CURATED_EXTRAS: JumpSettingEntry[] = [
  {
    tab: 'Highlights & Dark Mode',
    label: 'Grid style / zebra stripes',
    key: 'listZebraStyle',
    description: 'Alternate row zebra striping for the file list',
    keywords: ['zebra', 'zebra stripes', 'grid style', 'alternate rows', 'stripes', 'list background', 'banding'],
  },
  {
    tab: 'Appearance',
    label: 'Show selection quick actions bar',
    key: 'showQuickActionsBar',
    description: 'Floating bar when multiple files are selected (N selected)',
    keywords: ['bar', 'quick actions', 'quick actions bar', 'selection bar', 'selected', 'n selected', 'actions bar'],
  },
  {
    tab: 'Appearance',
    label: 'Selection highlight extent',
    key: 'listSelectionChrome',
    description: 'Paint selection on the full row, name only, or through the second column',
    keywords: ['selection', 'highlight', 'name only', 'full row', 'second column', 'chrome', 'selected row'],
  },
  {
    tab: 'Themes',
    label: 'Workspace theme',
    description: 'Pick dark, light, or accent themes for the whole app',
    keywords: ['theme', 'dark', 'light', 'nord', 'appearance', 'skin', 'color scheme', 'night mode'],
  },
  {
    tab: 'Appearance',
    label: 'Selection chrome and density',
    description: 'How selected files look — borders, fill, File Pilot / XYplorer style',
    keywords: ['selection', 'chrome', 'density', 'radius', 'filepilot', 'xyplorer', 'highlight', 'selected'],
  },
  {
    tab: 'Appearance',
    label: 'Workspace palette',
    description: 'Sidebar and chrome surface colors',
    keywords: ['palette', 'slate', 'surface', 'chrome', 'background', 'colors'],
  },
  {
    tab: 'Colors',
    label: 'Custom colors',
    description: 'Override accent and workspace colors',
    keywords: ['color', 'accent', 'custom', 'tint', 'theme'],
  },
  {
    tab: 'Fonts',
    label: 'Fonts and toolbar density',
    description: 'UI font size and compact toolbar / menubar',
    keywords: ['font', 'typeface', 'toolbar', 'compact', 'menubar', 'size', 'density'],
  },
  {
    tab: 'Icon Configurator',
    label: 'Custom icons and icon libraries',
    description: 'Replace folder and file icons',
    keywords: ['icon', 'library', 'studio', 'custom icon', 'folcolor'],
  },
  {
    tab: 'Shell Integration',
    label: 'Default file manager and context menu',
    description: 'Make BNDZ open folders and appear in right-click menus',
    keywords: ['default', 'file manager', 'explorer', 'context menu', 'shell', 'right click', 'associate'],
  },
  {
    tab: 'Dual Pane',
    label: 'Dual pane layout',
    description: 'Side-by-side panes like Norton Commander / Total Commander',
    keywords: ['dual', 'pane', 'split', 'two panes', 'side by side', 'commander'],
  },
  {
    tab: 'Tabs',
    label: 'Tab bar behavior',
    description: 'New tab, close tab, tab bar position',
    keywords: ['tab', 'tabs', 'tab bar', 'close tab', 'new tab'],
  },
  {
    tab: 'Preview',
    label: 'Preview panel',
    description: 'Right-side file preview pane',
    keywords: ['preview', 'viewer', 'right panel', 'preview pane'],
  },
  {
    tab: 'Thumbnails',
    label: 'Thumbnail quality and style',
    description: 'Icon and thumbnail rendering options',
    keywords: ['thumbnail', 'thumb', 'icon view', 'image preview'],
  },
  {
    tab: 'Features',
    label: 'Everything search and optional features',
    description: 'Toggle Everything indexing / search and other feature flags',
    keywords: ['everything', 'search', 'index', 'features', 'plugins'],
  },
  {
    tab: 'Rapid access',
    label: 'Rapid access pins',
    description: 'Sidebar favorites and pinned folders',
    keywords: ['rapid access', 'favorites', 'pins', 'bookmarks', 'quick access'],
  },
  {
    tab: 'Keyboard Shortcuts',
    label: 'Keyboard shortcuts',
    description: 'Remap hotkeys and key bindings',
    keywords: ['keyboard', 'hotkey', 'shortcut', 'keybind', 'keys'],
  },
  {
    tab: 'Custom Columns',
    label: 'Custom columns',
    description: 'Extra list columns and metadata fields',
    keywords: ['column', 'custom column', 'metadata', 'list columns'],
  },
  {
    tab: 'File Operations',
    label: 'Copy move delete engine',
    description: 'How file copy, move, and delete behave — confirmations and recycle',
    keywords: ['copy', 'move', 'delete', 'transfer', 'confirm', 'recycle', 'overwrite'],
  },
  {
    tab: 'Undo & Action Log',
    label: 'Undo and action history',
    description: 'Undo file operations and browse the action log',
    keywords: ['undo', 'redo', 'action log', 'history', 'revert'],
  },
  {
    tab: 'Find Files & Branch View',
    label: 'Find files and branch view',
    description: 'Search in folders and flat branch listings',
    keywords: ['find', 'search', 'branch', 'flat view', 'recursive'],
  },
  {
    tab: 'Filters & Type Ahead Find',
    label: 'Filters and type-ahead find',
    description: 'Instant filter bar and type-ahead selection in the list',
    keywords: ['filter', 'type ahead', 'fuzzy', 'quick filter', 'slash filter'],
  },
];

const STOP = new Set([
  'a', 'an', 'the', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'as', 'by', 'at', 'is', 'be', 'with',
]);

function haystackFor(entry: JumpSettingEntry): string {
  const parts = [
    entry.label,
    entry.description || '',
    entry.tab,
    entry.key || '',
    ...(entry.keywords || []),
  ];
  return parts
    .join(' ')
    .toLowerCase()
    .split(/[^a-z0-9+]+/i)
    .filter(w => w.length > 1 && !STOP.has(w))
    .join(' ');
}

/** Prefer label/description phrase hits over loose keyword noise. */
function intentScore(entry: JumpSettingEntry, query: string): number {
  const q = query.toLowerCase().trim();
  const label = entry.label.toLowerCase();
  const desc = (entry.description || '').toLowerCase();
  const tab = entry.tab.toLowerCase();
  const blob = `${label} ${desc}`;
  let score = 0;

  if (label === q || label.includes(q)) score += 80;
  if (desc.includes(q)) score += 55;
  if (tab.includes(q)) score += 20;

  const tokens = q.split(/\s+/).filter(t => t.length > 1 && !STOP.has(t));
  for (const t of tokens) {
    if (label.includes(t)) score += 12;
    else if (desc.includes(t)) score += 7;
    else if ((entry.keywords || []).some(k => k === t || k.includes(t))) score += 2;
  }

  if (/\b(ask|confirm|prompt|before)\b/.test(q) && /\b(confirm|prompt|suppress)\b/.test(blob)) score += 35;
  if (/\b(delete|remove|trash)\b/.test(q) && /\b(delete|recycle|trash)\b/.test(blob)) score += 12;
  if (/\b(theme|dark|light|nord)\b/.test(q) && /\btheme\b/.test(blob)) score += 30;
  if (/\b(dual|split|side)\b/.test(q) && /\b(dual|pane|split)\b/.test(blob)) score += 25;
  if (/\b(tooltip|hover)\b/.test(q) && /\b(tooltip|hover)\b/.test(blob)) score += 20;

  if (entry.description && entry.description.length > 20 && !entry.key) score += 8;

  return score;
}

/** Full searchable catalog (generated checkboxes + curated hubs). */
export const JUMP_SETTING_INDEX: JumpSettingEntry[] = [
  ...CURATED_EXTRAS,
  ...(GENERATED_INDEX as JumpSettingEntry[]),
];

export function searchJumpSettings(query: string, categoryTabs: string[]): JumpSettingEntry[] {
  const q = query.trim();
  if (!q) return [];

  const tabHits: JumpSettingEntry[] = categoryTabs
    .filter(t => t.toLowerCase().includes(q.toLowerCase()))
    .map(t => ({
      tab: t,
      label: `Open tab: ${t}`,
      description: `Go to the ${t} settings page`,
      keywords: t.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean),
    }));

  const withHay = JUMP_SETTING_INDEX.map(e => ({
    ...e,
    name: haystackFor(e),
  }));

  let entryHits = fuzzyFilterByName(withHay, q).map(({ name: _n, ...rest }) => rest as JumpSettingEntry);

  if (!entryHits.length) {
    entryHits = JUMP_SETTING_INDEX.filter(e => {
      const blob = `${e.label} ${e.description || ''} ${e.tab} ${(e.keywords || []).join(' ')}`.toLowerCase();
      const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
      return tokens.every(t => blob.includes(t));
    });
  }

  entryHits.sort((a, b) => intentScore(b, q) - intentScore(a, q));

  const seen = new Set<string>();
  const out: JumpSettingEntry[] = [];
  for (const e of [...tabHits, ...entryHits]) {
    const key = `${e.tab}::${e.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
    if (out.length >= 16) break;
  }
  return out;
}

/** Find a settings row in the active tab pane and flash it. */
export function flashJumpSettingTarget(root: HTMLElement | null, hit: JumpSettingEntry): boolean {
  if (!root) return false;
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const target = norm(hit.label);
  if (!target || target.startsWith('open tab:')) return false;

  const labels = root.querySelectorAll('label');
  for (const lab of labels) {
    const text = norm(lab.textContent || '');
    if (text === target || text.includes(target) || target.includes(text)) {
      lab.scrollIntoView({ block: 'center', behavior: 'smooth' });
      lab.classList.add('bndz-setting-jump-flash');
      window.setTimeout(() => lab.classList.remove('bndz-setting-jump-flash'), 1800);
      return true;
    }
  }
  return false;
}
