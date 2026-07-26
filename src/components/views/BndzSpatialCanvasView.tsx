import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { ShellNativeIcon } from '../ShellNativeIcon';
import { readBndzFileDragData, hasBndzFileDrag } from '../../lib/bndzDrag';
import {
  loadSpatialCanvas, saveSpatialCanvas, saveSpatialCanvasNow, type CanvasItem, type SpatialCanvasDoc,
} from '../../lib/spatialCanvasStore';
import { toWindowsPath } from '../../lib/pathUtils';
import { toPanePath } from '../../lib/shellPaths';
import { useAppConfig } from '../../data/configContext';

type Props = {
  onNavigate: (path: string) => void;
  onOpenPath?: (path: string) => void;
};

function newItem(path: string, x: number, y: number): CanvasItem {
  const name = path.split(/[/\\]/).pop() || path;
  return { id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, path, name, x, y };
}

export default function BndzSpatialCanvasView({ onNavigate, onOpenPath }: Props) {
  const { config } = useAppConfig();
  const autoSave = config.spatialCanvasAutoSave !== false;
  const saveDelayMs = typeof config.spatialCanvasAutoSaveDelayMs === 'number'
    ? config.spatialCanvasAutoSaveDelayMs
    : 400;
  const wheelZoom = config.spatialCanvasWheelZoom !== false;
  const minZoom = typeof config.spatialCanvasMinZoom === 'number' ? config.spatialCanvasMinZoom : 0.35;
  const maxZoom = typeof config.spatialCanvasMaxZoom === 'number' ? config.spatialCanvasMaxZoom : 2.5;

  const [doc, setDoc] = useState<SpatialCanvasDoc | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<SpatialCanvasDoc | null>(null);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const itemDrag = useRef({ id: '', ox: 0, oy: 0, startX: 0, startY: 0 });

  docRef.current = doc;

  useEffect(() => {
    let active = true;
    loadSpatialCanvas().then(d => { if (active) setDoc(d); });
    return () => { active = false; };
  }, []);

  const queueSave = useCallback((next: SpatialCanvasDoc) => {
    setDoc(next);
    if (!autoSave) return;
    void saveSpatialCanvas(next, saveDelayMs).then(ok => {
      if (!ok) setStatus('Save failed — try Save button');
    });
  }, [autoSave, saveDelayMs]);

  const screenToBoard = useCallback((clientX: number, clientY: number) => {
    const el = boardRef.current;
    const d = docRef.current;
    if (!el || !d) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    const x = (clientX - rect.left - d.panX) / d.zoom;
    const y = (clientY - rect.top - d.panY) / d.zoom;
    return { x, y };
  }, []);

  // Non-passive wheel listener — React onWheel cannot preventDefault in WebView2.
  useEffect(() => {
    const el = boardRef.current;
    if (!el || !wheelZoom) return;
    const onWheel = (e: WheelEvent) => {
      const d = docRef.current;
      if (!d) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.92 : 1.08;
      const nextZoom = Math.min(maxZoom, Math.max(minZoom, d.zoom * delta));
      queueSave({ ...d, zoom: nextZoom });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [wheelZoom, minZoom, maxZoom, queueSave, doc !== null]);

  const addPaths = useCallback((paths: string[], at?: { x: number; y: number }) => {
    if (!doc || !paths.length) return;
    const base = at || screenToBoard(boardRef.current!.clientWidth / 2, boardRef.current!.clientHeight / 2);
    const items = [...doc.items];
    paths.forEach((p, i) => {
      const win = toWindowsPath(p);
      if (items.some(it => it.path.toLowerCase() === win.toLowerCase())) return;
      items.push(newItem(win, base.x + (i % 4) * 168, base.y + Math.floor(i / 4) * 132));
    });
    queueSave({ ...doc, items });
    setStatus(`Added ${paths.length} item${paths.length === 1 ? '' : 's'} to board`);
  }, [doc, queueSave, screenToBoard]);

  const onBoardPointerDown = (e: React.PointerEvent) => {
    if (!doc) return;
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      setPanning(true);
      panStart.current = { x: e.clientX, y: e.clientY, panX: doc.panX, panY: doc.panY };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } else if (e.target === boardRef.current) {
      setSelectedId(null);
    }
  };

  const onBoardPointerMove = (e: React.PointerEvent) => {
    if (!doc) return;
    if (panning) {
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      setDoc({ ...doc, panX: panStart.current.panX + dx, panY: panStart.current.panY + dy });
      return;
    }
    if (draggingId) {
      const pt = screenToBoard(e.clientX, e.clientY);
      const items = doc.items.map(it => it.id === draggingId
        ? { ...it, x: pt.x - itemDrag.current.ox, y: pt.y - itemDrag.current.oy }
        : it);
      setDoc({ ...doc, items });
    }
  };

  const onBoardPointerUp = (e: React.PointerEvent) => {
    if (panning) {
      setPanning(false);
      if (doc) queueSave(doc);
    }
    if (draggingId && doc) {
      queueSave(doc);
      setDraggingId(null);
    }
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* */ }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const pt = screenToBoard(e.clientX, e.clientY);
    const payload = readBndzFileDragData(e);
    if (payload?.paths?.length) {
      addPaths(payload.paths, pt);
      return;
    }
    const plain = e.dataTransfer.getData('text/plain');
    if (plain) {
      const paths = plain.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      if (paths.length) addPaths(paths, pt);
    }
  };

  const removeSelected = () => {
    if (!doc || !selectedId) return;
    queueSave({ ...doc, items: doc.items.filter(it => it.id !== selectedId) });
    setSelectedId(null);
  };

  if (!doc) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm gap-2">
        <Icons8Icon id="loading" size={18} spin /> Loading spatial canvas…
      </div>
    );
  }

  return (
    <div className="bndz-spatial-canvas flex flex-col h-full min-h-0" data-bndz-surface>
      <header className="shrink-0 px-4 py-3 border-b border-white/[0.06] flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icons8Icon id="view_grid" size={16} className="text-[#7eb8e8]" />
            <h1 className="text-sm font-semibold text-white">Spatial Canvas</h1>
          </div>
          <p className="text-[11px] text-[#7a8088] mt-0.5">
            Drag files from any folder onto the board — references only, nothing moves on disk.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {status && <span className="text-[10px] text-[#7eb8e8] max-w-[200px] truncate">{status}</span>}
          <button type="button" className="bndz-lens-chip" onClick={() => queueSave({ ...doc, items: [], panX: 0, panY: 0, zoom: 1 })}>Clear</button>
          <button type="button" className="bndz-lens-chip" disabled={!selectedId} onClick={removeSelected}>Remove</button>
          <button
            type="button"
            className="bndz-lens-chip"
            onClick={() => void saveSpatialCanvasNow(doc).then(ok => setStatus(ok ? 'Saved' : 'Save failed'))}
          >
            Save
          </button>
        </div>
      </header>

      <div
        ref={boardRef}
        className="bndz-spatial-board flex-1 min-h-0 relative overflow-hidden cursor-grab active:cursor-grabbing"
        onPointerDown={onBoardPointerDown}
        onPointerMove={onBoardPointerMove}
        onPointerUp={onBoardPointerUp}
        onPointerLeave={onBoardPointerUp}
        onDragOver={e => { if (hasBndzFileDrag(e) || e.dataTransfer.types.includes('text/plain')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
        onDrop={onDrop}
      >
        <div
          className="bndz-spatial-grid absolute inset-0 pointer-events-none"
          style={{
            backgroundSize: `${24 * doc.zoom}px ${24 * doc.zoom}px`,
            backgroundPosition: `${doc.panX}px ${doc.panY}px`,
          }}
        />
        <div
          className="absolute origin-top-left"
          style={{ transform: `translate(${doc.panX}px, ${doc.panY}px) scale(${doc.zoom})` }}
        >
          {doc.items.map(item => (
            <div
              key={item.id}
              className={`bndz-spatial-card${selectedId === item.id ? ' is-selected' : ''}`}
              style={{ left: item.x, top: item.y }}
              onPointerDown={e => {
                e.stopPropagation();
                setSelectedId(item.id);
                const pt = screenToBoard(e.clientX, e.clientY);
                itemDrag.current = { id: item.id, ox: pt.x - item.x, oy: pt.y - item.y, startX: e.clientX, startY: e.clientY };
                setDraggingId(item.id);
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              }}
              onDoubleClick={() => {
                if (onOpenPath) onOpenPath(item.path);
                else onNavigate(toPanePath(item.path));
              }}
            >
              <div className="bndz-spatial-card-icon">
                <ShellNativeIcon path={item.path} isDir={false} size={40} eager preferThumbnail />
              </div>
              <div className="bndz-spatial-card-body">
                <div className="bndz-spatial-card-name" title={item.name}>{item.name}</div>
                <div className="bndz-spatial-card-path" title={item.path}>{item.path}</div>
              </div>
            </div>
          ))}
        </div>
        {doc.items.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-8 pointer-events-none">
            <Icons8Icon id="view_grid" size={48} className="opacity-20 mb-3" />
            <p className="text-sm text-gray-400">Drop files here from any BNDZ pane</p>
            <p className="text-[11px] text-gray-500 mt-1">Alt+drag to pan · scroll to zoom · double-click to open</p>
          </div>
        )}
      </div>
      <footer className="shrink-0 px-4 py-1.5 border-t border-white/[0.06] text-[10px] text-[#7a8088] flex justify-between">
        <span>{doc.items.length} reference{doc.items.length === 1 ? '' : 's'}</span>
        <span>Zoom {(doc.zoom * 100).toFixed(0)}%</span>
      </footer>
    </div>
  );
}
