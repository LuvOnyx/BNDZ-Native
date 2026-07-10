import type { FileTransferQueueState } from './ipcBridge';

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
    default: return action;
  }
}

export function isTransferActive(state: FileTransferQueueState): boolean {
  return state.activeCount > 0 || state.queuedCount > 0
    || state.jobs.some(j => j.status === 'queued' || j.status === 'running');
}
