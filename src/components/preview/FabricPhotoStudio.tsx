import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Canvas,
  Circle,
  FabricImage,
  FabricObject,
  IText,
  Line,
  PencilBrush,
  Point,
  Rect,
  filters,
  type TEvent,
  type TPointerEventInfo,
} from 'fabric';
import { Icons8Icon } from '../Icons8Icon';

export type PhotoStudioTool =
  | 'select'
  | 'hand'
  | 'brush'
  | 'eraser'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'text'
  | 'crop';

type LayerRow = {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  kind: string;
};

type AdjustState = {
  brightness: number;
  contrast: number;
  saturation: number;
  hue: number;
  blur: number;
  grayscale: boolean;
  invert: boolean;
};

type Props = {
  imageUrl: string;
  imageName: string;
  onExport: (payload: { dataUrl: string; mime: string; ext: string }) => void;
  onReady?: () => void;
  onError?: (message: string) => void;
  busy?: boolean;
  /** Host bar can trigger PNG/JPEG export without duplicating canvas logic. */
  exportHookRef?: React.MutableRefObject<((kind: 'png' | 'jpeg') => void) | null>;
};

const TOOLS: { id: PhotoStudioTool; label: string; icon: string; tip: string }[] = [
  { id: 'select', label: 'Move', icon: 'target_ui', tip: 'V — Select / move' },
  { id: 'hand', label: 'Hand', icon: 'mouse_ui', tip: 'H — Pan canvas' },
  { id: 'brush', label: 'Brush', icon: 'paint', tip: 'B — Paint brush' },
  { id: 'eraser', label: 'Eraser', icon: 'trash_ui', tip: 'E — Erase' },
  { id: 'rect', label: 'Rect', icon: 'view_grid', tip: 'U — Rectangle' },
  { id: 'ellipse', label: 'Ellipse', icon: 'images_ui', tip: 'O — Ellipse' },
  { id: 'line', label: 'Line', icon: 'link', tip: 'L — Line' },
  { id: 'text', label: 'Text', icon: 'notepad', tip: 'T — Type' },
  { id: 'crop', label: 'Crop', icon: 'cut', tip: 'C — Crop frame' },
];

const DEFAULT_ADJUST: AdjustState = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  hue: 0,
  blur: 0,
  grayscale: false,
  invert: false,
};

function objectId(obj: FabricObject): string {
  const anyObj = obj as FabricObject & { __bndzId?: string };
  if (!anyObj.__bndzId) anyObj.__bndzId = `L${Math.random().toString(36).slice(2, 9)}`;
  return anyObj.__bndzId;
}

