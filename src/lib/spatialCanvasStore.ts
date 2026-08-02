import { IPC } from './ipcBridge';
import { flushBndzMeta, readBndzMeta, writeBndzMetaDebounced } from './bndzMetaStore';
import { toWindowsPath } from './pathUtils';

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

export type SpatialSticky = {
  id: string;
  text: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  color?: string; // soft paper tint hex
  tetherToId?: string; // CanvasItem.id
  rotation?: number; // slight degrees e.g. -2..3
};

export type SpatialCanvasDoc = {
  id: string;
  name: string;
  items: CanvasItem[];
  stickies: SpatialSticky[];
  panX: number;
  panY: number;
  zoom: number;
  updatedAt: number;
};

export const SPATIAL_STICKY_COLORS = ['#f5e6a8', '#c8e6d0', '#f0d0d8', '#cfe0f5'] as const;
export const SPATIAL_STICKY_W = 168;
export const SPATIAL_STICKY_H = 148;

export type SpatialBoardLibrary = {
  version: 1;
  activeBoardId: string;
  boards: SpatialCanvasDoc[];
};

const META_KEY = 'spatial_canvas_v1';
const LIBRARY_KEY = 'spatial_boards_v1';

let cache: SpatialCanvasDoc | null = null;
let libraryCache: SpatialBoardLibrary | null = null;

export function defaultCanvas(id = 'default', name = 'Project board'): SpatialCanvasDoc {
  return {
    id,
    name,
    items: [],
    stickies: [],
    panX: 0,
    panY: 0,
    zoom: 1,
    updatedAt: Date.now(),
  };
}

function parseSticky(raw: unknown): SpatialSticky | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<SpatialSticky>;
  if (typeof s.id !== 'string' || !s.id) return null;
  if (typeof s.x !== 'number' || !Number.isFinite(s.x)) return null;
  if (typeof s.y !== 'number' || !Number.isFinite(s.y)) return null;
  return {
    id: s.id,
    text: typeof s.text === 'string' ? s.text : '',
    x: s.x,
    y: s.y,
    w: typeof s.w === 'number' && Number.isFinite(s.w) ? s.w : undefined,
    h: typeof s.h === 'number' && Number.isFinite(s.h) ? s.h : undefined,
    color: typeof s.color === 'string' && s.color ? s.color : undefined,
    tetherToId: typeof s.tetherToId === 'string' && s.tetherToId ? s.tetherToId : undefined,
    rotation: typeof s.rotation === 'number' && Number.isFinite(s.rotation) ? s.rotation : undefined,
  };
}

