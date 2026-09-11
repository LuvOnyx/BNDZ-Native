import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Icons8Icon } from '../../components/Icons8Icon';
import {
  disarmFluidDrag,
  getFluidDragState,
  subscribeFluidDrag,
  type FluidDragMeta,
} from './fluidDragBridge';
import { getMotionBusSnapshot, subscribeMotionPointer } from '../workstationMotionBus';
import {
  fetchFluidDragThumb,
  peekFluidDragThumbs,
  type FluidDragItem,
} from './fluidDragThumbs';
import { isOleDragHandoffActive, subscribeOleDragHandoff } from '../../lib/fileDragUiCleanup';

const MAX_VISIBLE = 10;
/** Horizontal fan span per card — wide enough to read as a multi-file stack. */
const FAN_SPREAD = 58;
const CURSOR_OFFSET_X = 14;
const CURSOR_OFFSET_Y = 10;
/** Cursor-locked follow — lag felt "clunky" at lower values. */
const FOLLOW = 1;
const TILT_FOLLOW = 0.55;

type Props = {
  enabled?: boolean;
};

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function FluidDragIcon({
  isDirectory,
  thumb,
  size,
  className,
}: {
  isDirectory?: boolean;
  thumb?: string;
  size: number;
  className?: string;
}) {
  // Never mount Icons8 and native img as a hard swap — keep fallback under a fading-in native.
  return (
    <span className={`bndz-fluid-drag-icon-slot${thumb ? ' has-thumb' : ''}${className ? ` ${className}` : ''}`}>
      <span className="bndz-fluid-drag-icon-fallback" aria-hidden>
        <Icons8Icon id={isDirectory ? 'explorer' : 'file_ui'} size={size} />
      </span>
      {thumb ? (
        <img src={thumb} alt="" className="bndz-fluid-drag-icon-native" draggable={false} />
      ) : null}
    </span>
  );
}

