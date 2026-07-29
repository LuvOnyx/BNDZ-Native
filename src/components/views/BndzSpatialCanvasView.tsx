import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import WorkspaceMenuPanel, { WorkspaceMenuItem, WorkspaceMenuSep } from '../workspace/WorkspaceMenuPanel';
import SpatialCanvasCard from '../workspace/SpatialCanvasCard';
import SpatialSpringBoard from '../../workstation/spatial/SpatialSpringBoard';
import { readBndzFileDragData, hasBndzFileDrag } from '../../lib/bndzDrag';
import { getFileDragSession } from '../../lib/fileDragSession';
import {
  loadSpatialCanvas, hydrateSpatialCanvasFromJson, invalidateSpatialCanvasCache,
  resetSpatialCanvasPersisted,
  type CanvasItem, type SpatialCanvasDoc,
} from '../../lib/spatialCanvasStore';
import { toWindowsPath } from '../../lib/pathUtils';
import { toPanePath } from '../../lib/shellPaths';
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
  saveSnapshot, snapPosition, magneticOffset,
} from '../../lib/workspace/spatialCanvasUtils';
import { setWorkspaceClipboard } from '../../lib/workspace/workspaceClipboard';
import { useWorkspaceAutosave } from '../../lib/useWorkspaceAutosave';
import { flushBndzMeta } from '../../lib/bndzMetaStore';
import { WorkspaceInteractionEngine } from '../../lib/workspace/WorkspaceInteractionEngine';
import {
  focusWorkspaceSurface, shouldHandleWorkspaceKeys,
} from '../../lib/workspace/workspaceFocus';
import { bindWorkspaceCursorGuard } from '../../lib/workspace/workspaceCursorGuard';
import { invalidateSpatialVisual } from '../../lib/workspace/spatialVisualBus';

const MIN_MARQUEE_PX = 4;

type Props = {
  onNavigate: (path: string) => void;
  onOpenPath?: (path: string) => void;
};

const CARD_W = 172;
const CARD_H = 148;

