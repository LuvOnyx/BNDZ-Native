/** Session hint: last Remote/mesh FS mutation that never entered the local Action Log. */
import { isMeshPath } from './meshPaths';

const REMOTE_HINT_TTL_MS = 15 * 60_000;

let lastRemoteMutationAt = 0;
let lastRemoteMutationLabel = '';

function pathsLookRemote(paths: Array<string | null | undefined>): boolean {
  return paths.some(p => typeof p === 'string' && p.length > 0 && isMeshPath(p));
}

/** Call when FE dispatches a mesh/remote FS op (rename/delete/mkdir/move/copy). */
export function noteRemoteMutation(detail?: { action?: string; label?: string }): void {
  lastRemoteMutationAt = Date.now();
  const action = detail?.action?.trim() || 'change';
  lastRemoteMutationLabel = detail?.label?.trim() || action;
}

export function noteRemoteMutationIfPaths(
  paths: Array<string | null | undefined>,
  detail?: { action?: string; label?: string },
): void {
  if (!pathsLookRemote(paths)) return;
  noteRemoteMutation(detail);
}

export function hasRecentRemoteMutation(ttlMs = REMOTE_HINT_TTL_MS): boolean {
  if (!lastRemoteMutationAt) return false;
  return Date.now() - lastRemoteMutationAt <= ttlMs;
}

export function remoteUndoHonestyMessage(redo = false): string | null {
  if (!hasRecentRemoteMutation()) return null;
  if (redo) return "Remote changes aren't on Redo";
  return "Remote changes aren't on Undo";
}

export function clearRemoteMutationHint(): void {
  lastRemoteMutationAt = 0;
  lastRemoteMutationLabel = '';
}

export function getLastRemoteMutationLabel(): string {
  return lastRemoteMutationLabel;
}
