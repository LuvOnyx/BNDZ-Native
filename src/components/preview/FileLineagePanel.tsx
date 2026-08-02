import React, { useEffect, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { IPC } from '../../lib/ipcBridge';
import { toWindowsPath } from '../../lib/pathUtils';

type LineageEdge = {
  id: string;
  kind: string;
  sourcePath: string;
  destPath: string;
  timestampUtc: string;
  label?: string;
};

function normalizeEdge(raw: Record<string, unknown>): LineageEdge {
  return {
    id: String(raw.id ?? raw.Id ?? `e_${Math.random().toString(36).slice(2, 9)}`),
    kind: String(raw.kind ?? raw.Kind ?? raw.op ?? raw.Op ?? 'unknown'),
    sourcePath: String(raw.sourcePath ?? raw.SourcePath ?? raw.fromPath ?? raw.FromPath ?? ''),
    destPath: String(raw.destPath ?? raw.DestPath ?? raw.toPath ?? raw.ToPath ?? ''),
    timestampUtc: String(raw.timestampUtc ?? raw.TimestampUtc ?? raw.utc ?? raw.Utc ?? ''),
    label: (raw.label as string | undefined) ?? (raw.Label as string | undefined) ?? (raw.op as string | undefined) ?? (raw.Op as string | undefined),
  };
}

function relativeTime(utc: string): string {
  if (!utc) return '';
  const ms = Date.now() - new Date(utc).getTime();
  if (ms < 0) return 'future';
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function leafName(path: string): string {
  const parts = path.replace(/[/\\]+$/, '').split(/[/\\]/);
  return parts.pop() || path;
}

const EDGE_ICONS: Record<string, string> = {
  copy: 'move_ui',
  move: 'move_ui',
  rename: 'edit_ui',
  create: 'plus_ui',
  delete: 'delete',
  inbound: 'download_ui',
};

interface Props {
  path: string | null;
  onNavigate?: (path: string) => void;
}

export default function FileLineagePanel({ path, onNavigate }: Props) {
  const [edges, setEdges] = useState<LineageEdge[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!path) { setEdges([]); return; }
    let active = true;
    setLoading(true);
    IPC.lineageGet(toWindowsPath(path), 10)
      .then(r => {
        if (!active) return;
        setEdges((r.edges || []).map(e => normalizeEdge(e as Record<string, unknown>)));
      })
      .catch(() => { if (active) setEdges([]); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [path]);

  if (!path) return null;
  if (edges.length === 0 && !loading) return null;

  const revealPath = (winPath: string) => {
    const panePath = winPath.replace(/^([A-Za-z]):\\/, '/$1/').replace(/\\/g, '/');
    onNavigate?.(panePath);
  };

  return (
    <div className="border-t border-white/[0.06] px-4 py-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Icons8Icon id="view_history" size={13} className="opacity-60" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">File Lineage</span>
        {loading && <span className="text-[10px] text-gray-600 ml-auto">loading…</span>}
      </div>

      <div className="relative pl-3">
        <div className="absolute left-[7px] top-0 bottom-0 w-[1px] bg-white/[0.08]" />

        {edges.map((edge, i) => {
          const icon = EDGE_ICONS[edge.kind] || 'zap_ui';
          const isInbound = edge.destPath && toWindowsPath(path!) === edge.destPath;
          const otherPath = isInbound ? edge.sourcePath : edge.destPath;
          return (
            <div key={edge.id} className="relative flex items-start gap-2.5 pb-2.5 group/lineage">
              <div className="absolute left-[-5px] top-[5px] w-[9px] h-[9px] rounded-full border-2 border-[#1e1e2e] bg-sky-500/60 z-10 group-hover/lineage:bg-sky-400 transition-colors" />
              <div className="flex-1 min-w-0 pl-2">
                <div className="flex items-center gap-1.5">
                  <Icons8Icon id={icon} size={11} className="text-gray-500 shrink-0" />
                  <span className="text-[10px] font-semibold text-gray-300 uppercase tracking-wide">{edge.kind}</span>
                  <span className="text-[10px] text-gray-600 ml-auto shrink-0">{relativeTime(edge.timestampUtc)}</span>
                </div>
                {edge.label && (
                  <div className="text-[10px] text-gray-400 mt-0.5">{edge.label}</div>
                )}
                {otherPath && (
                  <button
                    type="button"
                    className="bndz-mono text-[10px] text-sky-400/70 hover:text-sky-300 truncate mt-0.5 block text-left max-w-full"
                    onClick={() => revealPath(otherPath)}
                    title={otherPath}
                  >
                    {isInbound ? '← ' : '→ '}{leafName(otherPath)}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
