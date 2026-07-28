import type { CanvasItem } from '../spatialCanvasStore';

export type PinCluster = {
  id: string;
  label: string;
  itemIds: string[];
  cx: number;
  cy: number;
};

export type PinRelation = {
  fromId: string;
  toId: string;
  reason: 'folder' | 'tag' | 'extension';
};

export function parentFolder(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i > 0 ? p.slice(0, i).toLowerCase() : p.toLowerCase();
}

export function fileExtension(p: string): string {
  const base = p.split(/[/\\]/).pop() || '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

export function computeClusters(items: CanvasItem[], cardW = 172, cardH = 148): PinCluster[] {
  const groups = new Map<string, CanvasItem[]>();
  items.forEach(it => {
    const key = parentFolder(it.path);
    const list = groups.get(key) ?? [];
    list.push(it);
    groups.set(key, list);
  });
  const clusters: PinCluster[] = [];
  groups.forEach((group, folder) => {
    if (group.length < 2) return;
    let sx = 0;
    let sy = 0;
    group.forEach(it => { sx += it.x + cardW / 2; sy += it.y + cardH / 2; });
    const label = folder.split(/[/\\]/).pop() || folder;
    clusters.push({
      id: `cluster_${folder}`,
      label,
      itemIds: group.map(it => it.id),
      cx: sx / group.length,
      cy: sy / group.length,
    });
  });
  return clusters;
}

export function computeRelations(
  items: CanvasItem[],
  tagMap: Map<string, string[]>,
): PinRelation[] {
  const relations: PinRelation[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      const key = [a.id, b.id].sort().join('|');
      if (seen.has(key)) continue;
      const folderA = parentFolder(a.path);
      const folderB = parentFolder(b.path);
      if (folderA === folderB && folderA.length > 1) {
        relations.push({ fromId: a.id, toId: b.id, reason: 'folder' });
        seen.add(key);
        continue;
      }
      const extA = fileExtension(a.path);
      const extB = fileExtension(b.path);
      if (extA && extA === extB) {
        relations.push({ fromId: a.id, toId: b.id, reason: 'extension' });
        seen.add(key);
        continue;
      }
      const tagsA = new Set(tagMap.get(a.path) ?? []);
      const shared = (tagMap.get(b.path) ?? []).some(t => tagsA.has(t));
      if (shared) {
        relations.push({ fromId: a.id, toId: b.id, reason: 'tag' });
        seen.add(key);
      }
    }
  }
  return relations;
}

export function exportConstellationJson(doc: { name: string; items: CanvasItem[]; panX: number; panY: number; zoom: number }) {
  return JSON.stringify({
    format: 'bndz-constellation-v1',
    exportedAt: Date.now(),
    ...doc,
  }, null, 2);
}

export function parseConstellationImport(raw: string): { items: CanvasItem[]; panX?: number; panY?: number; zoom?: number } | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!Array.isArray(parsed.items)) return null;
    return {
      items: parsed.items as CanvasItem[],
      panX: typeof parsed.panX === 'number' ? parsed.panX : undefined,
      panY: typeof parsed.panY === 'number' ? parsed.panY : undefined,
      zoom: typeof parsed.zoom === 'number' ? parsed.zoom : undefined,
    };
  } catch {
    return null;
  }
}

export type SnapshotEntry = { id: string; name: string; at: number; json: string };

const SNAPSHOT_KEY = 'spatial_snapshots_v1';

export function loadSnapshots(): SnapshotEntry[] {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    return raw ? JSON.parse(raw) as SnapshotEntry[] : [];
  } catch {
    return [];
  }
}

export function saveSnapshot(name: string, json: string): SnapshotEntry[] {
  const list = loadSnapshots();
  const entry: SnapshotEntry = {
    id: `snap_${Date.now()}`,
    name,
    at: Date.now(),
    json,
  };
  const next = [entry, ...list].slice(0, 20);
  localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(next));
  return next;
}

export function snapPosition(
  x: number,
  y: number,
  grid = 24,
  enabled = true,
): { x: number; y: number } {
  if (!enabled) return { x, y };
  return {
    x: Math.round(x / grid) * grid,
    y: Math.round(y / grid) * grid,
  };
}

export function magneticOffset(
  x: number,
  y: number,
  others: Array<{ x: number; y: number }>,
  cardW: number,
  cardH: number,
  threshold = 8,
): { x: number; y: number } {
  let nx = x;
  let ny = y;
  others.forEach(o => {
    if (Math.abs(o.x - x) < threshold) nx = o.x;
    if (Math.abs(o.y - y) < threshold) ny = o.y;
    if (Math.abs(o.x + cardW - (x + cardW)) < threshold) nx = o.x;
    if (Math.abs(o.y + cardH - (y + cardH)) < threshold) ny = o.y;
  });
  return { x: nx, y: ny };
}

export function visibleItems(
  items: CanvasItem[],
  viewport: { panX: number; panY: number; zoom: number; w: number; h: number },
  cardW: number,
  cardH: number,
  margin = 120,
): CanvasItem[] {
  const { panX, panY, zoom, w, h } = viewport;
  const vx0 = (-panX - margin) / zoom;
  const vy0 = (-panY - margin) / zoom;
  const vx1 = (w - panX + margin) / zoom;
  const vy1 = (h - panY + margin) / zoom;
  return items.filter(it =>
    it.x + cardW > vx0 && it.x < vx1 && it.y + cardH > vy0 && it.y < vy1,
  );
}