function newItem(path: string, x: number, y: number): CanvasItem {
  const name = path.split(/[/\\]/).pop() || path;
  return { id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, path, name, x, y };
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

export default function BndzSpatialCanvasView({ onNavigate, onOpenPath }: Props) {
  const { config } = useAppConfig();
  const autoSave = config.spatialCanvasAutoSave !== false;
  const saveDelayMs = typeof config.spatialCanvasAutoSaveDelayMs === 'number'
    ? Math.max(100, config.spatialCanvasAutoSaveDelayMs)
    : 400;
  const wheelZoom = config.spatialCanvasWheelZoom !== false;
  const minZoom = typeof config.spatialCanvasMinZoom === 'number' ? config.spatialCanvasMinZoom : 0.35;
  const maxZoom = typeof config.spatialCanvasMaxZoom === 'number' ? config.spatialCanvasMaxZoom : 2.5;
  const spatialV2 = config.spatialCanvasV2 !== false;

  const [doc, setDoc] = useState<SpatialCanvasDoc | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const panningRef = useRef(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const [status, setStatus] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [displayZoom, setDisplayZoom] = useState(1);
  const [showRelations, setShowRelations] = useState(true);
  const [showMinimap, setShowMinimap] = useState(true);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
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
  const itemDrag = useRef({
    id: '', ox: 0, oy: 0,
    originX: 0, originY: 0,
    groupIds: [] as string[],
    starts: new Map<string, { x: number; y: number }>(),
  });
  const spacePanDown = useRef(false);
  const draggingRef = useRef<string | null>(null);
  const dragElsRef = useRef<Map<string, HTMLElement>>(new Map());
  const dragOffsetRef = useRef({ dx: 0, dy: 0 });
  const dragRafRef = useRef(0);
  const rafRef = useRef(0);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const { menu, closeMenu, onContextMenu } = useWorkspaceContextMenu(surfaceRef);
  const splash = useWorkspaceSplash('spatial-canvas', {
    isReady: doc !== null,
    isEmpty: Boolean(doc && doc.items.length === 0),
    resetEmptyHintOnMount: false,
  });

  docRef.current = doc;

  const autosave = useWorkspaceAutosave(
    () => (docRef.current ? stableDocJson(docRef.current) : ''),
    async snap => {
      const parsed = JSON.parse(snap) as SpatialCanvasDoc;
      const payload: SpatialCanvasDoc = { ...parsed, updatedAt: Date.now() };
      hydrateSpatialCanvasFromJson(JSON.stringify(payload));
      return flushBndzMeta('spatial_canvas_v1', JSON.stringify(payload));
    },
    saveDelayMs,
    autoSave,
  );

  const { schedule: scheduleSave, seed: seedAutosave, flush: flushAutosave } = autosave;

  const commitDoc = useCallback((next: SpatialCanvasDoc, save = true) => {
    const prevItems = docRef.current?.items.length ?? 0;
    docRef.current = next;
    setDoc(next);
    engine.setTransform(next.panX, next.panY, next.zoom, true);
    if (!save || !autoSave) return;
    if (next.items.length !== prevItems) {
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
    focusWorkspaceSurface(surfaceRef.current);
  }, [doc]);

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
    const run = () => {
      void Promise.all(
        doc.items.slice(0, 64).map(it =>
          IPC.getTagSidecar(it.path).then(sc => [it.path, sc?.tags?.filter(Boolean) ?? []] as const),
        ),
      ).then(rows => {
        if (!active) return;
        setTagMap(new Map(rows));
      });
    };
    const ric = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
    const id = typeof ric === 'function' ? ric(run, { timeout: 2000 }) : window.setTimeout(run, 400);
    return () => {
      active = false;
      if (typeof ric === 'function') window.cancelIdleCallback?.(id as number);
      else clearTimeout(id);
    };
  }, [doc?.items.length, doc?.updatedAt]);

  const clusters = useMemo(
    () => (doc ? computeClusters(doc.items, CARD_W, CARD_H) : []),
    [doc],
  );
  const relations = useMemo(
    () => (doc && showRelations ? computeRelations(doc.items, tagMap) : []),
    [doc, showRelations, tagMap],
  );

  useEffect(() => {
    let active = true;
    invalidateSpatialCanvasCache();
    loadSpatialCanvas({ force: true }).then(d => {
      if (!active) return;
      docRef.current = d;
      setDoc(d);
      engine.setTransform(d.panX, d.panY, d.zoom, true);
      seedAutosave(stableDocJson(d));
    });
    return () => { active = false; };
  }, [engine, seedAutosave]);

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
    const base = at || screenToBoard(
      boardRef.current!.clientWidth / 2 + boardRef.current!.getBoundingClientRect().left,
      boardRef.current!.clientHeight / 2 + boardRef.current!.getBoundingClientRect().top,
    );
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

  useEffect(() => {
    const onExternalDrop = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const paths = (detail.paths as string[] | undefined)?.filter(Boolean);
      if (!paths?.length) return;
      const clientX = typeof detail.webViewX === 'number' ? detail.webViewX : window.innerWidth / 2;
      const clientY = typeof detail.webViewY === 'number' ? detail.webViewY : window.innerHeight / 2;
      if (!hitBoardAt(clientX, clientY)) return;
      addPaths(paths, resolveDropPoint(clientX, clientY));
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
    };
    window.addEventListener('bndz-external-drop', onExternalDrop);
    window.addEventListener('bndz-spatial-add', onSpatialAdd);
    window.addEventListener('pointerup', onPointerUp, true);
    return () => {
      window.removeEventListener('bndz-external-drop', onExternalDrop);
      window.removeEventListener('bndz-spatial-add', onSpatialAdd);
      window.removeEventListener('pointerup', onPointerUp, true);
    };
  }, [addPaths, hitBoardAt, resolveDropPoint]);

  const removeItems = useCallback((ids: string[]) => {
    const d = docRef.current;
    if (!d || !ids.length) return;
    const drop = new Set(ids);
    commitDoc({ ...d, items: d.items.filter(it => !drop.has(it.id)) });
    setSelectedIds(prev => prev.filter(id => !drop.has(id)));
    setStatus(`Removed ${ids.length} card${ids.length === 1 ? '' : 's'}`);
    closeMenu();
  }, [commitDoc, closeMenu]);

  const removeItem = useCallback((id: string) => removeItems([id]), [removeItems]);
  const removeSelected = useCallback(() => { if (selectedIds.length) removeItems(selectedIds); }, [selectedIds, removeItems]);

  const clearBoard = useCallback(() => {
    const d = docRef.current;
    if (!d) return;
    const empty = { ...d, items: [], panX: 0, panY: 0, zoom: 1, updatedAt: Date.now() };
    docRef.current = empty;
    setDoc(empty);
    setSelectedIds([]);
    setEditingNoteId(null);
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
    void navigator.clipboard.writeText(item.path).then(() => setStatus('Path copied'));
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

  const fitBoard = useCallback(() => {
    const d = docRef.current;
    if (!d || !d.items.length || !boardRef.current) {
      if (d) commitDoc({ ...d, panX: 0, panY: 0, zoom: 1 });
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
    const pad = 48;
    const bw = maxX - minX + pad * 2;
    const bh = maxY - minY + pad * 2;
    const zoom = Math.min(maxZoom, Math.max(minZoom, Math.min(rect.width / bw, rect.height / bh)));
    const panX = (rect.width - bw * zoom) / 2 - minX * zoom + pad * zoom;
    const panY = (rect.height - bh * zoom) / 2 - minY * zoom + pad * zoom;
    commitDoc({ ...d, panX, panY, zoom });
    setStatus('Fitted to board');
    closeMenu();
  }, [commitDoc, minZoom, maxZoom, closeMenu]);

  const arrangeGrid = useCallback(() => {
    const d = docRef.current;
    if (!d || !d.items.length) return;
    const cols = Math.ceil(Math.sqrt(d.items.length));
    const gap = 20;
    const items = d.items.map((it, i) => ({
      ...it,
      x: 40 + (i % cols) * (CARD_W + gap),
      y: 40 + Math.floor(i / cols) * (CARD_H + gap),
    }));
    commitDoc({ ...d, items });
    setStatus('Arranged in grid');
    closeMenu();
  }, [commitDoc, closeMenu]);

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
          panX: parsed.panX ?? d.panX,
          panY: parsed.panY ?? d.panY,
          zoom: parsed.zoom ?? d.zoom,
        });
        setStatus(`Imported ${parsed.items.length} pin${parsed.items.length === 1 ? '' : 's'}`);
      };
      reader.readAsText(file);
    };
    input.click();
  }, [commitDoc]);

  const snapshotBoard = useCallback(() => {
    const d = docRef.current;
    if (!d) return;
    const json = exportConstellationJson(d);
    saveSnapshot(d.name || 'Snapshot', json);
    setStatus('Snapshot saved');
  }, []);

  const paletteCommands = useMemo<PaletteCommand[]>(() => [
    { id: 'zin', label: 'Zoom in', group: 'View', shortcut: 'Ctrl++', onRun: () => zoomBy(1.15) },
    { id: 'zout', label: 'Zoom out', group: 'View', shortcut: 'Ctrl+-', onRun: () => zoomBy(0.87) },
    { id: 'fit', label: 'Fit all pins', group: 'View', onRun: fitBoard },
    { id: 'grid', label: 'Arrange grid', group: 'Layout', onRun: arrangeGrid },
    { id: 'relations', label: showRelations ? 'Hide relation lines' : 'Show relation lines', group: 'View', onRun: () => setShowRelations(v => !v) },
    { id: 'snap', label: snapEnabled ? 'Disable snap' : 'Enable snap', group: 'Layout', onRun: () => setSnapEnabled(v => !v) },
    { id: 'export', label: 'Export constellation', group: 'File', onRun: exportBoard },
    { id: 'import', label: 'Import constellation', group: 'File', onRun: importBoard },
    { id: 'snapshot', label: 'Save snapshot', group: 'File', onRun: snapshotBoard },
    { id: 'copy', label: 'Copy selected paths', group: 'Edit', onRun: () => {
      const d = docRef.current;
      if (!d) return;
      const paths = d.items.filter(it => selectedSet.has(it.id)).map(it => it.path);
      if (paths.length) {
        setWorkspaceClipboard({ kind: 'spatial-pins', paths });
        void navigator.clipboard.writeText(paths.join('\n'));
        setStatus(`Copied ${paths.length} path${paths.length === 1 ? '' : 's'}`);
      }
    }},
  ], [zoomBy, fitBoard, arrangeGrid, showRelations, snapEnabled, exportBoard, importBoard, snapshotBoard, selectedSet]);

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
        setSelectedIds(d.items.map(it => it.id));
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
  }, [selectedIds, removeSelected, zoomBy, commitTransform, isWorkspaceActive, engine]);

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
      commitTransform();
    }

    if (marqueeRef.current.active) {
      const m = marqueeRef.current;
      const w = Math.abs(m.x2 - m.x1);
      const h = Math.abs(m.y2 - m.y1);
      if (w >= MIN_MARQUEE_PX && h >= MIN_MARQUEE_PX) {
        const hits = d.items.filter(it => cardIntersectsMarquee(it, m)).map(it => it.id);
        if (m.additive) setSelectedIds(prev => [...new Set([...prev, ...hits])]);
        else setSelectedIds(hits);
      }
      hideMarquee();
    }

    if (draggingRef.current) {
      const drag = itemDrag.current;
      const moveIds = new Set(drag.groupIds);
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

    interacting.current = false;
  }, [commitTransform, hideMarquee, commitDoc, snapEnabled]);

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

    const groupIds = wasSelected ? selectedIds : [item.id];
    if (!wasSelected) setSelectedIds([item.id]);

    interacting.current = true;
    const pt = screenToBoard(e.clientX, e.clientY);
    const starts = new Map<string, { x: number; y: number }>();
    const els = new Map<string, HTMLElement>();
    d.items.forEach(it => {
      if (groupIds.includes(it.id)) {
        starts.set(it.id, { x: it.x, y: it.y });
        const el = boardRef.current?.querySelector(`[data-spatial-card="${it.id}"]`) as HTMLElement | null;
        if (el) {
          els.set(it.id, el);
          el.classList.add('is-dragging');
        }
      }
    });
    dragElsRef.current = els;
    itemDrag.current = {
      id: item.id, ox: pt.x - item.x, oy: pt.y - item.y,
      originX: item.x, originY: item.y, groupIds, starts,
    };
    draggingRef.current = item.id;
    setDraggingId(item.id);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [selectedSet, selectedIds, screenToBoard]);

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
      const t = engine.getTransform();
      panStart.current = { x: e.clientX, y: e.clientY, panX: t.panX, panY: t.panY };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } else if (e.button === 0 && onEmptyBoard) {
      interacting.current = true;
      const pt = screenToBoard(e.clientX, e.clientY);
      marqueeRef.current = { active: true, additive: e.ctrlKey || e.metaKey, x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y };
      const m = { x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y };
      updateMarqueeDom(m);
      if (!marqueeRef.current.additive) setSelectedIds([]);
      setEditingNoteId(null);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
  };

  const onBoardPointerMove = (e: React.PointerEvent) => {
    e.stopPropagation();
    const board = e.currentTarget as HTMLElement;
    if (!panningRef.current) board.style.cursor = 'default';
    const d = docRef.current;
    if (!d) return;
    if (panning) {
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      applyLiveTransform(panStart.current.panX + dx, panStart.current.panY + dy, engine.getTransform().zoom);
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
    if (!doc) return;
    const el = surfaceRef.current;
    const board = boardRef.current;
    const unbindSurface = el ? bindWorkspaceCursorGuard(el) : undefined;
    const unbindBoard = board ? bindWorkspaceCursorGuard(board) : undefined;
    return () => {
      unbindSurface?.();
      unbindBoard?.();
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
    const pt = screenToBoard(e.clientX, e.clientY);
    const payload = readBndzFileDragData(e);
    if (payload?.paths?.length) { addPaths(payload.paths, pt); return; }
    const plain = e.dataTransfer.getData('text/plain');
    if (plain) {
      const paths = plain.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      if (paths.length) addPaths(paths, pt);
    }
  };

  const menuItem = doc?.items.find(it => it.id === menu?.targetId) ?? null;

  if (!doc) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm gap-2">
        <Icons8Icon id="loading" size={18} spin /> Loading spatial canvas…
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
          eyebrow="Constellation board"
          title="Spatial Canvas"
          subtitle="Pin references across every folder on an infinite orrery — originals never move on disk."
          icon="view_grid"
          accent="#c48b4a"
          features={[
            { icon: 'upload', title: 'Drop from anywhere', desc: 'Drag files from any pane onto the board' },
            { icon: 'notepad', title: 'Sticky notes', desc: 'Right-click a card to annotate' },
            { icon: 'zoom_in_ui', title: 'Pan & zoom', desc: 'Scroll to pan · Ctrl+scroll to zoom' },
            { icon: 'keyboard_ui', title: 'Marquee select', desc: 'Drag empty space to box-select cards' },
          ]}
          onDismiss={() => splash.dismiss()}
        />
      )}

      <header className="bndz-ws-chrome bndz-ws-chrome--spatial shrink-0">
        <div className="bndz-ws-chrome-brand min-w-0">
          <span className="bndz-ws-chrome-sigil bndz-ws-chrome-sigil--spatial" aria-hidden>
            <img src="/Ui/applications-featured.svg" alt="" className="bndz-ws-sigil-img" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="bndz-ws-chrome-title">Spatial Canvas</h1>
              <span className="bndz-ws-pill bndz-ws-pill--spatial">Constellation</span>
            </div>
            <p className="bndz-ws-chrome-desc">
              {doc.items.length} pin{doc.items.length === 1 ? '' : 's'}
              {selectedIds.length > 0 ? ` · ${selectedIds.length} selected` : ''}
              {autoSave ? ' · autosave on' : ''}
            </p>
          </div>
        </div>
        <div className="bndz-ws-chrome-actions shrink-0">
          {status && <span className="bndz-ws-status">{status}</span>}
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
              { id: 'fit', label: 'Fit all', iconSrc: '/Ui/details-view.svg', onClick: fitBoard },
              { id: 'grid', label: 'Arrange grid', iconSrc: '/Ui/icons.svg', disabled: !doc.items.length, onClick: arrangeGrid },
              { id: 'links', label: 'Relations', iconSrc: '/launcher-icons/emblem-shared.svg', active: showRelations, onClick: () => setShowRelations(v => !v) },
              { id: 'export', label: 'Export', iconSrc: '/launcher-icons/emblem-downloads.svg', onClick: exportBoard },
              { id: 'palette', label: 'Commands', iconSrc: '/Ui/keybinds-keyboard.svg', onClick: () => setPaletteOpen(true) },
              { id: 'intro', label: 'Intro', iconSrc: '/Ui/image-loading.svg', onClick: () => splash.replay() },
              {
                id: 'clear',
                label: 'Clear board',
                iconSrc: '/launcher-icons/trash_ui.png',
                disabled: !doc.items.length,
                onClick: clearBoard,
              },
              {
                id: 'reset',
                label: 'Reset view',
                iconSrc: '/launcher-icons/emblem-synchronizing.svg',
                onClick: () => commitDoc({ ...doc, zoom: 1, panX: 0, panY: 0 }),
              },
            ]}
          />

          <div
            ref={boardRef}
            data-spatial-board
            className={`bndz-spatial-board flex-1 min-h-0 relative overflow-hidden${panning ? ' is-panning' : ''}`}
            style={{ touchAction: 'none', cursor: panning ? 'grabbing' : 'default' }}
            onPointerEnter={() => {
              if (boardRef.current && !panning) boardRef.current.style.cursor = 'default';
            }}
            onPointerDown={onBoardPointerDown}
            onPointerMove={onBoardPointerMove}
            onPointerUp={onBoardPointerUp}
            onPointerCancel={onBoardPointerUp}
            onPointerLeave={(e) => {
              if (panningRef.current) finishPointerGesture();
              else onBoardPointerUp(e);
            }}
            onContextMenu={e => { e.stopPropagation(); onContextMenu(e, 'spatial-board'); }}
            onDragOver={e => { if (hasBndzFileDrag(e) || e.dataTransfer.types.includes('text/plain')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
            onDrop={onDrop}
          >
            <div className="bndz-spatial-vignette pointer-events-none" aria-hidden />
            <div ref={gridRef} className="bndz-spatial-grid absolute inset-0 pointer-events-none" />
            <div ref={marqueeElRef} className="bndz-spatial-marquee" style={{ display: 'none' }} />
            <div ref={transformLayerRef} className="bndz-spatial-layer absolute origin-top-left pointer-events-none">
              {clusters.map(c => (
                <div
                  key={c.id}
                  className="bndz-spatial-cluster-halo pointer-events-none"
                  style={{ left: c.cx - 40, top: c.cy - 40, width: 80, height: 80 }}
                  title={`${c.label} (${c.itemIds.length})`}
                />
              ))}
              {spatialV2 ? (
                <SpatialSpringBoard
                  items={doc.items}
                  relations={showRelations ? relations : []}
                  selectedSet={selectedSet}
                  draggingId={draggingId}
                  editingNoteId={editingNoteId}
                  cardW={CARD_W}
                  cardH={CARD_H}
                  onPointerDown={onCardPointerDown}
                  onDoubleClick={openItem}
                  onContextMenu={(e, it) => {
                    if (!selectedSet.has(it.id)) setSelectedIds([it.id]);
                    onContextMenu(e, 'spatial-card', it.id);
                  }}
                  onNoteBlur={(id, val) => { updateNote(id, val); setEditingNoteId(null); }}
                  onNoteCancel={() => setEditingNoteId(null)}
                />
              ) : (
                <>
              {showRelations && relations.length > 0 && (
                <svg className="bndz-spatial-relations" aria-hidden>
                  {relations.map((rel, i) => {
                    const a = doc.items.find(it => it.id === rel.fromId);
                    const b = doc.items.find(it => it.id === rel.toId);
                    if (!a || !b) return null;
                    const x1 = a.x + CARD_W / 2;
                    const y1 = a.y + CARD_H / 2;
                    const x2 = b.x + CARD_W / 2;
                    const y2 = b.y + CARD_H / 2;
                    const mx = (x1 + x2) / 2;
                    return (
                      <path
                        key={`${rel.fromId}_${rel.toId}_${i}`}
                        d={`M ${x1} ${y1} Q ${mx} ${y1} ${x2} ${y2}`}
                        className={`bndz-relation-line bndz-relation-line--${rel.reason}`}
                      />
                    );
                  })}
                </svg>
              )}
              {doc.items.map(item => (
                <SpatialCanvasCard
                  key={item.id}
                  item={item}
                  selected={selectedSet.has(item.id)}
                  dragging={draggingId === item.id}
                  editingNote={editingNoteId === item.id}
                  cardW={CARD_W}
                  cardH={CARD_H}
                  onPointerDown={onCardPointerDown}
                  onDoubleClick={openItem}
                  onContextMenu={(e, it) => {
                    if (!selectedSet.has(it.id)) setSelectedIds([it.id]);
                    onContextMenu(e, 'spatial-card', it.id);
                  }}
                  onNoteBlur={(id, val) => { updateNote(id, val); setEditingNoteId(null); }}
                  onNoteCancel={() => setEditingNoteId(null)}
                />
              ))}
                </>
              )}
            </div>
            {doc.items.length === 0 && (
              <div className="bndz-spatial-empty absolute inset-0 flex flex-col items-center justify-center text-center p-8 pointer-events-none">
                <div className="bndz-spatial-empty-orbit" aria-hidden />
                <img src="/Ui/preview-Big Folder.svg" alt="" className="w-16 h-16 opacity-40 mb-4" />
                <p className="text-sm text-gray-300 font-medium">Drop files onto the constellation</p>
                <p className="text-[11px] text-gray-500 mt-1.5 max-w-[300px]">Pins are references only — originals stay on disk. Tag and annotate in the inspector.</p>
              </div>
            )}
            {showMinimap && doc.items.length > 0 && (
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
            <span className="bndz-ws-rail-stat">{doc.items.length} pinned</span>
            <span className="bndz-ws-rail-hint">Ctrl+scroll zoom · scroll pan · Space/Alt/right-drag pan · Ctrl+Shift+P commands</span>
            <button ref={zoomPillRef} type="button" className="bndz-ws-rail-zoom-pill" onClick={() => setShowMinimap(v => !v)}>
              {(displayZoom * 100).toFixed(0)}%
            </button>
          </footer>
        </div>

        <SpatialInspector
          items={doc.items}
          selectedIds={selectedIds}
          onOpen={openItem}
          onReveal={revealItem}
          onCopyPath={copyPath}
          onEditNote={setEditingNoteId}
          onUpdateNote={updateNote}
          onAddTag={addTagToPath}
          onRemoveTag={removeTagFromPath}
          onBatchAddTag={batchAddTags}
        />
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
          <WorkspaceMenuItem label="Copy path to automation" icon="copy" onClick={() => {
            setWorkspaceClipboard({ kind: 'spatial-pins', paths: [menuItem.path] });
            window.dispatchEvent(new CustomEvent('bndz-automation-add-from-pin', { detail: { paths: [menuItem.path] } }));
            closeMenu();
          }} />
          <WorkspaceMenuSep />
          <WorkspaceMenuItem label="Edit note" icon="notepad" onClick={() => { setEditingNoteId(menuItem.id); closeMenu(); }} />
          <WorkspaceMenuItem label="Remove from board" icon="delete" danger onClick={() => removeItem(menuItem.id)} />
          {selectedIds.length > 1 && (
            <WorkspaceMenuItem label={`Remove ${selectedIds.length} selected`} icon="delete" danger onClick={() => removeSelected()} />
          )}
        </WorkspaceMenuPanel>
      )}

      {menu?.kind === 'spatial-board' && (
        <WorkspaceMenuPanel variant="spatial" x={menu.x} y={menu.y}>
          <WorkspaceMenuItem label="Fit all cards" icon="zoom_in_ui" onClick={fitBoard} />
          <WorkspaceMenuItem label="Arrange grid" icon="view_grid" onClick={arrangeGrid} disabled={!doc.items.length} />
          <WorkspaceMenuItem label="Reset zoom" icon="reset_ui" onClick={() => { commitDoc({ ...doc, zoom: 1, panX: 0, panY: 0 }); closeMenu(); }} />
          <WorkspaceMenuSep />
          <WorkspaceMenuItem label="Clear board" icon="delete" danger onClick={clearBoard} disabled={!doc.items.length} />
        </WorkspaceMenuPanel>
      )}
    </div>
  );
}
