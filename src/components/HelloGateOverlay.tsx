import React, { useCallback, useState } from 'react';
import { Icons8Icon } from './Icons8Icon';
import { IPC } from '../lib/ipcBridge';
import { toWindowsPath } from '../lib/pathUtils';

interface HelloGateOverlayProps {
  folderPath: string;
  gatePath?: string;
  onUnlocked: () => void;
  onCancel?: () => void;
}

export default function HelloGateOverlay({ folderPath, gatePath, onUnlocked, onCancel }: HelloGateOverlayProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [needsPassphrase, setNeedsPassphrase] = useState(false);
  const target = gatePath || toWindowsPath(folderPath);

  const tryUnlock = useCallback(async (withPassphrase?: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await IPC.helloGateUnlock(target, withPassphrase);
      if (r.ok) {
        onUnlocked();
        return;
      }
      if (r.error?.toLowerCase().includes('passphrase')) {
        setNeedsPassphrase(true);
      }
      setError(r.error || 'Unlock failed.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unlock failed.');
    } finally {
      setBusy(false);
    }
  }, [target, onUnlocked]);

  return (
    <div className="bndz-hello-gate-overlay absolute inset-0 z-30 flex items-center justify-center bg-[#0a0c12]/88 backdrop-blur-sm">
      <div className="bndz-hello-gate-card w-[min(380px,92%)] rounded-[var(--bndz-radius-lg)] border border-sky-400/20 bg-gradient-to-b from-[#1a2230] to-[#12161e] p-5 shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-11 h-11 rounded-xl bg-sky-500/15 border border-sky-400/25 flex items-center justify-center">
            <Icons8Icon id="lock_ui" size={20} />
          </div>
          <div>
            <h3 className="text-[14px] font-semibold text-gray-100">Protected folder</h3>
            <p className="text-[10px] text-white/40 mt-0.5">Windows Hello or backup passphrase required</p>
          </div>
        </div>
        <p className="text-[11px] text-sky-200/70 bndz-mono truncate mb-4" title={target}>{target}</p>

        {needsPassphrase && (
          <input
            type="password"
            value={passphrase}
            onChange={e => setPassphrase(e.target.value)}
            placeholder="Backup passphrase"
            className="w-full mb-3 px-3 py-2 rounded-[var(--bndz-radius-sm)] bg-black/30 border border-white/10 text-[12px] text-gray-100 outline-none focus:border-sky-400/40"
            onKeyDown={e => { if (e.key === 'Enter') void tryUnlock(passphrase); }}
          />
        )}

        {error && <p className="text-[11px] text-rose-300/90 mb-3">{error}</p>}

        <div className="flex gap-2 justify-end">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="px-3 py-1.5 text-[12px] text-white/50 hover:text-white/80 disabled:opacity-40"
            >
              Go back
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void tryUnlock(needsPassphrase ? passphrase : undefined)}
            className="bndz-hub-btn-primary px-4 py-1.5 text-[12px] font-semibold disabled:opacity-40"
          >
            {busy ? 'Verifying…' : needsPassphrase ? 'Unlock with passphrase' : 'Unlock with Hello'}
          </button>
        </div>
      </div>
    </div>
  );
}
