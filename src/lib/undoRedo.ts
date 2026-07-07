import { IPC } from './ipcBridge';

// Single source of truth for the undo/redo deadline — passed all the way into the
// underlying nativeCall so the IPC layer's own timeout can never fire first and
// silently swallow a slow-but-successful backend response (the bug that produced
// "IPC timeout: UNDO_REDO_RESULT" toasts on large undo/redo operations).
const UNDO_TIMEOUT_MS = 120_000;

export async function executeUndoWithTimeout(): Promise<{ ok: boolean; message: string }> {
  if (!IPC.isNative) return { ok: false, message: 'Undo requires native host' };
  try {
    return await IPC.executeUndo(UNDO_TIMEOUT_MS);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Undo timed out.' };
  }
}

export async function executeRedoWithTimeout(): Promise<{ ok: boolean; message: string }> {
  if (!IPC.isNative) return { ok: false, message: 'Redo requires native host' };
  try {
    return await IPC.executeRedo(UNDO_TIMEOUT_MS);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Redo timed out.' };
  }
}
