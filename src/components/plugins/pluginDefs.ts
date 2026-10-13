/**
 * Hub catalogue entries (id / name / icon / panel) for the built-in bottom plugins.
 * Kept apart from the plugin components so the registry can list every plugin at startup
 * while each panel's code loads only when it is first opened.
 */

export const ContextMenuPluginDef = {
  id: 'context-menu-manager',
  name: 'Shell Menus',
  icon: 'shell_menus',
};

export const IconStudioPluginDef = {
    id: "icon-studio",
    name: "Icon Studio",
    icon: 'icon_studio'
};

export const BatchRenamePluginDef = {
    id: "batch-rename",
    name: "Batch Rename",
    icon: 'batch_rename',
    description: 'Rename many files at once, plus drop rules for rename, tag, and move',
};

export const FindPluginDef = {
    id: "find",
    name: "Fast Search",
    icon: 'find',
    targetPanel: "bottom"
};

export const DropStackPluginDef = {
  id: 'dropstack',
  name: 'Drop Stack',
  icon: 'dropstack',
  description: 'Hold files from many places, then copy or move them all at once',
  targetPanel: 'bottom',
};

export const FiltersPluginDef = {
    id: 'filters',
    name: 'Visual Filters',
    icon: 'filters',
    description: 'Color rules and smart groups to highlight or hide files in the list',
    isNative: false,
    targetPanel: 'bottom' as const,
};

export const MetadataPluginDef = {
    id: 'metadata',
    name: 'Metadata',
    icon: 'metadata',
    description: 'Details, tags, checksums, and image convert -- one place',
    isNative: true,
    targetPanel: 'bottom' as const,
};

export const StorageCleanupPluginDef = {
  id: 'storage-cleanup',
  name: 'Storage Cleanup',
  icon: 'storage_cleanup',
  description: 'Free space, find large files, remove duplicates, and check library health',
  targetPanel: 'bottom' as const,
  installOnFirstUse: false,
};

export const FolderSyncPluginDef = {
  id: 'folder-sync',
  name: 'Folder Sync',
  icon: 'sync_folders',
  description: 'Keep folders in sync, or compare two folders side by side',
  targetPanel: 'bottom' as const,
  installOnFirstUse: false,
};

export const CatalogPluginDef = {
  id: 'catalog',
  name: 'Catalog',
  icon: 'bookmark',
  targetPanel: 'bottom' as const,
  installOnFirstUse: false,
};

export const ActionLogPluginDef = {
  id: 'action-log',
  name: 'Action Log',
  icon: 'clock_ui',
  targetPanel: 'bottom' as const,
  installOnFirstUse: false,
};

export const MeshPluginDef = {
  id: 'remote-mesh',
  name: 'Remote',
  icon: 'cloud_ui',
  targetPanel: 'bottom' as const,
  installOnFirstUse: false,
};

export const ProjectSandboxPluginDef = {
  id: 'project-sandbox',
  name: 'Project Sandbox',
  icon: 'layers_ui',
  description: 'Safe work folders with restore points and optional locked vaults',
  targetPanel: 'bottom' as const,
  installOnFirstUse: false,
};

export const BranchingTimePluginDef = {
  id: 'branching-time',
  name: 'Branching Time',
  icon: 'history_ui',
  description: 'Save folder snapshots you can preview and restore later -- like undo for a whole folder',
  targetPanel: 'bottom' as const,
  installOnFirstUse: false,
};

export const CloudDrivePluginDef = {
  id: 'cloud-drive',
  name: 'BNDZ Cloud',
  icon: 'cloud_ui',
  description: 'Your own drives at cloud.bndz.org/<name>/ -- in the cloud or on this PC. Create, start, and share.',
  targetPanel: 'bottom' as const,
  installOnFirstUse: false,
};
