/** Shared omnibar command catalog -- `>` prefix + Command Hub. */

export type OmnibarCommandGroup =
  | 'nav'
  | 'workspace'
  | 'view'
  | 'ops'
  | 'plugins'
  | 'system';

export type OmnibarCommandDef = {
  id: string;
  /** Primary token after `>` */
  name: string;
  aliases?: string[];
  label: string;
  hint: string;
  /** Icon id for Icons8Icon / Emblem -- must exist in TOOLBAR_LAUNCHER_ICONS. */
  icon?: string;
  /** Hub section grouping. */
  group?: OmnibarCommandGroup;
};

export const OMNIBAR_GROUP_LABELS: Record<OmnibarCommandGroup, string> = {
  nav: 'Navigate',
  workspace: 'Workspace',
  view: 'View',
  ops: 'File ops',
  plugins: 'Plugins & tools',
  system: 'System',
};

export const OMNIBAR_GROUP_ORDER: OmnibarCommandGroup[] = [
  'nav',
  'workspace',
  'view',
  'ops',
  'plugins',
  'system',
];

/**
 * File-manager command hub catalog.
 * Every entry must have a matching handler in BNDZUI tryOmnibarSubmit commandTable.
 */
export const OMNIBAR_COMMANDS: OmnibarCommandDef[] = [
  // --- Navigate ---
  { id: 'home', name: 'home', aliases: ['bndz'], label: 'Go Home', hint: 'Open Continuum Home', icon: 'home', group: 'nav' },
  { id: 'up', name: 'up', aliases: ['..', 'parent'], label: 'Go up', hint: 'Parent folder of the active pane', icon: 'nav_up', group: 'nav' },
  { id: 'go', name: 'go', aliases: ['cd'], label: 'Go to path', hint: '>go C:\\Users -- navigate to a folder', icon: 'folder_open_ui', group: 'nav' },
  { id: 'desktop', name: 'desktop', label: 'Desktop', hint: 'Jump to Desktop', icon: 'folder_open_ui', group: 'nav' },
  { id: 'downloads', name: 'downloads', aliases: ['dl'], label: 'Downloads', hint: 'Jump to Downloads', icon: 'download', group: 'nav' },
  { id: 'documents', name: 'documents', aliases: ['docs'], label: 'Documents', hint: 'Jump to Documents', icon: 'emblem_documents', group: 'nav' },
  { id: 'thispc', name: 'thispc', aliases: ['computer', 'pc'], label: 'This PC', hint: 'Open This PC / drives root', icon: 'this_pc', group: 'nav' },
  { id: 'recycle', name: 'recycle', aliases: ['trash', 'bin'], label: 'Recycle Bin', hint: 'Open Recycle Bin', icon: 'go_recycle_bin', group: 'nav' },
  { id: 'network', name: 'network', aliases: ['net'], label: 'Network', hint: 'Open Network places', icon: 'go_network', group: 'nav' },

  // --- Workspace ---
  { id: 'refresh', name: 'refresh', aliases: ['reload', 'r'], label: 'Refresh folder', hint: 'Reload the active folder', icon: 'refresh', group: 'workspace' },
  { id: 'dual', name: 'dual', aliases: ['split', 'dp'], label: 'Toggle dual pane', hint: 'Split / unsplit the workspace', icon: 'toggle_dual_pane', group: 'workspace' },
  { id: 'preview', name: 'preview', aliases: ['inspector', 'i'], label: 'Toggle preview', hint: 'Show or hide the preview pane', icon: 'toggle_preview', group: 'workspace' },
  { id: 'bottom', name: 'bottom', aliases: ['panel'], label: 'Toggle bottom panel', hint: 'Show or hide the plugin panel', icon: 'toggle_bottom', group: 'workspace' },
  { id: 'newtab', name: 'newtab', aliases: ['tab'], label: 'New tab', hint: 'Open a new tab in the active pane', icon: 'new_tab', group: 'workspace' },
  { id: 'tabset', name: 'tabset', label: 'Save tabset', hint: 'Save the current workspace tabs', icon: 'tabs', group: 'workspace' },

  // --- View ---
  { id: 'details', name: 'details', aliases: ['viewdetails'], label: 'Details view', hint: 'Switch active tab to details', icon: 'view_details', group: 'view' },
  { id: 'grid', name: 'grid', aliases: ['viewgrid'], label: 'Grid view', hint: 'Switch active tab to grid', icon: 'view_grid', group: 'view' },
  { id: 'list', name: 'list', aliases: ['viewlist'], label: 'List view', hint: 'Switch active tab to list', icon: 'view_list', group: 'view' },
  { id: 'columns', name: 'columns', aliases: ['miller'], label: 'Columns view', hint: 'Switch active tab to columns', icon: 'view_columns', group: 'view' },

  // --- File ops ---
  { id: 'newfolder', name: 'newfolder', aliases: ['mkdir', 'md'], label: 'New folder', hint: 'Create a folder in the active pane', icon: 'new_folder', group: 'ops' },
  { id: 'newfile', name: 'newfile', aliases: ['touch'], label: 'New text file', hint: 'Create a text document in the active pane', icon: 'new_file', group: 'ops' },
  { id: 'copypath', name: 'copypath', aliases: ['path'], label: 'Copy path', hint: 'Copy selected path(s) to clipboard', icon: 'copy_path', group: 'ops' },
  { id: 'properties', name: 'properties', aliases: ['props'], label: 'Properties', hint: 'Open properties for the selection', icon: 'properties', group: 'ops' },
  { id: 'selectall', name: 'selectall', aliases: ['sa'], label: 'Select all', hint: 'Select all items in the active pane', icon: 'select_all', group: 'ops' },

  // --- Plugins & tools ---
  { id: 'find', name: 'find', aliases: ['search'], label: 'Fast Search', hint: '>find photos -- or open Search plugin', icon: 'search', group: 'plugins' },
  { id: 'rename', name: 'rename', label: 'Batch Rename', hint: 'Open Batch / Smart Rename', icon: 'batch_rename', group: 'plugins' },
  { id: 'metadata', name: 'metadata', label: 'Metadata Inspector', hint: 'Open Metadata plugin', icon: 'metadata', group: 'plugins' },
  { id: 'filters', name: 'filters', label: 'Visual Filters', hint: 'Open Visual Filters plugin', icon: 'filters', group: 'plugins' },
  { id: 'terminal', name: 'terminal', aliases: ['shell'], label: 'Terminal', hint: 'Open embedded terminal', icon: 'terminal', group: 'plugins' },
  { id: 'icons', name: 'icons', aliases: ['iconstudio'], label: 'Icon Studio', hint: 'Open Icon Studio plugin', icon: 'icon_studio', group: 'plugins' },
  { id: 'tags', name: 'tags', aliases: ['tag'], label: 'Tag Manager', hint: 'Open tag manager', icon: 'tag_manager', group: 'plugins' },
  { id: 'dropstack', name: 'dropstack', aliases: ['drop'], label: 'Drop Stack', hint: 'Open Drop Stack plugin', icon: 'dropstack', group: 'plugins' },
  { id: 'cleanup', name: 'cleanup', aliases: ['storage'], label: 'Storage Cleanup', hint: 'Open Storage Cleanup plugin', icon: 'storage_cleanup', group: 'plugins' },
  { id: 'compare', name: 'compare', aliases: ['sync'], label: 'Compare / Sync', hint: 'Compare or sync two folders', icon: 'sync_folders', group: 'plugins' },
  { id: 'smart', name: 'smart', aliases: ['smarttools', 'ai'], label: 'Smart Tools', hint: 'Open AI Smart Workspace Tools', icon: 'smart_tools', group: 'plugins' },

  // --- System ---
  { id: 'settings', name: 'settings', aliases: ['config'], label: 'Configuration', hint: 'Open BNDZ settings', icon: 'settings', group: 'system' },
  { id: 'palette', name: 'palette', aliases: ['commands'], label: 'Command palette', hint: 'Open the full command palette', icon: 'command_ui', group: 'system' },
  { id: 'hub', name: 'hub', aliases: ['plugins', 'store'], label: 'Extension Hub', hint: 'Install and manage plugins', icon: 'extension_hub', group: 'system' },
];

