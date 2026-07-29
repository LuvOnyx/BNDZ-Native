import React, { useCallback, useEffect, useState } from 'react';
import { IPC } from '../../lib/ipcBridge';

type Session = {
  id: string;
  role?: string;
  state?: string;
  label?: string;
  bytesSent?: number;
  bytesTotal?: number;
};

export default function MeshDropSessionPanel() {
  const [sessions, setSessions] = useState<Session[]>([]);

  const refresh = useCallback(async () => {
    const r = await IPC.meshDropListSessions();
    setSessions((r.sessions as Session[]) ?? []);
  }, []);

  useEffect(() => {
    void refresh();
    const onChange = () => void refresh();
    window.addEventListener('bndz-mesh-drop-session', onChange);
    return () => window.removeEventListener('bndz-mesh-drop-session', onChange);
  }, [refresh]);

  const active = sessions.filter(s => s.state && !['completed', 'cancelled', 'failed'].includes(s.state));
  if (!active.length) return null;

  return (
    <div className="bndz-meshdrop-sessions px-3 py-2 border-b border-white/[0.06]">
      <div className="text-[10px] uppercase tracking-wider text-cyan-300/80 mb-1.5">Mesh Drop sessions</div>
      {active.map(s => (
        <div key={s.id} className="bndz-meshdrop-session-row flex items-center justify-between gap-2 py-1">
          <span className="text-[11px] text-gray-300 truncate">{s.label || s.id}</span>
          <span className="text-[10px] text-amber-300/90 shrink-0">{s.state}</span>
          <button
            type="button"
            className="bndz-meshdrop-btn text-[10px] shrink-0"
            onClick={() => IPC.meshDropCancel(s.id)}
          >
            Cancel
          </button>
        </div>
      ))}
    </div>
  );
}
