/** Imperative invalidation for spatial canvas overlays (wires, halos) — no React per frame. */
type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeSpatialVisual(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function invalidateSpatialVisual(): void {
  listeners.forEach(fn => fn());
}
