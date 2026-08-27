import type { SelectionSignature } from '../selectionSignature';

export type ContextToolId =
  | 'properties'
  | 'batch-rename'
  | 'compare'
  | 'mesh-drop'
  | 'mesh-shell-here'
  | 'mesh-download'
  | 'mesh-edit-remote'
  | 'mesh-ephemeral'
  | 'archive-extract'
  | 'waveform'
  | 'media-tab'
  | 'histogram'
  | 'loupe'
  | 'quick-look'
  | 'index-folder'
  | 'storage-cleanup'
  | 'ghost-link'
  | 'ram-staging'
  | 'dropstack'
  | 'catalog'
  | 'folder-sync'
  | 'project-sandbox'
  | 'library-health'
  | 'capacity-solver'
  | 'inbound-volume'
  | 'branching-time'
  | 'analyze-audio'
  | 'continuum-compose'
  | 'work-intent'
  | 'flush-ram-zone'
  | 'transcode-rack'
  | 'semantic-desk'
  | 'shell-menus';

export type ContextTool = {
  id: ContextToolId;
  label: string;
  icon: string;
  /**
   * Bottom-plugin id required to show this action.
   * Omit only for true host-native actions (index, preview inspect, continuum, intent).
   */
  pluginId?: string;
  /**
   * 'host' = mode/role action built into the host (not a plugin chip).
   * 'plugin' (default) = requires a bottom plugin to be meaningful.
   */
  kind?: 'host' | 'plugin';
};

function tool(
  id: ContextToolId,
  label: string,
  icon: string,
  pluginId?: string,
  kind?: ContextTool['kind'],
): ContextTool {
  const t: ContextTool = pluginId ? { id, label, icon, pluginId } : { id, label, icon };
  if (kind) t.kind = kind;
  return t;
}

/**
 * Drop tools whose plugin is not installed — never auto-install from the deck.
 * Host tools (no pluginId) always pass. Empty installed set hides every plugin-backed tool.
 */
export function filterToolsForInstalled(
  tools: ContextTool[],
  installedIds: ReadonlySet<string> | readonly string[] | undefined | null,
): ContextTool[] {
  const set = !installedIds
    ? null
    : installedIds instanceof Set
      ? installedIds
      : new Set(installedIds);
  return tools.filter(t => {
    if (!t.pluginId) return true;
    if (!set) return false;
    return set.has(t.pluginId);
  });
}

