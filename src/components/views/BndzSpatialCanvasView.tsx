import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import WorkspaceMenuPanel, { WorkspaceMenuItem, WorkspaceMenuSep } from '../workspace/WorkspaceMenuPanel';
import SpatialStickyNote from '../workspace/SpatialStickyNote';
import SpatialSpringBoard from '../../workstation/spatial/SpatialSpringBoard';
import { readBndzFileDragData, hasBndzFileDrag } from '../../lib/bndzDrag';
import { getFileDragSession } from '../../lib/fileDragSession';
import { endInternalFileDragUi } from '../../lib/fileDragUiCleanup';
import { readClipboardText, writeClipboardText } from '../../lib/clipboardSafe';
import {
  loadSpatialCanvas, hydrateSpatialCanvasFromJson, invalidateSpatialCanvasCache,
  defaultCanvas,
  resetSpatialCanvasPersisted,
  listSpatialBoards, switchSpatialBoard, createSpatialBoard, deleteSpatialBoard, renameSpatialBoard,
  duplicateSpatialBoard,
  createSticky, SPATIAL_STICKY_COLORS, SPATIAL_STICKY_W, SPATIAL_STICKY_H,
  type CanvasItem, type SpatialCanvasDoc, type SpatialSticky,
} from '../../lib/spatialCanvasStore';
import { toWindowsPath } from '../../lib/pathUtils';
import { toPanePath } from '../../lib/shellPaths';
import { formatPathLeafName, formatUiPath, isRawShellDisplayName } from '../../lib/displayPath';
import { useAppConfig } from '../../data/configContext';
import { IPC } from '../../lib/ipcBridge';
import { useWorkspaceContextMenu } from '../workspace/useWorkspaceContextMenu';
import WorkspaceSplash, { useWorkspaceSplash, resetWorkspaceSplash } from '../workspace/WorkspaceSplash';
import WorkspaceCommandBar from '../workspace/WorkspaceCommandBar';
import SpatialInspector from '../workspace/SpatialInspector';
import ConstellationMinimap, { type ConstellationMinimapHandle } from '../workspace/ConstellationMinimap';
import WorkspaceCommandPalette, { type PaletteCommand } from '../workspace/WorkspaceCommandPalette';
import {
  computeClusters, computeRelations, exportConstellationJson, parseConstellationImport,
  saveSnapshot, snapPosition, magneticOffset, visibleItems,
  loadSnapshots, hydrateSnapshotsFromMeta, restoreSnapshotJson, deleteSnapshot, type SnapshotEntry,
} from '../../lib/workspace/spatialCanvasUtils';
import { applyMomentum } from '../../workstation/spatial/spatialPhysics';
import { setWorkspaceClipboard, getWorkspaceClipboard } from '../../lib/workspace/workspaceClipboard';
import { dispatchAutomationFromPin } from '../../lib/workspace/automationPendingSeed';
import { useSpatialIntelligence, useLineageRelations } from '../../lib/workspace/useSpatialIntelligence';
import { useWorkspaceAutosave } from '../../lib/useWorkspaceAutosave';
import { WorkspaceInteractionEngine } from '../../lib/workspace/WorkspaceInteractionEngine';
import {
  focusWorkspaceSurface, shouldHandleWorkspaceKeys,
} from '../../lib/workspace/workspaceFocus';
import {
  bindWorkspaceCursorGuard,
  clearChromeDragCursor,
  resetWorkspacePointerChrome,
} from '../../lib/workspace/workspaceCursorGuard';
import { invalidateSpatialVisual } from '../../lib/workspace/spatialVisualBus';
import { openOrRefreshContinuumBoard } from '../../lib/workspace/continuumComposeBoard';
import { createSpatialCanvasHistory } from '../../lib/workspace/spatialCanvasHistory';

const MIN_MARQUEE_PX = 4;

type Props = {
  onNavigate: (path: string) => void;
  onOpenPath?: (path: string) => void;
};

const CARD_W = 228;
const CARD_H = 176;

function newItem(path: string, x: number, y: number): CanvasItem {
  const name = formatPathLeafName(path) || path.split(/[/\\]/).pop() || path;
  return { id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, path, name, x, y };
}

/** Rewrite stored pin titles that still show raw shell: tokens. */
function sanitizePinDisplayNames(doc: SpatialCanvasDoc): SpatialCanvasDoc {
  let changed = false;
  const items = doc.items.map(it => {
    if (!isRawShellDisplayName(it.name) && it.name?.trim()) return it;
    const nextName = formatPathLeafName(it.path) || it.name;
    if (nextName === it.name) return it;
    changed = true;
    return { ...it, name: nextName };
  });
  return changed ? { ...doc, items } : doc;
}

function parentDir(p: string) {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i > 0 ? p.slice(0, i) : p;
}

function stableDocJson(doc: SpatialCanvasDoc): string {
  const { updatedAt: _u, ...rest } = doc;
  return JSON.stringify(rest);
}

function cardIntersectsMarquee(
  item: CanvasItem,
  m: { x1: number; y1: number; x2: number; y2: number },
) {
  const lx = Math.min(m.x1, m.x2);
  const ly = Math.min(m.y1, m.y2);
  const rx = Math.max(m.x1, m.x2);
  const ry = Math.max(m.y1, m.y2);
  return item.x < rx && item.x + CARD_W > lx && item.y < ry && item.y + CARD_H > ly;
}

function stickyIntersectsMarquee(
  sticky: SpatialSticky,
  m: { x1: number; y1: number; x2: number; y2: number },
) {
  const w = sticky.w ?? SPATIAL_STICKY_W;
  const h = sticky.h ?? SPATIAL_STICKY_H;
  const lx = Math.min(m.x1, m.x2);
  const ly = Math.min(m.y1, m.y2);
  const rx = Math.max(m.x1, m.x2);
  const ry = Math.max(m.y1, m.y2);
  return sticky.x < rx && sticky.x + w > lx && sticky.y < ry && sticky.y + h > ly;
}

