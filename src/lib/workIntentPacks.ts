export type WorkIntentId = 'browse' | 'ingest' | 'archive' | 'fix' | 'ship' | 'review';

export type WorkIntentPack = {
  id: WorkIntentId;
  label: string;
  description: string;
  plugins: string[];
  previewMode?: string;
  confirmStrict?: boolean;
  sortColumn?: string;
  listGroupBy?: string;
};

export const WORK_INTENT_PACKS: WorkIntentPack[] = [
  {
    id: 'browse',
    label: 'Browse',
    description: 'Explore and search your file system',
    plugins: ['find', 'properties'],
  },
  {
    id: 'ingest',
    label: 'Ingest',
    description: 'Import files from clipboard, downloads, and external media',
    plugins: ['inbound-volume', 'dropstack', 'ram-staging'],
  },
  {
    id: 'archive',
    label: 'Archive',
    description: 'Free space with ghost-links, cleanup, and capacity planning',
    plugins: ['storage-cleanup', 'ghost-link', 'capacity-solver'],
  },
  {
    id: 'fix',
    label: 'Fix',
    description: 'Find and resolve library problems, compare diffs',
    plugins: ['library-health', 'action-log', 'compare'],
  },
  {
    id: 'ship',
    label: 'Ship',
    description: 'Sync folders and deploy via mesh remotes',
    plugins: ['folder-sync', 'mesh', 'catalog'],
  },
  {
    id: 'review',
    label: 'Review',
    description: 'Audit recent actions, compare files, inspect properties',
    plugins: ['action-log', 'compare', 'properties'],
  },
];

export function applyWorkIntentPack(
  packId: WorkIntentId,
  ctx: {
    openBottomPlugin: (id: string) => void;
    updateConfig: (patch: Record<string, unknown>) => void;
  },
): void {
  const pack = WORK_INTENT_PACKS.find(p => p.id === packId);
  if (!pack) return;
  ctx.updateConfig({ workIntentId: packId });
  if (pack.plugins.length > 0) {
    ctx.openBottomPlugin(pack.plugins[0]);
  }
}
