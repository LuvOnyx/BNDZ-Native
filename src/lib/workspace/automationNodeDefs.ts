export type AutomationNodeCategory = 'trigger' | 'filter' | 'action' | 'utility';

export type AutomationNodeType =
  | 'watchFolder'
  | 'manualRun'
  | 'onSchedule'
  | 'onStartup'
  | 'indexChanged'
  | 'spatialPin'
  | 'filterExtension'
  | 'filterArchive'
  | 'filterSize'
  | 'filterAge'
  | 'filterTag'
  | 'filterContent'
  | 'duplicatesOnly'
  | 'copyTo'
  | 'moveTo'
  | 'rsyncDeploy'
  | 'ghostLinkTo'
  | 'recycleBin'
  | 'compressArchive'
  | 'extractArchive'
  | 'syncFolders'
  | 'generateThumbnail'
  | 'applyTag'
  | 'notifyToast'
  | 'runShell'
  | 'branch'
  | 'delay'
  | 'stopAbort'
  | 'batchCounter'
  | 'log';

export type AutomationFieldDef = {
  key: string;
  label: string;
  placeholder?: string;
  type?: 'text' | 'folder' | 'boolean' | 'select';
  options?: Array<{ value: string; label: string }>;
};

export type AutomationNodeDef = {
  label: string;
  color: string;
  icon: string;
  category: AutomationNodeCategory;
  desc: string;
  fields: AutomationFieldDef[];
  /** Branch nodes expose true/false source handles */
  branchOutputs?: boolean;
};

