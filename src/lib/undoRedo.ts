import { IPC } from './ipcBridge';

const UNDO_TIMEOUT_MS = 120_000;

export async function executeUndoWithTimeout(): Promise<{ ok: boolean; message: string }> {
  if (!IPC.isNative) return { ok: false, message: 'Undo requires native host' };
  return Promise.race([
    IPC.executeUndo(),
    new Promise<{ ok: boolean; message: string }>((_, reject) => {
      setTimeout(() => reject(new Error('Undo timed out after 2 minutes')), UNDO_TIMEOUT_MS);
    }),
  ]);
}

export async function executeRedoWithTimeout(): Promise<{ ok: boolean; message: string }> {
  if (!IPC.isNative) return { ok: false, message: 'Redo requires native host' };
  return Promise.race([
    IPC.executeRedo(),
    new Promise<{ ok: boolean; message: string }>((_, reject) => {
      setTimeout(() => reject(new Error('Redo timed out after 2 minutes')), UNDO_TIMEOUT_MS);
    }),
  ]);
}
