import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Icons8Icon } from './Icons8Icon';
import { CloseGlyph } from './ChromeGlyphs';
import { useAppConfig } from '../data/configContext';

const TUTORIAL_STEPS = [
  {
    id: 'welcome',
    iconId: 'sparkles_ui',
    color: '#c026d3',
    title: 'Welcome to BNDZ',
    body: 'Windows-native file manager with BNDZ craft UI. This short tour covers the surfaces you will use every day — replay anytime from View → Show tutorial.',
  },
  {
    id: 'sidebar',
    iconId: 'category_ui',
    color: '#34d399',
    title: 'Navigate',
    body: 'Drives, Rapid access, Cloud, and the Navigation Tree live in the sidebar. Selected tree rows use the same Files-modern highlight as drive cards.',
    anchor: 'sidebar',
  },
  {
    id: 'search',
    iconId: 'search',
    color: '#fbbf24',
    title: 'Find anything',
    body: 'Type in the filter bar to fuzzy-filter the active folder, or start with > for Everything-powered global search.',
    anchor: 'omnibar',
  },
  {
    id: 'dualpane',
    iconId: 'columns_ui',
    color: '#38bdf8',
    title: 'Workspace & views',
    body: 'The center list is your browsing surface. Switch Details / Grid / List from the toolbar. Dual pane is under View when you need side-by-side work.',
    anchor: 'workspace',
  },
  {
    id: 'plugins',
    iconId: 'puzzle_ui',
    color: '#c084fc',
    title: 'Plugins & Continuum',
    body: 'Bottom plugins (Properties, Fast Search, Visual Filters) stay docked. Open Continuum from Go → Continuum or Home for the live rail.',
    anchor: 'toolbar',
  },
  {
    id: 'rapid',
    iconId: 'zap_ui',
    color: '#f59e0b',
    title: 'Rapid access & Undo',
    body: 'Pin folders to Rapid access from the context menu. Undo file operations with Ctrl+Z — the Action Log tracks what can be reversed.',
    anchor: 'sidebar',
  },
];

const SPOTLIGHT_PAD = 10;

interface TutorialOverlayProps {
  forceShow?: boolean;
  onClose?: () => void;
}

function useTutorialAnchor(anchor: string | undefined, active: boolean) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  const measure = useCallback(() => {
    if (!anchor || !active) {
      setRect(null);
      return;
    }
    const el = document.querySelector(`[data-tutorial="${anchor}"]`);
    if (!el) {
      setRect(null);
      return;
    }
    setRect(el.getBoundingClientRect());
  }, [anchor, active]);

  useEffect(() => {
    measure();
    if (!anchor || !active) return;

    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    const ro = new ResizeObserver(measure);
    const el = document.querySelector(`[data-tutorial="${anchor}"]`);
    if (el) ro.observe(el);

    const interval = window.setInterval(measure, 400);

    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      ro.disconnect();
      window.clearInterval(interval);
    };
  }, [anchor, active, measure]);

  return rect;
}

