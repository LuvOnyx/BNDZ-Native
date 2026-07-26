import { IPC } from './ipcBridge';

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

export async function loadSpatialCanvas(): Promise<SpatialCanvasDoc> {
  if (cache) return cache;
  if (!IPC.isNative) {
    cache = defaultCanvas();
    return cache;
  }
  try {
    const raw = await IPC.getBndzMeta(META_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SpatialCanvasDoc;
      cache = { ...defaultCanvas(), ...parsed, items: parsed.items || [] };
      return cache;
    }
  } catch { /* fresh board */ }
  cache = defaultCanvas();
  return cache;
}

export async function saveSpatialCanvas(doc: SpatialCanvasDoc): Promise<void> {
  const next = { ...doc, updatedAt: Date.now() };
  cache = next;
  if (!IPC.isNative) return;
  await IPC.setBndzMeta(META_KEY, JSON.stringify(next));
}