export default function BndzSpatialCanvasView({ onNavigate, onOpenPath }: Props) {
  const { config } = useAppConfig();
  const autoSave = config.spatialCanvasAutoSave !== false;
  const saveDelayMs = typeof config.spatialCanvasAutoSaveDelayMs === 'number'
    ? Math.max(100, config.spatialCanvasAutoSaveDelayMs)
    : 400;
  const wheelZoom = config.spatialCanvasWheelZoom !== false;
  const minZoom = typeof config.spatialCanvasMinZoom === 'number' ? config.spatialCanvasMinZoom : 0.35;
  const maxZoom = typeof config.spatialCanvasMaxZoom === 'number' ? config.spatialCanvasMaxZoom : 2.5;

  const [doc, setDoc] = useState<SpatialCanvasDoc | null>(() => defaultCanvas());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const panningRef = useRef(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const [status, setStatus] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingStickyId, setEditingStickyId] = useState<string | null>(null);
  const editingNoteIdRef = useRef<string | null>(null);
  const editingStickyIdRef = useRef<string | null>(null);
  editingNoteIdRef.current = editingNoteId;
  editingStickyIdRef.current = editingStickyId;
  const [displayZoom, setDisplayZoom] = useState(1);
  const [showRelations, setShowRelations] = useState(true);
  const [showMinimap, setShowMinimap] = useState(true);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<SnapshotEntry[]>(() => loadSnapshots());
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [boardList, setBoardList] = useState<Array<{ id: string; name: string; pinCount: number; active: boolean }>>([]);
  const [showBoardPicker, setShowBoardPicker] = useState(false);
  const [pinSearch, setPinSearch] = useState('');
  const [tagMap, setTagMap] = useState<Map<string, string[]>>(new Map());
  const [boardSize, setBoardSize] = useState({ w: 800, h: 600 });
  const minimapRef = useRef<ConstellationMinimapHandle>(null);
  const zoomPillRef = useRef<HTMLButtonElement>(null);

  const marqueeRef = useRef({ active: false, additive: false, x1: 0, y1: 0, x2: 0, y2: 0 });
  const boardRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const transformLayerRef = useRef<HTMLDivElement>(null);
  const marqueeElRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<SpatialCanvasDoc | null>(null);
  const engine = useMemo(
    () => new WorkspaceInteractionEngine({ minZoom, maxZoom }),
    [minZoom, maxZoom],
  );
  const interacting = useRef(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const panSamplesRef = useRef<Array<{ x: number; y: number; t: number }>>([]);
  const panMomentumRafRef = useRef(0);
  const itemDrag = useRef({
    id: '', ox: 0, oy: 0,
    originX: 0, originY: 0,
    groupIds: [] as string[],
    starts: new Map<string, { x: number; y: number }>(),
  });
  const spacePanDown = useRef(false);
  const draggingRef = useRef<string | null>(null);
  const dragKindRef = useRef<'item' | 'sticky'>('item');
  const dragElsRef = useRef<Map<string, HTMLElement>>(new Map());
  const dragOffsetRef = useRef({ dx: 0, dy: 0 });
  const dragRafRef = useRef(0);
  /** Armed card/sticky drag waiting for MIN_MARQUEE_PX movement before committing to drag. */
  const pendingCardDragRef = useRef<{
    kind: 'item' | 'sticky';
    clientX: number;
    clientY: number;
    id: string;
    groupIds: string[];
    starts: Map<string, { x: number; y: number }>;
    originX: number;
    originY: number;
    ox: number;
    oy: number;
  } | null>(null);
  const rafRef = useRef(0);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef(createSpatialCanvasHistory());
  const { menu, closeMenu, onContextMenu } = useWorkspaceContextMenu(surfaceRef);
  const splash = useWorkspaceSplash('spatial-canvas', {
    isReady: doc !== null,
    isEmpty: Boolean(doc && doc.items.length === 0 && (doc.stickies?.length ?? 0) === 0),
    resetEmptyHintOnMount: false,
  });

  docRef.current = doc;

  const autosave = useWorkspaceAutosave(
    () => (docRef.current ? stableDocJson(docRef.current) : ''),
    async snap => {
      const parsed = JSON.parse(snap) as SpatialCanvasDoc;
      const payload: SpatialCanvasDoc = { ...parsed, updatedAt: Date.now() };
      hydrateSpatialCanvasFromJson(JSON.stringify(payload));
      const { saveSpatialCanvasNow } = await import('../../lib/spatialCanvasStore');
      return saveSpatialCanvasNow(payload);
    },
    saveDelayMs,
    autoSave,
  );

  const { schedule: scheduleSave, seed: seedAutosave, flush: flushAutosave } = autosave;

  const commitDoc = useCallback((next: SpatialCanvasDoc, save = true, recordHistory = true) => {
    const prev = docRef.current;
    const prevItems = prev?.items.length ?? 0;
    const prevStickies = prev?.stickies?.length ?? 0;
    const normalized: SpatialCanvasDoc = {
      ...next,
      stickies: Array.isArray(next.stickies) ? next.stickies : [],
    };
    if (recordHistory && save && prev && stableDocJson(prev) !== stableDocJson(normalized)) {
      historyRef.current.pushBefore(prev);
    }
    docRef.current = normalized;
    setDoc(normalized);
    engine.setTransform(normalized.panX, normalized.panY, normalized.zoom, true);
    if (!save || !autoSave) return;
    if (
      normalized.items.length !== prevItems
      || (normalized.stickies?.length ?? 0) !== prevStickies
    ) {
      scheduleSave();
      void flushAutosave(true);
      return;
    }
    scheduleSave();
  }, [engine, autoSave, scheduleSave, flushAutosave]);
  const zoomSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheelCommitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleZoomSave = useCallback(() => {
    if (zoomSaveTimer.current) clearTimeout(zoomSaveTimer.current);
    zoomSaveTimer.current = setTimeout(() => {
      zoomSaveTimer.current = null;
      scheduleSave();
    }, 400);
  }, [scheduleSave]);

  const scheduleWheelCommit = useCallback(() => {
    if (wheelCommitTimer.current) clearTimeout(wheelCommitTimer.current);
    wheelCommitTimer.current = setTimeout(() => {
      wheelCommitTimer.current = null;
      commitTransformRef.current();
    }, 120);
  }, []);

  const commitTransformRef = useRef<(save?: boolean) => void>(() => {});

  const isWorkspaceActive = useCallback(
    () => shouldHandleWorkspaceKeys(surfaceRef.current),
    [],
  );

  useEffect(() => () => engine.destroy(), [engine]);

  useEffect(() => {
    engine.bindElements(transformLayerRef.current, gridRef.current);
  }, [engine, doc]);

  useEffect(() => engine.subscribeDisplay(z => {
    setDisplayZoom(z);
    if (zoomPillRef.current) zoomPillRef.current.textContent = `${(z * 100).toFixed(0)}%`;
  }), [engine]);

  useEffect(() => {
    return engine.subscribeTransform(t => {
      minimapRef.current?.setViewport(t.panX, t.panY, t.zoom);
      invalidateSpatialVisual();
    });
  }, [engine]);

  const commitTransform = useCallback((save = true) => {
    const d = docRef.current;
    if (!d) return;
    const t = engine.getTransform();
    const next = { ...d, panX: t.panX, panY: t.panY, zoom: t.zoom };
    docRef.current = next;
    setDoc(next);
    if (save && autoSave) scheduleZoomSave();
  }, [engine, autoSave, scheduleZoomSave]);

  commitTransformRef.current = commitTransform;

  const applyLiveTransform = useCallback((panX: number, panY: number, zoom: number) => {
    engine.setTransform(panX, panY, zoom);
  }, [engine]);

  useEffect(() => {
    // Only reclaim keyboard focus when switching boards — not on every pin/sticky
    // mutation (that blurred sticky textareas mid-edit and could storm with reloads).
    focusWorkspaceSurface(surfaceRef.current);
  }, [doc?.id]);

  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const ro = new ResizeObserver(() => {
      setBoardSize({ w: board.clientWidth, h: board.clientHeight });
    });
    ro.observe(board);
    setBoardSize({ w: board.clientWidth, h: board.clientHeight });
    return () => ro.disconnect();
  }, [doc]);

  useEffect(() => {
    if (!doc?.items.length || !IPC.isNative) return;
    let active = true;
    const batchSize = 32;
    const items = doc.items;
    const run = async () => {
      const map = new Map<string, string[]>();
      for (let i = 0; i < items.length; i += batchSize) {
        if (!active) return;
        const chunk = items.slice(i, i + batchSize);
        const rows = await Promise.all(
          chunk.map(it =>
            IPC.getTagSidecar(it.path).then(sc => [it.path, sc?.tags?.filter(Boolean) ?? []] as const),
          ),
        );
        rows.forEach(([path, tags]) => map.set(path, tags));
        if (active) setTagMap(new Map(map));
      }
    };
    const ric = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
    const id = typeof ric === 'function' ? ric(() => void run(), { timeout: 3000 }) : window.setTimeout(() => void run(), 400);
    return () => {
      active = false;
      if (typeof ric === 'function') window.cancelIdleCallback?.(id as number);
      else clearTimeout(id);
    };
  }, [doc?.items, doc?.updatedAt]);

  const intelligenceMap = useSpatialIntelligence(doc?.items ?? [], IPC.isNative);
  const lineageEdges = useLineageRelations(doc?.items ?? [], intelligenceMap, showRelations && IPC.isNative);

  const clusters = useMemo(
    () => (doc ? computeClusters(doc.items, CARD_W, CARD_H) : []),
    [doc],
  );
  const baseRelations = useMemo(
    () => (doc && showRelations ? computeRelations(doc.items, tagMap) : []),
    [doc, showRelations, tagMap],
  );
  const relations = useMemo(() => {
    if (!showRelations || !lineageEdges.length || !doc) return baseRelations;
    const itemsByPath = new Map(doc.items.map(it => [it.path.toLowerCase(), it.id]));
    const existingKeys = new Set(baseRelations.map(r => [r.fromId, r.toId].sort().join('|')));
    const lineageRelations = lineageEdges
      .map(edge => {
        const fromId = itemsByPath.get(edge.fromPath.toLowerCase());
        const toId = itemsByPath.get(edge.toPath.toLowerCase());
        if (!fromId || !toId) return null;
        const key = [fromId, toId].sort().join('|');
        if (existingKeys.has(key)) return null;
        existingKeys.add(key);
        return { fromId, toId, reason: 'lineage' as const };
      })
      .filter(Boolean) as Array<{ fromId: string; toId: string; reason: 'lineage' }>;
    return [...baseRelations, ...lineageRelations];
  }, [baseRelations, lineageEdges, doc, showRelations]);

  const renderedItems = useMemo(() => {
    if (!doc) return [];
    const t = engine.getTransform();
    const q = pinSearch.trim().toLowerCase();
    const base = q
      ? doc.items.filter(it => {
          const name = (it.name || it.path || '').toLowerCase();
          const note = (it.note || '').toLowerCase();
          return name.includes(q) || note.includes(q) || (it.path || '').toLowerCase().includes(q);
        })
      : doc.items;
    return visibleItems(base, {
      panX: t.panX,
      panY: t.panY,
      zoom: t.zoom,
      w: boardSize.w,
      h: boardSize.h,
    }, CARD_W, CARD_H);
  }, [doc, boardSize, displayZoom, engine, pinSearch]);

  useEffect(() => {
    let active = true;
    void hydrateSnapshotsFromMeta().then(list => {
      if (active) setSnapshots(list);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    invalidateSpatialCanvasCache();
    Promise.all([loadSpatialCanvas({ force: true }), listSpatialBoards()]).then(([d, boards]) => {
      if (!active) return;
      const next = sanitizePinDisplayNames(d);
      docRef.current = next;
      setDoc(next);
      setBoardList(boards);
      engine.setTransform(next.panX, next.panY, next.zoom, true);
      seedAutosave(stableDocJson(next));
    }).catch((err: unknown) => {
      if (!active) return;
      console.error('[spatial] load failed', err);
      const fallback = defaultCanvas();
      docRef.current = fallback;
      setDoc(fallback);
      engine.setTransform(fallback.panX, fallback.panY, fallback.zoom, true);
      seedAutosave(stableDocJson(fallback));
      setStatus('Could not load spatial board — showing empty canvas.');
    });
    return () => { active = false; };
  }, [engine, seedAutosave]);

  const refreshBoards = useCallback(async () => {
    setBoardList(await listSpatialBoards());
  }, []);

  useEffect(() => {
    if (!showBoardPicker) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('.bndz-spatial-board-picker, [data-spatial-board-trigger]')) return;
      setShowBoardPicker(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowBoardPicker(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [showBoardPicker]);

  const switchBoard = useCallback(async (boardId: string) => {
    await flushAutosave(true);
    const d = sanitizePinDisplayNames(await switchSpatialBoard(boardId));
    historyRef.current = createSpatialCanvasHistory();
    docRef.current = d;
    setDoc(d);
    engine.setTransform(d.panX, d.panY, d.zoom, true);
    seedAutosave(stableDocJson(d));
    setSelectedIds([]);
    setShowBoardPicker(false);
    await refreshBoards();
    setStatus(`Switched to ${d.name}`);
  }, [engine, flushAutosave, seedAutosave, refreshBoards]);

  const newBoard = useCallback(async () => {
    await flushAutosave(true);
    const d = await createSpatialBoard();
    historyRef.current = createSpatialCanvasHistory();
    docRef.current = d;
    setDoc(d);
    engine.setTransform(0, 0, 1, true);
    seedAutosave(stableDocJson(d));
    setSelectedIds([]);
    setShowBoardPicker(false);
    await refreshBoards();
    setStatus(`Created ${d.name}`);
  }, [engine, flushAutosave, seedAutosave, refreshBoards]);

  const duplicateBoard = useCallback(async () => {
    try {
      await flushAutosave(true);
      const d = await duplicateSpatialBoard(docRef.current.id);
      historyRef.current = createSpatialCanvasHistory();
      docRef.current = d;
      setDoc(d);
      engine.setTransform(d.panX, d.panY, d.zoom, true);
      seedAutosave(stableDocJson(d));
      setSelectedIds([]);
      setShowBoardPicker(false);
      await refreshBoards();
      setStatus(`Duplicated → ${d.name}`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Could not duplicate board');
    }
  }, [engine, flushAutosave, seedAutosave, refreshBoards]);

  const removeBoard = useCallback(async (boardId: string) => {
    try {
      await flushAutosave(true);
      const d = await deleteSpatialBoard(boardId);
      historyRef.current = createSpatialCanvasHistory();
      docRef.current = d;
      setDoc(d);
      engine.setTransform(d.panX, d.panY, d.zoom, true);
      seedAutosave(stableDocJson(d));
      setSelectedIds([]);
      await refreshBoards();
      setStatus(`Deleted board · now on ${d.name}`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Could not delete board');
    }
  }, [engine, flushAutosave, seedAutosave, refreshBoards]);

  useLayoutEffect(() => {
    return () => {
      if (wheelCommitTimer.current) clearTimeout(wheelCommitTimer.current);
      commitTransformRef.current(true);
      void flushAutosave(true);
    };
  }, [flushAutosave]);

  const screenToBoard = useCallback((clientX: number, clientY: number) => {
    const el = boardRef.current;
    if (!el) return { x: 0, y: 0 };
    return engine.screenToWorld(clientX, clientY, el.getBoundingClientRect());
  }, [engine]);

  const zoomAtPoint = useCallback((clientX: number, clientY: number, factor: number) => {
    const el = boardRef.current;
    if (!el) return;
    engine.zoomAtCursor(clientX, clientY, el.getBoundingClientRect(), factor);
    scheduleWheelCommit();
  }, [engine, scheduleWheelCommit]);

  const zoomBy = useCallback((factor: number) => {
    const el = boardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    zoomAtPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  }, [zoomAtPoint]);

  // Native listener (passive:false) — must re-bind when board mounts after async doc load.
  useEffect(() => {
    const el = boardRef.current;
    if (!el || !wheelZoom || !doc) return;
    const onWheel = (e: WheelEvent) => {
      if (!docRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.ctrlKey || e.metaKey) {
        const delta = e.deltaY > 0 ? 0.9 : 1.11;
        zoomAtPoint(e.clientX, e.clientY, delta);
        return;
      }
      const dx = e.shiftKey ? -e.deltaY : 0;
      const dy = e.shiftKey ? 0 : -e.deltaY;
      engine.panBy(dx, dy);
      scheduleWheelCommit();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [doc, wheelZoom, zoomAtPoint, engine, scheduleWheelCommit]);

  const mutateTags = useCallback(async (path: string, mutate: (tags: string[]) => string[]) => {
    if (!IPC.isNative) return;
    const sc = await IPC.getTagSidecar(path);
    const next = mutate([...(sc?.tags?.filter(Boolean) ?? [])]);
    await IPC.setTagMeta(path, sc?.label, sc?.comment, next);
    setStatus('Tags updated');
  }, []);

  const addTagToPath = useCallback((path: string, tag: string) => {
    void mutateTags(path, tags => (tags.includes(tag) ? tags : [...tags, tag]));
  }, [mutateTags]);

  const batchAddTags = useCallback((paths: string[], tag: string) => {
    void Promise.all(paths.map(p => mutateTags(p, tags => (tags.includes(tag) ? tags : [...tags, tag]))))
      .then(() => setStatus(`Tagged ${paths.length} pin${paths.length === 1 ? '' : 's'}`));
  }, [mutateTags]);

  const removeTagFromPath = useCallback((path: string, tag: string) => {
    void mutateTags(path, tags => tags.filter(t => t !== tag));
  }, [mutateTags]);

  const addPaths = useCallback((paths: string[], at?: { x: number; y: number }) => {
    const d = docRef.current;
    if (!d || !paths.length) return;
    const board = boardRef.current;
    const base = at || (board
      ? screenToBoard(
          board.clientWidth / 2 + board.getBoundingClientRect().left,
          board.clientHeight / 2 + board.getBoundingClientRect().top,
        )
      : { x: 0, y: 0 });
    const items = [...d.items];
    let added = 0;
    paths.forEach((p, i) => {
      const win = toWindowsPath(p);
      if (items.some(it => it.path.toLowerCase() === win.toLowerCase())) return;
      items.push(newItem(win, base.x + (i % 4) * (CARD_W + 16), base.y + Math.floor(i / 4) * (CARD_H + 16)));
      added++;
    });
    if (added) {
      commitDoc({ ...d, items });
      setStatus(`Added ${added} reference${added === 1 ? '' : 's'}`);
    }
  }, [commitDoc, screenToBoard]);

  const hitBoardAt = useCallback((clientX: number, clientY: number) => {
    const board = boardRef.current;
    if (!board) return false;
    const rect = board.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  }, []);

  const resolveDropPoint = useCallback((clientX: number, clientY: number) => {
    if (hitBoardAt(clientX, clientY)) return screenToBoard(clientX, clientY);
    const board = boardRef.current;
    if (!board) return screenToBoard(clientX, clientY);
    const rect = board.getBoundingClientRect();
    return screenToBoard(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }, [hitBoardAt, screenToBoard]);

  const fitBoard = useCallback(() => {
    const d = docRef.current;
    const stickies = d?.stickies ?? [];
    if (!d || (!d.items.length && !stickies.length) || !boardRef.current) {
      if (d) {
        // Empty board: true identity at world origin (no content to frame).
        commitDoc({ ...d, panX: 0, panY: 0, zoom: 1 });
      }
      return;
    }
    const rect = boardRef.current.getBoundingClientRect();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    d.items.forEach(it => {
      minX = Math.min(minX, it.x);
      minY = Math.min(minY, it.y);
      maxX = Math.max(maxX, it.x + CARD_W);
      maxY = Math.max(maxY, it.y + CARD_H);
    });
    stickies.forEach(s => {
      const w = s.w ?? SPATIAL_STICKY_W;
      const h = s.h ?? SPATIAL_STICKY_H;
      minX = Math.min(minX, s.x);
      minY = Math.min(minY, s.y);
      maxX = Math.max(maxX, s.x + w);
      maxY = Math.max(maxY, s.y + h);
    });
    const pad = 48;
    const contentW = Math.max(1, maxX - minX);
    const contentH = Math.max(1, maxY - minY);
    const bw = contentW + pad * 2;
    const bh = contentH + pad * 2;
    const zoom = Math.min(maxZoom, Math.max(minZoom, Math.min(rect.width / bw, rect.height / bh)));
    // Center the content bounding box in the viewport (world ↔ screen via pan + scale).
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const panX = rect.width / 2 - cx * zoom;
    const panY = rect.height / 2 - cy * zoom;
    commitDoc({ ...d, panX, panY, zoom });
    setStatus('Fitted to board');
    closeMenu();
  }, [commitDoc, minZoom, maxZoom, closeMenu]);

  useEffect(() => {
    const onExternalDrop = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const paths = (detail.paths as string[] | undefined)?.filter(Boolean);
      if (!paths?.length) return;
      const clientX = typeof detail.webViewX === 'number' ? detail.webViewX : window.innerWidth / 2;
      const clientY = typeof detail.webViewY === 'number' ? detail.webViewY : window.innerHeight / 2;
      if (!hitBoardAt(clientX, clientY)) return;
      const wasEmpty = !docRef.current?.items.length && !(docRef.current?.stickies?.length);
      addPaths(paths, resolveDropPoint(clientX, clientY));
      // Fit board into view when items land on an otherwise-empty canvas so the
      // user can see them immediately (OLE coords may place cards off-screen if
      // the canvas pan/zoom was at an unexpected position before the drop).
      if (wasEmpty) requestAnimationFrame(() => fitBoard());
    };
    const onSpatialAdd = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const paths = (detail.paths as string[] | undefined)?.filter(Boolean);
      if (!paths?.length) return;
      const clientX = typeof detail.clientX === 'number' ? detail.clientX : window.innerWidth / 2;
      const clientY = typeof detail.clientY === 'number' ? detail.clientY : window.innerHeight / 2;
      addPaths(paths, resolveDropPoint(clientX, clientY));
    };
    const onPointerUp = (ev: PointerEvent) => {
      const session = getFileDragSession();
      if (!session?.paths?.length) return;
      if (!hitBoardAt(ev.clientX, ev.clientY)) return;
      addPaths(session.paths, resolveDropPoint(ev.clientX, ev.clientY));
      // Board stopPropagation blocks BNDZUI bubble cleanup — tear down ghost/fluid here.
      endInternalFileDragUi('spatial-pin');
    };
    window.addEventListener('bndz-external-drop', onExternalDrop);
    window.addEventListener('bndz-spatial-add', onSpatialAdd);
    window.addEventListener('pointerup', onPointerUp, true);
    return () => {
      window.removeEventListener('bndz-external-drop', onExternalDrop);
      window.removeEventListener('bndz-spatial-add', onSpatialAdd);
      window.removeEventListener('pointerup', onPointerUp, true);
    };
  }, [addPaths, hitBoardAt, resolveDropPoint, fitBoard]);

  const removeItems = useCallback((ids: string[]) => {
    const d = docRef.current;
    if (!d || !ids.length) return;
    const drop = new Set(ids);
    const nextItems = d.items.filter(it => !drop.has(it.id));
    const nextStickies = (d.stickies ?? []).filter(s => !drop.has(s.id)).map(s => (
      s.tetherToId && drop.has(s.tetherToId) ? { ...s, tetherToId: undefined } : s
    ));
    const removedPins = d.items.length - nextItems.length;
    const removedStickies = (d.stickies ?? []).length - nextStickies.length;
    if (!removedPins && !removedStickies) return;
    commitDoc({ ...d, items: nextItems, stickies: nextStickies });
    setSelectedIds(prev => prev.filter(id => !drop.has(id)));
    const parts: string[] = [];
    if (removedPins) parts.push(`${removedPins} card${removedPins === 1 ? '' : 's'}`);
    if (removedStickies) parts.push(`${removedStickies} sticky${removedStickies === 1 ? '' : 'ies'}`);
    setStatus(`Removed ${parts.join(' · ')}`);
    closeMenu();
  }, [commitDoc, closeMenu]);

  const removeItem = useCallback((id: string) => removeItems([id]), [removeItems]);
  const removeSelected = useCallback(() => { if (selectedIds.length) removeItems(selectedIds); }, [selectedIds, removeItems]);

  const clearBoard = useCallback(() => {
    const d = docRef.current;
    if (!d) return;
    const empty = { ...d, items: [], stickies: [], panX: 0, panY: 0, zoom: 1, updatedAt: Date.now() };
    docRef.current = empty;
    setDoc(empty);
    setSelectedIds([]);
    setEditingNoteId(null);
    setEditingStickyId(null);
    engine.setTransform(0, 0, 1, true);
    setStatus('Board cleared');
    resetWorkspaceSplash('spatial-canvas');
    splash.replay();
    void resetSpatialCanvasPersisted();
    void flushAutosave(true);
    closeMenu();
  }, [engine, splash, flushAutosave, closeMenu]);

  const openItem = useCallback((item: CanvasItem) => {
    if (onOpenPath) onOpenPath(item.path);
    else onNavigate(toPanePath(item.path));
    closeMenu();
  }, [onOpenPath, onNavigate, closeMenu]);

  const revealItem = useCallback((item: CanvasItem) => {
    if (IPC.isNative) void IPC.shellExecute('openExplorer', parentDir(item.path));
    closeMenu();
  }, [closeMenu]);

  const copyPath = useCallback((item: CanvasItem) => {
    void writeClipboardText(item.path).then(ok => {
      setStatus(ok ? 'Path copied' : 'Could not copy path');
    });
    closeMenu();
  }, [closeMenu]);

  const updateNote = useCallback((id: string, note: string) => {
    const d = docRef.current;
    if (!d) return;
    commitDoc({
      ...d,
      items: d.items.map(it => it.id === id ? { ...it, note: note.trim() || undefined } : it),
    });
  }, [commitDoc]);

  const addStickyNote = useCallback((at?: { x: number; y: number }, opts?: { tetherToId?: string; startEdit?: boolean }) => {
    const d = docRef.current;
    if (!d) return;
    const t = engine.getTransform();
    const fallback = {
      x: (-t.panX + boardSize.w / 2) / t.zoom - SPATIAL_STICKY_W / 2,
      y: (-t.panY + boardSize.h / 2) / t.zoom - SPATIAL_STICKY_H / 2,
    };
    const sticky = createSticky({
      x: at?.x ?? fallback.x,
      y: at?.y ?? fallback.y,
      tetherToId: opts?.tetherToId,
    });
    commitDoc({ ...d, stickies: [...(d.stickies ?? []), sticky] });
    setSelectedIds([sticky.id]);
    if (opts?.startEdit !== false) setEditingStickyId(sticky.id);
    setStatus('Sticky note added');
    closeMenu();
    return sticky;
  }, [commitDoc, engine, boardSize, closeMenu]);

  const updateStickyText = useCallback((id: string, text: string) => {
    const d = docRef.current;
    if (!d) return;
    const prev = (d.stickies ?? []).find(s => s.id === id);
    if (prev && prev.text === text) {
      setEditingStickyId(null);
      return;
    }
    commitDoc({
      ...d,
      stickies: (d.stickies ?? []).map(s => (s.id === id ? { ...s, text } : s)),
    });
    setEditingStickyId(null);
  }, [commitDoc]);

  const setStickyColor = useCallback((id: string, color: string) => {
    const d = docRef.current;
    if (!d) return;
    commitDoc({
      ...d,
      stickies: (d.stickies ?? []).map(s => (s.id === id ? { ...s, color } : s)),
    });
    closeMenu();
  }, [commitDoc, closeMenu]);

  const tetherSticky = useCallback((stickyId: string, pinId: string | undefined) => {
    const d = docRef.current;
    if (!d) return;
    commitDoc({
      ...d,
      stickies: (d.stickies ?? []).map(s => (
        s.id === stickyId ? { ...s, tetherToId: pinId || undefined } : s
      )),
    });
    setStatus(pinId ? 'Sticky tethered to pin' : 'Sticky untethered');
    closeMenu();
  }, [commitDoc, closeMenu]);

  const addStickyBesidePin = useCallback((pin: CanvasItem) => {
    addStickyNote(
      { x: pin.x + CARD_W + 20, y: pin.y + 8 },
      { tetherToId: pin.id, startEdit: true },
    );
  }, [addStickyNote]);

  const openContinuumBoard = useCallback(async () => {
    await flushAutosave(true);
    const d = await openOrRefreshContinuumBoard();
    historyRef.current = createSpatialCanvasHistory();
    docRef.current = d;
    setDoc(d);
    engine.setTransform(d.panX, d.panY, d.zoom, true);
    seedAutosave(stableDocJson(d));
    setSelectedIds([]);
    setShowBoardPicker(false);
    await refreshBoards();
    requestAnimationFrame(() => fitBoard());
    setStatus('Continuum board live — Sandbox · Health · Inbound · RAM · Capacity · Automation');
  }, [engine, flushAutosave, seedAutosave, refreshBoards, fitBoard]);

  useEffect(() => {
    const onOpen = () => { void openContinuumBoard(); };
    window.addEventListener('bndz-open-continuum', onOpen);
    return () => window.removeEventListener('bndz-open-continuum', onOpen);
  }, [openContinuumBoard]);

  /** Zoom = 100% while keeping the current world point under the board center. */
  const resetZoomPreserveCenter = useCallback(() => {
    const d = docRef.current;
    const el = boardRef.current;
    if (!d || !el) return;
    const t = engine.getTransform();
    const vw = el.clientWidth;
    const vh = el.clientHeight;
    const worldX = (-t.panX + vw / 2) / t.zoom;
    const worldY = (-t.panY + vh / 2) / t.zoom;
    const zoom = 1;
    const panX = vw / 2 - worldX * zoom;
    const panY = vh / 2 - worldY * zoom;
    commitDoc({ ...d, panX, panY, zoom });
    setStatus('Zoom reset to 100%');
    closeMenu();
  }, [commitDoc, engine, closeMenu]);

  const arrangeGrid = useCallback(() => {
    const d = docRef.current;
    if (!d) return;
    const stickies = d.stickies ?? [];
    if (!d.items.length && !stickies.length) return;
    const total = d.items.length + stickies.length;
    const cols = Math.ceil(Math.sqrt(total));
    const gap = 20;
    const items = d.items.map((it, i) => ({
      ...it,
      x: 40 + (i % cols) * (CARD_W + gap),
      y: 40 + Math.floor(i / cols) * (CARD_H + gap),
    }));
    const offset = d.items.length;
    const nextStickies = stickies.map((s, i) => {
      const idx = offset + i;
      return {
        ...s,
        x: 40 + (idx % cols) * (CARD_W + gap),
        y: 40 + Math.floor(idx / cols) * (CARD_H + gap),
      };
    });
    commitDoc({ ...d, items, stickies: nextStickies });
    fitBoard();
    setStatus('Arranged in grid');
    closeMenu();
  }, [commitDoc, fitBoard, closeMenu]);

  const exportBoard = useCallback(() => {
    const d = docRef.current;
    if (!d) return;
    const json = exportConstellationJson(d);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${d.name || 'constellation'}.bndz-constellation.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus('Exported constellation');
  }, []);

  const importBoard = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.bndz-constellation.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const parsed = parseConstellationImport(String(reader.result));
        const d = docRef.current;
        if (!parsed || !d) return;
        commitDoc({
          ...d,
          items: [...d.items, ...parsed.items.map(it => ({ ...it, id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }))],
          stickies: [
            ...(d.stickies ?? []),
            ...(parsed.stickies ?? []).map(s => ({
              ...s,
              id: `sticky_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
            })),
          ],
          panX: parsed.panX ?? d.panX,
          panY: parsed.panY ?? d.panY,
          zoom: parsed.zoom ?? d.zoom,
        });
        const stickyCount = parsed.stickies?.length ?? 0;
        setStatus(
          `Imported ${parsed.items.length} pin${parsed.items.length === 1 ? '' : 's'}`
          + (stickyCount ? ` · ${stickyCount} sticky${stickyCount === 1 ? '' : 'ies'}` : ''),
        );
      };
      reader.readAsText(file);
    };
    input.click();
  }, [commitDoc]);

  const snapshotBoard = useCallback(() => {
    const d = docRef.current;
    if (!d) return;
    const json = exportConstellationJson(d);
    setSnapshots(saveSnapshot(d.name || 'Snapshot', json));
    setStatus('Snapshot saved');
    setShowSnapshots(true);
  }, []);

  const restoreSnapshot = useCallback((id: string) => {
    const json = restoreSnapshotJson(id);
    if (!json) return;
    const parsed = parseConstellationImport(json);
    const d = docRef.current;
    if (!parsed || !d) return;
    commitDoc({
      ...d,
      name: parsed.name ?? d.name,
      items: parsed.items.map(it => ({ ...it, id: it.id || `${Date.now()}_${Math.random().toString(36).slice(2, 6)}` })),
      panX: parsed.panX ?? d.panX,
      panY: parsed.panY ?? d.panY,
      zoom: parsed.zoom ?? d.zoom,
    });
    setStatus('Snapshot restored');
  }, [commitDoc]);

  const focusCluster = useCallback((clusterId: string) => {
    const c = clusters.find(cl => cl.id === clusterId);
    const d = docRef.current;
    const el = boardRef.current;
    if (!c || !d || !el) return;
    setSelectedIds(c.itemIds);
    const zoom = Math.min(maxZoom, Math.max(minZoom, 1.1));
    const px = el.clientWidth / 2 - c.cx * zoom;
    const py = el.clientHeight / 2 - c.cy * zoom;
    engine.setTransform(px, py, zoom, true);
    commitTransform();
    setStatus(`Focused cluster: ${c.label}`);
  }, [clusters, engine, minZoom, maxZoom, commitTransform]);

  const pastePins = useCallback((paths?: string[]) => {
    const clipPaths = paths ?? (() => {
      const clip = getWorkspaceClipboard();
      return clip?.kind === 'spatial-pins' ? clip.paths : [];
    })();
    if (!clipPaths.length) return;
    const d = docRef.current;
    if (!d) return;
    const existing = new Set(d.items.map(it => it.path));
    const t = engine.getTransform();
    const cx = (-t.panX + boardSize.w / 2) / t.zoom;
    const cy = (-t.panY + boardSize.h / 2) / t.zoom;
    const added = clipPaths
      .filter(p => p && !existing.has(p))
      .map((path, i) => newItem(path, cx + (i % 4) * (CARD_W + 16), cy + Math.floor(i / 4) * (CARD_H + 16)));
    if (!added.length) return;
    commitDoc({ ...d, items: [...d.items, ...added] });
    setSelectedIds(added.map(it => it.id));
    setStatus(`Pasted ${added.length} pin${added.length === 1 ? '' : 's'}`);
  }, [engine, boardSize, commitDoc]);

  const copySelectedPaths = useCallback(() => {
    const d = docRef.current;
    if (!d) return;
    const paths = d.items.filter(it => selectedSet.has(it.id)).map(it => it.path);
    if (!paths.length) return;
    setWorkspaceClipboard({ kind: 'spatial-pins', paths });
    void writeClipboardText(paths.join('\n'));
    setStatus(`Copied ${paths.length} path${paths.length === 1 ? '' : 's'}`);
  }, [selectedSet]);

  const cutSelectedPins = useCallback(() => {
    if (!selectedIds.length) return;
    copySelectedPaths();
    removeItems(selectedIds);
    setStatus(`Cut ${selectedIds.length} pin${selectedIds.length === 1 ? '' : 's'}`);
  }, [selectedIds, copySelectedPaths, removeItems]);

  const duplicateSelectedPins = useCallback(() => {
    const d = docRef.current;
    if (!d || !selectedIds.length) return;
    const sel = new Set(selectedIds);
    const clones = d.items
      .filter(it => sel.has(it.id))
      .map((it, i) => newItem(it.path, it.x + 24 + (i % 3) * 12, it.y + 24 + Math.floor(i / 3) * 12));
    if (!clones.length) return;
    commitDoc({ ...d, items: [...d.items, ...clones] });
    setSelectedIds(clones.map(it => it.id));
    setStatus(`Duplicated ${clones.length} pin${clones.length === 1 ? '' : 's'}`);
  }, [selectedIds, commitDoc]);

  const nudgeSelectedPins = useCallback((dx: number, dy: number) => {
    const d = docRef.current;
    if (!d || !selectedIds.length) return;
    const sel = new Set(selectedIds);
    const items = d.items.map(it => {
      if (!sel.has(it.id)) return it;
      const snapped = snapPosition(it.x + dx, it.y + dy, 24, snapEnabled);
      return { ...it, x: snapped.x, y: snapped.y };
    });
    const stickies = (d.stickies ?? []).map(s => {
      if (!sel.has(s.id)) return s;
      const snapped = snapPosition(s.x + dx, s.y + dy, 24, snapEnabled);
      return { ...s, x: snapped.x, y: snapped.y };
    });
    commitDoc({ ...d, items, stickies });
  }, [selectedIds, commitDoc, snapEnabled]);

  const fitSelection = useCallback(() => {
    const d = docRef.current;
    if (!d || !selectedIds.length || !boardRef.current) return;
    const sel = new Set(selectedIds);
    const picked = d.items.filter(it => sel.has(it.id));
    if (!picked.length) return;
    const rect = boardRef.current.getBoundingClientRect();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    picked.forEach(it => {
      minX = Math.min(minX, it.x);
      minY = Math.min(minY, it.y);
      maxX = Math.max(maxX, it.x + CARD_W);
      maxY = Math.max(maxY, it.y + CARD_H);
    });
    const pad = 56;
    const contentW = Math.max(1, maxX - minX);
    const contentH = Math.max(1, maxY - minY);
    const bw = contentW + pad * 2;
    const bh = contentH + pad * 2;
    const zoom = Math.min(maxZoom, Math.max(minZoom, Math.min(rect.width / bw, rect.height / bh)));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const panX = rect.width / 2 - cx * zoom;
    const panY = rect.height / 2 - cy * zoom;
    commitDoc({ ...d, panX, panY, zoom });
    setStatus(`Framed ${picked.length} selected pin${picked.length === 1 ? '' : 's'}`);
  }, [selectedIds, commitDoc, minZoom, maxZoom]);

  const sendSelectionToAutomation = useCallback(() => {
    const d = docRef.current;
    if (!d) return;
    const paths = d.items.filter(it => selectedSet.has(it.id)).map(it => it.path);
    if (!paths.length) return;
    setWorkspaceClipboard({ kind: 'spatial-pins', paths });
    dispatchAutomationFromPin(paths, { navigate: true });
    setStatus(`Sent ${paths.length} pin${paths.length === 1 ? '' : 's'} to automation`);
  }, [selectedSet]);

  const undoDoc = useCallback(() => {
    const d = docRef.current;
    if (!d) return;
    const prev = historyRef.current.undo(d);
    if (!prev) return;
    commitDoc(prev, true, false);
    setSelectedIds([]);
    setStatus('Undo');
  }, [commitDoc]);

  const redoDoc = useCallback(() => {
    const d = docRef.current;
    if (!d) return;
    const next = historyRef.current.redo(d);
    if (!next) return;
    commitDoc(next, true, false);
    setSelectedIds([]);
    setStatus('Redo');
  }, [commitDoc]);

  const paletteCommands = useMemo<PaletteCommand[]>(() => [
    { id: 'zin', label: 'Zoom in', group: 'View', shortcut: 'Ctrl++', onRun: () => zoomBy(1.15) },
    { id: 'zout', label: 'Zoom out', group: 'View', shortcut: 'Ctrl+-', onRun: () => zoomBy(0.87) },
    { id: 'fit', label: 'Fit all pins', group: 'View', onRun: fitBoard },
    { id: 'reset-zoom', label: 'Reset zoom (100%)', group: 'View', onRun: resetZoomPreserveCenter },
    { id: 'fit-sel', label: 'Frame selection', group: 'View', shortcut: 'Ctrl+Shift+F', onRun: fitSelection },
    { id: 'grid', label: 'Arrange grid', group: 'Layout', onRun: arrangeGrid },
    { id: 'sticky', label: 'Add sticky note', group: 'Edit', onRun: () => addStickyNote() },
    { id: 'relations', label: showRelations ? 'Hide relation lines' : 'Show relation lines', group: 'View', onRun: () => setShowRelations(v => !v) },
    { id: 'snap', label: snapEnabled ? 'Disable snap' : 'Enable snap', group: 'Layout', onRun: () => setSnapEnabled(v => !v) },
    { id: 'export', label: 'Export constellation', group: 'File', onRun: exportBoard },
    { id: 'import', label: 'Import constellation', group: 'File', onRun: importBoard },
    { id: 'snapshot', label: 'Save snapshot', group: 'File', onRun: snapshotBoard },
    { id: 'snapshots', label: 'Snapshot history', group: 'File', onRun: () => { setSnapshots(loadSnapshots()); setShowSnapshots(true); } },
    { id: 'undo', label: 'Undo', group: 'Edit', shortcut: 'Ctrl+Z', onRun: undoDoc },
    { id: 'redo', label: 'Redo', group: 'Edit', shortcut: 'Ctrl+Shift+Z', onRun: redoDoc },
    { id: 'cut', label: 'Cut selected pins', group: 'Edit', shortcut: 'Ctrl+X', onRun: cutSelectedPins },
    { id: 'dup', label: 'Duplicate selected pins', group: 'Edit', shortcut: 'Ctrl+D', onRun: duplicateSelectedPins },
    { id: 'paste', label: 'Paste pins', group: 'Edit', shortcut: 'Ctrl+V', onRun: () => pastePins() },
    { id: 'copy', label: 'Copy selected paths', group: 'Edit', shortcut: 'Ctrl+C', onRun: copySelectedPaths },
    { id: 'automation', label: 'Send selection to automation', group: 'Workflow', shortcut: 'Ctrl+Shift+A', onRun: sendSelectionToAutomation },
  ], [zoomBy, fitBoard, resetZoomPreserveCenter, fitSelection, arrangeGrid, addStickyNote, showRelations, snapEnabled, exportBoard, importBoard, snapshotBoard, undoDoc, redoDoc, cutSelectedPins, duplicateSelectedPins, pastePins, copySelectedPaths, sendSelectionToAutomation]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (!isWorkspaceActive()) return;

      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }

      if (e.key === ' ' && !spacePanDown.current) {
        spacePanDown.current = true;
        e.preventDefault();
      }

      const d = docRef.current;
      if (!d) return;

      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        zoomBy(1.12);
      } else if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        zoomBy(0.89);
      } else if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        engine.setTransform(0, 0, 1, true);
        commitTransform();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!selectedIds.length) return;
        e.preventDefault();
        removeSelected();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelectedIds([
          ...d.items.map(it => it.id),
          ...(d.stickies ?? []).map(s => s.id),
        ]);
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undoDoc();
      } else if ((e.ctrlKey || e.metaKey) && (e.shiftKey && e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
        e.preventDefault();
        redoDoc();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
        if (!selectedIds.length) return;
        e.preventDefault();
        cutSelectedPins();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        if (!selectedIds.length) return;
        e.preventDefault();
        duplicateSelectedPins();
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        sendSelectionToAutomation();
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        fitSelection();
      } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && selectedIds.length) {
        e.preventDefault();
        const step = e.shiftKey ? 1 : 24;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        nudgeSelectedPins(dx, dy);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        if (!selectedIds.length) return;
        e.preventDefault();
        copySelectedPaths();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        const clip = getWorkspaceClipboard();
        if (clip?.kind === 'spatial-pins' && clip.paths.length) {
          pastePins(clip.paths);
          return;
        }
        void readClipboardText().then(text => {
          const paths = text.split(/\r?\n/).map(s => s.trim()).filter(p => p.length > 2);
          if (!paths.length) return;
          setWorkspaceClipboard({ kind: 'spatial-pins', paths });
          pastePins(paths);
        });
      } else if (e.key === 'Escape' && selectedIds.length) {
        e.preventDefault();
        setSelectedIds([]);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') spacePanDown.current = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [selectedIds, removeSelected, zoomBy, commitTransform, isWorkspaceActive, engine, pastePins, copySelectedPaths, undoDoc, redoDoc, cutSelectedPins, duplicateSelectedPins, nudgeSelectedPins, fitSelection, sendSelectionToAutomation]);

  useEffect(() => {
    let cancelled = false;
    let reloadGen = 0;
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;

    const busyEditing = () =>
      !!editingStickyIdRef.current
      || !!editingNoteIdRef.current
      || interacting.current
      || !!draggingRef.current;

    const adoptExternalDoc = (next: SpatialCanvasDoc, opts?: { fit?: boolean }) => {
      if (cancelled || busyEditing()) return;
      const sanitized = sanitizePinDisplayNames(next);
      // Preserve live camera if the external writer didn't change transforms —
      // unless caller asked to fit (context-menu pin / intro CTAs).
      const cur = docRef.current;
      const merged = cur && sanitized.id === cur.id && !opts?.fit
        ? { ...sanitized, panX: cur.panX, panY: cur.panY, zoom: cur.zoom }
        : sanitized;
      docRef.current = merged;
      setDoc(merged);
      invalidateSpatialVisual();
      if (opts?.fit) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => fitBoard());
        });
      }
    };

    const scheduleReload = (opts?: { fit?: boolean }) => {
      if (busyEditing()) return;
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        reloadTimer = null;
        if (cancelled || busyEditing()) return;
        const gen = ++reloadGen;
        void loadSpatialCanvas({ force: true }).then(next => {
          if (cancelled || gen !== reloadGen || busyEditing()) return;
          adoptExternalDoc(next, opts);
        });
      }, 200);
    };

    const onDocChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const stickyId = typeof detail.stickyId === 'string' ? detail.stickyId : '';
      const cur = docRef.current;
      if (cur && stickyId) {
        // Pop-out sticky widget — merge text/note without a full board reload (avoids freeze loops).
        if (typeof detail.text === 'string') {
          if (editingStickyIdRef.current === stickyId) return;
          const stickies = (cur.stickies ?? []).map(s => (
            s.id === stickyId ? { ...s, text: detail.text as string } : s
          ));
          const next = { ...cur, stickies };
          docRef.current = next;
          setDoc(next);
          return;
        }
        if ('note' in detail) {
          if (editingNoteIdRef.current === stickyId) return;
          const note = typeof detail.note === 'string' ? detail.note : undefined;
          const items = cur.items.map(it => (
            it.id === stickyId ? { ...it, note: note || undefined } : it
          ));
          const next = { ...cur, items };
          docRef.current = next;
          setDoc(next);
          return;
        }
      }
      scheduleReload({ fit: !!detail.fit || !!detail.added });
    };

    // Do NOT listen to window `focus` — clicking a sticky/textarea fires it in WebView2
    // and force-reloading the board while editing caused full app freezes.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') scheduleReload();
    };

    window.addEventListener('bndz-spatial-doc-changed', onDocChanged);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      if (reloadTimer) clearTimeout(reloadTimer);
      window.removeEventListener('bndz-spatial-doc-changed', onDocChanged);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fitBoard]);

  const updateMarqueeDom = useCallback((m: { x1: number; y1: number; x2: number; y2: number }) => {
    const el = marqueeElRef.current;
    if (!el) return;
    if (!marqueeRef.current.active) {
      el.style.display = 'none';
      return;
    }
    const w = Math.abs(m.x2 - m.x1);
    const h = Math.abs(m.y2 - m.y1);
    if (w < MIN_MARQUEE_PX && h < MIN_MARQUEE_PX) {
      el.style.display = 'none';
      return;
    }
    const t = engine.getTransform();
    const lx = Math.min(m.x1, m.x2);
    const ly = Math.min(m.y1, m.y2);
    const rx = Math.max(m.x1, m.x2);
    const ry = Math.max(m.y1, m.y2);
    el.style.display = 'block';
    el.classList.toggle('is-additive', !!marqueeRef.current.additive);
    el.style.left = `${t.panX + lx * t.zoom}px`;
    el.style.top = `${t.panY + ly * t.zoom}px`;
    el.style.width = `${Math.max(1, (rx - lx) * t.zoom)}px`;
    el.style.height = `${Math.max(1, (ry - ly) * t.zoom)}px`;
  }, [engine]);

  const hideMarquee = useCallback(() => {
    marqueeRef.current.active = false;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    const el = marqueeElRef.current;
    if (el) el.style.display = 'none';
  }, []);

  const finishPointerGesture = useCallback(() => {
    const d = docRef.current;
    if (!d) return;

    if (panningRef.current) {
      panningRef.current = false;
      setPanning(false);
      const samples = panSamplesRef.current;
      const t = engine.getTransform();
      const boosted = applyMomentum(samples, { x: t.panX, y: t.panY });
      panSamplesRef.current = [];
      if (panMomentumRafRef.current) cancelAnimationFrame(panMomentumRafRef.current);
      const dx = boosted.x - t.panX;
      const dy = boosted.y - t.panY;
      if (Math.hypot(dx, dy) > 2) {
        let vx = dx * 0.35;
        let vy = dy * 0.35;
        let px = t.panX;
        let py = t.panY;
        const tick = () => {
          vx *= 0.88;
          vy *= 0.88;
          px += vx;
          py += vy;
          applyLiveTransform(px, py, engine.getTransform().zoom);
          if (Math.hypot(vx, vy) > 0.35) {
            panMomentumRafRef.current = requestAnimationFrame(tick);
          } else {
            panMomentumRafRef.current = 0;
            commitTransform();
          }
        };
        panMomentumRafRef.current = requestAnimationFrame(tick);
      } else {
        commitTransform();
      }
    }

    if (marqueeRef.current.active) {
      const m = marqueeRef.current;
      const w = Math.abs(m.x2 - m.x1);
      const h = Math.abs(m.y2 - m.y1);
      if (w >= MIN_MARQUEE_PX && h >= MIN_MARQUEE_PX) {
        const pinHits = d.items.filter(it => cardIntersectsMarquee(it, m)).map(it => it.id);
        const stickyHits = (d.stickies ?? []).filter(s => stickyIntersectsMarquee(s, m)).map(s => s.id);
        const hits = [...pinHits, ...stickyHits];
        if (m.additive) setSelectedIds(prev => [...new Set([...prev, ...hits])]);
        else setSelectedIds(hits);
      }
      hideMarquee();
    }

    if (draggingRef.current) {
      const drag = itemDrag.current;
      const moveIds = new Set(drag.groupIds);
      if (dragKindRef.current === 'sticky') {
        const stickies = (d.stickies ?? []).map(s => {
          if (!moveIds.has(s.id)) return s;
          const el = dragElsRef.current.get(s.id);
          const start = drag.starts.get(s.id);
          if (!el || !start) return s;
          const m = el.style.transform.match(/translate3d\(([-\d.]+)px,\s*([-\d.]+)px/);
          const dx = m ? parseFloat(m[1]) : 0;
          const dy = m ? parseFloat(m[2]) : 0;
          el.style.transform = '';
          el.classList.remove('is-dragging');
          const snapped = snapPosition(start.x + dx, start.y + dy, 24, snapEnabled);
          return { ...s, x: snapped.x, y: snapped.y };
        });
        dragElsRef.current.clear();
        draggingRef.current = null;
        commitDoc({ ...d, stickies });
        setDraggingId(null);
      } else {
        const items = d.items.map(it => {
          if (!moveIds.has(it.id)) return it;
          const el = dragElsRef.current.get(it.id);
          const start = drag.starts.get(it.id);
          if (!el || !start) return it;
          const m = el.style.transform.match(/translate3d\(([-\d.]+)px,\s*([-\d.]+)px/);
          const dx = m ? parseFloat(m[1]) : 0;
          const dy = m ? parseFloat(m[2]) : 0;
          el.style.transform = '';
          el.classList.remove('is-dragging');
          let nx = start.x + dx;
          let ny = start.y + dy;
          const others = d.items.filter(o => !moveIds.has(o.id)).map(o => ({ x: o.x, y: o.y }));
          const mag = magneticOffset(nx, ny, others, CARD_W, CARD_H);
          const snapped = snapPosition(mag.x, mag.y, 24, snapEnabled);
          return { ...it, x: snapped.x, y: snapped.y };
        });
        dragElsRef.current.clear();
        draggingRef.current = null;
        commitDoc({ ...d, items });
        setDraggingId(null);
      }
    }

    pendingCardDragRef.current = null;
    interacting.current = false;
  }, [commitTransform, hideMarquee, commitDoc, snapEnabled, applyLiveTransform, engine]);

  const applyDragOffset = useCallback(() => {
    const { dx, dy } = dragOffsetRef.current;
    dragElsRef.current.forEach(el => {
      el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    });
    invalidateSpatialVisual();
  }, []);

  const onCardPointerDown = useCallback((e: React.PointerEvent, item: CanvasItem) => {
    const d = docRef.current;
    e.stopPropagation();
    if (!d) return;
    if (e.button === 2) return;
    if (e.button !== 0) return;
    focusWorkspaceSurface(surfaceRef.current);
    const wasSelected = selectedSet.has(item.id);
    const multi = e.ctrlKey || e.metaKey;

    if (multi) {
      if (wasSelected) {
        setSelectedIds(selectedIds.filter(id => id !== item.id));
      } else {
        setSelectedIds([...selectedIds, item.id]);
      }
      return;
    }

    const groupIds = wasSelected
      ? selectedIds.filter(id => d.items.some(it => it.id === id))
      : [item.id];
    // Always select on pointerdown so inspector updates on first click.
    setSelectedIds(groupIds);

    const pt = screenToBoard(e.clientX, e.clientY);
    const starts = new Map<string, { x: number; y: number }>();
    d.items.forEach(it => {
      if (groupIds.includes(it.id)) starts.set(it.id, { x: it.x, y: it.y });
    });
    pendingCardDragRef.current = {
      kind: 'item',
      clientX: e.clientX,
      clientY: e.clientY,
      id: item.id,
      groupIds,
      starts,
      originX: item.x,
      originY: item.y,
      ox: pt.x - item.x,
      oy: pt.y - item.y,
    };
    interacting.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [selectedSet, selectedIds, screenToBoard]);

  const onStickyPointerDown = useCallback((e: React.PointerEvent, sticky: SpatialSticky) => {
    const d = docRef.current;
    e.stopPropagation();
    if (!d) return;
    if (e.button === 2) return;
    if (e.button !== 0) return;
    if (editingStickyId === sticky.id) return;
    focusWorkspaceSurface(surfaceRef.current);
    const wasSelected = selectedSet.has(sticky.id);
    const multi = e.ctrlKey || e.metaKey;

    if (multi) {
      if (wasSelected) setSelectedIds(selectedIds.filter(id => id !== sticky.id));
      else setSelectedIds([...selectedIds, sticky.id]);
      return;
    }

    const groupIds = wasSelected
      ? selectedIds.filter(id => (d.stickies ?? []).some(s => s.id === id))
      : [sticky.id];
    setSelectedIds(groupIds);

    const pt = screenToBoard(e.clientX, e.clientY);
    const starts = new Map<string, { x: number; y: number }>();
    (d.stickies ?? []).forEach(s => {
      if (groupIds.includes(s.id)) starts.set(s.id, { x: s.x, y: s.y });
    });
    pendingCardDragRef.current = {
      kind: 'sticky',
      clientX: e.clientX,
      clientY: e.clientY,
      id: sticky.id,
      groupIds,
      starts,
      originX: sticky.x,
      originY: sticky.y,
      ox: pt.x - sticky.x,
      oy: pt.y - sticky.y,
    };
    interacting.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [selectedSet, selectedIds, screenToBoard, editingStickyId]);

  const onCardClick = useCallback((e: React.MouseEvent, item: CanvasItem) => {
    if (e.ctrlKey || e.metaKey) return;
    if (!selectedSet.has(item.id)) setSelectedIds([item.id]);
  }, [selectedSet]);

  const onBoardPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    focusWorkspaceSurface(surfaceRef.current);
    const d = docRef.current;
    if (!d) return;
    const t = e.target as HTMLElement;
    const onEmptyBoard =
      t === boardRef.current
      || t === transformLayerRef.current
      || t.classList.contains('bndz-spatial-grid')
      || t.classList.contains('bndz-spatial-layer')
      || t.classList.contains('bndz-spatial-marquee');

    if (e.button === 1 || (e.button === 0 && (e.altKey || spacePanDown.current))) {
      interacting.current = true;
      panningRef.current = true;
      setPanning(true);
      if (panMomentumRafRef.current) {
        cancelAnimationFrame(panMomentumRafRef.current);
        panMomentumRafRef.current = 0;
      }
      const t = engine.getTransform();
      panStart.current = { x: e.clientX, y: e.clientY, panX: t.panX, panY: t.panY };
      panSamplesRef.current = [{ x: t.panX, y: t.panY, t: performance.now() }];
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } else if (e.button === 0 && onEmptyBoard) {
      interacting.current = true;
      const pt = screenToBoard(e.clientX, e.clientY);
      marqueeRef.current = { active: true, additive: e.ctrlKey || e.metaKey, x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y };
      const m = { x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y };
      updateMarqueeDom(m);
      if (!marqueeRef.current.additive) setSelectedIds([]);
      setEditingNoteId(null);
      setEditingStickyId(null);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
  };

  const onBoardPointerMove = (e: React.PointerEvent) => {
    e.stopPropagation();
    const board = e.currentTarget as HTMLElement;
    if (!panningRef.current) board.style.cursor = 'default';
    const rect = board.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      board.style.setProperty('--mouse-x', `${((e.clientX - rect.left) / rect.width) * 100}%`);
      board.style.setProperty('--mouse-y', `${((e.clientY - rect.top) / rect.height) * 100}%`);
    }
    const d = docRef.current;
    if (!d) return;
    if (panning) {
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      const nextX = panStart.current.panX + dx;
      const nextY = panStart.current.panY + dy;
      applyLiveTransform(nextX, nextY, engine.getTransform().zoom);
      const samples = panSamplesRef.current;
      samples.push({ x: nextX, y: nextY, t: performance.now() });
      if (samples.length > 6) samples.shift();
      return;
    }
    if (marqueeRef.current.active) {
      const pt = screenToBoard(e.clientX, e.clientY);
      marqueeRef.current.x2 = pt.x;
      marqueeRef.current.y2 = pt.y;
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = 0;
          const m = marqueeRef.current;
          updateMarqueeDom({ x1: m.x1, y1: m.y1, x2: m.x2, y2: m.y2 });
        });
      }
      return;
    }
    if (pendingCardDragRef.current && !draggingRef.current) {
      const pending = pendingCardDragRef.current;
      const dist = Math.hypot(e.clientX - pending.clientX, e.clientY - pending.clientY);
      if (dist >= MIN_MARQUEE_PX) {
        const d = docRef.current;
        if (!d) return;
        dragKindRef.current = pending.kind;
        const els = new Map<string, HTMLElement>();
        const selector = pending.kind === 'sticky' ? 'data-spatial-sticky' : 'data-spatial-card';
        pending.groupIds.forEach(id => {
          const el = boardRef.current?.querySelector(`[${selector}="${id}"]`) as HTMLElement | null;
          if (el) {
            els.set(id, el);
            el.classList.add('is-dragging');
          }
        });
        dragElsRef.current = els;
        itemDrag.current = {
          id: pending.id,
          ox: pending.ox,
          oy: pending.oy,
          originX: pending.originX,
          originY: pending.originY,
          groupIds: pending.groupIds,
          starts: pending.starts,
        };
        draggingRef.current = pending.id;
        setDraggingId(pending.id);
        pendingCardDragRef.current = null;
      } else {
        return;
      }
    }
    if (draggingRef.current) {
      const pt = screenToBoard(e.clientX, e.clientY);
      const drag = itemDrag.current;
      dragOffsetRef.current = {
        dx: (pt.x - drag.ox) - drag.originX,
        dy: (pt.y - drag.oy) - drag.originY,
      };
      if (!dragRafRef.current) {
        dragRafRef.current = requestAnimationFrame(() => {
          dragRafRef.current = 0;
          applyDragOffset();
        });
      }
      return;
    }
  };

  const onBoardPointerUp = (e: React.PointerEvent) => {
    e.stopPropagation();
    finishPointerGesture();
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* */ }
  };

  useEffect(() => {
    panningRef.current = panning;
  }, [panning]);

  useEffect(() => {
    // Clear splitter col-resize immediately — don't wait for doc hydrate / pointerenter.
    resetWorkspacePointerChrome();
    return () => resetWorkspacePointerChrome();
  }, []);

  useEffect(() => {
    if (!doc) return;
    const el = surfaceRef.current;
    const board = boardRef.current;
    resetWorkspacePointerChrome();
    const unbindSurface = el ? bindWorkspaceCursorGuard(el) : undefined;
    const unbindBoard = board ? bindWorkspaceCursorGuard(board) : undefined;
    return () => {
      unbindSurface?.();
      unbindBoard?.();
      clearChromeDragCursor();
    };
  }, [doc]);

  useEffect(() => {
    const onWinEnd = () => {
      if (!interacting.current && !marqueeRef.current.active && !draggingRef.current && !panningRef.current) return;
      finishPointerGesture();
    };
    window.addEventListener('pointerup', onWinEnd, true);
    window.addEventListener('pointercancel', onWinEnd, true);
    return () => {
      window.removeEventListener('pointerup', onWinEnd, true);
      window.removeEventListener('pointercancel', onWinEnd, true);
    };
  }, [finishPointerGesture]);

  useEffect(() => () => hideMarquee(), [hideMarquee]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const pt = screenToBoard(e.clientX, e.clientY);
    const payload = readBndzFileDragData(e);
    let pinned = false;
    const wasEmpty = !docRef.current?.items.length && !(docRef.current?.stickies?.length);
    if (payload?.paths?.length) {
      addPaths(payload.paths, pt);
      pinned = true;
    } else {
      // Explorer → Spatial: HTML5 FileList may carry Windows .path (Chromium).
      const fromFiles = Array.from(e.dataTransfer.files || [])
        .map(f => (f as File & { path?: string }).path || '')
        .map(s => s.trim())
        .filter(Boolean);
      if (fromFiles.length) {
        addPaths(fromFiles, pt);
        pinned = true;
      } else {
        const plain = e.dataTransfer.getData('text/plain');
        if (plain) {
          const paths = plain.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
          if (paths.length) {
            addPaths(paths, pt);
            pinned = true;
          }
        }
      }
    }
    if (pinned) {
      endInternalFileDragUi('spatial-html-drop');
      if (wasEmpty) requestAnimationFrame(() => fitBoard());
    }
  };

  const menuItem = doc?.items.find(it => it.id === menu?.targetId) ?? null;
  const menuSticky = doc?.stickies?.find(s => s.id === menu?.targetId) ?? null;
  const selectedPinForTether = doc?.items.find(it => selectedSet.has(it.id)) ?? null;
  const boardIsEmpty = doc ? doc.items.length === 0 && (doc.stickies?.length ?? 0) === 0 : true;

  if (!doc) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm gap-2">
        <Icons8Icon id="loading" size={18} spin /> Preparing spatial canvas…
      </div>
    );
  }

  return (
    <div
      ref={surfaceRef}
      tabIndex={0}
      className="bndz-spatial-canvas bndz-ws-skin--spatial flex flex-col h-full min-h-0 outline-none"
      data-bndz-surface
      data-bndz-workspace-surface
      onPointerDown={e => {
        // Bubble-only guard: never stop capture — that blocks board/cards/buttons.
        if (e.target === e.currentTarget) e.stopPropagation();
      }}
    >
      {splash.visible && (
        <WorkspaceSplash
          workspaceId="spatial-canvas"
          eyebrow="Project map"
          title="Spatial Canvas"
          subtitle="Map folders and free sticky notes on an infinite board — pins are references; originals stay on disk."
          icon="view_grid"
          accent="#c48b4a"
          features={[
            { icon: 'upload', title: 'Drop folders', desc: 'Drag project folders from any pane onto the map' },
            { icon: 'notepad', title: 'Free sticky notes', desc: 'Park notes beside folders — optional tether to a pin' },
            { icon: 'zoom_in_ui', title: 'Pan & zoom', desc: 'Scroll to pan · Ctrl+scroll to zoom' },
            { icon: 'keyboard_ui', title: 'Marquee select', desc: 'Drag empty space to box-select cards and stickies' },
          ]}
          onDismiss={() => splash.dismiss()}
        />
      )}

      <header className="bndz-ws-chrome bndz-ws-chrome--spatial shrink-0">
        <div className="bndz-ws-chrome-brand min-w-0">
          <span className="bndz-ws-chrome-sigil bndz-ws-chrome-sigil--spatial" aria-hidden>
            <img src="/Ui/applications-featured.svg" alt="" className="bndz-ws-sigil-img" />
          </span>
          <div className="min-w-0 relative">
            <div className="flex items-center gap-2">
              <input
                className="bndz-ws-pipeline-name"
                value={doc.name}
                onChange={e => commitDoc({ ...doc, name: e.target.value })}
                onBlur={() => {
                  const name = doc.name.trim() || 'Untitled board';
                  if (name !== doc.name) commitDoc({ ...doc, name });
                  void renameSpatialBoard(doc.id, name).then(() => void refreshBoards());
                }}
                spellCheck={false}
                aria-label="Board name"
              />
              <button
                type="button"
                data-spatial-board-trigger
                className="bndz-ws-pill bndz-ws-pill--spatial"
                onClick={() => { void refreshBoards(); setShowBoardPicker(v => !v); }}
                title="Switch board"
              >
                Boards{boardList.length > 1 ? ` (${boardList.length})` : ''}
              </button>
            </div>
            {showBoardPicker && (
              <div className="bndz-spatial-board-picker">
                {boardList.map(b => (
                  <div key={b.id} className="bndz-spatial-board-picker-row">
                    <button
                      type="button"
                      className={`bndz-spatial-board-picker-item${b.active ? ' is-active' : ''}`}
                      onClick={() => void switchBoard(b.id)}
                    >
                      {b.name}
                      <span className="bndz-spatial-board-picker-count">· {b.pinCount}</span>
                    </button>
                    {boardList.length > 1 && (
                      <button
                        type="button"
                        className="bndz-spatial-board-picker-del"
                        title="Delete board"
                        onClick={() => void removeBoard(b.id)}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
                <div className="bndz-spatial-board-picker-actions">
                  <button
                    type="button"
                    className="bndz-spatial-board-picker-action bndz-spatial-board-picker-action--amber"
                    onClick={() => void newBoard()}
                  >
                    + New board
                  </button>
                  <button
                    type="button"
                    className="bndz-spatial-board-picker-action bndz-spatial-board-picker-action--emerald"
                    onClick={() => void openContinuumBoard()}
                  >
                    Open Continuum
                  </button>
                  <button
                    type="button"
                    className="bndz-spatial-board-picker-action bndz-spatial-board-picker-action--sky"
                    onClick={() => void duplicateBoard()}
                  >
                    Duplicate current board
                  </button>
                </div>
                <div className="bndz-spatial-board-picker-search">
                  <input
                    className="bndz-spatial-board-picker-search-input"
                    placeholder="Find pins…"
                    value={pinSearch}
                    onChange={e => setPinSearch(e.target.value)}
                  />
                  {pinSearch.trim() && (
                    <p className="bndz-spatial-board-picker-search-hint">{renderedItems.length} match(es)</p>
                  )}
                </div>
              </div>
            )}
            <p className="bndz-ws-chrome-desc">
              {doc.items.length} pin{doc.items.length === 1 ? '' : 's'}
              {(doc.stickies?.length ?? 0) > 0 ? ` · ${doc.stickies!.length} sticky${doc.stickies!.length === 1 ? '' : 'ies'}` : ''}
              {selectedIds.length > 0 ? ` · ${selectedIds.length} selected` : ''}
              {autoSave ? ' · autosave on' : ''}
            </p>
          </div>
        </div>
        <div className="bndz-ws-chrome-actions shrink-0">
          {status && <span className="bndz-ws-status">{status}</span>}
          <button type="button" className="bndz-ws-chip" onClick={() => { setSnapshots(loadSnapshots()); setShowSnapshots(v => !v); }}>
            Snapshots{snapshots.length ? ` (${snapshots.length})` : ''}
          </button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0 min-w-0">
        <div className="flex flex-col flex-1 min-w-0 min-h-0 relative">
          <WorkspaceCommandBar
            variant="spatial"
            hint={`${(displayZoom * 100).toFixed(0)}% · Ctrl+scroll zoom · Del unpin · Ctrl+A`}
            commands={[
              { id: 'zin', label: 'Zoom in', iconSrc: '/launcher-icons/magnifier.png', onClick: () => zoomBy(1.15) },
              { id: 'zout', label: 'Zoom out', iconSrc: '/launcher-icons/minus_ui.png', onClick: () => zoomBy(0.87) },
              { id: 'fit', label: 'Fit all', iconSrc: '/launcher-icons/details-view.svg', onClick: fitBoard },
              { id: 'grid', label: 'Arrange grid', iconSrc: '/Ui/icons.svg', disabled: boardIsEmpty, onClick: arrangeGrid },
              { id: 'sticky', label: 'Sticky note', iconSrc: '/launcher-icons/emblem-documents.svg', onClick: () => addStickyNote() },
              { id: 'links', label: 'Relations', iconSrc: '/launcher-icons/emblem-shared.svg', active: showRelations, onClick: () => setShowRelations(v => !v) },
              { id: 'export', label: 'Export', iconSrc: '/launcher-icons/emblem-downloads.svg', onClick: exportBoard },
              { id: 'palette', label: 'Commands', iconSrc: '/Ui/keybinds-keyboard.svg', onClick: () => setPaletteOpen(true) },
              { id: 'intro', label: 'Intro', iconSrc: '/Ui/image-loading.svg', onClick: () => splash.replay() },
              {
                id: 'clear',
                label: 'Clear board',
                iconSrc: '/launcher-icons/trash_ui.png',
                disabled: boardIsEmpty,
                onClick: clearBoard,
              },
              {
                id: 'reset',
                label: 'Reset zoom',
                iconSrc: '/launcher-icons/emblem-synchronizing.svg',
                onClick: () => resetZoomPreserveCenter(),
              },
            ]}
          />

          <div
            ref={boardRef}
            data-spatial-board
            className={`bndz-spatial-board flex-1 min-h-0 relative overflow-hidden${panning ? ' is-panning' : ''}`}
            style={{ touchAction: 'none', cursor: 'default' }}
            onPointerEnter={() => {
              if (boardRef.current && !panning) boardRef.current.style.cursor = 'default';
            }}
            onPointerDown={onBoardPointerDown}
            onPointerMove={onBoardPointerMove}
            onPointerUp={onBoardPointerUp}
            onPointerCancel={onBoardPointerUp}
            onPointerLeave={() => {
              // Never end card-drag / marquee on leave — pointer capture owns the gesture.
              // Only clear a stray splitter cursor if we aren't mid-interaction.
              if (!interacting.current && !draggingRef.current && !panningRef.current && !marqueeRef.current.active) {
                clearChromeDragCursor();
                if (boardRef.current) boardRef.current.style.cursor = 'default';
              }
            }}
            onContextMenu={e => { e.stopPropagation(); onContextMenu(e, 'spatial-board'); }}
            onDragOver={e => {
              if (hasBndzFileDrag(e) || e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('text/plain')) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
              }
            }}
            onDrop={onDrop}
          >
            <div className="bndz-spatial-vignette pointer-events-none" aria-hidden />
            <div ref={gridRef} className="bndz-spatial-grid absolute inset-0 pointer-events-none" />
            <div ref={marqueeElRef} className="bndz-spatial-marquee" style={{ display: 'none' }} />
            <div ref={transformLayerRef} className="bndz-spatial-layer absolute origin-top-left pointer-events-none">
              {clusters.map(c => (
                <button
                  key={c.id}
                  type="button"
                  className="bndz-spatial-cluster-halo pointer-events-auto"
                  style={{ left: c.cx - 40, top: c.cy - 40, width: 80, height: 80 }}
                  title={`${c.label} (${c.itemIds.length}) — click to focus`}
                  onClick={() => focusCluster(c.id)}
                />
              ))}
              {doc.items.length > renderedItems.length && (
                <div className="bndz-spatial-virtual-badge pointer-events-none" aria-hidden>
                  {renderedItems.length}/{doc.items.length} visible
                </div>
              )}
              {(doc.stickies ?? []).some(s => s.tetherToId) && (
                <svg className="bndz-spatial-tethers" aria-hidden>
                  {(doc.stickies ?? []).map(s => {
                    if (!s.tetherToId) return null;
                    const pin = doc.items.find(it => it.id === s.tetherToId);
                    if (!pin) return null;
                    const sw = s.w ?? SPATIAL_STICKY_W;
                    const sh = s.h ?? SPATIAL_STICKY_H;
                    const x1 = s.x + sw / 2;
                    const y1 = s.y + sh / 2;
                    const x2 = pin.x + CARD_W / 2;
                    const y2 = pin.y + CARD_H / 2;
                    return (
                      <line
                        key={`tether_${s.id}`}
                        x1={x1}
                        y1={y1}
                        x2={x2}
                        y2={y2}
                        className="bndz-spatial-tether-line"
                      />
                    );
                  })}
                </svg>
              )}
              <SpatialSpringBoard
                items={renderedItems}
                relations={showRelations ? relations : []}
                selectedSet={selectedSet}
                draggingId={draggingId}
                editingNoteId={editingNoteId}
                cardW={CARD_W}
                cardH={CARD_H}
                intelligenceMap={intelligenceMap}
                onPointerDown={onCardPointerDown}
                onClick={onCardClick}
                onDoubleClick={openItem}
                onContextMenu={(e, it) => {
                  if (!selectedSet.has(it.id)) setSelectedIds([it.id]);
                  onContextMenu(e, 'spatial-card', it.id);
                }}
                onNoteBlur={(id, val) => { updateNote(id, val); setEditingNoteId(null); }}
                onNoteCancel={() => setEditingNoteId(null)}
                onReveal={revealItem}
                onAutomate={(it) => dispatchAutomationFromPin([it.path], { navigate: true })}
                onAddStickyBeside={addStickyBesidePin}
              />
              {(doc.stickies ?? []).map(sticky => (
                <SpatialStickyNote
                  key={sticky.id}
                  sticky={sticky}
                  selected={selectedSet.has(sticky.id)}
                  dragging={draggingId === sticky.id}
                  editing={editingStickyId === sticky.id}
                  onPointerDown={onStickyPointerDown}
                  onContextMenu={(e, s) => {
                    if (!selectedSet.has(s.id)) setSelectedIds(prev => {
                      const pins = prev.filter(id => doc.items.some(it => it.id === id));
                      return [...pins, s.id];
                    });
                    onContextMenu(e, 'spatial-sticky', s.id);
                  }}
                  onBeginEdit={setEditingStickyId}
                  onCommitText={updateStickyText}
                  onCancelEdit={() => setEditingStickyId(null)}
                  onDelete={removeItem}
                />
              ))}
            </div>
            {boardIsEmpty && (
              <div className="bndz-spatial-empty absolute inset-0 flex flex-col items-center justify-center z-10 p-8">
                <div className="bndz-spatial-empty-orbit pointer-events-none" aria-hidden />
                <div className="bndz-spatial-empty-glass text-center">
                  <img src="/Ui/preview-Big Folder.svg" alt="" className="w-14 h-14 opacity-35 mb-3 pointer-events-none mx-auto" />
                  <p className="text-sm font-semibold mb-1" style={{ color: 'rgba(240,232,218,0.92)' }}>Drop folders to build a project map</p>
                  <p className="text-[11px] mt-1 mb-5 max-w-[320px] pointer-events-none leading-relaxed" style={{ color: 'rgba(180,172,152,0.72)' }}>
                    Pins are references only — originals stay on disk.<br />Add sticky notes to annotate your layout.
                  </p>
                  <div className="flex flex-wrap justify-center gap-2 max-w-[400px] mx-auto">
                    <button
                      type="button"
                      className="bndz-spatial-empty-cta bndz-spatial-empty-cta--sticky"
                      onClick={() => addStickyNote()}
                    >
                      Add sticky note
                    </button>
                    {[
                      { label: 'Pin Downloads', path: '/shell:Downloads' },
                      { label: 'Pin Desktop', path: '/shell:Desktop' },
                      { label: 'Pin Pictures', path: '/shell:My Pictures' },
                      { label: 'Pin Documents', path: '/shell:Personal' },
                    ].map(btn => (
                      <button
                        key={btn.path}
                        type="button"
                        className="bndz-spatial-empty-cta"
                        onClick={() => {
                          // Viewport center (omit `at`) + fit so pins never land off-camera.
                          addPaths([btn.path]);
                          requestAnimationFrame(() => {
                            requestAnimationFrame(() => fitBoard());
                          });
                        }}
                      >
                        {btn.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] mt-4 pointer-events-none" style={{ color: 'rgba(120,112,96,0.8)' }}>Drag folders from any pane · right-click board → Add sticky note</p>
                </div>
              </div>
            )}
            {showMinimap && !boardIsEmpty && (
              <ConstellationMinimap
                ref={minimapRef}
                items={doc.items}
                boardW={boardSize.w}
                boardH={boardSize.h}
                onJump={(px, py) => {
                  engine.setTransform(px, py, engine.getTransform().zoom, true);
                  commitTransform();
                }}
              />
            )}
          </div>

          <footer className="bndz-ws-rail bndz-ws-rail--spatial shrink-0">
            <span className="bndz-ws-rail-stat">
              {doc.items.length} pinned
              {(doc.stickies?.length ?? 0) > 0 ? ` · ${doc.stickies!.length} notes` : ''}
            </span>
            <span className="bndz-ws-rail-hint">Ctrl+scroll zoom · scroll pan · Space/Alt/right-drag pan · Ctrl+Shift+P commands</span>
            <button ref={zoomPillRef} type="button" className="bndz-ws-rail-zoom-pill" onClick={() => setShowMinimap(v => !v)}>
              {(displayZoom * 100).toFixed(0)}%
            </button>
          </footer>
        </div>

        <SpatialInspector
          items={doc.items}
          stickies={doc.stickies ?? []}
          selectedIds={selectedIds}
          snapshotCount={snapshots.length}
          boardName={doc.name}
          intelligence={(() => {
            const sel = doc.items.find(it => selectedIds.includes(it.id));
            return sel ? intelligenceMap.get(sel.path) : undefined;
          })()}
          onOpen={openItem}
          onReveal={revealItem}
          onCopyPath={copyPath}
          onEditNote={setEditingNoteId}
          onUpdateNote={updateNote}
          onAddTag={addTagToPath}
          onRemoveTag={removeTagFromPath}
          onBatchAddTag={batchAddTags}
          onUpdateStickyText={updateStickyText}
        />

        {showSnapshots && (
          <aside className="bndz-spatial-snapshots shrink-0 overflow-y-auto bndz-scrollbar">
            <div className="bndz-spatial-snapshots-head">
              <span className="bndz-spatial-snapshots-title">Snapshot history</span>
              <button type="button" className="bndz-lens-chip" onClick={() => setShowSnapshots(false)}>Close</button>
            </div>
            {snapshots.length === 0 ? (
              <p className="bndz-spatial-snapshots-empty">No snapshots yet. Save one from the command palette or Snapshots button.</p>
            ) : (
              <ul className="bndz-spatial-snapshots-list">
                {snapshots.map(s => (
                  <li key={s.id} className="bndz-spatial-snapshots-item">
                    <div className="bndz-spatial-snapshots-meta">
                      <span className="bndz-spatial-snapshots-name">{s.name}</span>
                      <span className="bndz-spatial-snapshots-date">{new Date(s.at).toLocaleString()}</span>
                    </div>
                    <div className="bndz-spatial-snapshots-actions">
                      <button type="button" className="bndz-lens-chip" onClick={() => restoreSnapshot(s.id)}>Restore</button>
                      <button type="button" className="bndz-lens-chip bndz-lens-chip--danger" onClick={() => setSnapshots(deleteSnapshot(s.id))}>Delete</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        )}
      </div>

      <WorkspaceCommandPalette
        open={paletteOpen}
        commands={paletteCommands}
        onClose={() => setPaletteOpen(false)}
      />

      {menu?.kind === 'spatial-card' && menuItem && (
        <WorkspaceMenuPanel variant="spatial" x={menu.x} y={menu.y}>
          <WorkspaceMenuItem label="Open" icon="folder_open_ui" onClick={() => openItem(menuItem)} />
          <WorkspaceMenuItem label="Reveal in Explorer" icon="explorer" onClick={() => revealItem(menuItem)} />
          <WorkspaceMenuItem label="Copy path" icon="copy_path" onClick={() => copyPath(menuItem)} />
          <WorkspaceMenuSep />
          <WorkspaceMenuItem label="Add sticky beside" icon="notepad" onClick={() => addStickyBesidePin(menuItem)} />
          <WorkspaceMenuItem label="Copy path to automation" icon="copy" onClick={() => {
            setWorkspaceClipboard({ kind: 'spatial-pins', paths: [menuItem.path] });
            dispatchAutomationFromPin([menuItem.path], { navigate: true });
            closeMenu();
          }} />
          {selectedIds.length > 1 && (
            <WorkspaceMenuItem
              label={`Send ${selectedIds.length} pins to automation`}
              icon="zap_ui"
              onClick={() => { sendSelectionToAutomation(); closeMenu(); }}
            />
          )}
          <WorkspaceMenuSep />
          <WorkspaceMenuItem label="Duplicate" icon="copy" onClick={() => { duplicateSelectedPins(); closeMenu(); }} disabled={!selectedIds.includes(menuItem.id)} />
          <WorkspaceMenuItem label="Cut" icon="copy" onClick={() => { cutSelectedPins(); closeMenu(); }} disabled={!selectedIds.includes(menuItem.id)} />
          <WorkspaceMenuItem label="Edit note" icon="notepad" onClick={() => { setEditingNoteId(menuItem.id); closeMenu(); }} />
          <WorkspaceMenuItem
            label="Pop out pin note"
            icon="external_link"
            onClick={() => {
              const pin = menuItem;
              closeMenu();
              void import('../../lib/ipcBridge').then(({ IPC }) =>
                IPC.openPluginWindow('sticky-note', {
                  stickyId: pin.id,
                  title: pin.name || 'Pin note',
                }),
              );
            }}
          />
          <WorkspaceMenuItem label="Remove from board" icon="delete" danger onClick={() => removeItem(menuItem.id)} />
          {selectedIds.length > 1 && (
            <WorkspaceMenuItem label={`Remove ${selectedIds.length} selected`} icon="delete" danger onClick={() => removeSelected()} />
          )}
        </WorkspaceMenuPanel>
      )}

      {menu?.kind === 'spatial-sticky' && menuSticky && (
        <WorkspaceMenuPanel variant="spatial" x={menu.x} y={menu.y}>
          <WorkspaceMenuItem
            label="Edit"
            icon="notepad"
            onClick={() => { setEditingStickyId(menuSticky.id); closeMenu(); }}
          />
          {selectedPinForTether && selectedPinForTether.id !== menuSticky.tetherToId && (
            <WorkspaceMenuItem
              label={`Tether to ${selectedPinForTether.name}`}
              icon="link"
              onClick={() => tetherSticky(menuSticky.id, selectedPinForTether.id)}
            />
          )}
          {menuSticky.tetherToId && (
            <WorkspaceMenuItem
              label="Untether"
              icon="link"
              onClick={() => tetherSticky(menuSticky.id, undefined)}
            />
          )}
          <WorkspaceMenuSep />
          {SPATIAL_STICKY_COLORS.map((color, i) => (
            <WorkspaceMenuItem
              key={color}
              label={['Paper yellow', 'Mint', 'Rose', 'Sky'][i] || 'Color'}
              icon="notepad"
              onClick={() => setStickyColor(menuSticky.id, color)}
            />
          ))}
          <WorkspaceMenuSep />
          <WorkspaceMenuItem
            label="Pop out to desktop"
            icon="external_link"
            onClick={() => {
              const s = menuSticky;
              closeMenu();
              void import('../../lib/ipcBridge').then(({ IPC }) =>
                IPC.openPluginWindow('sticky-note', {
                  stickyId: s.id,
                  title: (s.text || 'Sticky').slice(0, 40),
                }),
              );
            }}
          />
          <WorkspaceMenuItem label="Delete sticky" icon="delete" danger onClick={() => removeItem(menuSticky.id)} />
        </WorkspaceMenuPanel>
      )}

      {menu?.kind === 'spatial-board' && (
        <WorkspaceMenuPanel variant="spatial" x={menu.x} y={menu.y}>
          <WorkspaceMenuItem
            label="Add sticky note"
            icon="notepad"
            onClick={() => {
              const pt = screenToBoard(menu.x, menu.y);
              addStickyNote(pt);
            }}
          />
          <WorkspaceMenuSep />
          <WorkspaceMenuItem label="Fit all cards" icon="zoom_in_ui" onClick={fitBoard} />
          <WorkspaceMenuItem label="Arrange grid" icon="view_grid" onClick={arrangeGrid} disabled={boardIsEmpty} />
          <WorkspaceMenuItem label="Reset zoom" icon="reset_ui" onClick={() => { resetZoomPreserveCenter(); }} />
          <WorkspaceMenuSep />
          <WorkspaceMenuItem label="Open Sandbox" icon="layers_ui" onClick={() => { window.dispatchEvent(new CustomEvent('bndz-open-bottom-plugin', { detail: { id: 'project-sandbox' } })); closeMenu(); }} />
          <WorkspaceMenuItem label="Open Library Health" icon="shield_ui" onClick={() => { window.dispatchEvent(new CustomEvent('bndz-open-bottom-plugin', { detail: { id: 'library-health' } })); closeMenu(); }} />
          <WorkspaceMenuItem label="Open Inbound Volume" icon="download_ui" onClick={() => { window.dispatchEvent(new CustomEvent('bndz-open-bottom-plugin', { detail: { id: 'inbound-volume' } })); closeMenu(); }} />
          <WorkspaceMenuItem label="Open Branching Time" icon="history_ui" onClick={() => { window.dispatchEvent(new CustomEvent('bndz-open-bottom-plugin', { detail: { id: 'branching-time' } })); closeMenu(); }} />
          <WorkspaceMenuSep />
          <WorkspaceMenuItem label="Clear board" icon="delete" danger onClick={clearBoard} disabled={boardIsEmpty} />
        </WorkspaceMenuPanel>
      )}
    </div>
  );
}