export function toolsForSignature(sig: SelectionSignature): ContextTool[] {
  if (sig.kind === 'empty') {
    return [];
  }
  if (sig.kind === 'multi') {
    const tools: ContextTool[] = [
      tool('compare', 'Compare', 'compare', 'compare'),
      tool('batch-rename', 'Batch rename', 'batch_rename', 'batch-rename'),
      tool('mesh-drop', 'Mesh Drop', 'emblem-shared', 'remote-mesh'),
      tool('dropstack', 'Drop Stack', 'dropstack', 'dropstack'),
      tool('ram-staging', 'RAM Staging', 'hard_drive_ui', 'ram-staging'),
      tool('flush-ram-zone', 'Flush zone', 'hard_drive_ui', 'ram-staging'),
      tool('capacity-solver', 'Capacity', 'bar_chart', 'capacity-solver'),
      tool('inbound-volume', 'Inbound', 'download', 'inbound-volume'),
      tool('work-intent', 'Intent', 'sparkles_ui', undefined, 'host'),
      tool('catalog', 'Catalog', 'catalog', 'catalog'),
      tool('properties', 'Properties', 'sys_properties', 'properties'),
    ];
    if (sig.dominantMedia === 'audio') {
      tools.splice(1, 0, tool('analyze-audio', 'Analyze BPM/Key', 'music_ui', 'metadata'));
    }
    if (sig.dominantMedia === 'archive') {
      tools.splice(0, 0, tool('archive-extract', 'Extract', 'zip', undefined, 'host'));
    }
    return tools;
  }
  switch (sig.media) {
    case 'audio':
      return [
        tool('waveform', 'Waveform', 'music_ui', 'metadata'),
        tool('analyze-audio', 'Analyze BPM/Key', 'music_ui', 'metadata'),
        tool('media-tab', 'Media', 'film_ui', undefined, 'host'),
        tool('batch-rename', 'Rename', 'batch_rename', 'batch-rename'),
        tool('mesh-drop', 'Mesh Drop', 'emblem-shared', 'remote-mesh'),
        tool('properties', 'Properties', 'sys_properties', 'properties'),
      ];
    case 'image':
      return [
        tool('transcode-rack', 'Transcode', 'edit_image', 'transcode-rack'),
        // Loupe / Luma are 2D image tools only — never offered for 3D meshes.
        tool('histogram', 'Luma inspect', 'color', undefined, 'host'),
        tool('loupe', 'Loupe', 'preview', undefined, 'host'),
        tool('quick-look', 'Quick Look', 'preview', undefined, 'host'),
        tool('properties', 'Properties', 'sys_properties', 'properties'),
      ];
    case 'model':
      // 3D / FiveM RAGE (.ydr/.ybn/…) — main preview GpuModelViewport only; no Loupe/Luma.
      return [
        tool('quick-look', 'Quick Look', 'preview', undefined, 'host'),
        tool('mesh-drop', 'Mesh Drop', 'emblem-shared', 'remote-mesh'),
        tool('mesh-ephemeral', 'Ephemeral', 'cloud_ui', 'remote-mesh'),
        tool('properties', 'Properties', 'sys_properties', 'properties'),
      ];
    case 'archive':
      return [
        tool('quick-look', 'Quick Look', 'preview', undefined, 'host'),
        tool('archive-extract', 'Extract', 'zip', undefined, 'host'),
        tool('mesh-ephemeral', 'Ephemeral', 'cloud_ui', 'remote-mesh'),
        tool('mesh-drop', 'Mesh Drop', 'emblem-shared', 'remote-mesh'),
        tool('properties', 'Properties', 'sys_properties', 'properties'),
      ];
    case 'video':
      return [
        tool('media-tab', 'Media', 'film_ui', undefined, 'host'),
        tool('quick-look', 'Quick Look', 'preview', undefined, 'host'),
        tool('properties', 'Properties', 'sys_properties', 'properties'),
      ];
    case 'folder':
      return [
        tool('semantic-desk', 'Semantic Desk', 'smart_view', 'semantic-desk'),
        tool('index-folder', 'Index', 'search', undefined, 'host'),
        tool('storage-cleanup', 'Cleanup', 'storage_cleanup', 'storage-cleanup'),
        tool('folder-sync', 'Folder Sync', 'sync', 'folder-sync'),
        tool('project-sandbox', 'Sandbox', 'folder_tree', 'project-sandbox'),
        tool('library-health', 'Health', 'health', 'library-health'),
        tool('branching-time', 'Branches', 'history_ui', 'branching-time'),
        tool('ghost-link', 'Ghost-Link', 'link', 'ghost-link'),
        tool('mesh-shell-here', 'Shell Here', 'terminal', 'remote-mesh'),
        tool('mesh-download', 'Download', 'download', 'remote-mesh'),
        tool('mesh-ephemeral', 'Ephemeral', 'cloud_ui', 'remote-mesh'),
        tool('ram-staging', 'RAM Staging', 'hard_drive_ui', 'ram-staging'),
        tool('flush-ram-zone', 'Flush zone', 'hard_drive_ui', 'ram-staging'),
        tool('continuum-compose', 'Continuum', 'view_grid', undefined, 'host'),
        tool('work-intent', 'Intent', 'sparkles_ui', undefined, 'host'),
        tool('catalog', 'Catalog', 'catalog', 'catalog'),
      ];
    default:
      return [
        tool('properties', 'Properties', 'sys_properties', 'properties'),
        tool('batch-rename', 'Rename', 'batch_rename', 'batch-rename'),
        tool('dropstack', 'Drop Stack', 'dropstack', 'dropstack'),
        tool('mesh-drop', 'Mesh Drop', 'emblem-shared', 'remote-mesh'),
        tool('mesh-shell-here', 'Shell Here', 'terminal', 'remote-mesh'),
        tool('mesh-download', 'Download', 'download', 'remote-mesh'),
        tool('mesh-edit-remote', 'Edit Remote', 'edit', 'remote-mesh'),
        tool('mesh-ephemeral', 'Ephemeral', 'cloud_ui', 'remote-mesh'),
        tool('work-intent', 'Intent', 'sparkles_ui', undefined, 'host'),
      ];
  }
}

export function deckBadgeLabel(sig: SelectionSignature): string {
  if (sig.kind === 'empty') return 'Command deck';
  if (sig.kind === 'multi') return `${sig.count} items selected`;
  return sig.name;
}
