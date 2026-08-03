import React, { useEffect, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { IPC } from '../../lib/ipcBridge';
import { toWindowsPath } from '../../lib/pathUtils';
import { isAudioExt, isImageExt } from '../../lib/mediaTypes';

type DnaRelative = {
  path: string;
  kind: string;
  score: number;
  reason: string;
};

function leafName(path: string): string {
  const parts = path.replace(/[/\\]+$/, '').split(/[/\\]/);
  return parts.pop() || path;
}

interface Props {
  path: string | null;
  onNavigate?: (path: string) => void;
}

export default function ContentDnaRelativesPanel({ path, onNavigate }: Props) {
  const [relatives, setRelatives] = useState<DnaRelative[]>([]);
  const [kind, setKind] = useState('');
  const [loading, setLoading] = useState(false);
  const [scanned, setScanned] = useState(false);

  useEffect(() => {
    if (!path) {
      setRelatives([]);
      setKind('');
      return;
    }

    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    if (!isImageExt(ext) && !isAudioExt(ext)) {
      setRelatives([]);
      setKind('');
      return;
    }

    let active = true;
    setLoading(true);
    const winPath = toWindowsPath(path);
    const folder = winPath.replace(/[/\\][^/\\]+$/, '');

    void IPC.contentDnaScan(folder, true)
      .then(() => IPC.contentDnaForPath(winPath, 12))
      .then(res => {
        if (!active) return;
        if (!res.ok) {
          setRelatives([]);
          return;
        }
        setKind(res.kind || '');
        setRelatives((res.relatives || []).map(r => ({
          path: String(r.path ?? (r as any).Path ?? ''),
          kind: String(r.kind ?? (r as any).Kind ?? ''),
          score: Number(r.score ?? (r as any).Score ?? 0),
          reason: String(r.reason ?? (r as any).Reason ?? ''),
        })).filter(r => r.path));
        setScanned(true);
      })
      .catch(() => { if (active) setRelatives([]); })
      .finally(() => { if (active) setLoading(false); });

    return () => { active = false; };
  }, [path]);

  if (!path) return null;
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (!isImageExt(ext) && !isAudioExt(ext)) return null;
  if (!loading && relatives.length === 0 && !scanned) return null;

  const revealPath = (winPath: string) => {
    const panePath = winPath.replace(/^([A-Za-z]):\\/, '/$1/').replace(/\\/g, '/');
    onNavigate?.(panePath);
  };

  return (
    <div className="border-t border-white/[0.06] px-4 py-3 bndz-dna-relatives">
      <div className="flex items-center gap-1.5 mb-2">
        <Icons8Icon id="genealogy" size={13} className="opacity-60" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">DNA Relatives</span>
        {kind && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/[0.06] text-gray-500 ml-1">{kind}</span>
        )}
        {loading && <span className="text-[10px] text-gray-600 ml-auto animate-pulse">scanning…</span>}
      </div>

      {!loading && relatives.length === 0 && (
        <p className="text-[10px] text-gray-600 italic">No near-duplicates in this folder tree.</p>
      )}

      <div className="flex flex-col gap-1.5 max-h-[180px] overflow-y-auto bndz-scrollbar">
        {relatives.map(rel => (
          <button
            key={rel.path}
            type="button"
            className="bndz-dna-relative-card group flex items-start gap-2 w-full text-left px-2.5 py-2 rounded-lg border border-white/[0.06] bg-white/[0.03] hover:bg-white/[0.06] hover:border-[#7eb8e8]/30 transition-colors"
            onClick={() => revealPath(rel.path)}
            title={rel.reason}
          >
            <span className="shrink-0 mt-0.5 text-[10px] font-mono text-[#7eb8e8] w-9">
              {Math.round(rel.score * 100)}%
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] text-gray-200 truncate group-hover:text-white">
                {leafName(rel.path)}
              </span>
              <span className="block text-[9px] text-gray-500 truncate mt-0.5">{rel.reason}</span>
            </span>
            <Icons8Icon id="arrow_right_ui" size={12} className="shrink-0 opacity-0 group-hover:opacity-60 mt-0.5" />
          </button>
        ))}
      </div>
    </div>
  );
}
