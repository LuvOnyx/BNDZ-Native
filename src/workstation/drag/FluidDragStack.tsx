import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Icons8Icon } from '../../components/Icons8Icon';
import {
  disarmFluidDrag,
  getFluidDragState,
  subscribeFluidDrag,
  type FluidDragMeta,
} from './fluidDragBridge';
import { getMotionBusSnapshot, subscribeMotionPointer } from '../workstationMotionBus';
import { fetchFluidDragThumb, type FluidDragItem } from './fluidDragThumbs';

const MAX_VISIBLE = 10;
const FAN_SPREAD = 18;
const CURSOR_OFFSET_X = 12;
const CURSOR_OFFSET_Y = 8;

type Props = {
  enabled?: boolean;
};

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function FluidDragStackInner({ meta }: { meta: FluidDragMeta }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [mounted, setMounted] = useState(false);
  const smoothRef = useRef({ x: 0, y: 0, rot: 0, scale: 0.92 });
  const entranceRef = useRef(0);
  const rafRef = useRef(0);

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

  const isMulti = meta.count > 1;
  const fanItems = isMulti ? items.slice(1) : [];
  const leadItem = items[0];

  useEffect(() => {
    const { pointer } = getMotionBusSnapshot();
    smoothRef.current = {
      x: pointer.x + CURSOR_OFFSET_X,
      y: pointer.y + CURSOR_OFFSET_Y,
      rot: 0,
      scale: 0.88,
    };
    entranceRef.current = 0;
    setMounted(true);
    let active = true;
    setThumbs({});
    (async () => {
      const next: Record<string, string> = {};
      await Promise.all(items.map(async item => {
        const data = await fetchFluidDragThumb(item.path, item.isDirectory);
        if (data && active) next[item.path] = data;
      }));
      if (active) setThumbs(next);
    })();
    return () => { active = false; };
  }, [items]);

  useEffect(() => {
    const tick = () => {
      const { pointer, snapTension } = getMotionBusSnapshot();
      const root = rootRef.current;
      if (!root) return;

      const targetX = pointer.x + CURSOR_OFFSET_X;
      const targetY = pointer.y + CURSOR_OFFSET_Y;
      const smooth = smoothRef.current;
      entranceRef.current = Math.min(1, entranceRef.current + 0.14);
      const entrance = 1 - Math.pow(1 - entranceRef.current, 2.4);
      smooth.x = lerp(smooth.x, targetX, 0.38);
      smooth.y = lerp(smooth.y, targetY, 0.38);
      const tilt = Math.max(-14, Math.min(14, pointer.vx * 0.42));
      smooth.rot = lerp(smooth.rot, tilt * (1 - snapTension * 0.85), 0.28);
      const mountScale = 0.88 + entrance * 0.12;
      smooth.scale = lerp(smooth.scale, mountScale - snapTension * 0.08, 0.22);

      const stack = root.querySelector('[data-fluid-fan]') as HTMLElement | null;
      const lead = root.querySelector('[data-fluid-lead]') as HTMLElement | null;
      const badge = root.querySelector('[data-fluid-badge]') as HTMLElement | null;

      if (lead) {
        lead.style.transform = `translate3d(${Math.round(smooth.x)}px, ${Math.round(smooth.y)}px, 0) rotate(${smooth.rot}deg) scale(${smooth.scale})`;
      }

      if (stack) {
        const cards = stack.querySelectorAll('[data-fluid-card]');
        cards.forEach((node, i) => {
          const el = node as HTMLElement;
          const fan = (i - (fanItems.length - 1) / 2) * FAN_SPREAD * entrance;
          const collapse = snapTension;
          const stagger = Math.min(1, Math.max(0, entrance * 1.15 - i * 0.08));
          const x = smooth.x + 10 + fan * (1 - collapse * 0.88);
          const y = smooth.y + 8 + (i + 1) * (8 + i * 1.1) * (1 - collapse * 0.92) + (1 - stagger) * 14;
          const rot = (fan * 0.5 + smooth.rot * 0.65) * (1 - collapse);
          const sc = (1 - (i + 1) * 0.04 - collapse * 0.05) * smooth.scale * (0.82 + stagger * 0.18);
          const op = (1 - (i + 1) * 0.08 - collapse * 0.2) * stagger;
          el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) rotate(${rot}deg) scale(${sc})`;
          el.style.opacity = String(Math.max(0.15, op));
        });
      }

      if (badge) {
        badge.style.transform = `translate3d(${Math.round(smooth.x + 34)}px, ${Math.round(smooth.y + 22 + fanItems.length * 6)}px, 0) scale(${smooth.scale})`;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    const unsubDrag = subscribeFluidDrag(tick);
    const unsubMotion = subscribeMotionPointer(tick);
    return () => {
      cancelAnimationFrame(rafRef.current);
      unsubDrag();
      unsubMotion();
    };
  }, [fanItems.length]);

  return (
    <div ref={rootRef} className="bndz-fluid-drag-stack fixed inset-0 z-[300] pointer-events-none">
      <AnimatePresence>
        {mounted && (
          <motion.div
            key="fluid-mount"
            className="contents"
            initial={{ opacity: 0, scale: 0.88 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.94 }}
            transition={{ type: 'spring', stiffness: 520, damping: 32, mass: 0.75 }}
          />
        )}
      </AnimatePresence>

      {isMulti && (
        <div data-fluid-fan className="contents">
          {fanItems.map((item, i) => (
            <div
              key={`${item.path}-${i}`}
              data-fluid-card
              className="bndz-fluid-drag-card absolute left-0 top-0 will-change-transform"
              style={{ zIndex: 280 - i }}
            >
              <div className="bndz-fluid-drag-card-inner bndz-fluid-drag-card-inner--fan">
                {thumbs[item.path] ? (
                  <img src={thumbs[item.path]} alt="" className="bndz-fluid-drag-card-img" draggable={false} />
                ) : (
                  <div className="bndz-fluid-drag-card-fallback">
                    <Icons8Icon id={item.isDirectory ? 'explorer' : 'file_ui'} size={16} />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div data-fluid-lead className="absolute left-0 top-0 will-change-transform z-[310]">
        <motion.div
          className={`bndz-fluid-drag-lead${isMulti ? ' is-multi' : ''}`}
          initial={{ opacity: 0, scale: 0.86 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 520, damping: 30, mass: 0.72 }}
        >
          <div className="bndz-fluid-drag-lead-aurora" aria-hidden />
          <div className="bndz-fluid-drag-lead-icon">
            {leadItem && thumbs[leadItem.path] ? (
              <img src={thumbs[leadItem.path]} alt="" className="bndz-fluid-drag-lead-img" draggable={false} />
            ) : (
              <Icons8Icon id={meta.isDirectory ? 'explorer' : 'file_ui'} size={22} />
            )}
            {meta.copy && (
              <span className="bndz-fluid-drag-copy-badge">
                <Icons8Icon id="copy" size={9} />
              </span>
            )}
            {isMulti && (
              <span className="bndz-fluid-drag-count-badge">{meta.count}</span>
            )}
          </div>
          <div className="min-w-0">
            <div className="bndz-fluid-drag-lead-title">
              {isMulti ? `${meta.count} items` : meta.label}
            </div>
            <div className="bndz-fluid-drag-lead-sub">
              {meta.copy ? 'Copy' : 'Move'}
              {isMulti ? ` · ${leadItem?.name ?? meta.label}` : ''}
              {meta.dropHint ? ` · ${meta.dropHint}` : ''}
            </div>
          </div>
        </motion.div>
      </div>

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

  useEffect(() => {
    if (!enabled) return;
    return subscribeFluidDrag(() => setState(getFluidDragState()));
  }, [enabled]);

  useEffect(() => {
    if (!enabled && state.visible) disarmFluidDrag();
  }, [enabled, state.visible]);

  if (!enabled || !state.visible || !state.meta) return null;
  return <FluidDragStackInner meta={state.meta} />;
}
