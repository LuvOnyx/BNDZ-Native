import React, { useEffect } from 'react';
import { Icons8Icon } from './Icons8Icon';
import { NativeDialogShell } from './native/NativeDialogShell';
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

  const footerButtons =
    phase === 'downloading'
      ? undefined
      : [
          { label: 'Cancel', onClick: onCancel },
          { label: phase === 'error' ? 'Retry Download' : 'Download & Enable', style: 'primary' as const, onClick: onConfirm },
        ];

  return (
    <NativeDialogShell
      open={open}
      title="Enable Local AI"
      subtitle="One-time download · fully offline after"
      iconId="brain_ui"
      tone="info"
      size="lg"
      zIndexClass="z-[600]"
      onClose={canDismiss ? onCancel : undefined}
      showCloseButton={canDismiss}
      footerButtons={footerButtons}
      bodyClassName="space-y-4"
    >
      <p className="text-[13px] bndz-native-dialog-muted leading-relaxed">
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

      <div className="bndz-native-status-ok flex items-start gap-2">
        <Icons8Icon id="shield_ui" size={14} className="shrink-0 mt-0.5" />
        <p className="text-[11px] leading-relaxed">
          Stored in <code>%LOCALAPPDATA%\BNDZ\models</code>.
          Built into BNDZ — not a separate app or service.
        </p>
      </div>

      {phase === 'downloading' && (
        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between text-[11px]">
            <span className="bndz-native-dialog-muted flex items-center gap-1.5">
              <Icons8Icon id="loading" size={12} spin />
              Downloading model…
            </span>
            <span className="bndz-native-dialog-muted font-mono">{pct}%</span>
          </div>
          <div className="bndz-native-progress-track">
            <div className="bndz-native-progress-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {phase === 'error' && errorMessage && (
        <div className="bndz-native-status-error">{errorMessage}</div>
      )}
    </NativeDialogShell>
  );
}
