import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { IPC } from '../lib/ipcBridge';
import { pushToast } from './ToastHost';
import { runPluginRefresh } from '../lib/pluginRefresh';

type MagnetRow = {
  id: string;
  name: string;
  targetPath: string;
  accentColor?: string;
  enabled: boolean;
};

function normalizeMagnet(raw: Record<string, unknown>): MagnetRow {
  return {
    id: String(raw.id ?? raw.Id ?? ''),
    name: String(raw.name ?? raw.Name ?? 'Magnet'),
    targetPath: String(raw.targetPath ?? raw.TargetPath ?? ''),
    accentColor: (raw.accentColor ?? raw.AccentColor) as string | undefined,
    enabled: raw.enabled !== false && raw.Enabled !== false,
  };
}

type Props = {
  externalDragActive: boolean;
  pendingPaths: string[];
  onApplied?: () => void;
};

export default function DropMagnetStrip({ externalDragActive, pendingPaths, onApplied }: Props) {
  const [magnets, setMagnets] = useState<MagnetRow[]>([]);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  const refresh = useCallback(async () => {
    await runPluginRefresh('Drop Magnets', async () => {
      const res = await IPC.magnetList();
      return (res.magnets || [])
        .map((m: Record<string, unknown>) => normalizeMagnet(m))
        .filter(m => m.enabled);
    }, setMagnets);
  }, []);

  useEffect(() => {
    if (externalDragActive) void refresh();
  }, [externalDragActive, refresh]);

  const applyMagnet = async (magnetId: string) => {
    if (!pendingPaths.length || applying) return;
    setApplying(true);
    try {
      const res = await IPC.magnetApplyDrop(magnetId, pendingPaths, 'copy');
      if (!res.ok) {
        pushToast(res.error || 'Magnet drop failed.');
        return;
      }
      const magnet = magnets.find(m => m.id === magnetId);
      pushToast({
        kind: 'success',
        title: magnet?.name ?? 'Magnet',
        message: `${res.transferred ?? pendingPaths.length} file(s) routed.`,
      });
      onApplied?.();
    } finally {
      setApplying(false);
      setHoverId(null);
    }
  };

  if (!externalDragActive || magnets.length === 0) return null;

  return createPortal(
    <div
      className="bndz-magnet-strip fixed inset-x-0 bottom-[calc(var(--bndz-bottom-plugin-height,120px)+12px)] z-[8500] flex justify-center px-4 pointer-events-none"
      aria-label="Drop magnet landing pads"
    >
      <div className="flex flex-wrap items-stretch justify-center gap-2.5 max-w-[min(100%,920px)] pointer-events-auto">
        {magnets.map(m => {
          const accent = m.accentColor || '#38bdf8';
          const active = hoverId === m.id;
          return (
            <button
              key={m.id}
              type="button"
              data-magnet-id={m.id}
              disabled={applying}
              className={`bndz-magnet-pad relative min-w-[140px] max-w-[200px] px-4 py-3 rounded-2xl border text-left transition-all duration-200 backdrop-blur-md ${
                active ? 'scale-[1.04] shadow-lg' : 'scale-100 opacity-90 hover:opacity-100'
              }`}
              style={{
                borderColor: `${accent}${active ? 'aa' : '55'}`,
                background: `linear-gradient(145deg, ${accent}28 0%, ${accent}08 45%, rgba(8,12,20,0.75) 100%)`,
                boxShadow: active ? `0 8px 32px ${accent}33, inset 0 1px 0 rgba(255,255,255,0.12)` : `0 4px 16px rgba(0,0,0,0.35)`,
              }}
              onPointerEnter={() => setHoverId(m.id)}
              onPointerLeave={() => setHoverId(prev => (prev === m.id ? null : prev))}
              onPointerUp={e => {
                e.preventDefault();
                e.stopPropagation();
                void applyMagnet(m.id);
              }}
            >
              <span
                className="absolute top-2 right-2 w-2 h-2 rounded-full animate-pulse"
                style={{ background: accent, boxShadow: `0 0 8px ${accent}` }}
              />
              <span className="block text-xs font-semibold text-white/95 truncate">{m.name}</span>
              <span className="block text-[9px] text-white/50 truncate mt-0.5">{m.targetPath}</span>
              <span className="block text-[9px] mt-1.5 text-white/40 uppercase tracking-wider">
                {active ? 'Release to apply recipe' : 'Drop here'}
              </span>
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}

/** Hit-test magnet pads at pointer coords during external drop commit. */
export function hitTestMagnetAtPoint(clientX: number, clientY: number): string | null {
  const el = document.elementFromPoint(clientX, clientY);
  const pad = (el as HTMLElement | null)?.closest('[data-magnet-id]') as HTMLElement | null;
  return pad?.getAttribute('data-magnet-id') || null;
}
