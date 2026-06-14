/**
 * Global Escape stack — dismiss overlays in priority order (capture phase).
 * Higher priority layers dismiss first (modals → context menus → filters → back).
 */

export type EscapeLayer = {
  id: string;
  priority: number;
  isActive: () => boolean;
  dismiss: () => void;
};

const layers = new Map<string, EscapeLayer>();
let listenerAttached = false;

export function registerEscapeLayer(layer: EscapeLayer): () => void {
  layers.set(layer.id, layer);
  return () => layers.delete(layer.id);
}

export function handleGlobalEscape(): boolean {
  const active = [...layers.values()]
    .filter(l => {
      try {
        return l.isActive();
      } catch {
        return false;
      }
    })
    .sort((a, b) => b.priority - a.priority);

  if (active.length === 0) return false;
  try {
    active[0].dismiss();
  } catch {
    /* noop */
  }
  return true;
}

export function initGlobalEscapeListener() {
  if (typeof window === 'undefined' || listenerAttached) return;
  listenerAttached = true;

  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape') return;
      if (handleGlobalEscape()) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true,
  );
}
