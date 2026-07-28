export type WorkspaceTransform = { panX: number; panY: number; zoom: number };

export type WorkspaceEngineOptions = {
  minZoom?: number;
  maxZoom?: number;
  /** Throttle zoom % display updates (ms). Default 250 (~4/sec). */
  displayThrottleMs?: number;
};

/**
 * Imperative pan/zoom engine — no React state during interaction.
 * Applies transforms via rAF to layer + optional grid elements.
 */
export class WorkspaceInteractionEngine {
  private transform: WorkspaceTransform = { panX: 0, panY: 0, zoom: 1 };
  private rafId = 0;
  private layerEl: HTMLElement | null = null;
  private gridEl: HTMLElement | null = null;
  private readonly minZoom: number;
  private readonly maxZoom: number;
  private readonly displayThrottleMs: number;
  private displayListeners = new Set<(zoom: number) => void>();
  private transformListeners = new Set<(t: WorkspaceTransform) => void>();
  private lastDisplayUpdate = 0;
  private pendingDisplayZoom: number | null = null;
  private displayTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts?: WorkspaceEngineOptions) {
    this.minZoom = opts?.minZoom ?? 0.35;
    this.maxZoom = opts?.maxZoom ?? 2.5;
    this.displayThrottleMs = opts?.displayThrottleMs ?? 250;
  }

  getTransform(): Readonly<WorkspaceTransform> {
    return this.transform;
  }

  clampZoom(zoom: number): number {
    return Math.min(this.maxZoom, Math.max(this.minZoom, zoom));
  }

  setTransform(panX: number, panY: number, zoom: number, immediate = false): WorkspaceTransform {
    this.transform = this.normalizeTransform(panX, panY, zoom);
    if (immediate) this.applyNow();
    else this.scheduleApply();
    return this.transform;
  }

  /** Snap pan/zoom for sharper compositing (avoids subpixel blur). */
  private normalizeTransform(panX: number, panY: number, zoom: number): WorkspaceTransform {
    const px = Number.isFinite(panX) ? panX : 0;
    const py = Number.isFinite(panY) ? panY : 0;
    const z = Number.isFinite(zoom) ? zoom : 1;
    return {
      panX: Math.round(px),
      panY: Math.round(py),
      zoom: this.clampZoom(Math.round(z * 100) / 100),
    };
  }

  bindElements(layer: HTMLElement | null, grid?: HTMLElement | null): void {
    this.layerEl = layer;
    this.gridEl = grid ?? null;
    if (layer) this.applyNow();
  }

  subscribeDisplay(cb: (zoom: number) => void): () => void {
    this.displayListeners.add(cb);
    cb(this.transform.zoom);
    return () => this.displayListeners.delete(cb);
  }

  /** Imperative listeners — never triggers React; used for minimap/viewport chrome. */
  subscribeTransform(cb: (t: WorkspaceTransform) => void): () => void {
    this.transformListeners.add(cb);
    cb(this.transform);
    return () => this.transformListeners.delete(cb);
  }

  screenToWorld(clientX: number, clientY: number, boardRect: DOMRect): { x: number; y: number } {
    const { panX, panY, zoom } = this.transform;
    return {
      x: (clientX - boardRect.left - panX) / zoom,
      y: (clientY - boardRect.top - panY) / zoom,
    };
  }

  zoomAtCursor(
    clientX: number,
    clientY: number,
    boardRect: DOMRect,
    factor: number,
  ): WorkspaceTransform {
    const { panX, panY, zoom } = this.transform;
    const nextZoom = this.clampZoom(zoom * factor);
    const bx = (clientX - boardRect.left - panX) / zoom;
    const by = (clientY - boardRect.top - panY) / zoom;
    const panX2 = clientX - boardRect.left - bx * nextZoom;
    const panY2 = clientY - boardRect.top - by * nextZoom;
    this.transform = this.normalizeTransform(panX2, panY2, nextZoom);
    this.scheduleApply();
    return this.transform;
  }

  panBy(dx: number, dy: number): WorkspaceTransform {
    this.transform = this.normalizeTransform(
      this.transform.panX + dx,
      this.transform.panY + dy,
      this.transform.zoom,
    );
    this.scheduleApply();
    return this.transform;
  }

  private scheduleApply(): void {
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      this.applyNow();
    });
  }

  private applyNow(): void {
    const { panX, panY, zoom } = this.transform;
    const layer = this.layerEl;
    if (layer) {
      layer.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${zoom})`;
    }
    const grid = this.gridEl;
    if (grid) {
      grid.style.backgroundPosition = `${panX}px ${panY}px`;
      grid.style.backgroundSize = `${24 * zoom}px ${24 * zoom}px`;
    }
    this.notifyDisplay(zoom);
    const t = this.transform;
    this.transformListeners.forEach(fn => fn(t));
  }

  private notifyDisplay(zoom: number): void {
    const fire = () => this.displayListeners.forEach(fn => fn(zoom));
    const now = performance.now();
    const elapsed = now - this.lastDisplayUpdate;
    if (elapsed >= this.displayThrottleMs) {
      this.lastDisplayUpdate = now;
      this.pendingDisplayZoom = null;
      if (this.displayTimer) {
        clearTimeout(this.displayTimer);
        this.displayTimer = null;
      }
      fire();
      return;
    }
    this.pendingDisplayZoom = zoom;
    if (this.displayTimer) return;
    this.displayTimer = setTimeout(() => {
      this.displayTimer = null;
      if (this.pendingDisplayZoom == null) return;
      this.lastDisplayUpdate = performance.now();
      this.pendingDisplayZoom = null;
      fire();
    }, this.displayThrottleMs - elapsed);
  }

  destroy(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    if (this.displayTimer) clearTimeout(this.displayTimer);
    this.displayListeners.clear();
    this.transformListeners.clear();
    this.layerEl = null;
    this.gridEl = null;
  }
}
