export interface JumpSettingEntry {
  tab: string;
  label: string;
  keywords: string[];
}

/** Searchable index for Configuration → Jump to Setting */
export const JUMP_SETTING_INDEX: JumpSettingEntry[] = [
  { tab: 'Tree and List', label: 'Hidden folders in tree', keywords: ['hidden', 'tree', 'system'] },
  { tab: 'Tree and List', label: 'Expand tree on browse', keywords: ['expand', 'tree', 'browse'] },
  { tab: 'Tree and List', label: 'Expand tree on drag-over', keywords: ['expand', 'drag', 'tree'] },
  { tab: 'Tree and List', label: 'Folder sizes', keywords: ['folder', 'size', 'sync'] },
  { tab: 'Tree and List', label: 'File extensions', keywords: ['extension', 'show'] },
  { tab: 'Menus, Mouse, Usability', label: 'Tooltips', keywords: ['tooltip', 'hover'] },
  { tab: 'File Info Tips & Hover Box', label: 'Hover tooltips', keywords: ['tooltip', 'hover', 'delay', 'theme', 'animated'] },
  { tab: 'File Info Tips & Hover Box', label: 'File info tips', keywords: ['file', 'info', 'tips'] },
  { tab: 'File Info Tips & Hover Box', label: 'Windows notifications', keywords: ['notification', 'toast', 'native'] },
  { tab: 'File Info Tips & Hover Box', label: 'Folder size toast', keywords: ['folder', 'size', 'cooldown', 'toast'] },
  { tab: 'Colors', label: 'Custom colors', keywords: ['color', 'theme', 'workspace'] },
  { tab: 'Themes', label: 'Workspace theme', keywords: ['theme', 'dark', 'light', 'nord'] },
  { tab: 'Appearance', label: 'Selection chrome', keywords: ['appearance', 'selection', 'chrome', 'xyplorer', 'filepilot', 'density', 'radius'] },
  { tab: 'Appearance', label: 'Grid selection style', keywords: ['grid', 'selection', 'tile', 'icon'] },
  { tab: 'Appearance', label: 'Workspace palette', keywords: ['palette', 'slate', 'surface', 'chrome'] },
  { tab: 'Fonts', label: 'Toolbar compact', keywords: ['toolbar', 'compact', 'menubar'] },
  { tab: 'Dual Pane', label: 'Dual pane', keywords: ['dual', 'pane', 'split'] },
  { tab: 'Tabs', label: 'Tab bar', keywords: ['tab', 'close', 'new'] },
  { tab: 'Preview', label: 'Preview panel', keywords: ['preview', 'right'] },
  { tab: 'Thumbnails', label: 'Thumbnails', keywords: ['thumbnail', 'icon', 'native'] },
  { tab: 'File Operations', label: 'Delete confirmation', keywords: ['delete', 'confirm', 'recycle'] },
  { tab: 'Safety Belts, Network', label: 'Recycle bin', keywords: ['recycle', 'delete', 'bypass'] },
  { tab: 'Shell Integration', label: 'Context menu', keywords: ['context', 'shell', 'menu'] },
  { tab: 'Features', label: 'Everything search', keywords: ['search', 'everything'] },
  { tab: 'Tags', label: 'File tagging', keywords: ['tag', 'color'] },
  { tab: 'Icon Configurator', label: 'Icons', keywords: ['icon', 'library', 'studio'] },
  { tab: 'Startup & Exit', label: 'Startup', keywords: ['startup', 'launch', 'exit'] },
];

export function searchJumpSettings(query: string, categoryTabs: string[]): JumpSettingEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const tabHits = categoryTabs
    .filter(t => t.toLowerCase().includes(q))
    .map(t => ({ tab: t, label: `Open tab: ${t}`, keywords: [q] }));
  const entryHits = JUMP_SETTING_INDEX.filter(e =>
    e.label.toLowerCase().includes(q) ||
    e.tab.toLowerCase().includes(q) ||
    e.keywords.some(k => k.includes(q) || q.includes(k)),
  );
  const seen = new Set<string>();
  return [...tabHits, ...entryHits].filter(e => {
    const key = `${e.tab}::${e.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 12);
}
