/** Shared omnibar command catalog -- `>` prefix + Command Hub. */

export type OmnibarCommandDef = {
  id: string;
  /** Primary token after `>` */
  name: string;
  aliases?: string[];
  label: string;
  hint: string;
  /** Icon id for Icons8Icon / Emblem */
  icon?: string;
};

export const OMNIBAR_COMMANDS: OmnibarCommandDef[] = [
  { id: 'refresh', name: 'refresh', aliases: ['reload', 'r'], label: 'Refresh folder', hint: 'Reload the active folder', icon: 'refresh' },
  { id: 'dual', name: 'dual', aliases: ['split', 'dp'], label: 'Toggle dual pane', hint: 'Split / unsplit the workspace', icon: 'dual_pane' },
  { id: 'preview', name: 'preview', aliases: ['inspector', 'i'], label: 'Toggle preview', hint: 'Show or hide the preview pane', icon: 'preview' },
  { id: 'settings', name: 'settings', aliases: ['config'], label: 'Configuration', hint: 'Open BNDZ settings', icon: 'settings' },
  { id: 'find', name: 'find', aliases: ['search'], label: 'Fast Search', hint: '>find photos -- or open Search plugin', icon: 'search' },
  { id: 'rename', name: 'rename', label: 'Batch Rename', hint: 'Open Batch / Smart Rename', icon: 'batch_rename' },
  { id: 'metadata', name: 'metadata', label: 'Metadata Inspector', hint: 'Open Metadata plugin', icon: 'metadata' },
  { id: 'filters', name: 'filters', label: 'Visual Filters', hint: 'Open Visual Filters plugin', icon: 'filters' },
  { id: 'terminal', name: 'terminal', aliases: ['shell'], label: 'Terminal', hint: 'Open embedded terminal', icon: 'terminal' },
  { id: 'tabset', name: 'tabset', label: 'Save tabset', hint: 'Save the current workspace tabs', icon: 'tabs' },
  { id: 'palette', name: 'palette', aliases: ['commands'], label: 'Command palette', hint: 'Open the full command palette', icon: 'command' },
  { id: 'hub', name: 'hub', aliases: ['plugins', 'store'], label: 'Extension Hub', hint: 'Install and manage plugins', icon: 'extension_hub' },
  { id: 'go', name: 'go', aliases: ['cd'], label: 'Go to path', hint: '>go C:\\Users -- navigate to a folder', icon: 'folder_open_ui' },
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
