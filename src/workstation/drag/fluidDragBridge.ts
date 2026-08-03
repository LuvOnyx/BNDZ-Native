import { updateMotionPointer, setMotionSnapTension } from '../workstationMotionBus';
import type { FluidDragItem } from './fluidDragThumbs';

export type FluidDragMeta = {
  label: string;
  count: number;
  copy: boolean;
  isDirectory?: boolean;
  dropHint?: string;
  paths?: string[];
  items?: FluidDragItem[];
};

let activeMeta: FluidDragMeta | null = null;
let visible = false;

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeFluidDrag(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  listeners.forEach(fn => fn());
}

export function getFluidDragState() {
  return { meta: activeMeta, visible };
}

export function armFluidDrag(meta: FluidDragMeta, at?: { x: number; y: number }) {
  if (at) updateMotionPointer(at.x, at.y);
  activeMeta = meta;
  visible = true;
  notify();
}

export function updateFluidDragPointer(x: number, y: number) {
  updateMotionPointer(x, y);
}

export function updateFluidDragMeta(patch: Partial<FluidDragMeta>) {
  if (!activeMeta) return;
  // Skip notify if nothing changed — prevents spurious FluidDragStack re-renders.
  const keys = Object.keys(patch) as (keyof FluidDragMeta)[];
  if (keys.every(k => (activeMeta as FluidDragMeta)[k] === (patch as FluidDragMeta)[k])) return;
  activeMeta = { ...activeMeta, ...patch };
  notify();
}

export function setFluidDragSnapTension(tension: number) {
  setMotionSnapTension(tension);
}

export function disarmFluidDrag() {
  activeMeta = null;
  visible = false;
  setMotionSnapTension(0);
  notify();
}

/** Drop-in replacement for setDragGhostPosition when fluid stacks enabled. */
export function fluidDragBridgeSetPointer(el: HTMLElement | null, x: number, y: number) {
  updateFluidDragPointer(x, y);
  if (el) {
    el.style.display = 'none';
  }
}
