import React, { useMemo, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { IPC } from '../../lib/ipcBridge';
import { isAudioExt } from '../../lib/mediaTypes';
import { toWindowsPath } from '../../lib/pathUtils';

export type MusicRow = {
  path: string;
  name: string;
  ok: boolean;
  bpm?: number;
  key?: string;
  mode?: string;
  camelot?: string;
  peakDb?: number;
  keyConfidence?: number;
  error?: string;
  sidecarTags?: string[];
};

type Props = {
  paths: string[];
  folderPath?: string;
};

function extOf(path: string): string {
  const base = path.split(/[/\\]/).pop() || '';
  const i = base.lastIndexOf('.');
  return i >= 0 ? base.slice(i + 1) : '';
}

function compatibleCamelot(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const na = parseInt(a, 10);
  const nb = parseInt(b, 10);
  const la = a.slice(-1);
  const lb = b.slice(-1);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
  // Same number different letter (relative major/minor) or ±1 on wheel
  if (na === nb && la !== lb) return true;
  const diff = Math.min(Math.abs(na - nb), 12 - Math.abs(na - nb));
  return diff === 1 && la === lb;
}

export default function MusicStudioPanel({ paths, folderPath }: Props) {
  const audioPaths = useMemo(() => {
    const fromSel = paths.map(toWindowsPath).filter(p => isAudioExt(extOf(p)));
    return [...new Set(fromSel)];
  }, [paths]);

  const [rows, setRows] = useState<MusicRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [writeTags, setWriteTags] = useState(true);
  const [writeSidecars, setWriteSidecars] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filterCamelot, setFilterCamelot] = useState<string | null>(null);

  const runAnalyze = async () => {
    if (!audioPaths.length) {
      setError('Select one or more audio files (mp3, wav, flac, m4a…).');
      return;
    }
    setBusy(true);
    setError(null);
    setStatus(`Analyzing ${audioPaths.length} clip${audioPaths.length === 1 ? '' : 's'}…`);
    setRows([]);
    try {
      const r = await IPC.analyzeMusicBatch(audioPaths, writeTags);
      const next: MusicRow[] = (r.results || []).map(item => ({
        path: item.path || '',
        name: (item.path || '').split(/[/\\]/).pop() || 'clip',
        ok: !!item.ok,
        bpm: item.bpm,
        key: item.key,
        mode: item.mode,
        camelot: item.camelot,
        peakDb: item.peakDb,
        keyConfidence: item.keyConfidence,
        error: item.error,
        sidecarTags: item.sidecarTags,
      }));
      setRows(next);

      if (writeSidecars) {
        for (const row of next) {
          if (!row.ok || !row.sidecarTags?.length || !row.path) continue;
          const sc = await IPC.getTagSidecar(row.path);
          const existing = sc?.tags?.filter(Boolean) ?? [];
          const merged = [...new Set([
            ...existing.filter(t => !/^(bpm|key|camelot)(?:\s|:|$|\d)/i.test(t)),
            ...row.sidecarTags,
          ])];
          await IPC.setTagMeta(row.path, sc?.label, sc?.comment, merged);
        }
      }

      setStatus(`Done — ${r.analyzed} analyzed${r.failed ? `, ${r.failed} failed` : ''}${writeTags ? ' · tags written' : ''}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus(null);
    } finally {
      setBusy(false);
    }
  };

  const visible = filterCamelot
    ? rows.filter(r => compatibleCamelot(r.camelot, filterCamelot) || r.camelot === filterCamelot)
    : rows;

  const harmonicGroups = useMemo(() => {
    const map = new Map<string, number>();
    rows.filter(r => r.ok && r.camelot).forEach(r => {
      map.set(r.camelot!, (map.get(r.camelot!) || 0) + 1);
    });
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  return (
    <div className="bndz-music-studio flex flex-col gap-3">
      <div className="bndz-plugin-card bndz-music-studio-hero !p-3">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 border border-amber-400/30 bg-gradient-to-br from-amber-500/20 to-sky-500/10 shadow-[0_0_24px_rgba(196,163,90,0.15)]">
            <Icons8Icon id="music_ui" size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-[13px] font-semibold text-[#f3f0e8]">Producer Studio</h3>
            <p className="text-[10px] text-white/45 mt-0.5 leading-snug">
              Detect BPM + musical key for selected clips, stamp sidecar tags, and find Camelot-compatible matches for mixing.
            </p>
            <div className="text-[10px] text-white/35 mt-1.5">
              {audioPaths.length
                ? `${audioPaths.length} audio file${audioPaths.length === 1 ? '' : 's'} in selection`
                : folderPath
                  ? 'No audio in selection — pick songs in the list first'
                  : 'Select audio in the file list'}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 mt-3">
          <label className="flex items-center gap-1.5 text-[11px] text-white/65 cursor-pointer">
            <input type="checkbox" checked={writeTags} onChange={e => setWriteTags(e.target.checked)} className="accent-[#c4a35a]" />
            Write BPM into file tags
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-white/65 cursor-pointer">
            <input type="checkbox" checked={writeSidecars} onChange={e => setWriteSidecars(e.target.checked)} className="accent-[#c4a35a]" />
            Stamp BNDZ sidecar (bpm:/key:/camelot:)
          </label>
        </div>

        <div className="flex items-center gap-2 mt-3">
          <button
            type="button"
            disabled={busy || !audioPaths.length}
            onClick={() => void runAnalyze()}
            className="bndz-hub-btn-primary px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40"
          >
            {busy ? 'Detecting…' : 'Detect BPM + Key'}
          </button>
          {filterCamelot && (
            <button type="button" className="bndz-lens-chip" onClick={() => setFilterCamelot(null)}>
              Clear Camelot filter ({filterCamelot})
            </button>
          )}
        </div>
        {status && <div className="text-[11px] text-sky-300/85 mt-2">{status}</div>}
        {error && <div className="text-[11px] text-rose-300/90 mt-2">{error}</div>}
      </div>

      {harmonicGroups.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {harmonicGroups.map(([code, count]) => (
            <button
              key={code}
              type="button"
              onClick={() => setFilterCamelot(v => (v === code ? null : code))}
              className={`bndz-music-camelot-chip${filterCamelot === code ? ' is-active' : ''}`}
              title="Show this key and harmonic neighbors"
            >
              {code} · {count}
            </button>
          ))}
        </div>
      )}

      {visible.length > 0 && (
        <div className="bndz-plugin-card !p-0 overflow-hidden">
          <div className="max-h-[280px] overflow-y-auto divide-y divide-white/[0.05] bndz-scrollbar">
            {visible.map(row => (
              <div key={row.path} className="px-3 py-2.5 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] text-white/90 truncate font-medium" title={row.path}>{row.name}</div>
                  {row.ok ? (
                    <div className="text-[10px] text-white/40 mt-0.5 flex flex-wrap gap-x-2">
                      <span className="text-amber-200/90 font-semibold">{row.bpm?.toFixed(1)} BPM</span>
                      <span>{row.key} {row.mode === 'minor' ? 'min' : 'maj'}</span>
                      {row.camelot && <span className="text-sky-300/80">Camelot {row.camelot}</span>}
                      {row.peakDb != null && <span>{row.peakDb.toFixed(1)} dB</span>}
                    </div>
                  ) : (
                    <div className="text-[10px] text-rose-300/80 mt-0.5">{row.error || 'Failed'}</div>
                  )}
                </div>
                {row.ok && row.camelot && (
                  <button
                    type="button"
                    className="bndz-lens-chip shrink-0"
                    onClick={() => setFilterCamelot(row.camelot!)}
                  >
                    Mix match
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
