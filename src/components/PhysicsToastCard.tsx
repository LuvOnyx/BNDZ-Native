import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, Loader2, X } from 'lucide-react';
import type { ToastKind } from './ToastHost';
import {
  physicsToastAnimator,
  Spring,
  PHYSICS_TOAST_SPRING,
  PHYSICS_TOAST_SPRING_SMOOTH,
} from '../lib/physicsToast/spring';
import {
  PHYSICS_TOAST_BLUR,
  PHYSICS_TOAST_EXPAND_HEADER_H,
  PHYSICS_TOAST_FILTER_ID,
  PHYSICS_TOAST_HEADER_H,
  PHYSICS_TOAST_RADIUS,
  PHYSICS_TOAST_SURFACE,
  PHYSICS_TOAST_WIDTH,
} from '../lib/physicsToast/theme';

const SWIPE_DISMISS = 30;
const SWIPE_MAX = 20;

function computeAutopilot(duration: number) {
  return {
    expandDelay: Math.max(Math.round(duration * 0.025), 100),
    collapseAt: Math.max(duration - 2000, duration * 0.5),
  };
}

type TimerEntry = {
  fn: () => void;
  delay: number;
  start: number;
  tid: ReturnType<typeof setTimeout> | null;
  fired: boolean;
  remaining?: number;
};

function ToastIcon({ kind }: { kind: ToastKind }) {
  const cls = 'w-4 h-4';
  switch (kind) {
    case 'success': return <CheckCircle2 className={cls} />;
    case 'error': return <X className={cls} />;
    case 'warning': return <AlertCircle className={cls} />;
    case 'info': return <Info className={cls} />;
    case 'progress': return <Loader2 className={`${cls} bndz-pt-spin`} />;
    default: return <CheckCircle2 className={cls} />;
  }
}

export interface PhysicsToastCardProps {
  id: string;
  kind: ToastKind;
  title: string;
  message: string;
  progress?: number;
  duration: number;
  sticky: boolean;
  onDismiss: (id: string) => void;
}

