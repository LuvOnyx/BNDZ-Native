import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Icons8Icon } from './Icons8Icon';
import { CloseGlyph } from './ChromeGlyphs';
import { registerEscapeLayer } from '../lib/globalEscape';

export type AiDownloadModalPhase = 'prompt' | 'downloading' | 'error';

export interface AiDownloadConsentModalProps {
  open: boolean;
  phase: AiDownloadModalPhase;
  progress: number;
  modelName: string;
  sizeLabel: string;
  errorMessage?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function AiDownloadConsentModal({
  open,
  phase,
  progress,
  modelName,
  sizeLabel,
  errorMessage,
  onConfirm,
  onCancel,
}: AiDownloadConsentModalProps) {
  const canDismiss = phase !== 'downloading';

  useEffect(() => {
    if (!open) return;
    return registerEscapeLayer({
      id: 'ai-download-consent',
      priority: 1100,
      isActive: () => open && canDismiss,
      dismiss: onCancel,
    });
  }, [open, canDismiss, onCancel]);

  const pct = Math.min(100, Math.max(0, Math.round(progress * 100)));

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[600] flex items-center justify-center p-4"
          onMouseDown={e => { if (canDismiss && e.target === e.currentTarget) onCancel(); }}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-md" />
          <motion.div
            initial={{ scale: 0.94, opacity: 0, y: 16 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0, y: 8 }}
            transition={{ type: 'spring', stiffness: 380, damping: 28 }}
            className="relative w-full max-w-[520px] rounded-2xl border border-white/10 shadow-2xl overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-download-title"
            onMouseDown={e => e.stopPropagation()}
          >
            <div className="relative px-6 py-5 bg-gradient-to-br from-violet-600/30 via-indigo-900/40 to-sky-900/30 border-b border-white/10">
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(139,92,246,0.25),transparent_55%)]" />
              <div className="relative flex items-start gap-4">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-900/40 shrink-0">
                  <Icons8Icon id="brain_ui" size={22} />
                </div>
                <div className="flex-1 min-w-0 pt-0.5">
                  <h2 id="ai-download-title" className="text-[17px] font-bold text-white tracking-tight">
                    Enable Local AI
                  </h2>
                  <p className="text-[12px] text-violet-200/80 mt-1">
                    One-time download · fully offline after
                  </p>
                </div>
                {canDismiss && (
                  <button
                    type="button"
                    onClick={onCancel}
                    className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                    aria-label="Close"
                  >
                    <CloseGlyph size={16} />
                  </button>
                )}
              </div>
            </div>

            <div className="bg-[#121218] px-6 py-5 space-y-4">
              <p className="text-[13px] text-gray-300 leading-relaxed">
                BNDZ runs AI features entirely on your PC — no API keys, no cloud, no subscription.
                The first time you use AI, we download a small language model once.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 flex items-center gap-2.5">
                  <Icons8Icon id="disk_mgmt" size={14} className="shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[10px] text-gray-500 uppercase tracking-wider">Model</div>
                    <div className="text-[11px] text-gray-200 truncate" title={modelName}>{modelName}</div>
                  </div>
                </div>
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 flex items-center gap-2.5">
                  <Icons8Icon id="download" size={14} className="shrink-0" />
                  <div>
                    <div className="text-[10px] text-gray-500 uppercase tracking-wider">Download</div>
                    <div className="text-[11px] text-gray-200">{sizeLabel}</div>
                  </div>
                </div>
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 flex items-center gap-2.5">
                  <Icons8Icon id="wifi_off_ui" size={14} className="shrink-0" />
                  <div>
                    <div className="text-[10px] text-gray-500 uppercase tracking-wider">After</div>
                    <div className="text-[11px] text-gray-200">Works offline</div>
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5">
                <Icons8Icon id="shield_ui" size={14} className="shrink-0 mt-0.5" />
                <p className="text-[11px] text-emerald-200/90 leading-relaxed">
                  Stored in <code className="text-emerald-300/90">%LOCALAPPDATA%\BNDZ\models</code>.
                  Built into BNDZ — not a separate app or service.
                </p>
              </div>

              {phase === 'downloading' && (
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-violet-300 flex items-center gap-1.5">
                      <Icons8Icon id="loading" size={12} spin />
                      Downloading model…
                    </span>
                    <span className="text-gray-400 font-mono">{pct}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-[#1a1a22] border border-white/5 overflow-hidden">
                    <motion.div
                      className="h-full bg-gradient-to-r from-violet-500 via-indigo-500 to-sky-500"
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ ease: 'easeOut', duration: 0.25 }}
                    />
                  </div>
                </div>
              )}

              {phase === 'error' && errorMessage && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-[12px] text-red-300">
                  {errorMessage}
                </div>
              )}
            </div>

            <div className="bg-[#0d0d12] px-6 py-4 flex flex-wrap justify-end gap-2.5 border-t border-white/5">
              {phase !== 'downloading' && (
                <>
                  <button
                    type="button"
                    onClick={onCancel}
                    className="px-4 py-2 rounded-xl text-[12px] font-semibold bg-[#2a2a32] hover:bg-[#35353f] text-gray-200 border border-[#444] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={onConfirm}
                    className="px-4 py-2 rounded-xl text-[12px] font-semibold bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white shadow-lg shadow-violet-900/30 flex items-center gap-2 transition-all"
                  >
                    <Icons8Icon id="sparkles_ui" size={14} />
                    {phase === 'error' ? 'Retry Download' : 'Download & Enable'}
                  </button>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
