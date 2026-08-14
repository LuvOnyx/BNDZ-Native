import type { NavTreeSourceNode } from './navTreeModel';

/** Default root-level navigation tree order — Workspace Tools stays at the bottom. */
export const NAV_TREE_ORDER_DEFAULT = [
  'home',
  'libraries',
  'this-pc',
  'linux',
  'network',
  'smart-views',
  'recycle-bin',
  'workspace-tools',
] as const;

export interface NavTreeBuildNode extends NavTreeSourceNode {
  treeKey: string;
}

/** Map legacy persisted keys to current structure */
export function migrateNavTreeOrder(saved: string[] | undefined): string[] {
  if (!saved?.length) return [...NAV_TREE_ORDER_DEFAULT];
  const out: string[] = [];
  for (const k of saved) {
    let key = k;
    if (k.startsWith('cloud:')) key = 'cloud-drives';
    if (k === 'gallery') key = 'libraries';
    if (k === 'spatial-canvas' || k === 'automation') key = 'workspace-tools';
    if (!out.includes(key)) out.push(key);
  }
  const deprecated = new Set(['rapid-access', 'cloud-drives', 'spatial-canvas', 'automation']);
  const filtered = out.filter(k => !deprecated.has(k));
  // Exactly one Workspace Tools entry — keep the last occurrence (bottom preference).
  const wtIdx = filtered.lastIndexOf('workspace-tools');
  if (wtIdx >= 0) {
    for (let i = filtered.length - 1; i >= 0; i--) {
      if (filtered[i] === 'workspace-tools' && i !== wtIdx) filtered.splice(i, 1);
    }
  }
  for (const k of NAV_TREE_ORDER_DEFAULT) {
    if (!filtered.includes(k)) filtered.push(k);
  }
  return filtered;
}

export function applyNavTreeOrder(
  nodes: NavTreeBuildNode[],
  order: string[] | undefined,
): NavTreeBuildNode[] {
  const rank = new Map(migrateNavTreeOrder(order).map((k, i) => [k, i]));
  return [...nodes].sort((a, b) => {
    const ra = rank.has(a.treeKey) ? rank.get(a.treeKey)! : 9999;
    const rb = rank.has(b.treeKey) ? rank.get(b.treeKey)! : 9999;
    if (ra !== rb) return ra - rb;
    return a.label.localeCompare(b.label);
  });
}

export function reorderNavTreeKeys(
  order: string[],
  dragKey: string,
  targetKey: string,
  placeAfter: boolean,
): string[] {
  const keys = migrateNavTreeOrder(order);
  const from = keys.indexOf(dragKey);
  if (from < 0) return keys;
  keys.splice(from, 1);
  let to = keys.indexOf(targetKey);
  if (to < 0) keys.push(dragKey);
  else {
    if (placeAfter) to += 1;
    keys.splice(to, 0, dragKey);
  }
  return keys;
}

export function mergeNavTreeOrder(saved: string[] | undefined, currentKeys: string[]): string[] {
  const base = migrateNavTreeOrder(saved);
  currentKeys.forEach(k => {
    if (!base.includes(k)) base.push(k);
  });
  return base.filter(k => currentKeys.includes(k));
}
