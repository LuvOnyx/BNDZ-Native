import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent as RPE } from 'react';
import { DEFAULT_HOME_MODULE_ORDER, homeModuleDef, type HomeModuleDef } from '../../lib/homeWidgets';

/**
 * Home module dashboard.
 *
 * Modules are the Home sections themselves (plus live-data plugins),
 * laid out on a 4-column grid in BNDZ's own Home design language.
 * Press and hold any module until every module starts the Apple-style
 * shake — that is edit mode: drag modules to reorder them, tap the
 * corner badge to remove one, Done (or Esc / tap empty space) to stop.
 * The round + button opens the gallery of modules/plugins on offer
 * (Homarr-style), where modules can be added or removed.
 */

export type DashboardModule = { id: string; node: ReactNode };

type DragState = {
  id: string;
  width: number;
  height: number;
  grabDX: number;
  grabDY: number;
  x: number;
  y: number;
  moved: boolean;
};

const LONG_PRESS_MS = 420;

export default function HomeDashboard({
  modules,
  order,
  onOrderChange,
  catalog,
  visibleIds,
  onToggleWidget,
}: {
  modules: DashboardModule[];
  order: string[];
  onOrderChange: (next: string[]) => void;
  catalog: HomeModuleDef[];
  visibleIds: string[];
  onToggleWidget: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const pressTimer = useRef<number | null>(null);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);

  const display = useMemo(() => {
    const byId = new Map(modules.map(m => [m.id, m]));
    const out: DashboardModule[] = [];
    for (const id of order) { const m = byId.get(id); if (m) { out.push(m); byId.delete(id); } }
    for (const m of byId.values()) out.push(m);
    return out;
  }, [modules, order]);

  const clearPress = useCallback(() => {
    if (pressTimer.current != null) { window.clearTimeout(pressTimer.current); pressTimer.current = null; }
    pressStart.current = null;
  }, []);

  useEffect(() => () => clearPress(), [clearPress]);

  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setEditing(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing]);

  const moveId = useCallback((id: string, toIndex: number) => {
    const ids = display.map(m => m.id);
    const from = ids.indexOf(id);
    if (from < 0) return;
    const next = [...ids];
    next.splice(from, 1);
    next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, id);
    if (next.join('|') !== ids.join('|')) onOrderChange(next);
  }, [display, onOrderChange]);

  const targetIndexAt = useCallback((x: number, y: number, selfId: string): number => {
    const grid = gridRef.current;
    if (!grid) return display.length - 1;
    const slots = Array.from(grid.querySelectorAll<HTMLElement>('[data-module-slot]'));
    for (let i = 0; i < slots.length; i++) {
      const r = slots[i].getBoundingClientRect();
      if (x >= r.left - 6 && x <= r.right + 6 && y >= r.top - 6 && y <= r.bottom + 6) {
        return display.findIndex(m => m.id === slots[i].dataset.moduleId);
      }
    }
    // Below / after everything -> end; above everything -> start.
    if (slots.length) {
      const last = slots[slots.length - 1].getBoundingClientRect();
      if (y > last.bottom) return display.length - 1;
      const first = slots[0].getBoundingClientRect();
      if (y < first.top) return 0;
    }
    return display.findIndex(m => m.id === selfId);
  }, [display]);

  const onModulePointerDown = (id: string) => (e: RPE<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if ((e.target as HTMLElement).closest('[data-module-remove]')) return;
    pressStart.current = { x: e.clientX, y: e.clientY };
    if (!editing) {
      clearPress();
      pressTimer.current = window.setTimeout(() => {
        pressTimer.current = null;
        setEditing(true);
      }, LONG_PRESS_MS);
      return;
    }
    // Edit mode: start a drag on this module.
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    try { el.setPointerCapture(e.pointerId); } catch { /* noop */ }
    setDrag({
      id,
      width: r.width,
      height: r.height,
      grabDX: e.clientX - r.left,
      grabDY: e.clientY - r.top,
      x: r.left,
      y: r.top,
      moved: false,
    });
  };

  const onModulePointerMove = (id: string) => (e: RPE<HTMLDivElement>) => {
    if (pressStart.current && !editing) {
      const dx = Math.abs(e.clientX - pressStart.current.x);
      const dy = Math.abs(e.clientY - pressStart.current.y);
      if (dx > 8 || dy > 8) clearPress();
    }
    if (!drag || drag.id !== id) return;
    const nx = e.clientX - drag.grabDX;
    const ny = e.clientY - drag.grabDY;
    const moved = drag.moved || Math.abs(e.clientX - (drag.x + drag.grabDX)) > 4 || Math.abs(e.clientY - (drag.y + drag.grabDY)) > 4;
    setDrag({ ...drag, x: nx, y: ny, moved });
    if (moved) {
      const t = targetIndexAt(e.clientX, e.clientY, id);
      if (t >= 0) moveId(id, t);
    }
  };

  const endPointer = (id: string) => (e: RPE<HTMLDivElement>) => {
    clearPress();
    if (drag && drag.id === id) {
      if (drag.moved) {
        suppressClick.current = true;
        window.setTimeout(() => { suppressClick.current = false; }, 80);
      }
      setDrag(null);
    }
  };

  const onGridPointerDown = (e: RPE<HTMLDivElement>) => {
    if (editing && e.target === e.currentTarget) setEditing(false);
  };

  const galleryItems = catalog.filter(c => c.id !== 'clock');

  return (
    <div className={`bndz-home-dash${editing ? ' is-editing' : ''}`}>
      <div className="bndz-home-dash-bar">
        {editing && <span className="bndz-home-dash-hint">Drag to reorder</span>}
        <span className="bndz-home-dash-spacer" />
        {editing && (
          <button type="button" className="bndz-home-dash-done" onClick={() => setEditing(false)}>
            Done
          </button>
        )}
        <button
          type="button"
          className={`bndz-home-dash-add${galleryOpen ? ' is-open' : ''}`}
          title="Add modules and plugins"
          aria-label="Add modules and plugins"
          onClick={() => setGalleryOpen(o => !o)}
        >
          +
        </button>
      </div>

      {galleryOpen && (
        <div className="bndz-home-gallery" role="dialog" aria-label="Modules and plugins">
          <div className="bndz-home-gallery-head">
            <span>Modules &amp; plugins</span>
            <span className="bndz-home-muted">What Home can show</span>
          </div>
          <ul className="bndz-home-gallery-list">
            {galleryItems.map(item => {
              const active = visibleIds.includes(item.id);
              return (
                <li key={item.id} className="bndz-home-gallery-item">
                  <div className="bndz-home-gallery-meta">
                    <span className="bndz-home-gallery-name">
                      {item.label}
                      {item.kind === 'plugin' && <span className="bndz-home-gallery-tag">Plugin</span>}
                    </span>
                    <span className="bndz-home-gallery-desc">{item.description}</span>
                  </div>
                  <button
                    type="button"
                    className={`bndz-home-gallery-btn${active ? ' is-remove' : ''}`}
                    onClick={() => onToggleWidget(item.id)}
                  >
                    {active ? 'Remove' : 'Add'}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="bndz-home-gallery-foot">
            <button
              type="button"
              className="bndz-home-gallery-reset"
              onClick={() => onOrderChange([...DEFAULT_HOME_MODULE_ORDER])}
            >
              Reset layout
            </button>
          </div>
        </div>
      )}

      <div
        className="bndz-home-modules"
        ref={gridRef}
        onPointerDown={onGridPointerDown}
        onClickCapture={e => { if (suppressClick.current) { e.preventDefault(); e.stopPropagation(); } }}
      >
        {display.map((m, i) => {
          const def = homeModuleDef(m.id);
          const span = def?.span ?? 2;
          const isDragged = drag?.id === m.id;
          if (isDragged && drag) {
            return (
              <div key={m.id} className="bndz-home-module-slot" data-module-slot data-module-id={m.id}>
                <div
                  className={`bndz-home-module is-placeholder span-${span}`}
                  style={{ height: drag.height }}
                />
                <div
                  className="bndz-home-module is-dragging"
                  style={{ width: drag.width, height: drag.height, left: drag.x, top: drag.y }}
                >
                  {m.node}
                </div>
              </div>
            );
          }
          return (
            <div
              key={m.id}
              className={`bndz-home-module span-${span}${editing ? ' is-jiggling' : ''}`}
              data-module-slot
              data-module-id={m.id}
              style={editing ? { animationDelay: `${-(i % 5) * 55}ms` } : undefined}
              onPointerDown={onModulePointerDown(m.id)}
              onPointerMove={onModulePointerMove(m.id)}
              onPointerUp={endPointer(m.id)}
              onPointerCancel={endPointer(m.id)}
              onPointerLeave={() => { if (!editing) clearPress(); }}
            >
              {editing && (
                <button
                  type="button"
                  className="bndz-home-module-remove"
                  data-module-remove
                  title={`Remove ${def?.label ?? m.id}`}
                  aria-label={`Remove ${def?.label ?? m.id}`}
                  onPointerDown={e => e.stopPropagation()}
                  onClick={e => { e.stopPropagation(); onToggleWidget(m.id); }}
                >
                  −
                </button>
              )}
              <div className={editing ? 'bndz-home-module-inner is-locked' : 'bndz-home-module-inner'}>
                {m.node}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
