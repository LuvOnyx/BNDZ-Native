/**
 * WebView2 DragStarting path (default): HTML5 draggable → host COM DoDragDrop.
 * Avoids boundary START_DRAG handoff when the bridge is installed.
 */

import { toWindowsPath } from './pathUtils';

let hostInstalled = false;

export function isWebView2DragStartingQuery(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('dragStarting') === '1';
  } catch {
    return false;
  }
}

export function markWebView2DragStartingInstalled(installed: boolean): void {
  hostInstalled = installed;
}

/** True when FE should use HTML5 draggable and skip boundary START_DRAG. */
export function isWebView2DragStartingEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  if (!isWebView2DragStartingQuery()) return false;
  return hostInstalled;
}

export function populateHtml5FileDragDataTransfer(
  dt: DataTransfer,
  paths: string[],
  copy: boolean,
): void {
  const lines = paths.map(raw => {
    const win = toWindowsPath(raw);
    const name = win.split(/[/\\]/).pop() || 'file';
    const url = `file:///${win.replace(/\\/g, '/')}`;
    return `application/octet-stream:${name}:${url}`;
  });
  dt.setData('DownloadURL', lines.join('\n'));
  dt.setData('text/plain', paths.map(p => toWindowsPath(p)).join('\n'));
  dt.effectAllowed = copy ? 'copyMove' : 'move';
}
