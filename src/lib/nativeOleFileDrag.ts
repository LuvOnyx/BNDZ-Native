/**
 * Outbound OLE drag:
 * - Inside BNDZ: React/fluid ghosts + in-app drop/cancel (no DoDragDrop yet).
 * - At window boundary: START_DRAG without ReleaseCapture (ReleaseCapture poisons wallpaper up).
 * - Outside: host layered ghost + existing wallpaper shell-recover path.
 */

import { IPC } from './ipcBridge';
import { isValidOutboundDragPath, toWindowsPath } from './pathUtils';
import type { FileDragSessionState } from './fileDragSession';
import { stashOleDragSession } from './fileDragSession';
import { hideFileDragGhostForOleHandoff } from './fileDragUiCleanup';
import { isWebView2DragStartingEnabled } from './webView2DragStarting';

export function isNativeOleDragHost(): boolean {
  return IPC.isNative;
}

/**
 * @deprecated Prefer boundary handoff so in-app ghosts and cancel keep working.
 * Kept for callers that must start OLE while still inside the HWND.
 */
export function launchNativeFileDragAtThreshold(
  session: FileDragSessionState,
  why = 'threshold',
): void {
  if (!IPC.isNative) return;
  if (isWebView2DragStartingEnabled()) return;
  const local = session.paths
    .map(p => toWindowsPath(p))
    .filter(isValidOutboundDragPath);
  if (!local.length) return;
  stashOleDragSession(session);
  hideFileDragGhostForOleHandoff();
  IPC.notifyFileDragActive(true, local);
  IPC.postOleDndDebug({
    kind: 'launch-native-at-threshold',
    why,
    count: local.length,
    sample: local.slice(0, 2),
  });
  IPC.startDrag(local);
}

export type OutboundOleBoundaryHandoffOpts = {
  paths: string[];
  pointerId: number;
  captureEl: HTMLElement | null;
  hideGhost: () => void;
  why?: string;
};

/**
 * Boundary handoff: hide React ghost → START_DRAG.
 * Do NOT releasePointerCapture — that synthesizes button-up and breaks wallpaper commit.
 */
export function performOutboundOleBoundaryHandoff(opts: OutboundOleBoundaryHandoffOpts): void {
  if (!IPC.isNative) return;
  if (isWebView2DragStartingEnabled()) return;
  const list = opts.paths.map(p => toWindowsPath(String(p))).filter(isValidOutboundDragPath);
  if (!list.length) return;

  stashOleDragSession();
  opts.hideGhost();
  // Intentionally no releasePointerCapture / ReleaseCapture.

  IPC.notifyFileDragActive(true, list);
  IPC.postOleDndDebug({
    kind: 'boundary-handoff',
    why: opts.why ?? 'boundary',
    count: list.length,
    sample: list.slice(0, 2),
  });
  IPC.startDrag(list);
}

/** FE rim backup when boundary handoff did not run (pointercancel, etc.). */
export function commitOutboundOleDrag(paths: string | string[], why = 'fe'): void {
  if (!IPC.isNative) return;
  if (isWebView2DragStartingEnabled()) return;
  const raw = (Array.isArray(paths) ? paths : [paths]).filter(Boolean);
  const list = raw.map(p => toWindowsPath(String(p))).filter(isValidOutboundDragPath);
  if (!list.length) return;
  hideFileDragGhostForOleHandoff();
  IPC.postOleDndDebug({ kind: 'commit-outbound-ole', why, count: list.length, sample: list.slice(0, 2) });
  IPC.startDrag(list);
}
