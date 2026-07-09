/**
 * Reorder helpers for drag-and-drop that commit on drop (not live on dragover).
 * Live reorder during dragover causes layout thrash and "spazzy" UI in virtualized lists.
 */

export function reorderArrayMove<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return items;
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export function reorderByKeyMove(
  order: string[],
  sourceKey: string,
  targetKey: string,
  after: boolean,
): string[] {
  const from = order.indexOf(sourceKey);
  let to = order.indexOf(targetKey);
  if (from < 0 || to < 0 || from === to) return order;
  const next = [...order];
  const [moved] = next.splice(from, 1);
  to = next.indexOf(targetKey);
  if (to < 0) return order;
  next.splice(after ? to + 1 : to, 0, moved);
  return next;
}

export function dropSideFromPointer(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  axis: 'x' | 'y' = 'y',
): 'before' | 'after' {
  if (axis === 'x') {
    return clientX - rect.left < rect.width / 2 ? 'before' : 'after';
  }
  return clientY - rect.top < rect.height / 2 ? 'before' : 'after';
}

/** Target index for splice-after-remove reorder. */
export function computeReorderInsertIndex(
  fromIndex: number,
  targetIndex: number,
  after: boolean,
): number {
  let insert = targetIndex + (after ? 1 : 0);
  if (fromIndex < insert) insert -= 1;
  return Math.max(0, Math.min(insert, Number.MAX_SAFE_INTEGER));
}