export const NODE_DEFS: Record<AutomationNodeType, AutomationNodeDef> = {
  watchFolder: {
    label: 'Watch folder', color: '#7eb8e8', icon: 'folder_open_ui', category: 'trigger',
    desc: 'Scan or live-monitor a folder for files',
    fields: [
      { key: 'path', label: 'Folder path', placeholder: 'C:\\Projects\\deploy', type: 'folder' },
      { key: 'liveWatch', label: 'Live watch (armed)', placeholder: 'true', type: 'boolean' },
      { key: 'includeSubdirs', label: 'Include subfolders', placeholder: 'true', type: 'boolean' },
    ],
  },
  manualRun: {
    label: 'Manual run', color: '#38bdf8', icon: 'zap_ui', category: 'trigger',
    desc: 'Explicit pipeline entry point for on-demand runs',
    fields: [],
  },
  onSchedule: {
    label: 'On schedule', color: '#60a5fa', icon: 'sync_folders', category: 'trigger',
    desc: 'Run pipeline on a repeating interval when armed',
    fields: [
      { key: 'intervalMinutes', label: 'Interval (minutes)', placeholder: '60' },
      { key: 'path', label: 'Scan folder (optional)', placeholder: 'C:\\Projects\\deploy', type: 'folder' },
      { key: 'includeSubdirs', label: 'Include subfolders', placeholder: 'true', type: 'boolean' },
      { key: 'enabled', label: 'Enabled', placeholder: 'true', type: 'boolean' },
    ],
  },
  onStartup: {
    label: 'On BNDZ startup', color: '#38bdf8', icon: 'zap_ui', category: 'trigger',
    desc: 'Run once when BNDZ launches (armed pipelines only — restored at host boot)',
    fields: [
      { key: 'enabled', label: 'Enabled', placeholder: 'true', type: 'boolean' },
    ],
  },
  indexChanged: {
    label: 'Index changed', color: '#22d3ee', icon: 'search', category: 'trigger',
    desc: 'Fire when a BNDZ index location finishes updating',
    fields: [
      { key: 'root', label: 'Index root (optional)', placeholder: 'Leave empty for any', type: 'folder' },
      { key: 'enabled', label: 'Enabled', placeholder: 'true', type: 'boolean' },
    ],
  },
  spatialPin: {
    label: 'Spatial pin', color: '#a78bfa', icon: 'pin', category: 'trigger',
    desc: 'Trigger from Spatial Canvas pinned paths',
    fields: [{ key: 'paths', label: 'Pinned paths', placeholder: 'One path per line' }],
  },
  filterExtension: {
    label: 'Filter extension', color: '#34d399', icon: 'filter_ui', category: 'filter',
    desc: 'Keep only files matching extensions (supports tar.gz)',
    fields: [{ key: 'extensions', label: 'Extensions', placeholder: 'zip,rar,7z,tar.gz' }],
  },
  filterArchive: {
    label: 'Archives only', color: '#a78bfa', icon: 'zip', category: 'filter',
    desc: 'Pass through archive types only',
    fields: [{ key: 'extensions', label: 'Archive types', placeholder: 'zip,rar,7z,tar.gz' }],
  },
  filterSize: {
    label: 'Filter by size', color: '#34d399', icon: 'filter_ui', category: 'filter',
    desc: 'Keep files within a size range',
    fields: [
      { key: 'minSize', label: 'Min size', placeholder: '0 or 1MB' },
      { key: 'maxSize', label: 'Max size', placeholder: '100MB' },
    ],
  },
  filterAge: {
    label: 'Filter by age', color: '#34d399', icon: 'filter_ui', category: 'filter',
    desc: 'Keep files older or newer than N days',
    fields: [
      { key: 'mode', label: 'Mode', placeholder: 'olderThan', type: 'select', options: [
        { value: 'olderThan', label: 'Older than' },
        { value: 'newerThan', label: 'Newer than' },
      ]},
      { key: 'days', label: 'Days', placeholder: '7' },
    ],
  },
  filterTag: {
    label: 'Filter by tag', color: '#34d399', icon: 'tag', category: 'filter',
    desc: 'Keep files with a specific BNDZ tag',
    fields: [{ key: 'tag', label: 'Tag name', placeholder: 'important' }],
  },
  filterContent: {
    label: 'Content grep', color: '#34d399', icon: 'search', category: 'filter',
    desc: 'Keep files whose text content matches a pattern',
    fields: [
      { key: 'pattern', label: 'Pattern', placeholder: 'TODO|FIXME' },
      { key: 'regex', label: 'Use regex', placeholder: 'false', type: 'boolean' },
    ],
  },
  duplicatesOnly: {
    label: 'Duplicates only', color: '#34d399', icon: 'copy', category: 'filter',
    desc: 'Keep only files that are hash-duplicates of another in the set',
    fields: [
      { key: 'minSize', label: 'Min size', placeholder: '1KB' },
    ],
  },
  copyTo: {
    label: 'Copy to', color: '#60a5fa', icon: 'copy', category: 'action',
    desc: 'Copy matched files to a destination',
    fields: [{ key: 'dest', label: 'Destination', placeholder: 'D:\\Backup', type: 'folder' }],
  },
  moveTo: {
    label: 'Move to', color: '#fbbf24', icon: 'move_ui', category: 'action',
    desc: 'Move matched files to a destination',
    fields: [{ key: 'dest', label: 'Destination', placeholder: 'D:\\Archive', type: 'folder' }],
  },
  rsyncDeploy: {
    label: 'Remote deploy', color: '#f472b6', icon: 'cloud_ui', category: 'action',
    desc: 'Push files via rsync / SCP to remote host',
    fields: [
      { key: 'source', label: 'Local source (optional)', placeholder: 'Uses pipeline files if empty', type: 'folder' },
      { key: 'remote', label: 'Target (user@host:/path)', placeholder: 'user@host:/var/www' },
      { key: 'extraArgs', label: 'Extra rsync args', placeholder: '-avz --delete' },
    ],
  },
  ghostLinkTo: {
    label: 'Ghost-Link offload', color: '#a78bfa', icon: 'emblem-symbolic-link', category: 'action',
    desc: 'Move matched files to cold storage and symlink originals',
    fields: [{ key: 'coldStorageRoot', label: 'Cold storage root', placeholder: 'D:\\ColdStorage', type: 'folder' }],
  },
  recycleBin: {
    label: 'Recycle Bin', color: '#f87171', icon: 'trash_ui', category: 'action',
    desc: 'Send matched files to the Windows Recycle Bin',
    fields: [],
  },
  compressArchive: {
    label: 'Compress', color: '#fbbf24', icon: 'zip', category: 'action',
    desc: 'Compress matched files into an archive',
    fields: [
      { key: 'dest', label: 'Archive path', placeholder: 'D:\\Backup\\files.zip' },
      { key: 'format', label: 'Format', placeholder: 'zip', type: 'select', options: [
        { value: 'zip', label: 'ZIP' },
        { value: '7z', label: '7z' },
      ]},
    ],
  },
  extractArchive: {
    label: 'Extract archive', color: '#fbbf24', icon: 'zip', category: 'action',
    desc: 'Extract matched archive files to a destination folder',
    fields: [{ key: 'dest', label: 'Destination folder', placeholder: 'D:\\Extracted', type: 'folder' }],
  },
  syncFolders: {
    label: 'Sync folders', color: '#60a5fa', icon: 'sync_folders', category: 'action',
    desc: 'One-shot sync from source folder to destination',
    fields: [
      { key: 'source', label: 'Source', placeholder: 'Uses pipeline roots if empty', type: 'folder' },
      { key: 'dest', label: 'Destination', placeholder: 'D:\\Mirror', type: 'folder' },
    ],
  },
  generateThumbnail: {
    label: 'Generate thumbnail', color: '#a78bfa', icon: 'preview', category: 'action',
    desc: 'Write PNG thumbnails for matched images into a folder',
    fields: [
      { key: 'dest', label: 'Output folder', placeholder: 'D:\\Thumbs', type: 'folder' },
      { key: 'size', label: 'Pixel size', placeholder: '256' },
    ],
  },
  applyTag: {
    label: 'Apply tag', color: '#a78bfa', icon: 'tag', category: 'action',
    desc: 'Apply a BNDZ tag to matched files',
    fields: [{ key: 'tag', label: 'Tag name', placeholder: 'archived' }],
  },
  notifyToast: {
    label: 'Notify', color: '#94a3b8', icon: 'bell', category: 'action',
    desc: 'Show a Windows notification toast',
    fields: [
      { key: 'title', label: 'Title', placeholder: 'BNDZ Automation' },
      { key: 'message', label: 'Message', placeholder: 'Pipeline checkpoint' },
    ],
  },
  runShell: {
    label: 'Run shell', color: '#f472b6', icon: 'terminal', category: 'action',
    desc: 'Execute a shell command (safety-filtered)',
    fields: [{ key: 'command', label: 'Command', placeholder: 'echo Pipeline done' }],
  },
  branch: {
    label: 'Branch', color: '#f59e0b', icon: 'branch', category: 'utility',
    desc: 'Split pipeline on true/false outputs',
    branchOutputs: true,
    fields: [
      { key: 'condition', label: 'Condition', placeholder: 'anyFiles', type: 'select', options: [
        { value: 'anyFiles', label: 'Has files' },
        { value: 'noFiles', label: 'No files' },
        { value: 'matchesExtension', label: 'Matches extension' },
      ]},
      { key: 'extensions', label: 'Extensions (if match)', placeholder: 'zip,pdf' },
    ],
  },
  delay: {
    label: 'Delay', color: '#94a3b8', icon: 'clock', category: 'utility',
    desc: 'Pause pipeline for N seconds',
    fields: [{ key: 'seconds', label: 'Seconds', placeholder: '5' }],
  },
  stopAbort: {
    label: 'Stop / abort', color: '#f87171', icon: 'close', category: 'utility',
    desc: 'Fail the pipeline with a message',
    fields: [{ key: 'message', label: 'Abort message', placeholder: 'Stopped by pipeline' }],
  },
  batchCounter: {
    label: 'Batch counter', color: '#94a3b8', icon: 'filter_ui', category: 'utility',
    desc: 'Process only the first N files this run',
    fields: [{ key: 'limit', label: 'Max files', placeholder: '50' }],
  },
  log: {
    label: 'Log', color: '#94a3b8', icon: 'notepad', category: 'utility',
    desc: 'Write a checkpoint message to the run log',
    fields: [{ key: 'message', label: 'Message', placeholder: 'Pipeline checkpoint' }],
  },
};

