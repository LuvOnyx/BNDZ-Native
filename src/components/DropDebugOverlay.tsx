import React, { useEffect, useState } from 'react';
import { getLastDropDebug, isDropDebugEnabled, type DropDebugInfo } from '../lib/fileDropBus';

/** Toggle with localStorage.bndzDropDebug = '1' */
export default function DropDebugOverlay() {
  const [info, setInfo] = useState<DropDebugInfo | null>(null);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(isDropDebugEnabled());
    const onDebug = (e: Event) => {
      setInfo((e as CustomEvent<DropDebugInfo>).detail);
    };
    window.addEventListener('bndz-drop-debug', onDebug);
    return () => window.removeEventListener('bndz-drop-debug', onDebug);
  }, []);

  if (!enabled) return null;

  const last = info ?? getLastDropDebug();
  if (!last) {
    return (
      <div className="fixed bottom-2 left-2 z-[10000] px-2 py-1 rounded bg-black/80 text-[10px] text-emerald-300 font-mono pointer-events-none">
        bndzDropDebug=1 — waiting for drop
      </div>
    );
  }

  return (
    <div className="fixed bottom-2 left-2 z-[10000] px-2 py-1.5 rounded bg-black/85 text-[10px] text-emerald-200 font-mono pointer-events-none max-w-md space-y-0.5 border border-emerald-500/30">
      <div>coords ({last.clientX.toFixed(0)}, {last.clientY.toFixed(0)}) · {last.coordSource}</div>
      <div>dest: {last.destPath}</div>
      <div>source: {last.source} · committed: {String(last.committed)}</div>
      <div
        className="fixed w-3 h-3 rounded-full bg-red-500/80 border border-white pointer-events-none"
        style={{ left: last.clientX - 6, top: last.clientY - 6 }}
      />
    </div>
  );
}
