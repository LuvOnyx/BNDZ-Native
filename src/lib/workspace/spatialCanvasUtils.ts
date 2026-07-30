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

export function parseConstellationImport(raw: string): { items: CanvasItem[]; panX?: number; panY?: number; zoom?: number; name?: string } | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.format && parsed.format !== 'bndz-constellation-v1') return null;
    if (!Array.isArray(parsed.items)) return null;
    const seen = new Set<string>();
    const items = (parsed.items as CanvasItem[]).filter(it => {
      if (!it?.path || seen.has(it.path)) return false;
      seen.add(it.path);
      return true;
    });
    return {
      items,
      panX: typeof parsed.panX === 'number' ? parsed.panX : undefined,
      panY: typeof parsed.panY === 'number' ? parsed.panY : undefined,
      zoom: typeof parsed.zoom === 'number' ? parsed.zoom : undefined,
      name: typeof parsed.name === 'string' ? parsed.name : undefined,
    };
  } catch {
    return null;
  }
}

export type SnapshotEntry = { id: string; name: string; at: number; json: string; updatedAt?: number };

const SNAPSHOT_KEY = 'spatial_snapshots_v1';
const SNAPSHOT_META_KEY = 'spatial_snapshots_v1';

type SnapshotStore = { entries: SnapshotEntry[]; updatedAt: number };

function readLocalSnapshots(): SnapshotEntry[] {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    return raw ? JSON.parse(raw) as SnapshotEntry[] : [];
  } catch {
    return [];
  }
}

function writeLocalSnapshots(list: SnapshotEntry[]) {
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(list));
  } catch { /* */ }
}

/** Sync read for UI mount — local cache; native meta is merged async via hydrateSnapshotsFromMeta. */
export function loadSnapshots(): SnapshotEntry[] {
  return readLocalSnapshots();
}

export async function hydrateSnapshotsFromMeta(): Promise<SnapshotEntry[]> {
  const local = readLocalSnapshots();
  try {
    const { readBndzMeta, flushBndzMeta } = await import('../bndzMetaStore');
    const remoteRaw = await readBndzMeta(SNAPSHOT_META_KEY);
    if (!remoteRaw) {
      if (local.length) {
        const store: SnapshotStore = { entries: local, updatedAt: Date.now() };
        await flushBndzMeta(SNAPSHOT_META_KEY, JSON.stringify(store));
      }
      return local;
    }
    const parsed = JSON.parse(remoteRaw) as SnapshotStore | SnapshotEntry[];
    const remote = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.entries) ? parsed.entries : []);
    const remoteAt = !Array.isArray(parsed) && typeof parsed?.updatedAt === 'number' ? parsed.updatedAt : 0;
    const localAt = local.reduce((m, e) => Math.max(m, e.at || 0), 0);
    const preferRemote = remoteAt >= localAt && remote.length >= local.length;
    const winner = preferRemote ? remote : local;
    writeLocalSnapshots(winner);
    if (!preferRemote && local.length) {
      await flushBndzMeta(SNAPSHOT_META_KEY, JSON.stringify({ entries: local, updatedAt: Date.now() } satisfies SnapshotStore));
    }
    return winner;
  } catch {
    return local;
  }
}

async function persistSnapshots(list: SnapshotEntry[]): Promise<SnapshotEntry[]> {
  writeLocalSnapshots(list);
  try {
    const { flushBndzMeta } = await import('../bndzMetaStore');
    await flushBndzMeta(SNAPSHOT_META_KEY, JSON.stringify({ entries: list, updatedAt: Date.now() } satisfies SnapshotStore));
  } catch { /* */ }
  return list;
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
  writeLocalSnapshots(next);
  void persistSnapshots(next);
  return next;
}

export function deleteSnapshot(id: string): SnapshotEntry[] {
  const next = loadSnapshots().filter(s => s.id !== id);
  writeLocalSnapshots(next);
  void persistSnapshots(next);
  return next;
}

export function restoreSnapshotJson(id: string): string | null {
  const entry = loadSnapshots().find(s => s.id === id);
  return entry?.json ?? null;
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
