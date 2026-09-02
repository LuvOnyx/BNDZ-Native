/**
 * Outbound OLE drag: React ghost inside the app; native DoDragDrop only at the boundary.
 */

import { IPC } from './ipcBridge';
import { isValidOutboundDragPath, toWindowsPath } from './pathUtils';
import type { FileDragSessionState } from './fileDragSession';
import { stashOleDragSession } from './fileDragSession';

export function isNativeOleDragHost(): boolean {
  return IPC.isNative;
}

/** Arm host session at threshold — React keeps the ghost; no START_DRAG yet. */
export function launchNativeFileDragAtThreshold(
  session: FileDragSessionState,
  why = 'threshold',
): void {
  if (!IPC.isNative) return;
  const local = session.paths
    .map(p => toWindowsPath(p))
    .filter(isValidOutboundDragPath);
  if (!local.length) return;
  stashOleDragSession(session);
  IPC.notifyFileDragActive(true, local);
  IPC.postOleDndDebug({
    kind: 'launch-native-at-threshold',
    why,
    count: local.length,
    sample: local.slice(0, 2),
  });
}

export type OutboundOleBoundaryHandoffOpts = {
  paths: string[];
  pointerId: number;
  captureEl: HTMLElement | null;
  hideGhost: () => void;
  why?: string;
};

/**
 * Boundary handoff: hide React ghost → release pointer capture → START_DRAG.
 * Call only when the cursor crosses the outer WebView/app edge toward the desktop.
 */
export function performOutboundOleBoundaryHandoff(opts: OutboundOleBoundaryHandoffOpts): void {
  if (!IPC.isNative) return;
  const list = opts.paths.map(p => toWindowsPath(String(p))).filter(isValidOutboundDragPath);
  if (!list.length) return;

  opts.hideGhost();
  if (opts.captureEl) {
    try { opts.captureEl.releasePointerCapture(opts.pointerId); } catch { /* ignore */ }
  }

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
  const raw = (Array.isArray(paths) ? paths : [paths]).filter(Boolean);
  const list = raw.map(p => toWindowsPath(String(p))).filter(isValidOutboundDragPath);
  if (!list.length) return;
  IPC.postOleDndDebug({ kind: 'commit-outbound-ole', why, count: list.length, sample: list.slice(0, 2) });
  IPC.startDrag(list);
}
