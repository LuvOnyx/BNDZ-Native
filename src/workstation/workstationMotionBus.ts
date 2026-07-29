export type DragPhase = 'idle' | 'arming' | 'dragging' | 'snapping';

export type PointerSample = { x: number; y: number; vx: number; vy: number; t: number };

export type MotionSnapshot = {
  pointer: PointerSample;
  snapTension: number;
  dragPhase: DragPhase;
};

type Listener = () => void;

const phaseListeners = new Set<Listener>();
const pointerListeners = new Set<Listener>();
let lastSample = { x: 0, y: 0, t: 0 };

let pointer: PointerSample = { x: 0, y: 0, vx: 0, vy: 0, t: 0 };
let snapTension = 0;
let dragPhase: DragPhase = 'idle';

/** Stable reference for phase-only subscribers (WorkstationVisualProvider). */
let phaseSnapshot = { dragPhase, snapTension };

/** Full snapshot — pointer fields mutate in place; replaced on phase publish. */
let snapshot: MotionSnapshot = { pointer, snapTension, dragPhase };

function publishPhase() {
  phaseSnapshot = { dragPhase, snapTension };
  snapshot = {
    dragPhase,
    snapTension,
    pointer: { ...pointer },
  };
  phaseListeners.forEach(fn => fn());
}

function publishPointer() {
  pointerListeners.forEach(fn => fn());
}

export function getMotionBusSnapshot(): MotionSnapshot {
  return snapshot;
}

export function getMotionPhaseSnapshot(): Pick<MotionSnapshot, 'dragPhase' | 'snapTension'> {
  return phaseSnapshot;
}

/** Legacy — subscribes to all motion events (pointer + phase). */
export function subscribeMotionBus(fn: Listener): () => void {
  phaseListeners.add(fn);
  pointerListeners.add(fn);
  return () => {
    phaseListeners.delete(fn);
    pointerListeners.delete(fn);
  };
}

export function subscribeMotionPhase(fn: Listener): () => void {
  phaseListeners.add(fn);
  return () => phaseListeners.delete(fn);
}

export function subscribeMotionPointer(fn: Listener): () => void {
  pointerListeners.add(fn);
  return () => pointerListeners.delete(fn);
}

export function setMotionDragPhase(phase: DragPhase) {
  if (dragPhase === phase) return;
  dragPhase = phase;
  publishPhase();
}

export function setMotionSnapTension(tension: number) {
  const t = Math.max(0, Math.min(1, tension));
  if (snapTension === t) return;
  snapTension = t;
  publishPhase();
}

export function updateMotionPointer(x: number, y: number) {
  const now = performance.now();
  const dt = Math.max(1, now - lastSample.t);
  const vx = ((x - lastSample.x) / dt) * 16;
  const vy = ((y - lastSample.y) / dt) * 16;
  pointer = { x, y, vx, vy, t: now };
  snapshot.pointer = pointer;
  lastSample = { x, y, t: now };
  publishPointer();
}

export function resetMotionBus() {
  dragPhase = 'idle';
  snapTension = 0;
  pointer = { x: 0, y: 0, vx: 0, vy: 0, t: 0 };
  snapshot.pointer = pointer;
  lastSample = { x: 0, y: 0, t: 0 };
  publishPhase();
}
