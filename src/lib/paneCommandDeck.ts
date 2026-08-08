import type { ContextToolId } from '../workstation/command-deck/contextToolRegistry';
import type { BndzPaneKind } from './paneBoot';

/** Map Command Deck tools → FilesMerge pane / plugin surface. */
export type PaneToolRoute =
  | { kind: 'plugin'; pluginId: string }
  | { kind: 'preview'; tab?: string; inspection?: 'loupe' | 'histogram' }
  | { kind: 'pane'; pane: BndzPaneKind }
  | { kind: 'host'; tool: ContextToolId };

export function routeCommandDeckTool(id: ContextToolId): PaneToolRoute {
  switch (id) {
    case 'properties':
      return { kind: 'plugin', pluginId: 'properties' };
    case 'batch-rename':
      return { kind: 'plugin', pluginId: 'batch-rename' };
    case 'compare':
      return { kind: 'plugin', pluginId: 'compare' };
    case 'mesh-drop':
      return { kind: 'plugin', pluginId: 'remote-mesh' };
    case 'waveform':
    case 'media-tab':
      return { kind: 'preview', tab: 'media' };
    case 'histogram':
      return { kind: 'preview', tab: 'preview', inspection: 'histogram' };
    case 'loupe':
      return { kind: 'preview', tab: 'preview', inspection: 'loupe' };
    case 'quick-look':
      return { kind: 'preview' };
    case 'storage-cleanup':
      return { kind: 'plugin', pluginId: 'storage-cleanup' };
    case 'ghost-link':
      return { kind: 'plugin', pluginId: 'ghost-link' };
    case 'ram-staging':
    case 'flush-ram-zone':
      return { kind: 'plugin', pluginId: 'ram-staging' };
    case 'dropstack':
      return { kind: 'plugin', pluginId: 'dropstack' };
    case 'catalog':
      return { kind: 'plugin', pluginId: 'catalog' };
    case 'folder-sync':
      return { kind: 'plugin', pluginId: 'folder-sync' };
    case 'project-sandbox':
      return { kind: 'plugin', pluginId: 'project-sandbox' };
    case 'library-health':
      return { kind: 'plugin', pluginId: 'library-health' };
    case 'capacity-solver':
      return { kind: 'plugin', pluginId: 'capacity-solver' };
    case 'inbound-volume':
      return { kind: 'plugin', pluginId: 'inbound-volume' };
    case 'branching-time':
      return { kind: 'plugin', pluginId: 'branching-time' };
    case 'transcode-rack':
      return { kind: 'plugin', pluginId: 'transcode-rack' };
    case 'semantic-desk':
      return { kind: 'plugin', pluginId: 'semantic-desk' };
    case 'shell-menus':
      return { kind: 'plugin', pluginId: 'context-menu-manager' };
    case 'analyze-audio':
      return { kind: 'plugin', pluginId: 'metadata' };
    case 'continuum-compose':
      return { kind: 'pane', pane: 'canvas' };
    case 'index-folder':
    case 'work-intent':
      return { kind: 'host', tool: id };
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}
