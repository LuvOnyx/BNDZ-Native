import { IPC } from './ipcBridge';
import { flushBndzMeta, readBndzMeta, writeBndzMetaDebounced } from './bndzMetaStore';

export type CanvasItem = {
  id: string;
  path: string;
  name: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  note?: string;
};

export type SpatialCanvasDoc = {
  id: string;
  name: string;
  items: CanvasItem[];
  panX: number;
  panY: number;
  zoom: number;
  updatedAt: number;
};

const META_KEY = 'spatial_canvas_v1';

let cache: SpatialCanvasDoc | null = null;

export function defaultCanvas(): SpatialCanvasDoc {
  return {
    id: 'default',
    name: 'Project board',
    items: [],
    panX: 0,
    panY: 0,
    zoom: 1,
    updatedAt: Date.now(),
  };
}

function parseSpatialDoc(parsed: Partial<SpatialCanvasDoc>): SpatialCanvasDoc {
  const base = defaultCanvas();
  return {
    ...base,
    ...parsed,
    items: Array.isArray(parsed.items) ? parsed.items : base.items,
    panX: typeof parsed.panX === 'number' && Number.isFinite(parsed.panX) ? parsed.panX : base.panX,
    panY: typeof parsed.panY === 'number' && Number.isFinite(parsed.panY) ? parsed.panY : base.panY,
    zoom: typeof parsed.zoom === 'number' && Number.isFinite(parsed.zoom) ? parsed.zoom : base.zoom,
    updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
  };
}

/** Drop in-memory cache so the next load reads from disk / IPC. */
export function invalidateSpatialCanvasCache(): void {
  cache = null;
}

/** Keep module cache in sync after autosave / flush (avoids stale reload). */
export function hydrateSpatialCanvasFromJson(json: string): SpatialCanvasDoc | null {
  try {
    const parsed = JSON.parse(json) as Partial<SpatialCanvasDoc>;
    const doc = parseSpatialDoc(parsed);
    cache = doc;
    return doc;
  } catch {
    return null;
  }
}

export async function loadSpatialCanvas(options?: { force?: boolean }): Promise<SpatialCanvasDoc> {
  if (cache && !options?.force) return cache;
  try {
    const raw = await readBndzMeta(META_KEY);
    if (raw) {
      cache = parseSpatialDoc(JSON.parse(raw) as Partial<SpatialCanvasDoc>);
      return cache;
    }
  } catch { /* fresh board */ }
  cache = defaultCanvas();
  return cache;
}

export async function saveSpatialCanvas(doc: SpatialCanvasDoc, delayMs = 400): Promise<boolean> {
  const next = { ...doc, updatedAt: Date.now() };
  cache = next;
  if (!IPC.isNative) return true;
  await writeBndzMetaDebounced(META_KEY, JSON.stringify(next), delayMs);
  return true;
}

export async function saveSpatialCanvasNow(doc: SpatialCanvasDoc): Promise<boolean> {
  const next = { ...doc, updatedAt: Date.now() };
  cache = next;
  if (!IPC.isNative) return true;
  return flushBndzMeta(META_KEY, JSON.stringify(next));
}
