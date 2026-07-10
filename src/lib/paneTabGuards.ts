/** Safe access to the active tab on a pane — prevents crashes when tabs[] is empty. */

import type { TabState } from '../components/tabTypes';

export type PaneLike = { tabs: TabState[]; activeTabIndex?: number };

export function resolvePaneTab(pane: PaneLike | null | undefined): TabState | null {
  if (!pane?.tabs?.length) return null;
  const idx = Math.min(Math.max(0, pane.activeTabIndex ?? 0), pane.tabs.length - 1);
  return pane.tabs[idx] ?? null;
}

export function resolvePaneTabPath(pane: PaneLike | null | undefined): string | null {
  return resolvePaneTab(pane)?.path ?? null;
}
