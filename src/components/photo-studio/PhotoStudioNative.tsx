/**
 * BNDZ Photo Studio (native) — a real editor that lives inside BNDZ.
 *
 * Rebuilt from photocraft's design (see src/lib/photocraft): ONE document
 * model is the source of truth for layers; the Fabric canvas renders it.
 * Path-editing nodes are canvas objects re-derived from the path's own
 * transform on every render, so they can never detach from their object
 * (the OpenShop overlay bug this studio replaces).
 *
 * Host contract (unchanged from the OpenShop host): the wrapper in
 * BndzPhotoStudio owns open/save/place; this component owns editing and
 * exposes placeImages/exportDataUrl through a ref.
 */
import React, {
  forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState,
} from 'react';
import * as fabric from 'fabric';
import {
  adjustmentLabel, colorRgb, createGroupLayer, createLayer, createRasterLayer,
  defaultAdjustment, findLayer, freshLayerId, hueRangeDefaults, walkLayers,
  type Adjustment, type BlendMode, type Document, type Layer, type LayerId, type RgbColor,
} from '../../lib/photocraft';
import { AFFINE_IDENTITY } from '../../lib/photocraft';

function hexToModelColor(hex: string): RgbColor {
  const n = parseInt(hex.replace('#', ''), 16);
  if (Number.isNaN(n)) return colorRgb(0, 0, 0);
  return colorRgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
import {
  applyAdjustments, clearSelection, fillSelection, floodFill, makeCanvas,
  paintGradient, paintSegment, selectionToMask, wandMask,
  type DocPoint, type SelectionShape,
} from './studioEngine';
import { LayersPanel } from './LayersPanel';
import { StudioPanels, type QuickAdjust } from './StudioPanels';

/* --------------------------------- types ---------------------------------- */

export interface StudioImageInput { dataUrl: string; name: string }

export interface PhotoStudioHandle {
  placeImages: (images: StudioImageInput[]) => void;
  exportDataUrl: (format: 'png' | 'jpeg' | 'webp' | 'svg') => string;
}

interface Props {
  initialImage: StudioImageInput | null;
  fonts: string[];
  onDirtyChange?: (dirty: boolean) => void;
  onError?: (message: string) => void;
}

type ToolId =
  | 'move' | 'pan' | 'zoom' | 'crop' | 'brush' | 'pencil' | 'eraser'
  | 'fill' | 'gradient' | 'eyedropper' | 'text' | 'shape' | 'pen' | 'node'
  | 'marquee-rect' | 'marquee-ellipse' | 'lasso' | 'wand';

type ShapeKind = 'rect' | 'ellipse' | 'triangle' | 'line' | 'star' | 'polygon';

interface PenPoint { ax: number; ay: number; c1x: number; c1y: number; c2x: number; c2y: number }

interface ObjExtras {
  __layerId?: LayerId;
  __pixels?: HTMLCanvasElement;
  __display?: HTMLCanvasElement;
  __penPoints?: PenPoint[];
  __isOverlay?: boolean;
}

type FObj = fabric.FabricObject & ObjExtras;

const BLEND_TO_FABRIC: Partial<Record<BlendMode, string>> = {
  'normal': 'source-over', 'darken': 'darken', 'multiply': 'multiply',
  'color-burn': 'color-burn', 'lighten': 'lighten', 'screen': 'screen',
  'color-dodge': 'color-dodge', 'linear-dodge': 'lighter', 'overlay': 'overlay',
  'soft-light': 'soft-light', 'hard-light': 'hard-light', 'difference': 'difference',
  'exclusion': 'exclusion', 'hue': 'hue', 'saturation': 'saturation',
  'color': 'color', 'luminosity': 'luminosity', 'pass-through': 'source-over',
};

const TOOLS: { id: ToolId; label: string; key: string; icon: string }[] = [
  { id: 'move', label: 'Move', key: 'V', icon: 'M4 4l7 14 2.5-6.5L20 9z' },
  { id: 'marquee-rect', label: 'Rectangular Marquee', key: 'M', icon: 'M4 5h16v14H4z' },
  { id: 'marquee-ellipse', label: 'Elliptical Marquee', key: 'M', icon: 'M12 5c4.4 0 8 3.1 8 7s-3.6 7-8 7-8-3.1-8-7 3.6-7 8-7z' },
  { id: 'lasso', label: 'Lasso', key: 'L', icon: 'M7 4c4 1 9 4 9 9 0 4-3 7-7 7-3 0-5-2-5-5 0-4 1-9 3-11z' },
  { id: 'wand', label: 'Magic Wand', key: 'W', icon: 'M6 18L15 5M15 4l.8 1.8L17.6 6.5l-1.8.8L15 9l-.8-1.8L12.4 6.5l1.8-.7z' },
  { id: 'crop', label: 'Crop', key: 'C', icon: 'M7 3v14h14M3 7h14v14' },
  { id: 'eyedropper', label: 'Eyedropper', key: 'I', icon: 'M14 4l6 6-8.5 8.5H5V12zM13 7l4 4' },
  { id: 'brush', label: 'Brush', key: 'B', icon: 'M17 3l4 4L10 18H6v-4zM5 21c2-1 3-2 3-4' },
  { id: 'pencil', label: 'Pencil', key: 'P', icon: 'M4 20l1-4L16 5l3 3L8 19z' },
  { id: 'eraser', label: 'Eraser', key: 'E', icon: 'M5 15l8-9 6 6-5 5H8l-3-2zM9 21h11' },
  { id: 'fill', label: 'Paint Bucket', key: 'G', icon: 'M5 11l7-7 7 7-7 7zM12 21c-1.5-1.7-2-3-2-4a2 2 0 1 1 4 0c0 1-.5 2.3-2 4z' },
  { id: 'gradient', label: 'Gradient', key: 'G', icon: 'M4 5h16v14H4zM4 15c4-4 8-6 16-6' },
  { id: 'text', label: 'Text', key: 'T', icon: 'M5 5h14M12 5v14' },
  { id: 'shape', label: 'Shape', key: 'U', icon: 'M5 5h9v9H5zM14 12h6v7h-6z' },
  { id: 'pen', label: 'Pen', key: 'P', icon: 'M12 4l3 6-3 10-3-10zM9 10h6' },
  { id: 'node', label: 'Node Edit (path points)', key: 'A', icon: 'M6 6h3v3H6zM15 15h3v3h-3zM7.5 7.5l9 9M18 6h-3v3h3z' },
  { id: 'pan', label: 'Hand (pan view)', key: 'H', icon: 'M8 12V6a1.5 1.5 0 0 1 3 0V5a1.5 1.5 0 0 1 3 0v1a1.5 1.5 0 0 1 3 0v6a7 7 0 0 1-7 7h-.5c-2 0-3.5-.8-4.7-2.6L4 14.6A1.6 1.6 0 0 1 6.6 12z' },
  { id: 'zoom', label: 'Zoom', key: 'Z', icon: 'M11 5a6 6 0 1 1 0 12 6 6 0 0 1 0-12zM21 21l-4.5-4.5M11 8v6M8 11h6' },
];

function uid(): number { return freshLayerId(); }

function docPoint(e: PointerEvent | MouseEvent, canvas: fabric.Canvas): DocPoint {
  const p = canvas.getPointer(e as unknown as fabric.TPointerEvent);
  return { x: p.x, y: p.y };
}

function hexWithAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/* ------------------------------- component --------------------------------- */

export const PhotoStudioNative = forwardRef<PhotoStudioHandle, Props>(function PhotoStudioNative(props, ref) {
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<fabric.Canvas | null>(null);
  const docRef = useRef<Document>({
    id: 1, name: 'Untitled', width: 1200, height: 800, resolutionDpi: 72,
    layers: [], activeLayerId: null,
  } as Document);
  const objByLayerRef = useRef(new Map<LayerId, FObj>());
  const layerAdjRef = useRef(new Map<LayerId, QuickAdjust>());
  // History entries are structured, NOT serialized strings: raster pixels are
  // held as bitmap canvas clones. Serializing them through fabric JSON turned
  // every snapshot into a giant base64 string per layer (tens of MB on real
  // photos) — that memory churn is what crashed the studio on open and dragged
  // the whole preview panel down with it.
  type HistoryEntry = {
    doc: Document;
    layerAdj: Array<[LayerId, QuickAdjust]>;
    objects: unknown[];
    pixels: Map<LayerId, HTMLCanvasElement>;
    pixelsVer: Map<LayerId, number>;
  };
  const historyRef = useRef<{ undo: HistoryEntry[]; redo: HistoryEntry[] }>({ undo: [], redo: [] });
  const pixelsVersionRef = useRef(new Map<LayerId, number>());
  const lastSnapRef = useRef<{ pixels: Map<LayerId, HTMLCanvasElement>; ver: Map<LayerId, number> } | null>(null);
  const touchPixels = useCallback((obj: FObj | undefined | null) => {
    const id = obj?.__layerId;
    if (id != null) pixelsVersionRef.current.set(id, (pixelsVersionRef.current.get(id) ?? 0) + 1);
  }, []);
  const gestureRef = useRef<any>(null);
  const selectionRef = useRef<SelectionShape | null>(null);
  const selOverlayRef = useRef<fabric.FabricObject | null>(null);
  const penRef = useRef<{ points: PenPoint[]; targetId: LayerId | null; overlay: fabric.Group | null } | null>(null);
  const adjRefreshTimers = useRef(new Map<LayerId, ReturnType<typeof setTimeout>>());

  const [, setRev] = useState(0);
  const [tool, setTool] = useState<ToolId>('move');
  const toolRef = useRef(tool); toolRef.current = tool;
  const [fg, setFg] = useState('#7c3aed');
  const [bg, setBg] = useState('#ffffff');
  const fgRef = useRef(fg); fgRef.current = fg;
  const bgRef = useRef(bg); bgRef.current = bg;
  const [brushSize, setBrushSize] = useState(24);
  const [brushOpacity, setBrushOpacity] = useState(1);
  const [brushSoft, setBrushSoft] = useState(false);
  const [tolerance, setTolerance] = useState(32);
  const [shapeKind, setShapeKind] = useState<ShapeKind>('rect');
  const [fontFamily, setFontFamily] = useState('Segoe UI');
  const [fontSize, setFontSize] = useState(48);
  const [zoomPct, setZoomPct] = useState(100);
  const [docSize, setDocSize] = useState({ w: 1200, h: 800 });
  const [selectedIds, setSelectedIds] = useState<LayerId[]>([]);
  const [thumbs, setThumbs] = useState(new Map<LayerId, string>());
  const [menu, setMenu] = useState<string | null>(null);
  const [cropRect, setCropRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [quickAdj, setQuickAdjState] = useState<QuickAdjust>({ brightness: 0, contrast: 0, saturation: 0, hue: 0, exposure: 0, blur: 0 });
  const [cursorPos, setCursorPos] = useState<DocPoint | null>(null);

  const bump = useCallback(() => setRev(r => r + 1), []);
  const doc = docRef.current;
  const activeId = (doc.activeLayerId ?? null) as LayerId | null;

  const markDirty = useCallback(() => { props.onDirtyChange?.(true); }, [props]);

  /* --------------------------- model <-> canvas --------------------------- */

  const applyLayerProps = useCallback((layer: Layer, obj: FObj) => {
    obj.visible = layer.visible;
    const isRasterLike = layer.content.kind === 'raster' || layer.content.kind === 'adjustment' || layer.content.kind === 'smart';
    obj.opacity = Math.max(0, Math.min(1, layer.opacity * (isRasterLike ? layer.fillOpacity : 1)));
    obj.globalCompositeOperation = BLEND_TO_FABRIC[layer.blend] ?? 'source-over';
    const locked = layer.locks.all || layer.locks.position;
    obj.selectable = !locked;
    obj.lockMovementX = locked; obj.lockMovementY = locked;
    obj.lockScalingX = locked; obj.lockScalingY = locked; obj.lockRotation = locked;
    obj.setCoords();
  }, []);

  const refreshThumbs = useCallback(() => {
    const next = new Map<LayerId, string>();
    objByLayerRef.current.forEach((obj, id) => {
      try {
        const img = obj as fabric.FabricImage;
        // Raster layers: draw the pixel canvas straight into the thumb —
        // fabric's toDataURL re-renders the whole object at full size first.
        if (typeof img.isType === 'function' && img.isType('image') && obj.__pixels) {
          const src = obj.__display ?? obj.__pixels;
          const t = makeCanvas(44, 30);
          const tctx = t.getContext('2d')!;
          const scale = Math.min(44 / Math.max(1, src.width), 30 / Math.max(1, src.height));
          const w = Math.max(1, Math.round(src.width * scale));
          const h = Math.max(1, Math.round(src.height * scale));
          tctx.drawImage(src, Math.round((44 - w) / 2), Math.round((30 - h) / 2), w, h);
          next.set(id, t.toDataURL('image/png'));
          return;
        }
        const url = (obj as fabric.FabricObject).toDataURL({ format: 'png', multiplier: 44 / Math.max(1, obj.width || 44) });
        if (url) next.set(id, url);
      } catch { /* thumbnail is best-effort */ }
    });
    setThumbs(next);
  }, []);

  /** Re-apply every model layer's props + stacking order to the canvas. */
  const syncCanvasFromModel = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const flat: Layer[] = walkLayers(docRef.current.layers).map(w => w.layer);
    // bottom-to-top order for top-level objects
    const order = new Map<LayerId, number>();
    docRef.current.layers.forEach((l, i) => order.set(l.id, i));
    const tops = canvas.getObjects().filter(o => !(o as FObj).__isOverlay && (o as FObj).__layerId != null);
    tops.sort((a, b) => (order.get((a as FObj).__layerId!) ?? 0) - (order.get((b as FObj).__layerId!) ?? 0));
    tops.forEach((o, i) => canvas.moveObjectTo(o, i + 1)); // +1: artboard sits at 0
    flat.forEach(layer => {
      const obj = objByLayerRef.current.get(layer.id);
      if (obj) applyLayerProps(layer, obj);
      if (layer.content.kind === 'group' && obj) {
        const group = obj as unknown as fabric.Group;
        const kids = group.getObjects().slice();
        const idx = new Map(layer.content.group.children.map((c, i) => [c.id, i]));
        kids.sort((a, b) => (idx.get((a as FObj).__layerId!) ?? 0) - (idx.get((b as FObj).__layerId!) ?? 0));
        kids.forEach(k => group.remove(k));
        kids.forEach(k => group.add(k));
        group.dirty = true;
      }
    });
    canvas.requestRenderAll();
    refreshThumbs();
    bump();
  }, [applyLayerProps, bump, refreshThumbs]);

  const registerObject = useCallback((layer: Layer, obj: FObj, parent?: fabric.Group) => {
    obj.__layerId = layer.id;
    objByLayerRef.current.set(layer.id, obj);
    const canvas = canvasRef.current!;
    if (parent) parent.add(obj as fabric.FabricObject);
    else canvas.add(obj as fabric.FabricObject);
    applyLayerProps(layer, obj);
    return obj;
  }, [applyLayerProps]);

  const unregisterLayer = useCallback((layer: Layer) => {
    const canvas = canvasRef.current;
    const obj = objByLayerRef.current.get(layer.id);
    if (obj && canvas) {
      if (obj.group) obj.group.remove(obj as fabric.FabricObject);
      else canvas.remove(obj as fabric.FabricObject);
    }
    objByLayerRef.current.delete(layer.id);
    if (layer.content.kind === 'group') layer.content.group.children.forEach(unregisterLayer);
  }, []);

  /* -------------------------------- history -------------------------------- */

  const snapshot = useCallback((): HistoryEntry => {
    const canvas = canvasRef.current!;
    // Serialize fabric objects with every image element swapped for a 2x2
    // placeholder first, so no full-res pixel data ever enters the JSON.
    const placeholder = makeCanvas(2, 2);
    const swaps: Array<[fabric.FabricImage, HTMLImageElement | HTMLCanvasElement]> = [];
    canvas.getObjects().forEach(o => {
      const img = o as fabric.FabricImage;
      if (typeof img.isType === 'function' && img.isType('image')) {
        const el = img.getElement() as HTMLImageElement | HTMLCanvasElement | undefined;
        if (el) { swaps.push([img, el]); img.setElement(placeholder as never); }
      }
    });
    let objects: unknown[] = [];
    try {
      objects = ((canvas.toObject(['__layerId', '__penPoints']) as { objects?: unknown[] }).objects ?? [])
        .filter((o) => (o as { __layerId?: unknown }).__layerId != null);
    } finally {
      swaps.forEach(([img, el]) => { try { img.setElement(el as never); } catch { /* keep placeholder */ } });
    }
    // Pixel bitmaps: clone only layers whose pixels changed since the last
    // snapshot (or whose pixel canvas was replaced); reuse the rest.
    const prev = lastSnapRef.current;
    const pixels = new Map<LayerId, HTMLCanvasElement>();
    const pixelsVer = new Map<LayerId, number>();
    walkLayers(docRef.current.layers).forEach(({ layer }) => {
      if (layer.content.kind !== 'raster' && layer.content.kind !== 'smart') return;
      const obj = objByLayerRef.current.get(layer.id);
      const src = obj?.__pixels;
      if (!src) return;
      const ver = pixelsVersionRef.current.get(layer.id) ?? 0;
      pixelsVer.set(layer.id, ver);
      const prevCanvas = prev?.pixels.get(layer.id);
      if (prevCanvas && prev!.ver.get(layer.id) === ver && prevCanvas.width === src.width && prevCanvas.height === src.height) {
        pixels.set(layer.id, prevCanvas);
      } else {
        const clone = makeCanvas(src.width, src.height);
        clone.getContext('2d')!.drawImage(src, 0, 0);
        pixels.set(layer.id, clone);
      }
    });
    lastSnapRef.current = { pixels, ver: pixelsVer };
    return {
      doc: JSON.parse(JSON.stringify(docRef.current)) as Document,
      layerAdj: Array.from(layerAdjRef.current.entries()),
      objects,
      pixels,
      pixelsVer,
    };
  }, []);

  // Undo stack holds PAST states: each commit pushes the previously committed
  // state and remembers the new one, so one Ctrl+Z always lands exactly one
  // action back. All call sites commit AFTER their change.
  const lastCommittedRef = useRef<HistoryEntry | null>(null);
  const commitHistory = useCallback(() => {
    try {
      const now = snapshot();
      if (lastCommittedRef.current) {
        historyRef.current.undo.push(lastCommittedRef.current);
        if (historyRef.current.undo.length > 40) historyRef.current.undo.shift();
      }
      lastCommittedRef.current = now;
      historyRef.current.redo = [];
      markDirty();
    } catch { /* history is best-effort */ }
  }, [snapshot, markDirty]);

  const restoreSnapshot = useCallback(async (entry: HistoryEntry) => {
    const canvas = canvasRef.current!;
    docRef.current = JSON.parse(JSON.stringify(entry.doc)) as Document;
    layerAdjRef.current = new Map(entry.layerAdj ?? []);
    pixelsVersionRef.current = new Map(entry.pixelsVer);
    lastSnapRef.current = { pixels: entry.pixels, ver: new Map(entry.pixelsVer) };
    // remove all layer objects
    [...objByLayerRef.current.values()].forEach(o => {
      if (o.group) o.group.remove(o as fabric.FabricObject);
      else canvas.remove(o as fabric.FabricObject);
    });
    objByLayerRef.current.clear();
    penRef.current = null;
    selectionRef.current = null;
    if (selOverlayRef.current) { canvas.remove(selOverlayRef.current); selOverlayRef.current = null; }
    const enlivened = await fabric.util.enlivenObjects(entry.objects as never[]);
    // Rebuild in model tree order (groups nest their children).
    const byId = new Map<LayerId, FObj>();
    const collectIds = (o: FObj) => {
      if (o.__layerId != null) byId.set(o.__layerId, o);
      const kids = (o as unknown as fabric.Group).getObjects ? (o as unknown as fabric.Group).getObjects() : [];
      kids.forEach(k => collectIds(k as FObj));
    };
    enlivened.forEach(o => collectIds(o as FObj));
    const attach = (layers: Layer[], parent?: fabric.Group) => {
      layers.forEach(layer => {
        const obj = byId.get(layer.id);
        if (!obj) return;
        objByLayerRef.current.set(layer.id, obj);
        // Pixels come from the entry's bitmap clones — never the placeholder
        // element the object was serialized with. Live objects get their own
        // clone so painting can never corrupt a history entry.
        if ((obj as fabric.FabricImage).isType && (obj as fabric.FabricImage).isType('image')) {
          const img = obj as fabric.FabricImage;
          const stored = layer.id != null ? entry.pixels.get(layer.id) : undefined;
          if (stored) {
            const px = makeCanvas(stored.width, stored.height);
            px.getContext('2d')!.drawImage(stored, 0, 0);
            (obj as FObj).__pixels = px;
            (obj as FObj).__display = px;
            img.setElement(px as never);
            refreshRasterDisplay(obj as FObj);
          } else {
            const el = img.getElement() as HTMLImageElement | undefined;
            if (el) {
              const px = makeCanvas(el.naturalWidth || el.width || 2, el.naturalHeight || el.height || 2);
              px.getContext('2d')!.drawImage(el, 0, 0);
              (obj as FObj).__pixels = px;
              (obj as FObj).__display = px;
            }
          }
        }
        const alreadyInside = !!(obj as FObj).group;
        if (!alreadyInside) {
          if (parent) parent.add(obj as fabric.FabricObject);
          else canvas.add(obj as fabric.FabricObject);
        }
        if (layer.content.kind === 'group') attach(layer.content.group.children, obj as unknown as fabric.Group);
      });
    };
    attach(docRef.current.layers);
    setDocSize({ w: docRef.current.width, h: docRef.current.height });
    syncCanvasFromModel();
    canvas.requestRenderAll();
    // refreshRasterDisplay is declared further down the component; it is only
    // invoked at restore time (after first render), never during render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncCanvasFromModel]);

  const undo = useCallback(async () => {
    const h = historyRef.current;
    if (!h.undo.length || !lastCommittedRef.current) return;
    h.redo.push(lastCommittedRef.current);
    const target = h.undo.pop()!;
    lastCommittedRef.current = target;
    await restoreSnapshot(target);
    markDirty();
  }, [restoreSnapshot, markDirty]);

  const redo = useCallback(async () => {
    const h = historyRef.current;
    if (!h.redo.length || !lastCommittedRef.current) return;
    h.undo.push(lastCommittedRef.current);
    const target = h.redo.pop()!;
    lastCommittedRef.current = target;
    await restoreSnapshot(target);
    markDirty();
  }, [restoreSnapshot, markDirty]);

  /* ------------------------------ layer ops ------------------------------- */

  const setActive = useCallback((id: LayerId | null, additive = false) => {
    docRef.current.activeLayerId = id as never;
    setSelectedIds(prev => {
      if (id == null) return additive ? prev : [];
      if (additive) return prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      return [id];
    });
    const canvas = canvasRef.current;
    if (canvas && id != null) {
      const obj = objByLayerRef.current.get(id);
      if (obj && obj.selectable) canvas.setActiveObject(obj as fabric.FabricObject);
    }
    const qa = id != null ? layerAdjRef.current.get(id) : undefined;
    setQuickAdjState(qa ?? { brightness: 0, contrast: 0, saturation: 0, hue: 0, exposure: 0, blur: 0 });
    bump();
  }, [bump]);

  const addLayerObject = useCallback((layer: Layer, obj: FObj, parentLayer?: Layer) => {
    const canvas = canvasRef.current!;
    if (parentLayer?.content.kind === 'group') {
      parentLayer.content.group.children.push(layer);
      registerObject(layer, obj, objByLayerRef.current.get(parentLayer.id) as unknown as fabric.Group);
    } else {
      docRef.current.layers.push(layer);
      registerObject(layer, obj);
    }
    setActive(layer.id);
    syncCanvasFromModel();
    canvas.requestRenderAll();
  }, [registerObject, setActive, syncCanvasFromModel]);

  const makeRasterImage = useCallback(async (dataUrl: string, name: string): Promise<{ layer: Layer; obj: FObj }> => {
    const img = await fabric.FabricImage.fromURL(dataUrl);
    const el = img.getElement() as HTMLImageElement;
    const px = makeCanvas(el.naturalWidth || img.width, el.naturalHeight || img.height);
    px.getContext('2d')!.drawImage(el, 0, 0);
    const layer = createRasterLayer(name);
    const obj = img as FObj;
    obj.__pixels = px;
    obj.__display = px;
    obj.objectCaching = false;
    return { layer, obj };
  }, []);

  const placeImagesInternal = useCallback(async (images: StudioImageInput[]) => {
    const canvas = canvasRef.current!;
    let offset = 0;
    for (const image of images) {
      const { layer, obj } = await makeRasterImage(image.dataUrl, image.name.replace(/\.[^.]+$/, '') || 'Image');
      const maxDim = Math.max(docRef.current.width, docRef.current.height);
      const scale = Math.min(1, (maxDim * 0.8) / Math.max(obj.width || 1, obj.height || 1));
      obj.set({
        left: docRef.current.width / 2 + offset, top: docRef.current.height / 2 + offset,
        originX: 'center', originY: 'center', scaleX: scale, scaleY: scale,
      });
      offset += 24;
      addLayerObject(layer, obj);
    }
    commitHistory();
    canvas.requestRenderAll();
  }, [addLayerObject, commitHistory, makeRasterImage]);

  /* ------------------------- adjustment layer render ----------------------- */

  const refreshAdjustmentLayer = useCallback(async (layer: Layer) => {
    const canvas = canvasRef.current;
    if (!canvas || layer.content.kind !== 'adjustment') return;
    const obj = objByLayerRef.current.get(layer.id);
    if (!obj) return;
    // Composite everything below this layer (bottom-to-top) offscreen.
    const idx = docRef.current.layers.indexOf(layer);
    const below = docRef.current.layers.slice(0, idx).filter(l => l.visible);
    const stage = new fabric.StaticCanvas(null, { width: docRef.current.width, height: docRef.current.height });
    try {
      for (const l of below) {
        const src = objByLayerRef.current.get(l.id);
        if (!src) continue;
        const clones = await fabric.util.enlivenObjects([JSON.parse(JSON.stringify((src as fabric.FabricObject).toObject(['__layerId'])))]);
        clones.forEach(c => stage.add(c as fabric.FabricObject));
      }
      stage.renderAll();
      const flat = stage.toCanvasElement(1);
      const adjusted = applyAdjustments(flat, [layer.content.adjustment]);
      const imgObj = obj as fabric.FabricImage;
      imgObj.setElement(adjusted);
      imgObj.set({ left: docRef.current.width / 2, top: docRef.current.height / 2, originX: 'center', originY: 'center', scaleX: 1, scaleY: 1 });
      imgObj.dirty = true;
      canvas.requestRenderAll();
      refreshThumbs();
    } finally {
      stage.dispose();
    }
  }, [refreshThumbs]);

  const scheduleAdjRefresh = useCallback(() => {
    docRef.current.layers.forEach(layer => {
      if (layer.content.kind !== 'adjustment') return;
      const timers = adjRefreshTimers.current;
      const old = timers.get(layer.id);
      if (old) clearTimeout(old);
      timers.set(layer.id, setTimeout(() => { void refreshAdjustmentLayer(layer); }, 180));
    });
  }, [refreshAdjustmentLayer]);

  /* ------------------------------ raster paint ----------------------------- */

  /** Map a doc-space point into a raster layer's pixel coordinates. */
  const toLayerPixels = useCallback((obj: FObj, p: DocPoint): DocPoint => {
    const inv = fabric.util.invertTransform(obj.calcTransformMatrix());
    const local = fabric.util.transformPoint(new fabric.Point(p.x, p.y), inv);
    return { x: local.x + (obj.width || 0) / 2, y: local.y + (obj.height || 0) / 2 };
  }, []);

  const activeRaster = useCallback((): { layer: Layer; obj: FObj } | null => {
    const id = docRef.current.activeLayerId as LayerId | null;
    if (id == null) return null;
    const layer = findLayer(docRef.current.layers, id)?.layer;
    const obj = objByLayerRef.current.get(id);
    if (!layer || !obj || layer.content.kind !== 'raster') return null;
    return { layer, obj };
  }, []);

  const ensurePaintTarget = useCallback((): { layer: Layer; obj: FObj } | null => {
    const current = activeRaster();
    if (current) {
      if (current.layer.locks.all || current.layer.locks.pixels) return null;
      return current;
    }
    // No paintable layer active: create a transparent raster layer to paint on.
    const layer = createRasterLayer(`Layer ${docRef.current.layers.length + 1}`);
    const px = makeCanvas(docRef.current.width, docRef.current.height);
    const img = new fabric.FabricImage(px, { left: docRef.current.width / 2, top: docRef.current.height / 2, originX: 'center', originY: 'center' }) as FObj;
    img.__pixels = px;
    img.__display = px;
    img.objectCaching = false;
    addLayerObject(layer, img);
    return { layer, obj: img };
  }, [activeRaster, addLayerObject]);

  const refreshRasterDisplay = useCallback((obj: FObj) => {
    const adj = layerAdjRef.current.get(obj.__layerId!);
    const px = obj.__pixels!;
    let display = px;
    if (adj && (adj.brightness || adj.contrast || adj.saturation || adj.hue || adj.exposure)) {
      display = applyAdjustments(px, [
        { kind: 'brightness-contrast', brightness: adj.brightness, contrast: adj.contrast, legacy: false },
        { kind: 'exposure', exposure: adj.exposure, offset: 0, gamma: 1 },
        { kind: 'hue-saturation', hue: adj.hue, saturation: adj.saturation, lightness: 0, colorize: false, ranges: hueRangeDefaults() },
      ]);
    }
    obj.__display = display;
    (obj as fabric.FabricImage).setElement(display);
    obj.dirty = true;
    canvasRef.current?.requestRenderAll();
  }, []);

  /* ------------------------------- selection -------------------------------- */

  const drawSelectionOverlay = useCallback(() => {
    const canvas = canvasRef.current!;
    if (selOverlayRef.current) { canvas.remove(selOverlayRef.current); selOverlayRef.current = null; }
    const sel = selectionRef.current;
    if (!sel) { canvas.requestRenderAll(); return; }
    let overlay: fabric.FabricObject;
    const style = { fill: 'rgba(124,58,237,0.13)', stroke: '#a78bfa', strokeWidth: 1 / canvas.getZoom(), strokeDashArray: [6 / canvas.getZoom(), 4 / canvas.getZoom()], selectable: false, evented: false };
    if (sel.kind === 'mask') {
      const tint = makeCanvas(sel.canvas.width, sel.canvas.height);
      const tctx = tint.getContext('2d')!;
      tctx.fillStyle = 'rgba(124,58,237,0.35)';
      tctx.fillRect(0, 0, tint.width, tint.height);
      tctx.globalCompositeOperation = 'destination-in';
      tctx.drawImage(sel.canvas, 0, 0);
      overlay = new fabric.FabricImage(tint, { left: 0, top: 0, selectable: false, evented: false, opacity: 0.8 });
    } else if (sel.kind === 'rect') {
      overlay = new fabric.Rect({ left: sel.x, top: sel.y, width: sel.w, height: sel.h, ...style });
    } else if (sel.kind === 'ellipse') {
      overlay = new fabric.Ellipse({ left: sel.x, top: sel.y, rx: sel.w / 2, ry: sel.h / 2, ...style });
    } else {
      overlay = new fabric.Polygon(sel.points, { ...style, objectCaching: false });
    }
    (overlay as FObj).__isOverlay = true;
    overlay.excludeFromExport = true;
    selOverlayRef.current = overlay;
    canvas.add(overlay);
    canvas.bringObjectToFront(overlay);
    canvas.requestRenderAll();
  }, []);

  const setSelection = useCallback((sel: SelectionShape | null) => {
    selectionRef.current = sel;
    drawSelectionOverlay();
  }, [drawSelectionOverlay]);

  /* --------------------------------- pen ----------------------------------- */
  // Pen points live in path-LOCAL coordinates on the object (__penPoints).
  // Handles are rebuilt from those points through the object's CURRENT
  // transform matrix on every render — photocraft's derive-per-frame rule.

  const buildPathString = (points: PenPoint[]): string => {
    if (!points.length) return '';
    let d = `M ${points[0].ax} ${points[0].ay}`;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1], cur = points[i];
      d += ` C ${prev.c2x} ${prev.c2y}, ${cur.c1x} ${cur.c1y}, ${cur.ax} ${cur.ay}`;
    }
    return d;
  };

  const rebuildPenOverlay = useCallback(() => {
    const canvas = canvasRef.current;
    const pen = penRef.current;
    if (!canvas || !pen) return;
    if (pen.overlay) { canvas.remove(pen.overlay); pen.overlay = null; }
    const target = pen.targetId != null ? objByLayerRef.current.get(pen.targetId) : null;
    const pts = pen.targetId != null ? (target?.__penPoints ?? []) : pen.points;
    if (!pts.length) { canvas.requestRenderAll(); return; }
    const matrix = target ? target.calcTransformMatrix() : fabric.iMatrix.concat();
    const toDoc = (x: number, y: number): DocPoint => {
      const p = fabric.util.transformPoint(new fabric.Point(x, y), matrix);
      return { x: p.x, y: p.y };
    };
    const zoom = canvas.getZoom();
    const handleR = 5 / zoom, ctrlR = 3.5 / zoom;
    const parts: fabric.FabricObject[] = [];
    const addLine = (a: DocPoint, b: DocPoint) => {
      parts.push(new fabric.Line([a.x, a.y, b.x, b.y], { stroke: '#a78bfa', strokeWidth: 1 / zoom, selectable: false, evented: false }));
    };
    pts.forEach((pt, i) => {
      const a = toDoc(pt.ax, pt.ay);
      const c1 = toDoc(pt.c1x, pt.c1y), c2 = toDoc(pt.c2x, pt.c2y);
      if (pt.c1x !== pt.ax || pt.c1y !== pt.ay) {
        addLine(c1, a);
        const h = new fabric.Circle({ left: c1.x, top: c1.y, radius: ctrlR, fill: '#1e1b26', stroke: '#a78bfa', strokeWidth: 1.2 / zoom, originX: 'center', originY: 'center', selectable: false, evented: false });
        (h as FObj & { __penHandle?: string }).__penHandle = `c1:${i}`;
        parts.push(h);
      }
      if (pt.c2x !== pt.ax || pt.c2y !== pt.ay) {
        addLine(a, c2);
        const h = new fabric.Circle({ left: c2.x, top: c2.y, radius: ctrlR, fill: '#1e1b26', stroke: '#a78bfa', strokeWidth: 1.2 / zoom, originX: 'center', originY: 'center', selectable: false, evented: false });
        (h as FObj & { __penHandle?: string }).__penHandle = `c2:${i}`;
        parts.push(h);
      }
      const anchor = new fabric.Rect({ left: a.x, top: a.y, width: handleR * 1.7, height: handleR * 1.7, fill: '#7c3aed', stroke: '#fff', strokeWidth: 1 / zoom, originX: 'center', originY: 'center', selectable: false, evented: false });
      (anchor as FObj & { __penHandle?: string }).__penHandle = `a:${i}`;
      parts.push(anchor);
    });
    const group = new fabric.Group(parts, { selectable: false, evented: false });
    (group as FObj).__isOverlay = true;
    group.excludeFromExport = true;
    pen.overlay = group;
    canvas.add(group);
    canvas.bringObjectToFront(group);
    canvas.requestRenderAll();
  }, []);

  const penHitTest = useCallback((p: DocPoint): { kind: 'a' | 'c1' | 'c2'; index: number } | null => {
    const pen = penRef.current;
    const canvas = canvasRef.current;
    if (!pen || !canvas) return null;
    const target = pen.targetId != null ? objByLayerRef.current.get(pen.targetId) : null;
    const pts = pen.targetId != null ? (target?.__penPoints ?? []) : pen.points;
    const matrix = target ? target.calcTransformMatrix() : fabric.iMatrix.concat();
    const tol = 9 / canvas.getZoom();
    let best: { kind: 'a' | 'c1' | 'c2'; index: number; dist: number } | null = null;
    pts.forEach((pt, i) => {
      const spots: ['a' | 'c1' | 'c2', number, number][] = [['a', pt.ax, pt.ay], ['c1', pt.c1x, pt.c1y], ['c2', pt.c2x, pt.c2y]];
      spots.forEach(([kind, x, y]) => {
        const d = fabric.util.transformPoint(new fabric.Point(x, y), matrix);
        const dist = Math.hypot(d.x - p.x, d.y - p.y);
        if (dist <= tol && (!best || dist < best.dist)) best = { kind, index: i, dist };
      });
    });
    return best;
  }, []);

  const applyPenPointsToPath = useCallback((obj: FObj) => {
    const pts = obj.__penPoints ?? [];
    if (!pts.length) return;
    const old = obj as unknown as fabric.Path;
    const fresh = new fabric.Path(buildPathString(pts), {
      fill: old.fill, stroke: old.stroke, strokeWidth: old.strokeWidth,
      strokeLineCap: 'round', strokeLineJoin: 'round',
    });
    fresh.set({
      left: old.left, top: old.top, scaleX: old.scaleX, scaleY: old.scaleY,
      angle: old.angle, flipX: old.flipX, flipY: old.flipY, opacity: old.opacity,
      originX: old.originX, originY: old.originY,
    });
    (fresh as FObj).__layerId = obj.__layerId;
    (fresh as FObj).__penPoints = pts;
    const canvas = canvasRef.current!;
    const parent = obj.group as unknown as fabric.Group | undefined;
    if (parent) parent.remove(obj as fabric.FabricObject);
    else canvas.remove(obj as fabric.FabricObject);
    if (parent) parent.add(fresh);
    else canvas.add(fresh);
    objByLayerRef.current.set(obj.__layerId!, fresh as FObj);
    const ownerLayer = findLayer(docRef.current.layers, obj.__layerId!)?.layer;
    if (ownerLayer) applyLayerProps(ownerLayer, fresh as FObj);
    if (penRef.current?.targetId === obj.__layerId) rebuildPenOverlay();
    canvas.requestRenderAll();
  }, [applyLayerProps, rebuildPenOverlay]);

  /* ------------------------------ canvas setup ----------------------------- */

  const fitZoom = useCallback(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const availW = wrap.clientWidth - 330 - 90; // right panels + tool rail + padding
    const availH = wrap.clientHeight - 130;
    const z = Math.max(0.05, Math.min(availW / docRef.current.width, availH / docRef.current.height));
    canvas.setViewportTransform([z, 0, 0, z, (wrap.clientWidth - 330) / 2 - (docRef.current.width * z) / 2 + 45, (wrap.clientHeight - 60) / 2 - (docRef.current.height * z) / 2 + 30]);
    setZoomPct(Math.round(z * 100));
    canvas.requestRenderAll();
  }, []);

  const setZoom = useCallback((z: number, center?: DocPoint) => {
    const canvas = canvasRef.current!;
    const c = center ?? new fabric.Point(canvas.width / 2, canvas.height / 2);
    canvas.zoomToPoint(c as never, Math.max(0.05, Math.min(8, z)));
    setZoomPct(Math.round(canvas.getZoom() * 100));
    drawSelectionOverlay();
    rebuildPenOverlay();
  }, [drawSelectionOverlay, rebuildPenOverlay]);

  useEffect(() => {
    const el = canvasElRef.current!;
    const canvas = new fabric.Canvas(el, {
      preserveObjectStacking: true,
      selection: true,
      stopContextMenu: true,
      fireRightClick: false,
    });
    canvasRef.current = canvas;
    // Artboard backdrop (not a layer, never exported).
    const art = new fabric.Rect({
      left: -1, top: -1, width: docRef.current.width + 2, height: docRef.current.height + 2,
      fill: '#ffffff', stroke: '#3f3f46', strokeWidth: 1, selectable: false, evented: false,
    });
    (art as FObj).__isOverlay = true;
    art.excludeFromExport = true;
    canvas.add(art);
    canvas.moveObjectTo(art, 0);
    (canvas as unknown as { __artboard?: fabric.FabricObject }).__artboard = art;

    const onModified = (e: { target?: fabric.FabricObject }) => {
      const t = e.target as FObj | undefined;
      if (!t || t.__isOverlay) return;
      commitHistory();
      scheduleAdjRefresh();
      refreshThumbs();
    };
    const onMoving = () => { rebuildPenOverlay(); };
    const onRender = () => { /* pen overlay is rebuilt on moving + explicit edits */ };
    canvas.on('object:modified', onModified);
    canvas.on('object:moving', onMoving);
    canvas.on('after:render', onRender);
    canvas.on('selection:created', (e) => {
      const sel = (e as { selected?: fabric.FabricObject[] }).selected ?? [];
      const first = sel[0] as FObj | undefined;
      if (first?.__layerId != null) setActive(first.__layerId);
    });
    canvas.on('selection:updated', (e) => {
      const sel = (e as { selected?: fabric.FabricObject[] }).selected ?? [];
      const first = sel[0] as FObj | undefined;
      if (first?.__layerId != null) setActive(first.__layerId);
    });
    canvas.on('mouse:wheel', (opt) => {
      const ev = opt.e as WheelEvent;
      ev.preventDefault(); ev.stopPropagation();
      const delta = ev.deltaY;
      let z = canvas.getZoom() * (0.999 ** delta);
      setZoom(z, new fabric.Point(ev.offsetX, ev.offsetY) as never);
    });

    // Initial document. Any failure here must surface through onError — the
    // host shows it on a stable error screen instead of the studio vanishing.
    void (async () => {
      try {
        if (props.initialImage) {
          const img = new Image();
          await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error('That image could not be loaded.')); img.src = props.initialImage!.dataUrl; });
          docRef.current.width = img.naturalWidth;
          docRef.current.height = img.naturalHeight;
          docRef.current.name = props.initialImage.name;
          const artboard = (canvas as unknown as { __artboard?: fabric.Rect }).__artboard;
          artboard?.set({ width: img.naturalWidth + 2, height: img.naturalHeight + 2 });
          const { layer, obj } = await makeRasterImage(props.initialImage.dataUrl, props.initialImage.name.replace(/\.[^.]+$/, '') || 'Background');
          obj.set({ left: img.naturalWidth / 2, top: img.naturalHeight / 2, originX: 'center', originY: 'center' });
          addLayerObject(layer, obj);
        } else {
          const layer = createRasterLayer('Background');
          const px = makeCanvas(docRef.current.width, docRef.current.height);
          const pctx = px.getContext('2d')!;
          pctx.fillStyle = '#ffffff';
          pctx.fillRect(0, 0, px.width, px.height);
          const img = new fabric.FabricImage(px, { left: docRef.current.width / 2, top: docRef.current.height / 2, originX: 'center', originY: 'center' }) as FObj;
          img.__pixels = px; img.__display = px; img.objectCaching = false;
          addLayerObject(layer, img);
        }
        setDocSize({ w: docRef.current.width, h: docRef.current.height });
        historyRef.current.undo = [];
        historyRef.current.redo = [];
        lastCommittedRef.current = null;
        lastSnapRef.current = null;
        pixelsVersionRef.current.clear();
        commitHistory();
        fitZoom();
      } catch (err) {
        props.onError?.(err instanceof Error ? err.message : 'The studio could not open this image.');
      }
    })();

    const onResize = () => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      canvas.setDimensions({ width: wrap.clientWidth, height: wrap.clientHeight });
      canvas.requestRenderAll();
    };
    onResize();
    const ro = new ResizeObserver(onResize);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => {
      ro.disconnect();
      canvas.dispose();
      canvasRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------------------ tool gestures ---------------------------- */

  const paintAt = useCallback((p: DocPoint, start: boolean) => {
    const g = gestureRef.current;
    const target = g?.paintTarget as { layer: Layer; obj: FObj } | undefined;
    if (!target) return;
    const local = toLayerPixels(target.obj, p);
    const erase = toolRef.current === 'eraser';
    const soft = toolRef.current === 'brush' && brushSoft;
    const size = toolRef.current === 'pencil' ? Math.max(1, brushSize / 3) : brushSize;
    if (start || !g.lastPaint) {
      paintSegment(target.obj.__pixels!, local, local, size, fgRef.current, brushOpacity, erase, soft);
      if (target.obj.__display && target.obj.__display !== target.obj.__pixels) {
        paintSegment(target.obj.__display, local, local, size, fgRef.current, brushOpacity, erase, soft);
      }
    } else {
      paintSegment(target.obj.__pixels!, g.lastPaint, local, size, fgRef.current, brushOpacity, erase, soft);
      if (target.obj.__display && target.obj.__display !== target.obj.__pixels) {
        paintSegment(target.obj.__display, g.lastPaint, local, size, fgRef.current, brushOpacity, erase, soft);
      }
    }
    g.lastPaint = local;
    target.obj.dirty = true;
    touchPixels(target.obj);
    canvasRef.current?.requestRenderAll();
  }, [brushOpacity, brushSize, brushSoft, toLayerPixels, touchPixels]);

  const onMouseDown = (e: fabric.TEvent) => {
    const canvas = canvasRef.current!;
    const pointer = (e as { pointer?: DocPoint }).pointer ?? docPoint(e.e as MouseEvent, canvas);
    const t = toolRef.current;
    const nativeEv = e.e as MouseEvent;
    if (nativeEv.button === 1 || t === 'pan' || (nativeEv.button === 0 && gestureRef.current?.spacePan)) {
      gestureRef.current = { kind: 'pan', start: { x: nativeEv.clientX, y: nativeEv.clientY }, vpt: [...(canvas.viewportTransform ?? fabric.iMatrix)] };
      canvas.selection = false;
      return;
    }
    if (nativeEv.button !== 0) return;

    switch (t) {
      case 'zoom': {
        const z = canvas.getZoom() * (nativeEv.altKey ? 0.8 : 1.25);
        setZoom(z, new fabric.Point(nativeEv.offsetX, nativeEv.offsetY) as never);
        break;
      }
      case 'brush': case 'pencil': case 'eraser': {
        const target = ensurePaintTarget();
        if (!target) break;
        gestureRef.current = { kind: 'paint', paintTarget: target, lastPaint: null };
        canvas.selection = false;
        paintAt(pointer, true);
        break;
      }
      case 'fill': {
        const target = ensurePaintTarget();
        if (!target) break;
        const local = toLayerPixels(target.obj, pointer);
        const selMask = selectionRef.current
          ? selectionToMask(selectionRef.current, target.obj.__pixels!.width, target.obj.__pixels!.height)
          : null;
        floodFill(target.obj.__pixels!, local.x, local.y, fgRef.current, tolerance, selMask);
        touchPixels(target.obj);
        refreshRasterDisplay(target.obj);
        commitHistory();
        scheduleAdjRefresh();
        break;
      }
      case 'gradient': {
        const target = ensurePaintTarget();
        if (!target) break;
        gestureRef.current = { kind: 'gradient', paintTarget: target, start: pointer };
        break;
      }
      case 'eyedropper': {
        const ctx = canvas.contextContainer;
        const scale = canvas.getRetinaScaling();
        const data = ctx.getImageData(Math.round(nativeEv.offsetX * scale), Math.round(nativeEv.offsetY * scale), 1, 1).data;
        const hex = `#${[data[0], data[1], data[2]].map(v => v.toString(16).padStart(2, '0')).join('')}`;
        if (nativeEv.altKey) setBg(hex); else setFg(hex);
        break;
      }
      case 'crop': {
        gestureRef.current = { kind: 'crop', start: pointer };
        break;
      }
      case 'marquee-rect': case 'marquee-ellipse': case 'lasso': {
        gestureRef.current = { kind: 'select', shape: t, start: pointer, points: [pointer] };
        break;
      }
      case 'wand': {
        const target = activeRaster();
        if (!target) break;
        const flat = makeCanvas(docRef.current.width, docRef.current.height);
        flat.getContext('2d')!.drawImage(canvas.toCanvasElement(1), 0, 0);
        // wand works on the composite: sample the active layer's own pixels when aligned, else composite.
        const local = toLayerPixels(target.obj, pointer);
        const maskLocal = wandMask(target.obj.__pixels!, local.x, local.y, tolerance);
        void maskLocal;
        const compositeMask = wandMask(flat, pointer.x, pointer.y, tolerance);
        setSelection({ kind: 'mask', canvas: compositeMask });
        break;
      }
      case 'text': {
        const layer = createLayer('Text', { kind: 'text', text: { text: 'Type here', fontFamily, sizePt: fontSize, color: hexToModelColor(fgRef.current), transform: AFFINE_IDENTITY, shape: 'point', antialias: 'smooth' } });
        const text = new fabric.IText('Type here', {
          left: pointer.x, top: pointer.y, fontFamily, fontSize, fill: fgRef.current,
        }) as FObj;
        addLayerObject(layer, text);
        canvas.setActiveObject(text);
        text.enterEditing();
        commitHistory();
        setTool('move');
        break;
      }
      case 'shape': {
        gestureRef.current = { kind: 'shape', start: pointer };
        break;
      }
      case 'pen': {
        const hit = penHitTest(pointer);
        if (hit && penRef.current?.targetId != null) {
          gestureRef.current = { kind: 'pen-handle', hit };
          break;
        }
        if (!penRef.current || penRef.current.targetId != null) {
          penRef.current = { points: [], targetId: null, overlay: null };
        }
        const pts = penRef.current.points;
        const last = pts[pts.length - 1];
        if (last && Math.hypot(last.ax - pointer.x, last.ay - pointer.y) < 8 / canvas.getZoom() && pts.length > 2) {
          finishPen();
          break;
        }
        pts.push({ ax: pointer.x, ay: pointer.y, c1x: pointer.x, c1y: pointer.y, c2x: pointer.x, c2y: pointer.y });
        gestureRef.current = { kind: 'pen-anchor', index: pts.length - 1 };
        rebuildPenOverlay();
        break;
      }
      case 'node': {
        const hit = penHitTest(pointer);
        if (hit) { gestureRef.current = { kind: 'pen-handle', hit }; break; }
        const target = (e as { target?: FObj }).target;
        if (target?.__layerId != null && target.__penPoints) {
          penRef.current = { points: [], targetId: target.__layerId, overlay: null };
          rebuildPenOverlay();
        }
        break;
      }
      default:
        break;
    }
  };

  const onMouseMove = (e: fabric.TEvent) => {
    const canvas = canvasRef.current!;
    const pointer = (e as { pointer?: DocPoint }).pointer ?? docPoint(e.e as MouseEvent, canvas);
    setCursorPos(pointer);
    const g = gestureRef.current;
    if (!g) return;
    const nativeEv = e.e as MouseEvent;
    switch (g.kind) {
      case 'pan': {
        const vpt = [...g.vpt];
        vpt[4] += nativeEv.clientX - g.start.x;
        vpt[5] += nativeEv.clientY - g.start.y;
        canvas.setViewportTransform(vpt as fabric.TMat2D);
        canvas.requestRenderAll();
        break;
      }
      case 'paint': paintAt(pointer, false); break;
      case 'gradient': {
        g.current = pointer;
        break;
      }
      case 'crop': {
        const r = {
          x: Math.min(g.start.x, pointer.x), y: Math.min(g.start.y, pointer.y),
          w: Math.abs(pointer.x - g.start.x), h: Math.abs(pointer.y - g.start.y),
        };
        setCropRect(r);
        setSelection({ kind: 'rect', ...r });
        break;
      }
      case 'select': {
        if (g.shape === 'lasso') {
          g.points.push(pointer);
          setSelection({ kind: 'polygon', points: [...g.points] });
        } else {
          const r = {
            x: Math.min(g.start.x, pointer.x), y: Math.min(g.start.y, pointer.y),
            w: Math.abs(pointer.x - g.start.x), h: Math.abs(pointer.y - g.start.y),
          };
          setSelection(g.shape === 'marquee-rect' ? { kind: 'rect', ...r } : { kind: 'ellipse', ...r });
        }
        break;
      }
      case 'shape': {
        g.current = pointer;
        drawShapePreview(g.start, pointer);
        break;
      }
      case 'pen-anchor': {
        const pen = penRef.current!;
        const pt = pen.points[g.index];
        if (pt) {
          pt.c2x = pointer.x; pt.c2y = pointer.y;
          pt.c1x = pt.ax - (pointer.x - pt.ax); pt.c1y = pt.ay - (pointer.y - pt.ay);
          rebuildPenOverlay();
          drawPenPreview();
        }
        break;
      }
      case 'pen-handle': {
        const pen = penRef.current!;
        const obj = pen.targetId != null ? objByLayerRef.current.get(pen.targetId) : null;
        const pts = pen.targetId != null ? (obj?.__penPoints ?? []) : pen.points;
        const pt = pts[g.hit.index];
        if (!pt) break;
        if (pen.targetId != null && obj) {
          const inv = fabric.util.invertTransform(obj.calcTransformMatrix());
          const local = fabric.util.transformPoint(new fabric.Point(pointer.x, pointer.y), inv);
          if (g.hit.kind === 'a') {
            const dx = local.x - pt.ax, dy = local.y - pt.ay;
            pt.ax = local.x; pt.ay = local.y;
            pt.c1x += dx; pt.c1y += dy; pt.c2x += dx; pt.c2y += dy;
          } else if (g.hit.kind === 'c1') { pt.c1x = local.x; pt.c1y = local.y; }
          else { pt.c2x = local.x; pt.c2y = local.y; }
          applyPenPointsToPath(obj);
        } else {
          if (g.hit.kind === 'a') {
            const dx = pointer.x - pt.ax, dy = pointer.y - pt.ay;
            pt.ax = pointer.x; pt.ay = pointer.y;
            pt.c1x += dx; pt.c1y += dy; pt.c2x += dx; pt.c2y += dy;
          } else if (g.hit.kind === 'c1') { pt.c1x = pointer.x; pt.c1y = pointer.y; }
          else { pt.c2x = pointer.x; pt.c2y = pointer.y; }
          rebuildPenOverlay();
          drawPenPreview();
        }
        break;
      }
      default:
        break;
    }
  };

  const onMouseUp = (e: fabric.TEvent) => {
    const canvas = canvasRef.current!;
    const g = gestureRef.current;
    gestureRef.current = null;
    canvas.selection = toolRef.current === 'move';
    if (!g) return;
    switch (g.kind) {
      case 'paint': {
        refreshRasterDisplay(g.paintTarget.obj);
        commitHistory();
        scheduleAdjRefresh();
        refreshThumbs();
        break;
      }
      case 'gradient': {
        const pointer = (e as { pointer?: DocPoint }).pointer ?? g.current;
        if (pointer && g.paintTarget) {
          const from = toLayerPixels(g.paintTarget.obj, g.start);
          const to = toLayerPixels(g.paintTarget.obj, pointer);
          paintGradient(g.paintTarget.obj.__pixels!, from, to, fgRef.current, bgRef.current, null);
          touchPixels(g.paintTarget.obj);
          refreshRasterDisplay(g.paintTarget.obj);
          commitHistory();
          scheduleAdjRefresh();
        }
        break;
      }
      case 'shape': {
        const pointer = (e as { pointer?: DocPoint }).pointer ?? g.current;
        if (pointer) finishShape(g.start, pointer);
        break;
      }
      case 'select': case 'crop':
        break;
      default:
        break;
    }
  };

  /* ------------------------------ pen helpers ------------------------------ */

  const penPreviewRef = useRef<fabric.Path | null>(null);
  const drawPenPreview = useCallback(() => {
    const canvas = canvasRef.current!;
    const pen = penRef.current;
    if (penPreviewRef.current) { canvas.remove(penPreviewRef.current); penPreviewRef.current = null; }
    if (!pen || pen.targetId != null || pen.points.length < 2) { canvas.requestRenderAll(); return; }
    const path = new fabric.Path(buildPathString(pen.points), {
      fill: 'rgba(0,0,0,0)', stroke: fgRef.current, strokeWidth: 2, selectable: false, evented: false,
    });
    (path as FObj).__isOverlay = true;
    path.excludeFromExport = true;
    penPreviewRef.current = path;
    canvas.add(path);
    canvas.requestRenderAll();
  }, []);

  const finishPen = useCallback(() => {
    const pen = penRef.current;
    const canvas = canvasRef.current!;
    if (!pen || pen.points.length < 2) {
      penRef.current = null;
      if (penPreviewRef.current) { canvas.remove(penPreviewRef.current); penPreviewRef.current = null; }
      rebuildPenOverlay();
      return;
    }
    const d = buildPathString(pen.points);
    const path = new fabric.Path(d, {
      fill: 'rgba(0,0,0,0)', stroke: fgRef.current, strokeWidth: 2, strokeLineCap: 'round', strokeLineJoin: 'round',
    }) as FObj;
    // Convert doc-space points into the path's local space.
    const inv = fabric.util.invertTransform(path.calcTransformMatrix());
    path.__penPoints = pen.points.map(pt => {
      const conv = (x: number, y: number) => {
        const p = fabric.util.transformPoint(new fabric.Point(x, y), inv);
        return { x: p.x, y: p.y };
      };
      const a = conv(pt.ax, pt.ay), c1 = conv(pt.c1x, pt.c1y), c2 = conv(pt.c2x, pt.c2y);
      return { ax: a.x, ay: a.y, c1x: c1.x, c1y: c1.y, c2x: c2.x, c2y: c2.y };
    });
    const layer = createLayer('Path', { kind: 'shape', shape: { fill: { kind: 'solid', color: hexToModelColor(fgRef.current) } } });
    if (penPreviewRef.current) { canvas.remove(penPreviewRef.current); penPreviewRef.current = null; }
    addLayerObject(layer, path);
    penRef.current = { points: [], targetId: layer.id, overlay: null };
    rebuildPenOverlay();
    commitHistory();
  }, [addLayerObject, commitHistory, rebuildPenOverlay]);

  const exitPenEdit = useCallback(() => {
    const canvas = canvasRef.current;
    if (penRef.current?.overlay && canvas) canvas.remove(penRef.current.overlay);
    if (penPreviewRef.current && canvas) { canvas.remove(penPreviewRef.current); penPreviewRef.current = null; }
    penRef.current = null;
    canvas?.requestRenderAll();
  }, []);

  /* ------------------------------ shape helpers ---------------------------- */

  const shapePreviewRef = useRef<fabric.FabricObject | null>(null);
  const makeShapeObject = useCallback((kind: ShapeKind, from: DocPoint, to: DocPoint): fabric.FabricObject => {
    const x = Math.min(from.x, to.x), y = Math.min(from.y, to.y);
    const w = Math.abs(to.x - from.x), h = Math.abs(to.y - from.y);
    const style = { fill: fgRef.current, stroke: bgRef.current === fgRef.current ? 'transparent' : 'transparent', strokeWidth: 0 };
    switch (kind) {
      case 'ellipse': return new fabric.Ellipse({ left: x, top: y, rx: w / 2, ry: h / 2, ...style });
      case 'triangle': return new fabric.Triangle({ left: x, top: y, width: w, height: h, ...style });
      case 'line': return new fabric.Line([from.x, from.y, to.x, to.y], { stroke: fgRef.current, strokeWidth: Math.max(1, brushSize / 4), fill: undefined });
      case 'star': case 'polygon': {
        const n = kind === 'star' ? 5 : 6;
        const pts: DocPoint[] = [];
        for (let i = 0; i < n * (kind === 'star' ? 2 : 1); i++) {
          const ang = (Math.PI * i) / (kind === 'star' ? n : n);
          const rad = kind === 'star' && i % 2 === 1 ? 0.45 : 1;
          pts.push({ x: Math.cos(ang - Math.PI / 2) * rad, y: Math.sin(ang - Math.PI / 2) * rad });
        }
        const poly = new fabric.Polygon(pts, { ...style, objectCaching: false });
        poly.set({ left: x, top: y, scaleX: w / 2, scaleY: h / 2 });
        return poly;
      }
      default: return new fabric.Rect({ left: x, top: y, width: w, height: h, ...style });
    }
  }, [brushSize]);

  const drawShapePreview = useCallback((from: DocPoint, to: DocPoint) => {
    const canvas = canvasRef.current!;
    if (shapePreviewRef.current) { canvas.remove(shapePreviewRef.current); shapePreviewRef.current = null; }
    const obj = makeShapeObject(shapeKind, from, to);
    (obj as FObj).__isOverlay = true;
    obj.excludeFromExport = true;
    obj.opacity = 0.85;
    shapePreviewRef.current = obj;
    canvas.add(obj);
    canvas.requestRenderAll();
  }, [makeShapeObject, shapeKind]);

  const finishShape = useCallback((from: DocPoint, to: DocPoint) => {
    const canvas = canvasRef.current!;
    if (shapePreviewRef.current) { canvas.remove(shapePreviewRef.current); shapePreviewRef.current = null; }
    if (Math.abs(to.x - from.x) < 2 && Math.abs(to.y - from.y) < 2) return;
    const obj = makeShapeObject(shapeKind, from, to) as FObj;
    const layer = createLayer(shapeKind[0].toUpperCase() + shapeKind.slice(1), { kind: 'shape', shape: { fill: { kind: 'solid', color: hexToModelColor(fgRef.current) } } });
    addLayerObject(layer, obj);
    commitHistory();
  }, [addLayerObject, commitHistory, makeShapeObject, shapeKind]);

  /* ------------------------------ attach events ---------------------------- */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const down = (e: fabric.TEvent) => onMouseDown(e);
    const move = (e: fabric.TEvent) => onMouseMove(e);
    const up = (e: fabric.TEvent) => onMouseUp(e);
    canvas.on('mouse:down', down);
    canvas.on('mouse:move', move);
    canvas.on('mouse:up', up);
    return () => { canvas.off('mouse:down', down as never); canvas.off('mouse:move', move as never); canvas.off('mouse:up', up as never); };
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.selection = tool === 'move';
    canvas.defaultCursor = tool === 'pan' ? 'grab' : tool === 'eyedropper' ? 'crosshair' : tool === 'text' ? 'text' : ['brush', 'pencil', 'eraser', 'fill', 'wand', 'pen', 'node', 'marquee-rect', 'marquee-ellipse', 'lasso', 'crop'].includes(tool) ? 'crosshair' : 'default';
    canvas.forEachObject(o => { if (!(o as FObj).__isOverlay) o.selectable = tool === 'move' && !(o.lockMovementX) && ((o as FObj).__layerId != null); });
    if (tool !== 'pen' && tool !== 'node') exitPenEdit();
    if (tool === 'node') {
      const activeObj = canvas.getActiveObject() as FObj | undefined;
      if (activeObj?.__penPoints && activeObj.__layerId != null) {
        penRef.current = { points: [], targetId: activeObj.__layerId, overlay: null };
        rebuildPenOverlay();
      }
    }
    canvas.requestRenderAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);

  /* --------------------------- layers panel wiring -------------------------- */

  // findLayer returns a { layer, path } result — always unwrap .layer here.
  // (Treating the result as the Layer itself hands panels an object with no
  // content, which is what crashed the studio on open.)
  const layerById = (id: LayerId): Layer | null => findLayer(docRef.current.layers, id)?.layer ?? null;

  const panelCallbacks = {
    onSelect: (id: LayerId, additive: boolean) => setActive(id, additive),
    onToggleVisible: (id: LayerId) => {
      const l = layerById(id); if (!l) return;
      l.visible = !l.visible;
      commitHistory(); syncCanvasFromModel(); scheduleAdjRefresh();
    },
    onToggleLock: (id: LayerId) => {
      const l = layerById(id); if (!l) return;
      l.locks = { ...l.locks, all: !l.locks.all };
      commitHistory(); syncCanvasFromModel();
    },
    onRename: (id: LayerId, name: string) => {
      const l = layerById(id); if (!l) return;
      l.name = name;
      commitHistory(); bump();
    },
    onToggleGroup: (id: LayerId) => {
      const l = layerById(id);
      if (l?.content.kind === 'group') { l.content.group.expanded = !l.content.group.expanded; bump(); }
    },
    onBlendChange: (id: LayerId, mode: BlendMode) => {
      const l = layerById(id); if (!l) return;
      l.blend = mode;
      commitHistory(); syncCanvasFromModel();
    },
    onOpacityChange: (id: LayerId, opacity: number, fillOpacity: number) => {
      const l = layerById(id); if (!l) return;
      l.opacity = opacity; l.fillOpacity = fillOpacity;
      syncCanvasFromModel();
    },
    onAddLayer: (kind: 'raster' | 'group' | 'text') => {
      commitHistory();
      if (kind === 'group') {
        const layer = createGroupLayer(`Group ${docRef.current.layers.length + 1}`);
        docRef.current.layers.push(layer);
        const obj = new fabric.Group([], { left: 0, top: 0 }) as unknown as FObj;
        registerObject(layer, obj);
        setActive(layer.id);
      } else if (kind === 'text') {
        const layer = createLayer('Text', { kind: 'text', text: { text: 'Text', fontFamily, sizePt: 40, color: hexToModelColor(fgRef.current), transform: AFFINE_IDENTITY, shape: 'point', antialias: 'smooth' } });
        const obj = new fabric.IText('Text', { left: 60, top: 60, fontFamily, fontSize: 40, fill: fgRef.current }) as FObj;
        addLayerObject(layer, obj);
      } else {
        const layer = createRasterLayer(`Layer ${docRef.current.layers.length + 1}`);
        const px = makeCanvas(docRef.current.width, docRef.current.height);
        const img = new fabric.FabricImage(px, { left: docRef.current.width / 2, top: docRef.current.height / 2, originX: 'center', originY: 'center' }) as FObj;
        img.__pixels = px; img.__display = px; img.objectCaching = false;
        addLayerObject(layer, img);
      }
      syncCanvasFromModel();
    },
    onAddAdjustment: (kind: Adjustment['kind']) => {
      commitHistory();
      const adj = defaultAdjustment(kind);
      const layer = createLayer(adjustmentLabel(adj), { kind: 'adjustment', adjustment: adj });
      const blank = makeCanvas(docRef.current.width, docRef.current.height);
      const img = new fabric.FabricImage(blank, {
        left: docRef.current.width / 2, top: docRef.current.height / 2, originX: 'center', originY: 'center',
        selectable: false, evented: false,
      }) as FObj;
      docRef.current.layers.push(layer);
      registerObject(layer, img);
      setActive(layer.id);
      syncCanvasFromModel();
      void refreshAdjustmentLayer(layer);
    },
    onDuplicate: (id: LayerId) => {
      const l = layerById(id);
      const obj = objByLayerRef.current.get(id);
      if (!l || !obj) return;
      commitHistory();
      void (async () => {
        const copyLayer: Layer = JSON.parse(JSON.stringify(l));
        const reassign = (lay: Layer) => {
          lay.id = uid();
          lay.name = `${lay.name} copy`;
          if (lay.content.kind === 'group') lay.content.group.children.forEach(reassign);
        };
        reassign(copyLayer);
        const clone = await (obj as fabric.FabricObject).clone(['__layerId', '__penPoints']);
        const cloneF = clone as FObj;
        // Rebind ids inside the clone tree by matching structure order.
        const srcFlat: FObj[] = [];
        const dstFlat: FObj[] = [];
        const collect = (o: FObj, acc: FObj[]) => { acc.push(o); if ((o as unknown as fabric.Group).getObjects) (o as unknown as fabric.Group).getObjects().forEach(c => collect(c as FObj, acc)); };
        collect(obj, srcFlat); collect(cloneF, dstFlat);
        const layerFlat: Layer[] = [];
        const collectL = (lay: Layer) => { layerFlat.push(lay); if (lay.content.kind === 'group') lay.content.group.children.forEach(collectL); };
        collectL(copyLayer);
        dstFlat.forEach((o, i) => {
          const src = srcFlat[i];
          o.__layerId = layerFlat[i]?.id;
          if (src?.__pixels) { o.__pixels = src.__pixels; o.__display = src.__display; o.objectCaching = false; }
          if (src?.__penPoints) o.__penPoints = src.__penPoints.map(p => ({ ...p }));
          if (o.__layerId != null) objByLayerRef.current.set(o.__layerId, o);
        });
        cloneF.set({ left: (obj.left ?? 0) + 16, top: (obj.top ?? 0) + 16 });
        const idx = docRef.current.layers.indexOf(l);
        docRef.current.layers.splice(idx + 1, 0, copyLayer);
        canvasRef.current!.add(cloneF as fabric.FabricObject);
        setActive(copyLayer.id);
        syncCanvasFromModel();
      })();
    },
    onDelete: (ids: LayerId[]) => {
      if (!ids.length) return;
      commitHistory();
      const removeFrom = (layers: Layer[]): Layer[] => layers.filter(l => {
        if (ids.includes(l.id)) { unregisterLayer(l); return false; }
        if (l.content.kind === 'group') l.content.group.children = removeFrom(l.content.group.children);
        return true;
      });
      docRef.current.layers = removeFrom(docRef.current.layers);
      if (activeId != null && ids.includes(activeId)) setActive(docRef.current.layers[docRef.current.layers.length - 1]?.id ?? null);
      setSelectedIds([]);
      syncCanvasFromModel();
      scheduleAdjRefresh();
    },
    onMergeDown: (id: LayerId) => {
      const idx = docRef.current.layers.indexOf(layerById(id)!);
      if (idx <= 0) return;
      const top = docRef.current.layers[idx];
      const bottom = docRef.current.layers[idx - 1];
      if (top.content.kind === 'group' || bottom.content.kind === 'group') return;
      commitHistory();
      void (async () => {
        const stage = new fabric.StaticCanvas(null, { width: docRef.current.width, height: docRef.current.height });
        try {
          for (const l of [bottom, top]) {
            const src = objByLayerRef.current.get(l.id);
            if (!src) continue;
            const clones = await fabric.util.enlivenObjects([JSON.parse(JSON.stringify((src as fabric.FabricObject).toObject(['__layerId'])))]);
            clones.forEach(c => stage.add(c as fabric.FabricObject));
          }
          stage.renderAll();
          const flat = stage.toCanvasElement(1);
          const layer = createRasterLayer(`${bottom.name} (merged)`);
          const img = new fabric.FabricImage(flat, { left: docRef.current.width / 2, top: docRef.current.height / 2, originX: 'center', originY: 'center' }) as FObj;
          img.__pixels = flat; img.__display = flat; img.objectCaching = false;
          unregisterLayer(top); unregisterLayer(bottom);
          docRef.current.layers.splice(idx - 1, 2, layer);
          registerObject(layer, img);
          setActive(layer.id);
          syncCanvasFromModel();
          scheduleAdjRefresh();
        } finally {
          stage.dispose();
        }
      })();
    },
    onReorder: (id: LayerId, targetId: LayerId, afterInPanel: boolean) => {
      // Panel is top-first; doc is bottom-to-top. Work at the top level when
      // both layers are top-level; otherwise move within the same parent list.
      const findParentList = (layers: Layer[], needle: LayerId): Layer[] | null => {
        if (layers.some(l => l.id === needle)) return layers;
        for (const l of layers) if (l.content.kind === 'group') {
          const found = findParentList(l.content.group.children, needle);
          if (found) return found;
        }
        return null;
      };
      const fromList = findParentList(docRef.current.layers, id);
      const toList = findParentList(docRef.current.layers, targetId);
      if (!fromList || !toList) return;
      const fromIdx = fromList.findIndex(l => l.id === id);
      const [moved] = fromList.splice(fromIdx, 1);
      let toIdx = toList.findIndex(l => l.id === targetId);
      if (toList === fromList && fromIdx < toIdx) toIdx -= 0; // already adjusted by splice
      // Panel-after means visually below target = lower doc index.
      const insertAt = afterInPanel ? toIdx : toIdx + 1;
      toList.splice(Math.max(0, Math.min(toList.length, insertAt)), 0, moved);
      if (moved.content.kind !== 'group') {
        // If the object lived in a different group than its new list, reparent the fabric object.
        const obj = objByLayerRef.current.get(id);
        if (obj) {
          const parentLayer = docRef.current.layers.find(l => l.content.kind === 'group' && (l.content.group.children.some(c => c.id === id)));
          const currentParentIsGroup = !!obj.group;
          const shouldBeInGroup = !!parentLayer;
          if (currentParentIsGroup !== shouldBeInGroup) {
            if (obj.group) obj.group.remove(obj as fabric.FabricObject); else canvasRef.current?.remove(obj as fabric.FabricObject);
            if (parentLayer) (objByLayerRef.current.get(parentLayer.id) as unknown as fabric.Group).add(obj as fabric.FabricObject);
            else canvasRef.current?.add(obj as fabric.FabricObject);
          }
        }
      }
      commitHistory();
      syncCanvasFromModel();
    },
  };

  /* ------------------------------- adjustments ------------------------------ */

  const onQuickAdjust = (qa: QuickAdjust) => {
    const id = activeId;
    if (id == null) return;
    setQuickAdjState(qa);
    layerAdjRef.current.set(id, qa);
    const obj = objByLayerRef.current.get(id);
    if (obj?.__pixels) {
      refreshRasterDisplay(obj);
      // blur rides Fabric's filter stack (canvas + WebGL safe).
      const img = obj as fabric.FabricImage;
      img.filters = qa.blur > 0 ? [new fabric.filters.Blur({ blur: qa.blur / 100 })] : [];
      img.applyFilters();
    }
    scheduleAdjRefresh();
  };

  const onAdjustmentParams = (adj: Adjustment) => {
    const l = activeId != null ? layerById(activeId) : null;
    if (!l || l.content.kind !== 'adjustment') return;
    l.content = { kind: 'adjustment', adjustment: adj };
    void refreshAdjustmentLayer(l);
    bump();
  };

  const onEffectsChange = (layer: Layer) => {
    const obj = objByLayerRef.current.get(layer.id);
    if (!obj) return;
    const fx = layer.effects.items;
    const shadowFx = fx.find(e => e.kind === 'drop-shadow');
    const glowFx = fx.find(e => e.kind === 'outer-glow');
    const strokeFx = fx.find(e => e.kind === 'stroke');
    const rgba = (c: { r: number; g: number; b: number; a: number }) =>
      `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${c.a})`;
    if (shadowFx?.kind === 'drop-shadow') {
      const s = shadowFx.shadow;
      const rad = (s.angle ?? 135) * Math.PI / 180;
      obj.shadow = new fabric.Shadow({
        color: rgba(s.color), blur: s.size ?? 8,
        offsetX: Math.cos(rad) * (s.distance ?? 6), offsetY: -Math.sin(rad) * (s.distance ?? 6),
      });
    } else if (glowFx?.kind === 'outer-glow') {
      const g = glowFx.glow;
      const paintColor = g.paint.kind === 'color' ? g.paint.color : { r: 1, g: 1, b: 1, a: 1 };
      obj.shadow = new fabric.Shadow({ color: rgba(paintColor), blur: g.size ?? 12, offsetX: 0, offsetY: 0 });
    } else {
      obj.shadow = undefined;
    }
    if (strokeFx?.kind === 'stroke') {
      const st = strokeFx.stroke;
      if (st.paint.kind === 'color') {
        obj.set({ stroke: rgba(st.paint.color), strokeWidth: st.size });
      }
    }
    obj.dirty = true;
    canvasRef.current?.requestRenderAll();
    refreshThumbs();
  };

  /* ------------------------------ document ops ------------------------------ */

  const applyCrop = useCallback(() => {
    if (!cropRect || cropRect.w < 4 || cropRect.h < 4) return;
    const canvas = canvasRef.current!;
    commitHistory();
    const { x, y, w, h } = cropRect;
    canvas.getObjects().forEach(o => {
      if ((o as FObj).__isOverlay) return;
      o.set({ left: (o.left ?? 0) - x, top: (o.top ?? 0) - y });
      o.setCoords();
    });
    docRef.current.width = Math.round(w);
    docRef.current.height = Math.round(h);
    const artboard = (canvas as unknown as { __artboard?: fabric.Rect }).__artboard;
    artboard?.set({ width: w + 2, height: h + 2, left: -1, top: -1 });
    setDocSize({ w: Math.round(w), h: Math.round(h) });
    setCropRect(null);
    setSelection(null);
    syncCanvasFromModel();
    fitZoom();
    scheduleAdjRefresh();
  }, [commitHistory, cropRect, fitZoom, scheduleAdjRefresh, setSelection, syncCanvasFromModel]);

  const rotateDoc = useCallback((dir: 1 | -1) => {
    const canvas = canvasRef.current!;
    commitHistory();
    const W = docRef.current.width, H = docRef.current.height;
    canvas.getObjects().forEach(o => {
      if ((o as FObj).__isOverlay) return;
      const cx = (o.left ?? 0), cy = (o.top ?? 0);
      const nx = dir === 1 ? H - cy : cy;
      const ny = dir === 1 ? cx : W - cx;
      o.set({ left: nx, top: ny, angle: (o.angle ?? 0) + dir * 90 });
      o.setCoords();
    });
    docRef.current.width = H; docRef.current.height = W;
    const artboard = (canvas as unknown as { __artboard?: fabric.Rect }).__artboard;
    artboard?.set({ width: H + 2, height: W + 2 });
    setDocSize({ w: H, h: W });
    syncCanvasFromModel();
    fitZoom();
  }, [commitHistory, fitZoom, syncCanvasFromModel]);

  const flipDoc = useCallback((axis: 'x' | 'y') => {
    const canvas = canvasRef.current!;
    commitHistory();
    const W = docRef.current.width, H = docRef.current.height;
    canvas.getObjects().forEach(o => {
      if ((o as FObj).__isOverlay) return;
      if (axis === 'x') o.set({ left: W - (o.left ?? 0), flipX: !o.flipX });
      else o.set({ top: H - (o.top ?? 0), flipY: !o.flipY });
      o.setCoords();
    });
    syncCanvasFromModel();
  }, [commitHistory, syncCanvasFromModel]);

  const flattenImage = useCallback(() => {
    const canvas = canvasRef.current!;
    commitHistory();
    const flat = canvas.toCanvasElement(1);
    [...docRef.current.layers].forEach(l => unregisterLayer(l));
    docRef.current.layers = [];
    layerAdjRef.current.clear();
    const layer = createRasterLayer('Flattened');
    const img = new fabric.FabricImage(flat, { left: docRef.current.width / 2, top: docRef.current.height / 2, originX: 'center', originY: 'center' }) as FObj;
    img.__pixels = flat; img.__display = flat; img.objectCaching = false;
    docRef.current.layers.push(layer);
    registerObject(layer, img);
    setActive(layer.id);
    syncCanvasFromModel();
  }, [commitHistory, registerObject, setActive, syncCanvasFromModel, unregisterLayer]);

  /* --------------------------------- export --------------------------------- */

  const exportDataUrl = useCallback((format: 'png' | 'jpeg' | 'webp' | 'svg'): string => {
    const canvas = canvasRef.current!;
    const vpt = [...(canvas.viewportTransform ?? fabric.iMatrix)];
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    let out: string;
    if (format === 'svg') {
      out = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(canvas.toSVG())));
    } else {
      out = canvas.toDataURL({ format, quality: 0.92, left: 0, top: 0, width: docRef.current.width, height: docRef.current.height, multiplier: 1 });
    }
    canvas.setViewportTransform(vpt as fabric.TMat2D);
    canvas.requestRenderAll();
    return out;
  }, []);

  useImperativeHandle(ref, () => ({
    placeImages: (images) => { void placeImagesInternal(images); },
    exportDataUrl,
  }), [exportDataUrl, placeImagesInternal]);

  /* -------------------------------- keyboard -------------------------------- */

  const onKeyDown = (e: React.KeyboardEvent) => {
    const canvas = canvasRef.current;
    const activeObj = canvas?.getActiveObject() as (fabric.FabricObject & { isEditing?: boolean }) | undefined;
    if (activeObj?.isEditing) return; // text editing owns the keys
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    let handled = true;
    if (mod && key === 'z' && !e.shiftKey) void undo();
    else if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) void redo();
    else if (mod && key === 'd') { setSelection(null); setCropRect(null); }
    else if (mod && key === 'a') setSelection({ kind: 'rect', x: 0, y: 0, w: docRef.current.width, h: docRef.current.height });
    else if (key === 'delete' || key === 'backspace') {
      const sel = selectionRef.current;
      const target = activeRaster();
      if (sel && target?.obj.__pixels) {
        clearSelection(target.obj.__pixels, sel);
        touchPixels(target.obj);
        refreshRasterDisplay(target.obj);
        commitHistory();
        scheduleAdjRefresh();
      } else if (selectedIds.length) {
        panelCallbacks.onDelete(selectedIds);
      } else if (activeId != null) {
        panelCallbacks.onDelete([activeId]);
      }
    } else if (key === 'enter' && toolRef.current === 'crop') applyCrop();
    else if (key === 'enter' && toolRef.current === 'pen') finishPen();
    else if (key === 'escape') {
      if (toolRef.current === 'pen') { if (penRef.current && penRef.current.points.length >= 2) finishPen(); else exitPenEdit(); }
      setSelection(null);
      setCropRect(null);
      setMenu(null);
    } else if (!mod) {
      const found = TOOLS.find(t => t.key.toLowerCase() === key);
      if (found) setTool(found.id);
      else handled = false;
    } else handled = false;
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  };

  /* ---------------------------------- menus --------------------------------- */

  const activeLayerObj = activeId != null ? layerById(activeId) : null;

  const menuAction = (fn: () => void) => () => { setMenu(null); fn(); };

  /* ----------------------------------- JSX ---------------------------------- */

  return (
    <div className="ps-root" ref={wrapRef} tabIndex={0} onKeyDown={onKeyDown}>
      {/* top menu bar */}
      <div className="ps-menubar">
        <span className="ps-doc-name">{doc.name} <em>{docSize.w} × {docSize.h}px</em></span>
        {(['File', 'Edit', 'Image', 'Layer', 'Select', 'View'] as const).map(name => (
          <div key={name} className="ps-menu-wrap">
            <button type="button" className="ps-menu-btn" onClick={() => setMenu(menu === name ? null : name)}>{name}</button>
            {menu === name && (
              <div className="ps-menu ps-top-menu">
                {name === 'File' && (<>
                  <button type="button" onClick={menuAction(() => document.dispatchEvent(new CustomEvent('bndz-studio-open-image')))}>Open image as new document…</button>
                  <button type="button" onClick={menuAction(() => document.dispatchEvent(new CustomEvent('bndz-studio-place-image')))}>Place image…</button>
                </>)}
                {name === 'Edit' && (<>
                  <button type="button" onClick={menuAction(() => void undo())}>Undo (Ctrl+Z)</button>
                  <button type="button" onClick={menuAction(() => void redo())}>Redo (Ctrl+Y)</button>
                  <button type="button" disabled={activeId == null} onClick={menuAction(() => activeId != null && panelCallbacks.onDuplicate(activeId))}>Duplicate layer</button>
                  <button type="button" disabled={activeId == null} onClick={menuAction(() => activeId != null && panelCallbacks.onDelete([activeId]))}>Delete layer</button>
                </>)}
                {name === 'Image' && (<>
                  <button type="button" onClick={menuAction(() => rotateDoc(1))}>Rotate 90° clockwise</button>
                  <button type="button" onClick={menuAction(() => rotateDoc(-1))}>Rotate 90° counter-clockwise</button>
                  <button type="button" onClick={menuAction(() => flipDoc('x'))}>Flip horizontal</button>
                  <button type="button" onClick={menuAction(() => flipDoc('y'))}>Flip vertical</button>
                  <button type="button" onClick={menuAction(flattenImage)}>Flatten image</button>
                </>)}
                {name === 'Layer' && (<>
                  <button type="button" onClick={menuAction(() => panelCallbacks.onAddLayer('raster'))}>New layer</button>
                  <button type="button" onClick={menuAction(() => panelCallbacks.onAddLayer('group'))}>New group</button>
                  <button type="button" onClick={menuAction(() => panelCallbacks.onAddLayer('text'))}>New text layer</button>
                  <button type="button" disabled={activeId == null} onClick={menuAction(() => activeId != null && panelCallbacks.onMergeDown(activeId))}>Merge down</button>
                </>)}
                {name === 'Select' && (<>
                  <button type="button" onClick={menuAction(() => setSelection({ kind: 'rect', x: 0, y: 0, w: docRef.current.width, h: docRef.current.height }))}>Select all (Ctrl+A)</button>
                  <button type="button" onClick={menuAction(() => setSelection(null))}>Deselect (Ctrl+D)</button>
                  <button type="button" disabled={!selectionRef.current} onClick={menuAction(() => {
                    const sel = selectionRef.current;
                    if (!sel) return;
                    const mask = selectionToMask(sel, docRef.current.width, docRef.current.height);
                    const inv = makeCanvas(mask.width, mask.height);
                    const ictx = inv.getContext('2d')!;
                    ictx.fillStyle = '#fff'; ictx.fillRect(0, 0, inv.width, inv.height);
                    ictx.globalCompositeOperation = 'destination-out';
                    ictx.drawImage(mask, 0, 0);
                    setSelection({ kind: 'mask', canvas: inv });
                  })}>Inverse</button>
                  <button type="button" disabled={!selectionRef.current} onClick={menuAction(() => {
                    const target = activeRaster();
                    if (!target?.obj.__pixels || !selectionRef.current) return;
                    const mask = selectionToMask(selectionRef.current, target.obj.__pixels.width, target.obj.__pixels.height);
                    fillSelection(target.obj.__pixels, { kind: 'mask', canvas: mask }, fg);
                    touchPixels(target.obj);
                    refreshRasterDisplay(target.obj);
                    commitHistory();
                  })}>Fill selection with color</button>
                </>)}
                {name === 'View' && (<>
                  <button type="button" onClick={menuAction(() => setZoom((canvasRef.current?.getZoom() ?? 1) * 1.25))}>Zoom in</button>
                  <button type="button" onClick={menuAction(() => setZoom((canvasRef.current?.getZoom() ?? 1) / 1.25))}>Zoom out</button>
                  <button type="button" onClick={menuAction(fitZoom)}>Fit to screen</button>
                  <button type="button" onClick={menuAction(() => setZoom(1))}>100%</button>
                </>)}
              </div>
            )}
          </div>
        ))}
        <span className="ps-zoom-label">{zoomPct}%</span>
      </div>

      {/* options bar */}
      <div className="ps-options">
        {(tool === 'brush' || tool === 'pencil' || tool === 'eraser') && (<>
          <label>Size <input type="range" min={1} max={200} value={brushSize} onChange={e => setBrushSize(Number(e.target.value))} /><span>{brushSize}px</span></label>
          <label>Opacity <input type="range" min={5} max={100} value={Math.round(brushOpacity * 100)} onChange={e => setBrushOpacity(Number(e.target.value) / 100)} /><span>{Math.round(brushOpacity * 100)}%</span></label>
          {tool === 'brush' && <label className="ps-check"><input type="checkbox" checked={brushSoft} onChange={e => setBrushSoft(e.target.checked)} /> Soft edge</label>}
        </>)}
        {(tool === 'wand' || tool === 'fill') && (
          <label>Tolerance <input type="range" min={0} max={100} value={tolerance} onChange={e => setTolerance(Number(e.target.value))} /><span>{tolerance}</span></label>
        )}
        {tool === 'text' && (<>
          <label>Font
            <select value={fontFamily} onChange={e => setFontFamily(e.target.value)}>
              {Array.from(new Set(['Segoe UI', 'Arial', 'Georgia', 'Consolas', ...props.fonts])).slice(0, 120).map(f => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </label>
          <label>Size <input type="number" min={8} max={400} value={fontSize} onChange={e => setFontSize(Number(e.target.value))} /></label>
        </>)}
        {tool === 'shape' && (
          <label>Shape
            <select value={shapeKind} onChange={e => setShapeKind(e.target.value as ShapeKind)}>
              <option value="rect">Rectangle</option>
              <option value="ellipse">Ellipse</option>
              <option value="triangle">Triangle</option>
              <option value="line">Line</option>
              <option value="star">Star</option>
              <option value="polygon">Polygon</option>
            </select>
          </label>
        )}
        {tool === 'pen' && <span className="ps-hint">Click to add points, drag for curves. Click the first point or press Enter to finish. Nodes always stay on their path.</span>}
        {tool === 'node' && <span className="ps-hint">Pick a path, then drag its square anchors or round curve handles — they move with the path, always.</span>}
        {tool === 'crop' && cropRect && <button type="button" className="ps-apply" onClick={applyCrop}>Apply crop ({Math.round(cropRect.w)} × {Math.round(cropRect.h)})</button>}
        {selectionRef.current && tool !== 'crop' && (
          <button type="button" className="ps-apply" onClick={() => {
            const target = activeRaster();
            if (!target?.obj.__pixels || !selectionRef.current) return;
            fillSelection(target.obj.__pixels, selectionRef.current, fg);
            touchPixels(target.obj);
            refreshRasterDisplay(target.obj);
            commitHistory();
          }}>Fill selection</button>
        )}
        <div className="ps-colors">
          <label className="ps-color-chip" title="Foreground color">
            <span style={{ background: fg }} />
            <input type="color" value={fg} onChange={e => setFg(e.target.value)} />
          </label>
          <label className="ps-color-chip" title="Background color">
            <span style={{ background: bg }} />
            <input type="color" value={bg} onChange={e => setBg(e.target.value)} />
          </label>
          <button type="button" className="ps-swap" title="Swap colors (X)" onClick={() => { setFg(bg); setBg(fg); }}>⇅</button>
        </div>
      </div>

      <div className="ps-body">
        {/* tool rail */}
        <div className="ps-tools">
          {TOOLS.map(t => (
            <button key={t.id} type="button" title={`${t.label} (${t.key})`}
              className={`ps-tool${tool === t.id ? ' is-active' : ''}`}
              onClick={() => setTool(t.id)}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
                <path d={t.icon} />
              </svg>
            </button>
          ))}
        </div>

        {/* canvas */}
        <div className="ps-canvas-wrap">
          <canvas ref={canvasElRef} />
        </div>

        {/* right panels */}
        <div className="ps-side">
          <LayersPanel
            doc={doc}
            activeId={activeId}
            selectedIds={selectedIds}
            thumbs={thumbs}
            {...panelCallbacks}
          />
          <StudioPanels
            activeLayer={activeLayerObj}
            quickAdjust={quickAdj}
            onQuickAdjust={onQuickAdjust}
            onAdjustmentParams={onAdjustmentParams}
            onEffectsChange={onEffectsChange}
          />
        </div>
      </div>

      {/* status bar */}
      <div className="ps-status">
        <span>{TOOLS.find(t => t.id === tool)?.label}</span>
        <span>{cursorPos ? `${Math.round(cursorPos.x)}, ${Math.round(cursorPos.y)}` : ''}</span>
        <span>{doc.layers.length} layer{doc.layers.length === 1 ? '' : 's'}</span>
        <span className="ps-status-right">photocraft engine · BNDZ theme</span>
      </div>
    </div>
  );
});