export default function PhysicsToastCard({
  id,
  kind,
  title,
  message,
  progress,
  duration,
  sticky,
  onDismiss,
}: PhysicsToastCardProps) {
  const animId = useId().replace(/:/g, '');
  const rootRef = useRef<HTMLButtonElement>(null);
  const pillRef = useRef<SVGRectElement>(null);
  const bodyRef = useRef<SVGRectElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const descRef = useRef<HTMLDivElement>(null);

  const [ready, setReady] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [contentH, setContentH] = useState(0);

  const timersRef = useRef<TimerEntry[]>([]);
  const pausedRef = useRef(false);
  const dismissedRef = useRef(false);
  const pointerStartY = useRef<number | null>(null);

  const hasMessage = !!message.trim();
  const isProgress = kind === 'progress';
  const isLoading = isProgress;
  const edge = 'bottom' as const;
  const edgeSign = -1;

  const clearTimers = useCallback(() => {
    for (const t of timersRef.current) {
      if (t.tid) clearTimeout(t.tid);
    }
    timersRef.current = [];
  }, []);

  const addTimer = useCallback((fn: () => void, delay: number) => {
    const timer: TimerEntry = { fn, delay, start: Date.now(), tid: null, fired: false };
    timer.tid = setTimeout(() => {
      timer.fired = true;
      fn();
    }, delay);
    timersRef.current.push(timer);
  }, []);

  const pauseTimers = useCallback(() => {
    if (pausedRef.current) return;
    pausedRef.current = true;
    const now = Date.now();
    for (const timer of timersRef.current) {
      if (!timer.fired && timer.tid) {
        clearTimeout(timer.tid);
        timer.remaining = timer.delay - (now - timer.start);
      }
    }
  }, []);

  const resumeTimers = useCallback(() => {
    if (!pausedRef.current) return;
    pausedRef.current = false;
    for (const timer of timersRef.current) {
      if (!timer.fired && timer.remaining && timer.remaining > 0) {
        timer.start = Date.now();
        timer.delay = timer.remaining;
        timer.tid = setTimeout(() => {
          timer.fired = true;
          timer.fn();
        }, timer.remaining!);
      }
    }
  }, []);

  const expand = useCallback(() => {
    const pill = pillRef.current;
    const body = bodyRef.current;
    const svg = svgRef.current;
    const root = rootRef.current;
    if (!pill || !body || !svg || !root || !contentH) return;

    const totalH = Math.max(PHYSICS_TOAST_HEADER_H * 2.25, PHYSICS_TOAST_HEADER_H + contentH);
    svg.setAttribute('height', String(totalH));
    svg.setAttribute('viewBox', `0 0 ${PHYSICS_TOAST_WIDTH} ${totalH}`);

    const springs = {
      pillH: new Spring(parseFloat(pill.getAttribute('height') || String(PHYSICS_TOAST_HEADER_H)), PHYSICS_TOAST_SPRING),
      bodyH: new Spring(parseFloat(body.getAttribute('height') || '0'), PHYSICS_TOAST_SPRING),
      bodyOp: new Spring(parseFloat(body.getAttribute('opacity') || '0'), PHYSICS_TOAST_SPRING_SMOOTH),
    };
    springs.pillH.set(PHYSICS_TOAST_EXPAND_HEADER_H);
    springs.bodyH.set(contentH);
    springs.bodyOp.set(1);

    physicsToastAnimator.add(`morph-${animId}`, springs, s => {
      pill.setAttribute('height', String(s.pillH.current));
      body.setAttribute('height', String(Math.max(0, s.bodyH.current)));
      body.setAttribute('opacity', String(s.bodyOp.current));
    });

    root.style.setProperty('--_h', `${totalH}px`);
    root.style.setProperty('--_ht', `translateY(${3 * edgeSign}px) scale(0.9)`);
    root.style.setProperty('--_co', '1');
    setExpanded(true);
  }, [animId, contentH, edgeSign]);

  const collapse = useCallback(() => {
    const pill = pillRef.current;
    const body = bodyRef.current;
    const root = rootRef.current;
    if (!pill || !body || !root) return;

    const springs = {
      pillH: new Spring(parseFloat(pill.getAttribute('height') || String(PHYSICS_TOAST_HEADER_H)), PHYSICS_TOAST_SPRING),
      bodyH: new Spring(parseFloat(body.getAttribute('height') || '0'), PHYSICS_TOAST_SPRING_SMOOTH),
      bodyOp: new Spring(parseFloat(body.getAttribute('opacity') || '0'), PHYSICS_TOAST_SPRING_SMOOTH),
    };
    springs.pillH.set(PHYSICS_TOAST_HEADER_H);
    springs.bodyH.set(0);
    springs.bodyOp.set(0);

    physicsToastAnimator.add(`morph-${animId}`, springs, s => {
      pill.setAttribute('height', String(s.pillH.current));
      body.setAttribute('height', String(Math.max(0, s.bodyH.current)));
      body.setAttribute('opacity', String(s.bodyOp.current));
    });

    root.style.setProperty('--_h', `${PHYSICS_TOAST_HEADER_H}px`);
    root.style.setProperty('--_ht', 'translateY(0px) scale(1)');
    root.style.setProperty('--_co', '0');
    setExpanded(false);
  }, [animId]);

  const requestDismiss = useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    clearTimers();
    physicsToastAnimator.remove(`morph-${animId}`);
    setExiting(true);
    const root = rootRef.current;
    if (!root) {
      onDismiss(id);
      return;
    }
    const finish = () => onDismiss(id);
    const onEnd = (e: TransitionEvent) => {
      if (e.propertyName === 'opacity' || e.propertyName === 'transform') {
        root.removeEventListener('transitionend', onEnd);
        finish();
      }
    };
    root.addEventListener('transitionend', onEnd);
    setTimeout(finish, 600);
  }, [animId, clearTimers, id, onDismiss]);

  useEffect(() => {
    if (!hasMessage && !isProgress) return;
    const el = descRef.current;
    if (!el) return;
    const measure = () => setContentH(el.scrollHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasMessage, isProgress, message, progress]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (sticky || isProgress) {
      if (hasMessage && contentH > 0) {
        const t = setTimeout(() => expand(), 80);
        return () => clearTimeout(t);
      }
      return;
    }

    clearTimers();
    if (hasMessage && contentH > 0) {
      const ap = computeAutopilot(duration);
      addTimer(() => { if (!dismissedRef.current) expand(); }, ap.expandDelay);
      addTimer(() => { if (!dismissedRef.current) collapse(); }, ap.collapseAt);
      addTimer(() => requestDismiss(), duration);
    } else {
      addTimer(() => requestDismiss(), duration);
    }
    return clearTimers;
  }, [addTimer, clearTimers, collapse, contentH, duration, expand, hasMessage, isProgress, requestDismiss, sticky]);

  const svgH = hasMessage || isProgress
    ? Math.max(PHYSICS_TOAST_HEADER_H * 2.25, PHYSICS_TOAST_HEADER_H + 80)
    : PHYSICS_TOAST_HEADER_H;

  const stateAttr = isProgress ? 'loading' : kind;

  return (
    <button
      ref={rootRef}
      type="button"
      className="bndz-pt-toast"
      data-state={stateAttr}
      data-edge={edge}
      data-ready={ready ? 'true' : undefined}
      data-expanded={expanded ? 'true' : undefined}
      data-exiting={exiting ? 'true' : undefined}
      style={{
        ['--_h' as string]: `${isProgress && contentH ? Math.max(PHYSICS_TOAST_HEADER_H * 2.25, PHYSICS_TOAST_HEADER_H + contentH) : PHYSICS_TOAST_HEADER_H}px`,
        ['--_px' as string]: '0px',
        ['--_pw' as string]: `${PHYSICS_TOAST_WIDTH}px`,
        ['--_ht' as string]: 'translateY(0px) scale(1)',
        ['--_co' as string]: expanded || isProgress ? '1' : '0',
      }}
      role="status"
      aria-label={`${title}${message ? `: ${message}` : ''}`}
      onMouseEnter={() => {
        pauseTimers();
        if (!isLoading && contentH > 0 && !dismissedRef.current) expand();
      }}
      onMouseLeave={() => {
        resumeTimers();
        if (!dismissedRef.current && !isProgress) collapse();
      }}
      onPointerDown={e => {
        if ((e.target as HTMLElement).closest('[data-bndz-pt-dismiss]')) return;
        pointerStartY.current = e.clientY;
        rootRef.current?.setPointerCapture(e.pointerId);
      }}
      onPointerMove={e => {
        if (pointerStartY.current === null || !rootRef.current) return;
        const dy = e.clientY - pointerStartY.current;
        const sign = dy > 0 ? 1 : -1;
        const clamped = Math.min(Math.abs(dy), SWIPE_MAX) * sign;
        rootRef.current.style.transform = `translateY(${clamped}px)`;
      }}
      onPointerUp={e => {
        if (pointerStartY.current === null || !rootRef.current) return;
        const dy = e.clientY - pointerStartY.current;
        pointerStartY.current = null;
        rootRef.current.style.transform = '';
        if (Math.abs(dy) > SWIPE_DISMISS) requestDismiss();
      }}
    >
      <div className="bndz-pt-canvas" data-edge={edge} style={{ filter: `url(#${PHYSICS_TOAST_FILTER_ID})` }}>
        <svg
          ref={svgRef}
          className="bndz-pt-svg"
          width={PHYSICS_TOAST_WIDTH}
          height={svgH}
          viewBox={`0 0 ${PHYSICS_TOAST_WIDTH} ${svgH}`}
        >
          <rect
            ref={pillRef}
            className="bndz-pt-pill"
            rx={PHYSICS_TOAST_RADIUS}
            ry={PHYSICS_TOAST_RADIUS}
            fill={PHYSICS_TOAST_SURFACE}
            x={0}
            y={0}
            width={PHYSICS_TOAST_WIDTH}
            height={PHYSICS_TOAST_HEADER_H}
          />
          <rect
            ref={bodyRef}
            className="bndz-pt-body"
            rx={PHYSICS_TOAST_RADIUS}
            ry={PHYSICS_TOAST_RADIUS}
            fill={PHYSICS_TOAST_SURFACE}
            x={0}
            y={PHYSICS_TOAST_HEADER_H}
            width={PHYSICS_TOAST_WIDTH}
            height={isProgress && contentH ? contentH : 0}
            opacity={isProgress ? 1 : 0}
          />
        </svg>
      </div>

      <div className="bndz-pt-header" data-edge={edge}>
        <div className="bndz-pt-header-stack">
          <div className="bndz-pt-header-inner" data-layer="current">
            <div className="bndz-pt-badge">
              <ToastIcon kind={kind} />
            </div>
            <span className="bndz-pt-title">{title}</span>
          </div>
        </div>
      </div>

      {(hasMessage || isProgress) && (
        <div className="bndz-pt-content" data-edge={edge} data-visible={expanded || isProgress ? 'true' : undefined}>
          <div ref={descRef} className="bndz-pt-description">
            {message}
            {isProgress && progress != null && (
              <div className="bndz-pt-progress-track">
                <div
                  className="bndz-pt-progress-fill"
                  style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
                />
              </div>
            )}
          </div>
        </div>
      )}

      <button
        type="button"
        data-bndz-pt-dismiss
        className="bndz-pt-dismiss"
        aria-label="Dismiss"
        onClick={e => {
          e.stopPropagation();
          requestDismiss();
        }}
      >
        <X size={12} />
      </button>
    </button>
  );
}
