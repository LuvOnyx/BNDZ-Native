import type { FileTransferJobDto, FileTransferQueueState } from './ipcBridge';

const COMPLETED_VISIBLE_MS = 45_000;

/** Shared hook for the native file-transfer queue (background jobs). */
export function useFileTransferQueue(
  onChange?: (state: FileTransferQueueState) => void,
): {
  refresh: () => Promise<FileTransferQueueState>;
  cancel: (operationId: string) => Promise<boolean>;
} {
  let unsub: (() => void) | undefined;

  const attach = async () => {
    const { IPC } = await import('./ipcBridge');
    if (!IPC.isNative) return;
    unsub?.();
    unsub = IPC.onFileTransferQueueChanged(state => {
      onChange?.(state);
    });
    const initial = await IPC.getFileTransferQueue();
    onChange?.(initial);
  };

  void attach();

  return {
    refresh: async () => {
      const { IPC } = await import('./ipcBridge');
      const state = await IPC.getFileTransferQueue();
      onChange?.(state);
      return state;
    },
    cancel: async (operationId: string) => {
      const { IPC } = await import('./ipcBridge');
      const res = await IPC.cancelFileTransfer(operationId);
      return !!res.ok;
    },
  };
}

export function formatTransferAction(action: string): string {
  switch (action) {
    case 'copy': return 'Copy';
    case 'move': return 'Move';
    case 'delete': return 'Delete';
    case 'create-dir': return 'New folder';
    case 'create-file': return 'New file';
    case 'batch-rename': return 'Batch rename';
    case 'create-link': return 'Link';
    case 'folder-sync': return 'Sync';
    case 'archive-add': return 'Archive';
    case 'archive-extract': return 'Extract';
    case 'archive-extract-rpf': return 'Extract RPF';
    case 'mesh-upload': return 'Upload (Mesh)';
    case 'mesh-download': return 'Download (Mesh)';
    case 'mesh-drop-send': return 'Mesh Drop';
    case 'archive-create': return 'Archive';
    case 'undo': return 'Undo';
    case 'redo': return 'Redo';
    case 'restore': return 'Restore';
    case 'purge': return 'Delete';
    case 'empty-recycle': return 'Empty Recycle Bin';
    default: return action;
  }
}

export function formatTransferCategory(category: string): string {
  switch (category) {
    case 'archive': return 'Archive';
    case 'recycle': return 'Recycle Bin';
    case 'folder-sync': return 'Sync';
    case 'mesh': return 'Mesh';
    case 'mesh-drop': return 'Mesh Drop';
    case 'ghost-link': return 'Ghost-Link';
    case 'ram-staging': return 'RAM Staging';
    default: return category;
  }
}

export function formatTransferBytes(bytes?: number): string {
  if (bytes == null || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const digits = i === 0 ? 0 : i === 1 ? 0 : 1;
  return `${v.toFixed(digits)} ${units[i]}`;
}

export function formatTransferSpeed(bytesPerSecond?: number): string {
  if (bytesPerSecond == null || bytesPerSecond <= 0) return '';
  return `${formatTransferBytes(bytesPerSecond)}/s`;
}

export function formatTransferEta(seconds?: number | null): string {
  if (seconds == null || seconds < 0) return '';
  if (seconds < 60) return `${seconds}s left`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s left` : `${m}m left`;
}

export function formatTransferDestination(job: FileTransferJobDto): string | null {
  const dest = job.destinationPath?.trim();
  if (!dest) return null;
  return dest;
}

export function formatTransferProgressLine(job: FileTransferJobDto, showSpeedEta = true): string {
  const parts: string[] = [];
  if (job.bytesTransferred != null && job.totalBytes != null && job.totalBytes > 0) {
    parts.push(`${formatTransferBytes(job.bytesTransferred)} / ${formatTransferBytes(job.totalBytes)}`);
  } else if (job.itemsTotal != null && job.itemsTotal > 1) {
    parts.push(`${job.itemsCompleted ?? 0} / ${job.itemsTotal} items`);
  }
  if (showSpeedEta) {
    const speed = formatTransferSpeed(job.speedBytesPerSecond);
    if (speed) parts.push(speed);
    const eta = formatTransferEta(job.etaSeconds);
    if (eta) parts.push(eta);
  }
  return parts.join(' · ');
}

function isRecentlyCompleted(job: FileTransferJobDto): boolean {
  if (job.status !== 'completed' && job.status !== 'failed' && job.status !== 'cancelled') return false;
  if (!job.completedUtc) return false;
  const completed = Date.parse(job.completedUtc);
  if (Number.isNaN(completed)) return false;
  return Date.now() - completed < COMPLETED_VISIBLE_MS;
}

export function isTransferActive(state: FileTransferQueueState): boolean {
  return state.activeCount > 0 || state.queuedCount > 0
    || state.jobs.some(j => j.status === 'queued' || j.status === 'running' || j.status === 'paused')
    || state.jobs.some(isRecentlyCompleted);
}

export function visibleTransferJobs(jobs: FileTransferJobDto[]): FileTransferJobDto[] {
  return jobs.filter(j =>
    j.status === 'queued' || j.status === 'running' || j.status === 'paused' || j.status === 'failed' || isRecentlyCompleted(j),
  );
}