function objectName(obj: FabricObject): string {
  const anyObj = obj as FabricObject & { __bndzName?: string };
  if (anyObj.__bndzName) return anyObj.__bndzName;
  const t = obj.type || 'layer';
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export default function FabricPhotoStudio({
  imageUrl,
  imageName,
  onExport,
  onReady,
  onError,
  busy,
  exportHookRef,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<Canvas | null>(null);
  const baseImageRef = useRef<FabricImage | null>(null);
  const historyRef = useRef<string[]>([]);
  const historyIdxRef = useRef(-1);
  const suppressHistoryRef = useRef(false);
  const panningRef = useRef(false);
  const drawStartRef = useRef<{ x: number; y: number; obj?: FabricObject } | null>(null);
  const toolRef = useRef<PhotoStudioTool>('select');
  const brushColorRef = useRef('#ff2bd6');
  const brushSizeRef = useRef(12);
  const fillRef = useRef('#ff2bd6');
  const strokeRef = useRef('#ffffff');
  const strokeWidthRef = useRef(2);

  const [tool, setTool] = useState<PhotoStudioTool>('select');
  const [brushColor, setBrushColor] = useState('#ff2bd6');
  const [brushSize, setBrushSize] = useState(12);
  const [fill, setFill] = useState('#ff2bd6');
  const [stroke, setStroke] = useState('#ffffff');
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [zoomPct, setZoomPct] = useState(100);
  const [layers, setLayers] = useState<LayerRow[]>([]);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [adjust, setAdjust] = useState<AdjustState>(DEFAULT_ADJUST);
  const [status, setStatus] = useState<string | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  toolRef.current = tool;
  brushColorRef.current = brushColor;
  brushSizeRef.current = brushSize;
  fillRef.current = fill;
  strokeRef.current = stroke;
  strokeWidthRef.current = strokeWidth;

  const refreshLayers = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const rows: LayerRow[] = canvas
      .getObjects()
      .slice()
      .reverse()
      .map((obj) => ({
        id: objectId(obj),
        name: objectName(obj),
        visible: obj.visible !== false,
        locked: !!obj.lockMovementX && !!obj.lockMovementY && !obj.selectable,
        kind: String(obj.type || 'object'),
      }));
    setLayers(rows);
    const active = canvas.getActiveObject();
    setActiveLayerId(active ? objectId(active) : null);
  }, []);

  const pushHistory = useCallback(async () => {
    const canvas = fabricRef.current;
    if (!canvas || suppressHistoryRef.current) return;
    try {
      const json = JSON.stringify(canvas.toJSON(['__bndzId', '__bndzName', '__bndzBase']));
      const stack = historyRef.current.slice(0, historyIdxRef.current + 1);
      if (stack[stack.length - 1] === json) return;
      stack.push(json);
      if (stack.length > 40) stack.shift();
      historyRef.current = stack;
      historyIdxRef.current = stack.length - 1;
      setCanUndo(historyIdxRef.current > 0);
      setCanRedo(false);
    } catch {
      /* ignore */
    }
  }, []);

  const applyAdjustments = useCallback(async (next: AdjustState) => {
    const img = baseImageRef.current;
    if (!img) return;
    const list: unknown[] = [];
    if (next.brightness) list.push(new filters.Brightness({ brightness: next.brightness }));
    if (next.contrast) list.push(new filters.Contrast({ contrast: next.contrast }));
    if (next.saturation) list.push(new filters.Saturation({ saturation: next.saturation }));
    if (next.hue) list.push(new filters.HueRotation({ rotation: next.hue }));
    if (next.blur) list.push(new filters.Blur({ blur: next.blur }));
    if (next.grayscale) list.push(new filters.Grayscale());
    if (next.invert) list.push(new filters.Invert());
    img.filters = list as FabricImage['filters'];
    await img.applyFilters();
    fabricRef.current?.requestRenderAll();
  }, []);

  const configureTool = useCallback((next: PhotoStudioTool) => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    setTool(next);
    toolRef.current = next;
    const drawing = next === 'brush' || next === 'eraser';
    canvas.isDrawingMode = drawing;
    canvas.selection = next === 'select';
    canvas.defaultCursor = next === 'hand' ? 'grab' : drawing || next === 'crop' ? 'crosshair' : 'default';
    canvas.forEachObject((obj) => {
      const isBase = !!(obj as FabricObject & { __bndzBase?: boolean }).__bndzBase;
      if (isBase) {
        obj.selectable = false;
        obj.evented = next === 'select';
        return;
      }
      obj.selectable = next === 'select';
      obj.evented = next === 'select' || next === 'crop';
    });
    if (drawing) {
      const brush = new PencilBrush(canvas);
      brush.width = brushSizeRef.current;
      brush.color = next === 'eraser' ? 'rgba(0,0,0,1)' : brushColorRef.current;
      canvas.freeDrawingBrush = brush;
      if (next === 'eraser') {
        canvas.freeDrawingBrush = brush;
        // destination-out style erase via globalCompositeOperation on brush
        (brush as PencilBrush & { globalCompositeOperation?: string }).globalCompositeOperation = 'destination-out';
      } else {
        (brush as PencilBrush & { globalCompositeOperation?: string }).globalCompositeOperation = 'source-over';
      }
    }
    canvas.requestRenderAll();
  }, []);

  const fitImage = useCallback(() => {
    const canvas = fabricRef.current;
    const img = baseImageRef.current;
    const host = hostRef.current;
    if (!canvas || !img || !host) return;
    const pad = 48;
    const availW = Math.max(120, host.clientWidth - pad);
    const availH = Math.max(120, host.clientHeight - pad);
    const iw = img.width || 1;
    const ih = img.height || 1;
    const scale = Math.min(availW / iw, availH / ih, 1);
    canvas.setZoom(1);
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    img.set({
      left: (canvas.getWidth() - iw * scale) / 2,
      top: (canvas.getHeight() - ih * scale) / 2,
      scaleX: scale,
      scaleY: scale,
    });
    canvas.requestRenderAll();
    setZoomPct(100);
  }, []);

  const setZoom = useCallback((pct: number) => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const z = Math.max(0.1, Math.min(8, pct / 100));
    const center = canvas.getCenterPoint();
    canvas.zoomToPoint(center, z);
    setZoomPct(Math.round(z * 100));
  }, []);

  const loadImage = useCallback(async () => {
    const canvas = fabricRef.current;
    if (!canvas || !imageUrl) return;
    try {
      setStatus('Loading image…');
      const img = await FabricImage.fromURL(imageUrl, { crossOrigin: 'anonymous' });
      canvas.clear();
      const anyImg = img as FabricImage & { __bndzBase?: boolean; __bndzName?: string; __bndzId?: string };
      anyImg.__bndzBase = true;
      anyImg.__bndzName = imageName || 'Background';
      anyImg.__bndzId = 'base';
      anyImg.set({ selectable: false, evented: true, hoverCursor: 'default' });
      canvas.add(img);
      baseImageRef.current = img;
      fitImage();
      refreshLayers();
      historyRef.current = [];
      historyIdxRef.current = -1;
      await pushHistory();
      setAdjust(DEFAULT_ADJUST);
      setStatus(null);
      onReady?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load image into studio';
      onError?.(message);
      setStatus(message);
    }
  }, [fitImage, imageName, imageUrl, onError, onReady, pushHistory, refreshLayers]);

  // Boot Fabric canvas
  useEffect(() => {
    const el = canvasElRef.current;
    const host = hostRef.current;
    if (!el || !host) return;

    const canvas = new Canvas(el, {
      preserveObjectStacking: true,
      selection: true,
      backgroundColor: '#1a1c22',
      stopContextMenu: true,
      fireRightClick: true,
    });
    fabricRef.current = canvas;

    const resize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (w < 40 || h < 40) return;
      canvas.setDimensions({ width: w, height: h });
      canvas.requestRenderAll();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    const onChanged = () => {
      refreshLayers();
      void pushHistory();
    };
    canvas.on('object:added', onChanged);
    canvas.on('object:removed', onChanged);
    canvas.on('object:modified', onChanged);
    canvas.on('path:created', onChanged);
    canvas.on('selection:created', refreshLayers);
    canvas.on('selection:updated', refreshLayers);
    canvas.on('selection:cleared', refreshLayers);

    canvas.on('mouse:down', (opt: TPointerEventInfo<TEvent['e']>) => {
      const t = toolRef.current;
      if (t === 'hand') {
        panningRef.current = true;
        canvas.setCursor('grabbing');
        return;
      }
      if (t === 'select' || t === 'brush' || t === 'eraser') return;
      const pointer = canvas.getScenePoint(opt.e);
      drawStartRef.current = { x: pointer.x, y: pointer.y };
      let obj: FabricObject | undefined;
      if (t === 'rect' || t === 'crop') {
        obj = new Rect({
          left: pointer.x,
          top: pointer.y,
          width: 1,
          height: 1,
          fill: t === 'crop' ? 'rgba(13,153,255,0.12)' : fillRef.current,
          stroke: t === 'crop' ? '#0d99ff' : strokeRef.current,
          strokeWidth: t === 'crop' ? 1 : strokeWidthRef.current,
          strokeDashArray: t === 'crop' ? [6, 4] : undefined,
        });
        (obj as FabricObject & { __bndzName?: string }).__bndzName = t === 'crop' ? 'Crop' : 'Rectangle';
      } else if (t === 'ellipse') {
        obj = new Circle({
          left: pointer.x,
          top: pointer.y,
          radius: 1,
          fill: fillRef.current,
          stroke: strokeRef.current,
          strokeWidth: strokeWidthRef.current,
        });
        (obj as FabricObject & { __bndzName?: string }).__bndzName = 'Ellipse';
      } else if (t === 'line') {
        obj = new Line([pointer.x, pointer.y, pointer.x, pointer.y], {
          stroke: strokeRef.current || fillRef.current,
          strokeWidth: Math.max(1, strokeWidthRef.current),
        });
        (obj as FabricObject & { __bndzName?: string }).__bndzName = 'Line';
      } else if (t === 'text') {
        obj = new IText('Text', {
          left: pointer.x,
          top: pointer.y,
          fill: fillRef.current,
          fontSize: 28,
          fontFamily: 'Segoe UI Variable, Segoe UI, sans-serif',
        });
        (obj as FabricObject & { __bndzName?: string }).__bndzName = 'Text';
        canvas.add(obj);
        canvas.setActiveObject(obj);
        configureTool('select');
        drawStartRef.current = null;
        return;
      }
      if (obj) {
        canvas.add(obj);
        drawStartRef.current.obj = obj;
        canvas.setActiveObject(obj);
      }
    });

    canvas.on('mouse:move', (opt) => {
      if (panningRef.current && toolRef.current === 'hand') {
        const e = opt.e as MouseEvent;
        const vpt = canvas.viewportTransform;
        if (vpt) {
          vpt[4] += e.movementX;
          vpt[5] += e.movementY;
          canvas.requestRenderAll();
        }
        return;
      }
      const start = drawStartRef.current;
      if (!start?.obj) return;
      const pointer = canvas.getScenePoint(opt.e);
      const w = Math.abs(pointer.x - start.x);
      const h = Math.abs(pointer.y - start.y);
      const left = Math.min(pointer.x, start.x);
      const top = Math.min(pointer.y, start.y);
      if (start.obj instanceof Circle) {
        const r = Math.max(w, h) / 2;
        start.obj.set({ left, top, radius: Math.max(1, r) });
      } else if (start.obj instanceof Line) {
        start.obj.set({ x2: pointer.x, y2: pointer.y });
      } else {
        start.obj.set({ left, top, width: Math.max(1, w), height: Math.max(1, h) });
      }
      canvas.requestRenderAll();
    });

    canvas.on('mouse:up', () => {
      panningRef.current = false;
      if (toolRef.current === 'hand') canvas.setCursor('grab');
      if (drawStartRef.current?.obj) {
        drawStartRef.current = null;
        if (toolRef.current === 'crop') {
          setStatus('Crop frame ready — click Apply Crop');
        } else if (toolRef.current !== 'select') {
          configureTool('select');
        }
      }
    });

    canvas.on('mouse:wheel', (opt) => {
      const e = opt.e as WheelEvent;
      e.preventDefault();
      e.stopPropagation();
      let zoom = canvas.getZoom();
      zoom *= 0.999 ** e.deltaY;
      zoom = Math.max(0.1, Math.min(8, zoom));
      canvas.zoomToPoint(new Point(e.offsetX, e.offsetY), zoom);
      setZoomPct(Math.round(zoom * 100));
    });

    return () => {
      ro.disconnect();
      canvas.dispose();
      fabricRef.current = null;
      baseImageRef.current = null;
    };
  }, [configureTool, pushHistory, refreshLayers]);

  useEffect(() => {
    void loadImage();
  }, [loadImage]);

  useEffect(() => {
    configureTool(tool);
  }, [tool, configureTool]);

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas?.isDrawingMode || !canvas.freeDrawingBrush) return;
    canvas.freeDrawingBrush.width = brushSize;
    if (tool === 'brush') canvas.freeDrawingBrush.color = brushColor;
  }, [brushColor, brushSize, tool]);

  const undo = useCallback(async () => {
    const canvas = fabricRef.current;
    if (!canvas || historyIdxRef.current <= 0) return;
    suppressHistoryRef.current = true;
    historyIdxRef.current -= 1;
    const json = historyRef.current[historyIdxRef.current];
    await canvas.loadFromJSON(json);
    baseImageRef.current = (canvas.getObjects().find(
      (o) => (o as FabricObject & { __bndzBase?: boolean }).__bndzBase,
    ) as FabricImage | undefined) || null;
    canvas.requestRenderAll();
    refreshLayers();
    setCanUndo(historyIdxRef.current > 0);
    setCanRedo(historyIdxRef.current < historyRef.current.length - 1);
    suppressHistoryRef.current = false;
  }, [refreshLayers]);

  const redo = useCallback(async () => {
    const canvas = fabricRef.current;
    if (!canvas || historyIdxRef.current >= historyRef.current.length - 1) return;
    suppressHistoryRef.current = true;
    historyIdxRef.current += 1;
    const json = historyRef.current[historyIdxRef.current];
    await canvas.loadFromJSON(json);
    baseImageRef.current = (canvas.getObjects().find(
      (o) => (o as FabricObject & { __bndzBase?: boolean }).__bndzBase,
    ) as FabricImage | undefined) || null;
    canvas.requestRenderAll();
    refreshLayers();
    setCanUndo(historyIdxRef.current > 0);
    setCanRedo(historyIdxRef.current < historyRef.current.length - 1);
    suppressHistoryRef.current = false;
  }, [refreshLayers]);

  const selectLayer = (id: string) => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const obj = canvas.getObjects().find((o) => objectId(o) === id);
    if (!obj || (obj as FabricObject & { __bndzBase?: boolean }).__bndzBase) return;
    canvas.setActiveObject(obj);
    canvas.requestRenderAll();
    setActiveLayerId(id);
  };

  const toggleLayerVisible = (id: string) => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const obj = canvas.getObjects().find((o) => objectId(o) === id);
    if (!obj) return;
    obj.visible = !obj.visible;
    canvas.requestRenderAll();
    refreshLayers();
    void pushHistory();
  };

  const deleteActive = () => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObjects().filter(
      (o) => !(o as FabricObject & { __bndzBase?: boolean }).__bndzBase,
    );
    if (!active.length) return;
    active.forEach((o) => canvas.remove(o));
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    refreshLayers();
    void pushHistory();
  };

  const bringForward = () => {
    const canvas = fabricRef.current;
    const obj = canvas?.getActiveObject();
    if (!canvas || !obj) return;
    canvas.bringObjectForward(obj);
    canvas.requestRenderAll();
    refreshLayers();
  };

  const sendBackward = () => {
    const canvas = fabricRef.current;
    const obj = canvas?.getActiveObject();
    if (!canvas || !obj) return;
    canvas.sendObjectBackwards(obj);
    canvas.requestRenderAll();
    refreshLayers();
  };

  const applyCrop = async () => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const crop = canvas.getObjects().find((o) => objectName(o) === 'Crop' && o instanceof Rect) as Rect | undefined;
    if (!crop) {
      setStatus('Draw a crop frame first (Crop tool)');
      return;
    }
    const dataUrl = canvas.toDataURL({
      format: 'png',
      left: crop.left || 0,
      top: crop.top || 0,
      width: (crop.width || 1) * (crop.scaleX || 1),
      height: (crop.height || 1) * (crop.scaleY || 1),
      multiplier: 1,
    });
    canvas.remove(crop);
    const img = await FabricImage.fromURL(dataUrl);
    canvas.clear();
    const anyImg = img as FabricImage & { __bndzBase?: boolean; __bndzName?: string; __bndzId?: string };
    anyImg.__bndzBase = true;
    anyImg.__bndzName = 'Background';
    anyImg.__bndzId = 'base';
    anyImg.set({ selectable: false });
    canvas.add(img);
    baseImageRef.current = img;
    fitImage();
    refreshLayers();
    await pushHistory();
    setStatus('Crop applied');
    configureTool('select');
  };

  const runExport = useCallback((kind: 'png' | 'jpeg') => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    // Hide crop guides for export
    const guides = canvas.getObjects().filter((o) => objectName(o) === 'Crop');
    guides.forEach((g) => { g.visible = false; });
    const dataUrl = kind === 'jpeg'
      ? canvas.toDataURL({ format: 'jpeg', quality: 0.92, multiplier: 1 })
      : canvas.toDataURL({ format: 'png', multiplier: 1 });
    guides.forEach((g) => { g.visible = true; });
    onExport(
      kind === 'jpeg'
        ? { dataUrl, mime: 'image/jpeg', ext: 'jpg' }
        : { dataUrl, mime: 'image/png', ext: 'png' },
    );
  }, [onExport]);

  useEffect(() => {
    if (!exportHookRef) return;
    exportHookRef.current = runExport;
    return () => { exportHookRef.current = null; };
  }, [exportHookRef, runExport]);

  const exportPng = () => runExport('png');
  const exportJpeg = () => runExport('jpeg');

  const onAdjustChange = async (patch: Partial<AdjustState>) => {
    const next = { ...adjust, ...patch };
    setAdjust(next);
    await applyAdjustments(next);
  };

  const shortcutHint = useMemo(() => TOOLS.find((t) => t.id === tool)?.tip || '', [tool]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const map: Record<string, PhotoStudioTool> = {
        v: 'select', h: 'hand', b: 'brush', e: 'eraser', u: 'rect', o: 'ellipse', l: 'line', t: 'text', c: 'crop',
      };
      const key = e.key.toLowerCase();
      if (map[key]) {
        e.preventDefault();
        configureTool(map[key]);
      } else if ((e.ctrlKey || e.metaKey) && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) void redo();
        else void undo();
      } else if ((e.ctrlKey || e.metaKey) && key === 'y') {
        e.preventDefault();
        void redo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteActive();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [configureTool, redo, undo]);

  return (
    <div className="bndz-ps-app">
      <header className="bndz-ps-menubar">
        <div className="bndz-ps-brand">
          <Icons8Icon id="paint" size={18} />
          <div>
            <strong>Photo Studio</strong>
            <span>{imageName}</span>
          </div>
        </div>
        <div className="bndz-ps-menu-actions">
          <button type="button" className="bndz-ps-chip" disabled={!canUndo || busy} onClick={() => void undo()}>Undo</button>
          <button type="button" className="bndz-ps-chip" disabled={!canRedo || busy} onClick={() => void redo()}>Redo</button>
          <button type="button" className="bndz-ps-chip" onClick={fitImage}>Fit</button>
          <button type="button" className="bndz-ps-chip" onClick={() => setZoom(zoomPct - 15)}>−</button>
          <span className="bndz-ps-zoom">{zoomPct}%</span>
          <button type="button" className="bndz-ps-chip" onClick={() => setZoom(zoomPct + 15)}>+</button>
          {tool === 'crop' && (
            <button type="button" className="bndz-ps-chip bndz-ps-chip--accent" onClick={() => void applyCrop()}>Apply Crop</button>
          )}
          <button type="button" className="bndz-ps-chip bndz-ps-chip--accent" disabled={busy} onClick={exportPng}>Export PNG</button>
          <button type="button" className="bndz-ps-chip" disabled={busy} onClick={exportJpeg}>Export JPEG</button>
        </div>
      </header>

      <div className="bndz-ps-body">
        <aside className="bndz-ps-rail" aria-label="Tools">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              title={t.tip}
              className={`bndz-ps-tool${tool === t.id ? ' is-active' : ''}`}
              onClick={() => configureTool(t.id)}
            >
              <Icons8Icon id={t.icon} size={16} />
              <span>{t.label}</span>
            </button>
          ))}
          <div className="bndz-ps-rail-sep" />
          <label className="bndz-ps-swatch" title="Brush / fill">
            <input type="color" value={brushColor} onChange={(e) => { setBrushColor(e.target.value); setFill(e.target.value); }} />
          </label>
          <label className="bndz-ps-swatch" title="Stroke">
            <input type="color" value={stroke} onChange={(e) => setStroke(e.target.value)} />
          </label>
          <label className="bndz-ps-size">
            <span>Size</span>
            <input
              type="range"
              min={1}
              max={80}
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
            />
          </label>
        </aside>

        <div className="bndz-ps-stage" ref={hostRef}>
          <div className="bndz-ps-stage-grid" />
          <canvas ref={canvasElRef} />
          {(status || shortcutHint) && (
            <div className="bndz-ps-stage-hint">{status || shortcutHint}</div>
          )}
        </div>

        <aside className="bndz-ps-inspector">
          <section className="bndz-ps-panel">
            <header>
              <span>Layers</span>
              <div className="bndz-ps-panel-acts">
                <button type="button" title="Bring forward" onClick={bringForward}>↑</button>
                <button type="button" title="Send backward" onClick={sendBackward}>↓</button>
                <button type="button" title="Delete" onClick={deleteActive}>✕</button>
              </div>
            </header>
            <ul className="bndz-ps-layers">
              {layers.map((layer) => (
                <li
                  key={layer.id}
                  className={activeLayerId === layer.id ? 'is-active' : ''}
                  onClick={() => selectLayer(layer.id)}
                >
                  <button
                    type="button"
                    className="bndz-ps-eye"
                    title={layer.visible ? 'Hide' : 'Show'}
                    onClick={(e) => { e.stopPropagation(); toggleLayerVisible(layer.id); }}
                  >
                    <Icons8Icon id={layer.visible ? 'eye_ui' : 'eye_off_ui'} size={12} />
                  </button>
                  <span className="bndz-ps-layer-name">{layer.name}</span>
                  <em>{layer.kind}</em>
                </li>
              ))}
            </ul>
          </section>

          <section className="bndz-ps-panel">
            <header><span>Adjustments</span></header>
            <div className="bndz-ps-sliders">
              {([
                ['brightness', 'Brightness', -1, 1, 0.01],
                ['contrast', 'Contrast', -1, 1, 0.01],
                ['saturation', 'Saturation', -1, 1, 0.01],
                ['hue', 'Hue', -1, 1, 0.01],
                ['blur', 'Blur', 0, 1, 0.01],
              ] as const).map(([key, label, min, max, step]) => (
                <label key={key}>
                  <span>{label}</span>
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={adjust[key]}
                    onChange={(e) => void onAdjustChange({ [key]: Number(e.target.value) })}
                  />
                </label>
              ))}
              <div className="bndz-ps-toggles">
                <button
                  type="button"
                  className={adjust.grayscale ? 'is-on' : ''}
                  onClick={() => void onAdjustChange({ grayscale: !adjust.grayscale })}
                >
                  B&amp;W
                </button>
                <button
                  type="button"
                  className={adjust.invert ? 'is-on' : ''}
                  onClick={() => void onAdjustChange({ invert: !adjust.invert })}
                >
                  Invert
                </button>
                <button type="button" onClick={() => void onAdjustChange(DEFAULT_ADJUST)}>Reset</button>
              </div>
            </div>
          </section>

          <section className="bndz-ps-panel">
            <header><span>Stroke</span></header>
            <label className="bndz-ps-size">
              <span>Width {strokeWidth}px</span>
              <input
                type="range"
                min={0}
                max={24}
                value={strokeWidth}
                onChange={(e) => setStrokeWidth(Number(e.target.value))}
              />
            </label>
          </section>
        </aside>
      </div>
    </div>
  );
}