export function createSticky(partial?: Partial<Omit<SpatialSticky, 'id'>> & { id?: string }): SpatialSticky {
  const rot = partial?.rotation ?? (Math.random() * 5 - 2);
  return {
    id: partial?.id || `sticky_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    text: typeof partial?.text === 'string' ? partial.text : '',
    x: typeof partial?.x === 'number' && Number.isFinite(partial.x) ? partial.x : 80,
    y: typeof partial?.y === 'number' && Number.isFinite(partial.y) ? partial.y : 80,
    w: partial?.w,
    h: partial?.h,
    color: partial?.color || SPATIAL_STICKY_COLORS[Math.floor(Math.random() * SPATIAL_STICKY_COLORS.length)],
    tetherToId: partial?.tetherToId,
    rotation: rot,
  };
}

function parseSpatialDoc(parsed: Partial<SpatialCanvasDoc>): SpatialCanvasDoc {
  const base = defaultCanvas(parsed.id || 'default', parsed.name || 'Project board');
  const stickies = Array.isArray(parsed.stickies)
    ? parsed.stickies.map(parseSticky).filter((s): s is SpatialSticky => Boolean(s))
    : base.stickies;
  return {
    ...base,
    ...parsed,
    id: typeof parsed.id === 'string' && parsed.id ? parsed.id : base.id,
    name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : base.name,
    items: Array.isArray(parsed.items) ? parsed.items : base.items,
    stickies,
    panX: typeof parsed.panX === 'number' && Number.isFinite(parsed.panX) ? parsed.panX : base.panX,
    panY: typeof parsed.panY === 'number' && Number.isFinite(parsed.panY) ? parsed.panY : base.panY,
    zoom: typeof parsed.zoom === 'number' && Number.isFinite(parsed.zoom) ? parsed.zoom : base.zoom,
    updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
  };
}

function defaultLibrary(): SpatialBoardLibrary {
  const board = defaultCanvas();
  return { version: 1, activeBoardId: board.id, boards: [board] };
}

function parseLibrary(raw: unknown): SpatialBoardLibrary {
  const base = defaultLibrary();
  if (!raw || typeof raw !== 'object') return base;
  const obj = raw as Partial<SpatialBoardLibrary>;
  const boards = Array.isArray(obj.boards)
    ? obj.boards.map(b => parseSpatialDoc(b)).filter(b => b.id)
    : [];
  if (!boards.length) return base;
  const activeBoardId = typeof obj.activeBoardId === 'string' && boards.some(b => b.id === obj.activeBoardId)
    ? obj.activeBoardId
    : boards[0].id;
  return { version: 1, activeBoardId, boards };
}

/** Drop in-memory cache so the next load reads from disk / IPC. */
export function invalidateSpatialCanvasCache(): void {
  cache = null;
  libraryCache = null;
}

/** Keep module cache in sync after autosave / flush (avoids stale reload). */
export function hydrateSpatialCanvasFromJson(json: string): SpatialCanvasDoc | null {
  try {
    const parsed = JSON.parse(json) as Partial<SpatialCanvasDoc>;
    const doc = parseSpatialDoc(parsed);
    cache = doc;
    if (libraryCache) {
      libraryCache = {
        ...libraryCache,
        boards: libraryCache.boards.map(b => (b.id === doc.id ? doc : b)),
        activeBoardId: doc.id,
      };
    }
    return doc;
  } catch {
    return null;
  }
}

async function loadLibrary(options?: { force?: boolean }): Promise<SpatialBoardLibrary> {
  if (libraryCache && !options?.force) return libraryCache;
  try {
    const libRaw = await readBndzMeta(LIBRARY_KEY);
    if (libRaw) {
      libraryCache = parseLibrary(JSON.parse(libRaw));
      cache = libraryCache.boards.find(b => b.id === libraryCache!.activeBoardId) || libraryCache.boards[0];
      return libraryCache;
    }
    // Migrate legacy single-board key into library.
    const legacy = await readBndzMeta(META_KEY);
    if (legacy) {
      const doc = parseSpatialDoc(JSON.parse(legacy) as Partial<SpatialCanvasDoc>);
      libraryCache = { version: 1, activeBoardId: doc.id, boards: [doc] };
      await flushBndzMeta(LIBRARY_KEY, JSON.stringify(libraryCache));
      cache = doc;
      return libraryCache;
    }
  } catch { /* fresh */ }
  libraryCache = defaultLibrary();
  cache = libraryCache.boards[0];
  return libraryCache;
}

async function persistLibrary(lib: SpatialBoardLibrary, delayMs = 400): Promise<boolean> {
  libraryCache = lib;
  const active = lib.boards.find(b => b.id === lib.activeBoardId) || lib.boards[0];
  cache = active;
  if (!IPC.isNative) return true;
  await writeBndzMetaDebounced(LIBRARY_KEY, JSON.stringify(lib), delayMs);
  // Keep legacy key in sync for older readers / exports.
  await writeBndzMetaDebounced(META_KEY, JSON.stringify(active), delayMs);
  return true;
}

export async function loadSpatialCanvas(options?: { force?: boolean }): Promise<SpatialCanvasDoc> {
  const lib = await loadLibrary(options);
  const active = lib.boards.find(b => b.id === lib.activeBoardId) || lib.boards[0];
  cache = active;
  return active;
}

export async function listSpatialBoards(): Promise<Array<{ id: string; name: string; pinCount: number; active: boolean }>> {
  const lib = await loadLibrary();
  return lib.boards.map(b => ({
    id: b.id,
    name: b.name,
    pinCount: b.items.length,
    active: b.id === lib.activeBoardId,
  }));
}

export async function switchSpatialBoard(boardId: string): Promise<SpatialCanvasDoc> {
  const lib = await loadLibrary();
  if (!lib.boards.some(b => b.id === boardId)) throw new Error('Board not found');
  const next = { ...lib, activeBoardId: boardId };
  await persistLibrary(next, 0);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('bndz-spatial-doc-changed', { detail: { switched: boardId } }));
  }
  return next.boards.find(b => b.id === boardId)!;
}

export async function createSpatialBoard(name?: string): Promise<SpatialCanvasDoc> {
  const lib = await loadLibrary();
  const board = defaultCanvas(
    `board_${Date.now().toString(36)}`,
    (name || '').trim() || `Board ${lib.boards.length + 1}`,
  );
  const next: SpatialBoardLibrary = {
    version: 1,
    activeBoardId: board.id,
    boards: [...lib.boards, board],
  };
  await persistLibrary(next, 0);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('bndz-spatial-doc-changed', { detail: { created: board.id } }));
  }
  return board;
}

export async function duplicateSpatialBoard(boardId: string): Promise<SpatialCanvasDoc> {
  const lib = await loadLibrary();
  const src = lib.boards.find(b => b.id === boardId);
  if (!src) throw new Error('Board not found');
  const copyId = `board_${Date.now().toString(36)}`;
  const copy: SpatialCanvasDoc = {
    ...JSON.parse(JSON.stringify(src)),
    id: copyId,
    name: `${src.name} copy`,
    updatedAt: Date.now(),
  };
  const next: SpatialBoardLibrary = {
    version: 1,
    activeBoardId: copy.id,
    boards: [...lib.boards, copy],
  };
  await persistLibrary(next, 0);
  cache = copy;
  libraryCache = next;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('bndz-spatial-doc-changed', { detail: { duplicated: copy.id } }));
  }
  return copy;
}

export async function renameSpatialBoard(boardId: string, name: string): Promise<SpatialCanvasDoc> {
  const lib = await loadLibrary();
  const trimmed = name.trim() || 'Untitled board';
  const next: SpatialBoardLibrary = {
    ...lib,
    boards: lib.boards.map(b => (b.id === boardId ? { ...b, name: trimmed, updatedAt: Date.now() } : b)),
  };
  await persistLibrary(next, 0);
  return next.boards.find(b => b.id === boardId)!;
}

export async function deleteSpatialBoard(boardId: string): Promise<SpatialCanvasDoc> {
  const lib = await loadLibrary();
  if (lib.boards.length <= 1) throw new Error('Cannot delete the last board');
  const boards = lib.boards.filter(b => b.id !== boardId);
  const activeBoardId = lib.activeBoardId === boardId ? boards[0].id : lib.activeBoardId;
  const next: SpatialBoardLibrary = { version: 1, activeBoardId, boards };
  await persistLibrary(next, 0);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('bndz-spatial-doc-changed', { detail: { deleted: boardId } }));
  }
  return next.boards.find(b => b.id === activeBoardId)!;
}

export async function saveSpatialCanvas(doc: SpatialCanvasDoc, delayMs = 400): Promise<boolean> {
  const nextDoc = { ...doc, updatedAt: Date.now() };
  const lib = await loadLibrary();
  const boards = lib.boards.some(b => b.id === nextDoc.id)
    ? lib.boards.map(b => (b.id === nextDoc.id ? nextDoc : b))
    : [...lib.boards, nextDoc];
  return persistLibrary({ version: 1, activeBoardId: nextDoc.id, boards }, delayMs);
}

/** Immediate persist of an empty spatial board — clears stale local cache. */
export async function resetSpatialCanvasPersisted(): Promise<SpatialCanvasDoc> {
  const empty = defaultCanvas();
  const lib: SpatialBoardLibrary = { version: 1, activeBoardId: empty.id, boards: [empty] };
  libraryCache = lib;
  cache = empty;
  try {
    localStorage.removeItem(`bndz_meta_${META_KEY}`);
    localStorage.removeItem(`bndz_meta_${LIBRARY_KEY}`);
  } catch { /* */ }
  if (IPC.isNative) {
    await flushBndzMeta(LIBRARY_KEY, JSON.stringify(lib));
    await flushBndzMeta(META_KEY, JSON.stringify(empty));
  }
  return empty;
}

export async function saveSpatialCanvasNow(doc: SpatialCanvasDoc): Promise<boolean> {
  return saveSpatialCanvas(doc, 0);
}

/** Locate a free Spatial sticky note by id across the board library. */
export async function findSpatialFreeSticky(
  stickyId: string,
): Promise<{ board: SpatialCanvasDoc; sticky: SpatialSticky } | null> {
  if (!stickyId) return null;
  const lib = await loadLibrary({ force: true });
  for (const board of lib.boards) {
    const sticky = (board.stickies ?? []).find(s => s.id === stickyId);
    if (sticky) return { board, sticky };
  }
  return null;
}

/** Update free sticky text and persist immediately. */
export async function updateSpatialFreeStickyText(stickyId: string, text: string): Promise<boolean> {
  const hit = await findSpatialFreeSticky(stickyId);
  if (!hit) return false;
  const nextStickies = (hit.board.stickies ?? []).map(s =>
    s.id === stickyId ? { ...s, text } : s,
  );
  const nextBoard: SpatialCanvasDoc = {
    ...hit.board,
    stickies: nextStickies,
    updatedAt: Date.now(),
  };
  const ok = await saveSpatialCanvasNow(nextBoard);
  if (ok && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('bndz-spatial-doc-changed', {
      detail: { stickyId, text },
    }));
  }
  return ok;
}

/** Locate a Spatial pin by id across the board library (pin caption / legacy pop-out). */
export async function findSpatialSticky(
  stickyId: string,
): Promise<{ board: SpatialCanvasDoc; item: CanvasItem } | null> {
  if (!stickyId) return null;
  const lib = await loadLibrary({ force: true });
  for (const board of lib.boards) {
    const item = board.items.find(it => it.id === stickyId);
    if (item) return { board, item };
  }
  return null;
}

/** Update a Spatial pin note and persist immediately. */
export async function updateSpatialStickyNote(stickyId: string, note: string): Promise<boolean> {
  const hit = await findSpatialSticky(stickyId);
  if (!hit) return false;
  const trimmed = note.trim();
  const nextItems = hit.board.items.map(it =>
    it.id === stickyId ? { ...it, note: trimmed || undefined } : it,
  );
  const nextBoard: SpatialCanvasDoc = {
    ...hit.board,
    items: nextItems,
    updatedAt: Date.now(),
  };
  const ok = await saveSpatialCanvasNow(nextBoard);
  if (ok && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('bndz-spatial-doc-changed', {
      detail: { stickyId, note: trimmed || undefined },
    }));
  }
  return ok;
}

const PIN_CARD_W = 228;
const PIN_CARD_H = 176;

function makeCanvasPin(path: string, x: number, y: number): CanvasItem {
  const name = path.split(/[/\\]/).pop() || path;
  return { id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, path, name, x, y };
}

/** Pin paths onto the spatial board from anywhere in the app (context menu, etc.). */
export async function pinPathsToSpatialCanvas(paths: string[]): Promise<number> {
  const normalized = [...new Set(paths.map(p => toWindowsPath(p)).filter(Boolean))];
  if (!normalized.length) return 0;
  const doc = await loadSpatialCanvas();
  const existing = new Set(doc.items.map(it => it.path));
  const toAdd = normalized.filter(p => !existing.has(p));
  if (!toAdd.length) return 0;
  const startX = 80;
  const startY = 80;
  const added = toAdd.map((path, i) => makeCanvasPin(
    path,
    startX + (i % 6) * (PIN_CARD_W + 16),
    startY + Math.floor(i / 6) * (PIN_CARD_H + 16),
  ));
  const next = { ...doc, items: [...doc.items, ...added] };
  await saveSpatialCanvasNow(next);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('bndz-spatial-doc-changed', { detail: { added: added.length } }));
  }
  return added.length;
}