function Spotlight({ rect }: { rect: DOMRect }) {
  const x = Math.max(0, rect.left - SPOTLIGHT_PAD);
  const y = Math.max(0, rect.top - SPOTLIGHT_PAD);
  const w = rect.width + SPOTLIGHT_PAD * 2;
  const h = rect.height + SPOTLIGHT_PAD * 2;

  return (
    <>
      <svg className="fixed inset-0 z-[500] w-full h-full pointer-events-none" aria-hidden>
        <defs>
          <mask id="bndz-tutorial-mask">
            <rect width="100%" height="100%" fill="white" />
            <rect x={x} y={y} width={w} height={h} rx="10" fill="black" />
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(0,0,0,0.58)" mask="url(#bndz-tutorial-mask)" />
      </svg>
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        className="fixed z-[500] pointer-events-none ring-2 ring-[#0078d4]/70 shadow-[0_0_12px_rgba(0,120,212,0.25)]"
        style={{ left: x, top: y, width: w, height: h }}
      />
    </>
  );
}

function cardPosition(rect: DOMRect | null): React.CSSProperties {
  if (!rect) {
    return {
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
    };
  }

  const cardW = Math.min(420, window.innerWidth - 32);
  const cardH = 320;
  const gap = 16;
  let top = rect.bottom + gap;
  let left = rect.left + rect.width / 2 - cardW / 2;

  if (top + cardH > window.innerHeight - 16) {
    top = rect.top - cardH - gap;
  }
  if (top < 16) top = 16;
  left = Math.max(16, Math.min(left, window.innerWidth - cardW - 16));

  return {
    left,
    top,
    transform: 'none',
  };
}

export default function TutorialOverlay({ forceShow = false, onClose }: TutorialOverlayProps) {
  const { config, updateConfig } = useAppConfig();
  const [stepIndex, setStepIndex] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (forceShow) {
      setStepIndex(0);
      setVisible(true);
      return;
    }
    if (config.tutorialNeverShow) return;
    if (config.tutorialCompleted) return;
    try {
      if (localStorage.getItem('bndz-legal-accepted') !== '1') return;
    } catch { /* ignore */ }
    // Give Continuum / chrome a beat to settle before the tip fights first paint.
    let delay = 900;
    try {
      if (document.documentElement.dataset.bndzShell === 'native-host') delay = 2800;
    } catch { /* ignore */ }
    const timer = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(timer);
  }, [forceShow, config.tutorialNeverShow, config.tutorialCompleted]);

  const step = TUTORIAL_STEPS[stepIndex];
  const anchorRect = useTutorialAnchor(step?.anchor, visible && !!step?.anchor);
  const isLast = stepIndex >= TUTORIAL_STEPS.length - 1;

  const dismiss = (opts: { completed?: boolean; neverShow?: boolean }) => {
    if (opts.neverShow) updateConfig({ tutorialNeverShow: true, tutorialCompleted: true });
    else if (opts.completed) updateConfig({ tutorialCompleted: true });
    setVisible(false);
    onClose?.();
  };

  return (
    <AnimatePresence>
      {visible && step && (
        <>
          {!step.anchor && (
            <motion.div
              key="tutorial-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="fixed inset-0 z-[500] bg-black/55 backdrop-blur-[2px] pointer-events-none"
            />
          )}
          {step.anchor && (
            <div
              className="fixed inset-0 z-[499] pointer-events-none"
              aria-hidden
            />
          )}
          {anchorRect && <Spotlight rect={anchorRect} />}
          <motion.div
            key={`tutorial-card-${step.id}`}
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 28 }}
            className="fixed z-[501] w-[min(420px,calc(100vw-32px))] bg-[#1a1a1e] border border-[#3a3a44] rounded-xl shadow-[0_24px_80px_rgba(0,0,0,0.65)] overflow-hidden"
            style={cardPosition(anchorRect)}
            onClick={e => e.stopPropagation()}
          >
            <div
              className="h-1.5 w-full"
              style={{ background: `linear-gradient(90deg, ${step.color}, transparent)` }}
            />
            <div className="p-5 pb-4">
              <div className="flex items-start justify-between gap-3 mb-4">
                <motion.div
                  key={step.id}
                  initial={{ rotate: -8, scale: 0.8 }}
                  animate={{ rotate: 0, scale: 1 }}
                  className="p-3 rounded-xl shrink-0"
                  style={{ backgroundColor: `${step.color}22`, border: `1px solid ${step.color}44` }}
                >
                  <Icons8Icon id={step.iconId} size={22} />
                </motion.div>
                <button
                  type="button"
                  onClick={() => dismiss({})}
                  className="text-gray-500 hover:text-gray-300 p-1 rounded transition-colors"
                  title="Cancel"
                >
                  <CloseGlyph size={16} />
                </button>
              </div>

              <motion.div
                key={`text-${step.id}`}
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.05 }}
              >
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 mb-1">
                  Tip {stepIndex + 1} of {TUTORIAL_STEPS.length}
                </div>
                <h2 className="text-[18px] font-bold text-white mb-2">{step.title}</h2>
                <p className="text-[13px] text-gray-400 leading-relaxed">{step.body}</p>
              </motion.div>

              <div className="flex gap-1.5 mt-5 mb-4">
                {TUTORIAL_STEPS.map((s, i) => (
                  <div
                    key={s.id}
                    className={`h-1 flex-1 rounded-full transition-all duration-300 ${i <= stepIndex ? 'bg-[#0078d4]' : 'bg-[#333]'}`}
                  />
                ))}
              </div>

              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => dismiss({ neverShow: true })}
                  className="text-[11px] text-gray-500 hover:text-gray-300 transition-colors px-1"
                >
                  Never show again
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => dismiss({})}
                    className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-semibold text-gray-400 hover:text-white border border-[#444] hover:border-[#555] rounded-md transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (isLast) dismiss({ completed: true });
                      else setStepIndex(i => i + 1);
                    }}
                    className="flex items-center gap-1.5 px-4 py-1.5 text-[11px] font-bold text-white bg-[#0067c0] hover:bg-[#0078d4] rounded-md transition-colors shadow-lg "
                  >
                    {isLast ? 'Get started' : 'Next'}
                    {!isLast && <Icons8Icon id="chevron_right" size={14} />}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
