import type { SelectionSignature } from '../selectionSignature';

export type ContextToolId =
  | 'properties'
  | 'batch-rename'
  | 'compare'
  | 'mesh-drop'
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
  | 'folder-sync';

export type ContextTool = {
  id: ContextToolId;
  label: string;
  icon: string;
};

export function toolsForSignature(sig: SelectionSignature): ContextTool[] {
  if (sig.kind === 'empty') {
    return [];
  }
  if (sig.kind === 'multi') {
    return [
      { id: 'compare', label: 'Compare', icon: 'compare' },
      { id: 'batch-rename', label: 'Batch rename', icon: 'batch_rename' },
      { id: 'mesh-drop', label: 'Mesh Drop', icon: 'emblem-shared' },
      { id: 'dropstack', label: 'Drop Stack', icon: 'dropstack' },
      { id: 'ram-staging', label: 'RAM Staging', icon: 'hard_drive_ui' },
      { id: 'catalog', label: 'Catalog', icon: 'catalog' },
      { id: 'properties', label: 'Properties', icon: 'sys_properties' },
    ];
  }
  switch (sig.media) {
    case 'audio':
      return [
        { id: 'waveform', label: 'Waveform', icon: 'music_ui' },
        { id: 'media-tab', label: 'Media', icon: 'film_ui' },
        { id: 'batch-rename', label: 'Rename', icon: 'batch_rename' },
        { id: 'mesh-drop', label: 'Mesh Drop', icon: 'emblem-shared' },
        { id: 'properties', label: 'Properties', icon: 'sys_properties' },
      ];
    case 'image':
      return [
        { id: 'histogram', label: 'Luma inspect', icon: 'color' },
        { id: 'loupe', label: 'Loupe', icon: 'preview' },
        { id: 'quick-look', label: 'Quick Look', icon: 'preview' },
        { id: 'properties', label: 'Properties', icon: 'sys_properties' },
      ];
    case 'video':
      return [
        { id: 'media-tab', label: 'Media', icon: 'film_ui' },
        { id: 'quick-look', label: 'Quick Look', icon: 'preview' },
        { id: 'properties', label: 'Properties', icon: 'sys_properties' },
      ];
    case 'folder':
      return [
        { id: 'index-folder', label: 'Index', icon: 'search' },
        { id: 'storage-cleanup', label: 'Cleanup', icon: 'storage_cleanup' },
        { id: 'folder-sync', label: 'Folder Sync', icon: 'sync' },
        { id: 'ghost-link', label: 'Ghost-Link', icon: 'emblem-symbolic-link' },
        { id: 'ram-staging', label: 'RAM Staging', icon: 'hard_drive_ui' },
        { id: 'catalog', label: 'Catalog', icon: 'catalog' },
      ];
    default:
      return [
        { id: 'properties', label: 'Properties', icon: 'sys_properties' },
        { id: 'batch-rename', label: 'Rename', icon: 'batch_rename' },
        { id: 'dropstack', label: 'Drop Stack', icon: 'dropstack' },
        { id: 'mesh-drop', label: 'Mesh Drop', icon: 'emblem-shared' },
      ];
  }
}

export function deckBadgeLabel(sig: SelectionSignature): string {
  if (sig.kind === 'empty') return 'Command deck';
  if (sig.kind === 'multi') return `${sig.count} items selected`;
  return sig.name;
}