function FluidDragStackInner({ meta }: { meta: FluidDragMeta }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const items = useMemo(() => {
    const fromMeta = meta.items?.length
      ? meta.items
      : (meta.paths ?? []).map((path, i) => ({
        path,
        name: i === 0 ? meta.label : `Item ${i + 1}`,
        isDirectory: i === 0 ? !!meta.isDirectory : false,
      }));
    return fromMeta.slice(0, MAX_VISIBLE) as FluidDragItem[];
  }, [meta]);

  // Seed from cache synchronously so first paint already has native thumbs when possible.
  const [thumbs, setThumbs] = useState<Record<string, string>>(() => peekFluidDragThumbs(items));
  const smoothRef = useRef({ x: 0, y: 0, rot: 0, scale: 0.94 });
  const entranceRef = useRef(0);
  const rafRef = useRef(0);
  const runningRef = useRef(false);
  // Cached DOM refs — populated after each render to avoid querySelectorAll in the RAF loop.
  const leadElRef = useRef<HTMLElement | null>(null);
  const badgeElRef = useRef<HTMLElement | null>(null);
  const pillElRef = useRef<HTMLElement | null>(null);
  const fanCardsRef = useRef<HTMLElement[]>([]);

  const isMulti = meta.count > 1;
  /** Multi: every visible item is a fan card — no separate lead chip covering the span. */
  const fanItems = isMulti ? items : [];
  const leadItem = items[0];

  // Re-populate cached node refs synchronously after every render.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    leadElRef.current = root.querySelector('[data-fluid-lead]') as HTMLElement | null;
    badgeElRef.current = root.querySelector('[data-fluid-badge]') as HTMLElement | null;
    pillElRef.current = root.querySelector('[data-fluid-pill]') as HTMLElement | null;
    const cards = root.querySelectorAll('[data-fluid-card]');
    fanCardsRef.current = Array.from(cards) as HTMLElement[];
  });

  useEffect(() => {
    const { pointer } = getMotionBusSnapshot();
    smoothRef.current = {
      x: pointer.x + CURSOR_OFFSET_X,
      y: pointer.y + CURSOR_OFFSET_Y,
      rot: 0,
      scale: 0.9,
    };
    entranceRef.current = 0;
    let active = true;
    // Merge cache hits — never wipe to empty (that caused Icons8 flash).
    const seeded = peekFluidDragThumbs(items);
    setThumbs(prev => {
      const next: Record<string, string> = { ...seeded };
      for (const item of items) {
        if (prev[item.path] && !next[item.path]) next[item.path] = prev[item.path];
      }
      return next;
    });
    (async () => {
      const next: Record<string, string> = { ...seeded };
      await Promise.all(items.map(async item => {
        const data = await fetchFluidDragThumb(item.path, item.isDirectory);
        if (data && active) next[item.path] = data;
      }));
      if (active) setThumbs(next);
    })();
    return () => { active = false; };
  }, [items]);

  useEffect(() => {
    const schedule = () => {
      if (runningRef.current) return;
      runningRef.current = true;
      rafRef.current = requestAnimationFrame(tick);
    };

    const tick = () => {
      runningRef.current = false;
      if (isOleDragHandoffActive()) {
        const root = rootRef.current;
        if (root) {
          root.style.setProperty('display', 'none', 'important');
          root.style.setProperty('visibility', 'hidden', 'important');
          root.style.setProperty('opacity', '0', 'important');
        }
        return;
      }
      const { pointer, snapTension } = getMotionBusSnapshot();
      if (!rootRef.current) return;

      const targetX = pointer.x + CURSOR_OFFSET_X;
      const targetY = pointer.y + CURSOR_OFFSET_Y;
      const smooth = smoothRef.current;
      const entranceBefore = entranceRef.current;
      entranceRef.current = Math.min(1, entranceBefore + 0.18);
      const entrance = 1 - Math.pow(1 - entranceRef.current, 2.6);
      smooth.x = lerp(smooth.x, targetX, FOLLOW);
      smooth.y = lerp(smooth.y, targetY, FOLLOW);
      const tilt = Math.max(-16, Math.min(16, pointer.vx * 0.5));
      smooth.rot = lerp(smooth.rot, tilt * (1 - snapTension * 0.9), TILT_FOLLOW);
      const mountScale = 0.9 + entrance * 0.1;
      smooth.scale = lerp(smooth.scale, mountScale - snapTension * 0.06, 0.35);

      // Use cached DOM refs — populated by useLayoutEffect, no querySelectorAll per frame.
      const lead = leadElRef.current;
      const badge = badgeElRef.current;
      const pill = pillElRef.current;
      const cards = fanCardsRef.current;

      if (lead) {
        lead.style.transform =
          `translate3d(${smooth.x}px, ${smooth.y}px, 0) rotate(${smooth.rot}deg) scale(${smooth.scale})`;
      }

      if (cards.length) {
        const n = cards.length;
        cards.forEach((el, i) => {
          // Arc fan centered on cursor — front card (i=0) sits nearest the pointer
          const t = n <= 1 ? 0 : i / (n - 1) - 0.5;
          const fan = t * FAN_SPREAD * (n + 1) * 0.55 * entrance;
          const collapse = snapTension;
          const stagger = Math.min(1, Math.max(0, entrance * 1.2 - i * 0.07));
          const x = smooth.x + fan * (1 - collapse * 0.9);
          const y = smooth.y + i * (9 + i * 1.2) * (1 - collapse * 0.94) + (1 - stagger) * 8;
          const rot = (fan * 0.55 + smooth.rot * 0.55) * (1 - collapse);
          const sc = (1 - i * 0.032 - collapse * 0.04) * smooth.scale * (0.88 + stagger * 0.12);
          const op = (1 - i * 0.055 - collapse * 0.15) * stagger;
          el.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${rot}deg) scale(${sc})`;
          el.style.opacity = String(Math.max(0.28, op));
          el.style.zIndex = String(300 - i);
        });
      }

      if (pill) {
        pill.style.transform =
          `translate3d(${smooth.x + 52}px, ${smooth.y - 6}px, 0) scale(${smooth.scale})`;
      }

      if (badge) {
        badge.style.transform =
          `translate3d(${smooth.x + 40}px, ${smooth.y + 28 + cards.length * 7}px, 0) scale(${smooth.scale})`;
      }

      // Self-reschedule only while entrance is still animating.
      // Once complete, subscribeMotionPointer and subscribeFluidDrag wake the loop on every pointer move.
      if (entranceBefore < 1) {
        schedule();
      }
    };

    schedule();
    const unsubDrag = subscribeFluidDrag(schedule);
    const unsubMotion = subscribeMotionPointer(schedule);
    return () => {
      cancelAnimationFrame(rafRef.current);
      runningRef.current = false;
      unsubDrag();
      unsubMotion();
    };
  }, [fanItems.length]);

  return (
    <div ref={rootRef} className="bndz-fluid-drag-stack fixed inset-0 z-[300] pointer-events-none" aria-hidden>
      {isMulti && (
        <div data-fluid-fan className="contents">
          {fanItems.map((item, i) => (
            <div
              key={`${item.path}-${i}`}
              data-fluid-card
              className="bndz-fluid-drag-card absolute left-0 top-0 will-change-transform"
              style={{ zIndex: 300 - i }}
            >
              <div className={`bndz-fluid-drag-card-inner bndz-fluid-drag-card-inner--fan${i === 0 ? ' is-lead' : ''}`}>
                <FluidDragIcon
                  isDirectory={item.isDirectory}
                  thumb={thumbs[item.path]}
                  size={16}
                  className="bndz-fluid-drag-card-icon"
                />
                <span className="bndz-fluid-drag-card-caption" title={item.name}>{item.name}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Single-item only: classic lead chip. Multi uses the fan alone. */}
      {!isMulti && (
        <div data-fluid-lead className="absolute left-0 top-0 will-change-transform z-[310]">
          <div className="bndz-fluid-drag-lead">
            <div className="bndz-fluid-drag-lead-aurora" aria-hidden />
            <div className="bndz-fluid-drag-lead-icon">
              <FluidDragIcon
                isDirectory={meta.isDirectory}
                thumb={leadItem ? thumbs[leadItem.path] : undefined}
                size={22}
              />
              {meta.copy && (
                <span className="bndz-fluid-drag-copy-badge">
                  <Icons8Icon id="copy" size={9} />
                </span>
              )}
            </div>
            <div className="min-w-0">
              <div className="bndz-fluid-drag-lead-title">{meta.label}</div>
              <div className="bndz-fluid-drag-lead-sub">
                {meta.copy ? 'Copy' : 'Move'}
                {meta.dropHint ? ` · ${meta.dropHint}` : ''}
              </div>
            </div>
          </div>
        </div>
      )}

      {isMulti && (
        <div data-fluid-pill className="bndz-fluid-drag-multi-pill absolute left-0 top-0 will-change-transform z-[320]">
          <span className="bndz-fluid-drag-multi-count">{meta.count}</span>
          <span className="bndz-fluid-drag-multi-label">{meta.copy ? 'Copy' : 'Move'}</span>
        </div>
      )}

      {meta.count > MAX_VISIBLE && (
        <div data-fluid-badge className="bndz-fluid-drag-overflow-badge">
          +{meta.count - MAX_VISIBLE}
        </div>
      )}
    </div>
  );
}

export default function FluidDragStack({ enabled = true }: Props) {
  const [state, setState] = useState(getFluidDragState);
  const [handoff, setHandoff] = useState(isOleDragHandoffActive);

  useEffect(() => {
    if (!enabled) return;
    return subscribeFluidDrag(() => setState(getFluidDragState()));
  }, [enabled]);

  useEffect(() => subscribeOleDragHandoff(() => setHandoff(isOleDragHandoffActive())), []);

  useEffect(() => {
    if (!enabled && state.visible) disarmFluidDrag();
  }, [enabled, state.visible]);

  if (!enabled || handoff || !state.visible || !state.meta) return null;
  return <FluidDragStackInner meta={state.meta} />;
}
