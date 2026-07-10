import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { getFloatingTooltip, subscribeFloatingTooltip } from '../lib/floatingTooltip';
import type { TooltipMedia } from './HoverTooltip';

const TOOLTIP_VARIANTS = {
  glass: {
    panel: 'bndz-floating-tooltip-panel bndz-tooltip-glass',
    header: 'bndz-floating-tooltip-header',
  },
  minimal: {
    panel: 'bndz-floating-tooltip-panel bndz-tooltip-minimal',
    header: 'bndz-floating-tooltip-header',
  },
  accent: {
    panel: 'bndz-floating-tooltip-panel bndz-tooltip-accent',
    header: 'bndz-floating-tooltip-header',
  },
  mono: {
    panel: 'bndz-floating-tooltip-panel bndz-tooltip-mono font-mono',
    header: 'bndz-floating-tooltip-header',
  },
} as const;

const ENTER = { duration: 0.07, ease: [0.22, 1, 0.36, 1] as const };
const EXIT = { duration: 0.12, ease: [0.4, 0, 1, 1] as const };

function clampPosition(x: number, y: number, width = 320, height = 160) {
  const pad = 14;
  const offsetX = 18;
  const offsetY = 20;
  let left = x + offsetX;
  let top = y + offsetY;
  if (left + width > window.innerWidth - pad) left = x - width - offsetX;
  if (top + height > window.innerHeight - pad) top = y - height - offsetY;
  if (left < pad) left = pad;
  if (top < pad) top = pad;
  return { left, top };
}

function TooltipMediaBlock({ media }: { media: TooltipMedia }) {
  if (media.kind === 'audio') {
    return (
      <div className="bndz-tooltip-media-frame bndz-tooltip-media-audio px-3.5 pb-2.5 pointer-events-auto">
        <audio
          src={media.src}
          controls
          preload="metadata"
          className="w-full h-8 rounded-lg"
          aria-label={media.alt || 'Audio preview'}
        />
      </div>
    );
  }

  if (media.kind === 'svg') {
    return (
      <div className="bndz-tooltip-media-frame px-3.5 pb-2.5">
        <div className="bndz-tooltip-media-inner flex items-center justify-center p-3 min-h-[72px] max-h-[148px]">
          <img
            src={media.src}
            alt={media.alt || 'SVG preview'}
            className="max-w-full max-h-[132px] object-contain drop-shadow-md"
            draggable={false}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="bndz-tooltip-media-frame px-3.5 pb-2.5">
      <div className="bndz-tooltip-media-inner flex items-center justify-center p-1 min-h-[72px] max-h-[148px]">
        <img
          src={media.src}
          alt={media.alt || 'Preview'}
          className="max-w-full max-h-[140px] object-contain rounded-lg drop-shadow-md"
          draggable={false}
        />
      </div>
    </div>
  );
}

export default function FloatingTooltipHost() {
  const [tip, setTip] = useState(getFloatingTooltip());

  useEffect(() => subscribeFloatingTooltip(() => setTip(getFloatingTooltip())), []);

  if (typeof document === 'undefined') return null;

  const hasMedia = !!tip?.content.media;
  const isHoverBox = tip?.content.mode === 'hoverbox';
  const panelWidth = isHoverBox || hasMedia ? 440 : 320;
  const panelHeight = hasMedia ? 300 : isHoverBox ? 280 : 160;
  const pos = tip ? clampPosition(tip.x, tip.y, panelWidth, panelHeight) : { left: 0, top: 0 };
  const variant = tip ? (TOOLTIP_VARIANTS[tip.theme] || TOOLTIP_VARIANTS.glass) : TOOLTIP_VARIANTS.glass;

  return createPortal(
    <AnimatePresence mode="wait">
      {tip && (
        <motion.div
          key="floating-tooltip"
          role="tooltip"
          initial={{ opacity: 0, scale: 0.96, y: 4, filter: 'blur(3px)' }}
          animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, scale: 0.98, y: 1, filter: 'blur(1px)' }}
          transition={{
            ...ENTER,
            opacity: { duration: 0.05 },
            filter: { duration: 0.05 },
            scale: { duration: 0.07 },
          }}
          className={`fixed z-[700] pointer-events-none ${isHoverBox || hasMedia ? 'max-w-[440px]' : 'max-w-[320px]'}`}
          style={{ left: pos.left, top: pos.top }}
        >
          <motion.div
            className={`${variant.panel} bndz-tooltip-premium overflow-hidden ${isHoverBox ? 'bndz-hoverbox-panel' : ''}`}
            style={{ borderRadius: 'var(--tooltip-radius, 16px)' }}
            initial={{ boxShadow: '0 4px 12px rgba(0,0,0,0.25)' }}
            animate={{ boxShadow: '0 14px 44px rgba(0,0,0,0.55)' }}
            exit={{ boxShadow: '0 2px 8px rgba(0,0,0,0.12)' }}
            transition={EXIT}
          >
            {tip.content.media && <TooltipMediaBlock media={tip.content.media} />}
            <div className={`px-3.5 py-2.5 ${variant.header} flex items-start gap-2.5`}>
              <div className="min-w-0 flex-1">
                <div className="bndz-floating-tooltip-title text-[13px] font-semibold leading-tight">
                  {tip.content.title}
                </div>
                {tip.content.subtitle && (
                  <div className="bndz-floating-tooltip-subtitle text-[10px] mt-0.5">
                    {tip.content.subtitle}
                  </div>
                )}
              </div>
              {tip.content.badge && (
                <span
                  className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md shrink-0"
                  style={{
                    background: `color-mix(in srgb, ${tip.content.badge.color || 'var(--tooltip-accent, #38bdf8)'} 14%, transparent)`,
                    color: tip.content.badge.color || 'var(--tooltip-accent, #38bdf8)',
                  }}
                >
                  {tip.content.badge.text}
                </span>
              )}
            </div>
            {tip.content.lines && tip.content.lines.length > 0 && (
              <div className="px-3.5 py-2 space-y-1">
                {tip.content.lines.map((line, i) => (
                  <div key={i} className="flex items-baseline gap-2 text-[11px]">
                    {line.label && <span className="bndz-floating-tooltip-label shrink-0 w-[54px]">{line.label}</span>}
                    <span
                      className={`bndz-floating-tooltip-value break-all ${line.mono ? 'font-mono text-[10px]' : ''}`}
                      style={line.accent ? { color: line.accent } : undefined}
                    >
                      {line.value}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <motion.div
              className="bndz-floating-tooltip-accent-bar h-[2px]"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
              style={{ transformOrigin: 'left' }}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
