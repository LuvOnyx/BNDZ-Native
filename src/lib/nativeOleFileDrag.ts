/**
 * Outbound OLE drag: DoDragDrop starts at list drag threshold (button still down inside the app).
 * Boundary ReleaseCapture handoff poisons wallpaper mouse-up — do not use it as the OLE start.
 */

import { IPC } from './ipcBridge';
import { isValidOutboundDragPath, toWindowsPath } from './pathUtils';
import type { FileDragSessionState } from './fileDragSession';
import { stashOleDragSession } from './fileDragSession';
import { isWebView2DragStartingEnabled } from './webView2DragStarting';

export function isNativeOleDragHost(): boolean {
  return IPC.isNative;
}

/** Start Windows OLE drag at gesture threshold — LMB still down, still inside the app. */
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
 * Boundary handoff: hide React ghost → release pointer capture → START_DRAG.
 * Call only when the cursor crosses the outer WebView/app edge toward the desktop.
 */
export function performOutboundOleBoundaryHandoff(opts: OutboundOleBoundaryHandoffOpts): void {
  if (!IPC.isNative) return;
  if (isWebView2DragStartingEnabled()) return;
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
  if (isWebView2DragStartingEnabled()) return;
  const raw = (Array.isArray(paths) ? paths : [paths]).filter(Boolean);
  const list = raw.map(p => toWindowsPath(String(p))).filter(isValidOutboundDragPath);
  if (!list.length) return;
  IPC.postOleDndDebug({ kind: 'commit-outbound-ole', why, count: list.length, sample: list.slice(0, 2) });
  IPC.startDrag(list);
}