export type OmnibarCommandSuggestion = {
  kind: 'command';
  id: string;
  insert: string;
  label: string;
  hint: string;
  icon?: string;
};

export function matchOmnibarCommands(queryAfterGt: string, limit = 10): OmnibarCommandSuggestion[] {
  const q = queryAfterGt.trim().toLowerCase();
  const token = q.split(/\s+/)[0] || '';
  const out: OmnibarCommandSuggestion[] = [];
  for (const c of OMNIBAR_COMMANDS) {
    const names = [c.name, ...(c.aliases || [])];
    const hit = !token || names.some(n => n.startsWith(token) || n.includes(token))
      || c.label.toLowerCase().includes(token)
      || c.hint.toLowerCase().includes(token);
    if (!hit) continue;
    out.push({
      kind: 'command',
      id: c.id,
      insert: `>${c.name}${token && names.includes(token) && q.includes(' ') ? ` ${q.slice(token.length).trimStart()}` : ''}`,
      label: `>${c.name}`,
      hint: c.hint,
      icon: c.icon,
    });
    if (out.length >= limit) break;
  }
  return out;
}

export function looksLikeOmnibarPath(s: string): boolean {
  return (
    /^%[A-Za-z_]/.test(s) ||
    /^[A-Za-z]:[\\/]/.test(s) ||
    /^[A-Za-z]:$/.test(s) ||
    s.toLowerCase().startsWith('shell:') ||
    s.startsWith('\\\\') ||
    s.startsWith('/') ||
    s.startsWith('~') ||
    /^(appdata|localappdata|temp|tmp|userprofile|home|desktop|downloads|documents)$/i.test(s)
  );
}