export const PALETTE_GROUPS: Array<{ id: string; label: string; types: AutomationNodeType[] }> = [
  {
    id: 'triggers',
    label: 'Triggers',
    types: ['watchFolder', 'manualRun', 'onSchedule', 'onStartup', 'indexChanged', 'spatialPin'],
  },
  {
    id: 'filters',
    label: 'Filters',
    types: ['filterExtension', 'filterArchive', 'filterSize', 'filterAge', 'filterTag', 'filterContent', 'duplicatesOnly'],
  },
  {
    id: 'actions',
    label: 'Actions',
    types: ['copyTo', 'moveTo', 'rsyncDeploy', 'ghostLinkTo', 'recycleBin', 'compressArchive', 'extractArchive', 'syncFolders', 'generateThumbnail', 'applyTag', 'notifyToast', 'runShell'],
  },
  {
    id: 'utility',
    label: 'Utility',
    types: ['branch', 'delay', 'stopAbort', 'batchCounter', 'log'],
  },
];

export const CATEGORY_LABEL: Record<AutomationNodeCategory, string> = {
  trigger: 'Trigger',
  filter: 'Filter',
  action: 'Action',
  utility: 'Utility',
};

export const TRIGGER_TYPES: AutomationNodeType[] = ['watchFolder', 'manualRun', 'onSchedule', 'onStartup', 'indexChanged', 'spatialPin'];

export const FOLDER_FIELD_KEYS = new Set(['path', 'dest', 'source', 'coldStorageRoot', 'root']);

export function isTriggerType(type: AutomationNodeType): boolean {
  return TRIGGER_TYPES.includes(type);
}
