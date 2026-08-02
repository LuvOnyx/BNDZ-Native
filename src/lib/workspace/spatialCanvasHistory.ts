import type { SpatialCanvasDoc } from '../spatialCanvasStore';

const MAX_ENTRIES = 60;

function cloneDoc(doc: SpatialCanvasDoc): SpatialCanvasDoc {
  return JSON.parse(JSON.stringify(doc)) as SpatialCanvasDoc;
}

export type SpatialCanvasHistory = {
  pushBefore: (doc: SpatialCanvasDoc) => void;
  undo: (current: SpatialCanvasDoc) => SpatialCanvasDoc | null;
  redo: (current: SpatialCanvasDoc) => SpatialCanvasDoc | null;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clear: () => void;
};

export function createSpatialCanvasHistory(): SpatialCanvasHistory {
  const undoStack: SpatialCanvasDoc[] = [];
  const redoStack: SpatialCanvasDoc[] = [];

  return {
    pushBefore(doc) {
      undoStack.push(cloneDoc(doc));
      if (undoStack.length > MAX_ENTRIES) undoStack.shift();
      redoStack.length = 0;
    },
    undo(current) {
      if (!undoStack.length) return null;
      redoStack.push(cloneDoc(current));
      return undoStack.pop() ?? null;
    },
    redo(current) {
      if (!redoStack.length) return null;
      undoStack.push(cloneDoc(current));
      return redoStack.pop() ?? null;
    },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    clear() {
      undoStack.length = 0;
      redoStack.length = 0;
    },
  };
}
