import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { subscribeTooltipKeys } from '../lib/tooltipSettings';

export interface TooltipLine {
  label?: string;
  value: string;
  mono?: boolean;
  accent?: string;
}

export interface TooltipMedia {
  kind: 'image' | 'svg' | 'audio';
  src: string;
  alt?: string;
  autoplay?: boolean;
}

export interface HoverTooltipContent {
  title: string;
  subtitle?: string;
  lines?: TooltipLine[];
  badge?: { text: string; color?: string };
  icon?: React.ReactNode;
  media?: TooltipMedia;
  /** `hoverbox` renders a wider premium panel (XYplorer Hover Box). */
  mode?: 'tip' | 'hoverbox';
}

export type HoverTooltipTheme = 'glass' | 'minimal' | 'accent' | 'mono';

const TOOLTIP_THEMES: Record<HoverTooltipTheme, { panel: string; header: string; accent: string }> = {
  glass: {
    panel: 'border border-[#454545] bg-[#2b2b2b] shadow-[0_2px_8px_rgba(0,0,0,0.35)]',
    header: 'border-b border-[#454545]',
    accent: 'from-[#0078d4]/50 to-transparent',
  },
  minimal: {
    panel: 'border border-[#454545] bg-[#2b2b2b] shadow-[0_2px_8px_rgba(0,0,0,0.35)]',
    header: 'border-b border-[#454545]',
    accent: 'from-[#555] to-transparent',
  },
  accent: {
    panel: 'border border-[#0078d4]/35 bg-[#252526] shadow-[0_2px_8px_rgba(0,0,0,0.35)]',
    header: 'border-b border-[#0078d4]/25',
    accent: 'from-[#0078d4]/70 to-transparent',
  },
  mono: {
    panel: 'border border-[#555] bg-[#0d0d0d] font-mono shadow-[0_2px_6px_rgba(0,0,0,0.35)]',
    header: 'border-b border-[#333]',
    accent: 'from-[#888] to-transparent',
  },
};

interface HoverTooltipProps {
  content: HoverTooltipContent | null;
  children: React.ReactNode;
  disabled?: boolean;
  delayMs?: number;
  theme?: HoverTooltipTheme;
  className?: string;
}

export function HoverTooltip({ content, children, disabled, delayMs = 320, theme = 'glass', className = '' }: HoverTooltipProps) {
  const themeStyle = TOOLTIP_THEMES[theme] || TOOLTIP_THEMES.glass;
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [, setKeyTick] = useState(0);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoveringRef = useRef(false);
  const tooltipId = useId();

  useEffect(() => subscribeTooltipKeys(() => {
    if (hoveringRef.current) setKeyTick(t => t + 1);
  }), []);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const updatePosition = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 10;
    let x = r.left + r.width / 2;
    let y = r.bottom + 8;
    const maxW = 340;
    if (x + maxW / 2 > window.innerWidth - pad) x = window.innerWidth - pad - maxW / 2;
    if (x - maxW / 2 < pad) x = pad + maxW / 2;
    if (y + 180 > window.innerHeight - pad) y = r.top - 8;
    setPos({ x, y });
  }, []);

  const show = () => {
    if (disabled || !content) return;
    clearTimer();
    timerRef.current = setTimeout(() => {
      updatePosition();
      setVisible(true);
    }, delayMs);
  };

  const hide = () => {
    clearTimer();
    setVisible(false);
  };

  useEffect(() => () => clearTimer(), []);

  return (
    <>
      <div
        ref={anchorRef}
        className={`bndz-tooltip-anchor w-full min-w-0 ${className}`}
        onMouseEnter={() => {
          hoveringRef.current = true;
          show();
        }}
        onMouseLeave={() => {
          hoveringRef.current = false;
          hide();
        }}
        onMouseMove={() => {
          if (visible) updatePosition();
        }}
      >
        {children}
      </div>
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {visible && content && (
            <motion.div
              id={tooltipId}
              role="tooltip"
              initial={{ opacity: 0, y: 6, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 4, scale: 0.98 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              className="fixed z-[650] pointer-events-none max-w-[340px]"
              style={{
                left: pos.x,
                top: pos.y,
                transform: 'translate(-50%, 0)',
              }}
            >
              <div className={`${themeStyle.panel} overflow-hidden`}>
                <div className={`px-3.5 py-2.5 ${themeStyle.header} flex items-start gap-2.5`}>
                  {content.icon && (
                    <div className="w-9 h-9 rounded-lg bg-black/30 flex items-center justify-center shrink-0 ring-1 ring-white/5">
                      {content.icon}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-white leading-tight truncate">{content.title}</div>
                    {content.subtitle && (
                      <div className="text-[10px] text-gray-400 mt-0.5 truncate">{content.subtitle}</div>
                    )}
                  </div>
                  {content.badge && (
                    <span
                      className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md shrink-0"
                      style={{ background: `${content.badge.color || '#007acc'}22`, color: content.badge.color || '#0078d4' }}
                    >
                      {content.badge.text}
                    </span>
                  )}
                </div>
                {content.lines && content.lines.length > 0 && (
                  <div className="px-3.5 py-2 space-y-1">
                    {content.lines.map((line, i) => (
                      <div key={i} className="flex items-baseline gap-2 text-[11px]">
                        {line.label && <span className="text-gray-500 shrink-0 w-[52px]">{line.label}</span>}
                        <span
                          className={`text-gray-200 truncate ${line.mono ? 'font-mono text-[10px]' : ''}`}
                          style={line.accent ? { color: line.accent } : undefined}
                        >
                          {line.value}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <div className={`h-[2px] bg-gradient-to-r ${themeStyle.accent}`} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
