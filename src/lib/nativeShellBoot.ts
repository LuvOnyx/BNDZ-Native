/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/** True when host launched with --native-shell (full product, Files-like chrome). */
export function isNativeShellBoot(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('nativeShell') === '1';
  } catch {
    return false;
  }
}

export function applyNativeShellDocumentMark(): void {
  if (!isNativeShellBoot()) return;
  if (isNativeCraftIslandBoot()) return;
  try {
    document.documentElement.dataset.bndzShell = 'native';
    document.title = 'BNDZ';
  } catch {
    /* ignore */
  }
}

/** True on BNDZShell craft WebView (`nativeShell=1&pane=…`) — React islands only, no DOM list. */
export function isNativeCraftIslandBoot(): boolean {
  try {
    const sp = new URLSearchParams(window.location.search);
    return sp.get('nativeShell') === '1' && !!sp.get('pane');
  } catch {
    return false;
  }
}
