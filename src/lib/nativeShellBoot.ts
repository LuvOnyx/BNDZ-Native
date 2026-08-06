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
  try {
    document.documentElement.dataset.bndzShell = 'native';
    document.title = 'BNDZ · Native Shell';
  } catch {
    /* ignore */
  }
}
