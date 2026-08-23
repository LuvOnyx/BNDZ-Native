import React, { useCallback, useEffect, useRef, useState } from 'react';
import { IPC } from '../lib/ipcBridge';

export type DiffEntry = {
  name: string;
  status: 'same' | 'different' | 'onlyA' | 'onlyB';
  type?: string;
  sizeA?: number;
  sizeB?: number;
  /** Inline text diff (only when files compared) */
  diff?: LineDiff[];
};

type LineDiff = {
  type: 'unchanged' | 'added' | 'removed' | 'modified';
  text: string;
  lineA?: number;
  lineB?: number;
};

type Props = {
  pathA: string;
  pathB: string;
  /** file paths when a file is selected in both panes; triggers inline line diff */
  fileA?: string | null;
  fileB?: string | null;
  onNavigate?: (path: string, pane: 'A' | 'B') => void;
  onClose?: () => void;
};

function statusColor(s: DiffEntry['status']) {
  switch (s) {
    case 'same': return '#22c55e';
    case 'different': return '#f59e0b';
    case 'onlyA': return '#38bdf8';
    case 'onlyB': return '#a78bfa';
  }
}

function statusLabel(s: DiffEntry['status']) {
  switch (s) {
    case 'same': return '≡';
    case 'different': return '≠';
    case 'onlyA': return '← A';
    case 'onlyB': return 'B →';
  }
}

function normalizeDirEntries(raw: unknown[]): DiffEntry[] {
  return raw.map((r: any) => {
    const status = normStatus(r.status ?? r.Status ?? '');
    return {
      name: String(r.name ?? r.Name ?? r.relativePath ?? r.RelativePath ?? ''),
      status,
      type: r.type ?? r.Type ?? 'file',
      sizeA: typeof r.sizeA === 'number' ? r.sizeA : undefined,
      sizeB: typeof r.sizeB === 'number' ? r.sizeB : undefined,
    };
  });
}

function normStatus(s: string): DiffEntry['status'] {
  const l = s.toLowerCase();
  if (l === 'same' || l === 'identical') return 'same';
  if (l === 'different' || l === 'differ' || l === 'modified') return 'different';
  if (l === 'onlya' || l === 'onlyleft' || l === 'left') return 'onlyA';
  if (l === 'onlyb' || l === 'onlyright' || l === 'right') return 'onlyB';
  return 'different';
}

function normalizeLineDiff(raw: any[]): LineDiff[] {
  return raw.map((r: any) => ({
    type: r.type ?? (r.isAdded ? 'added' : r.isDeleted ? 'removed' : 'unchanged'),
    text: String(r.text ?? r.line ?? ''),
    lineA: r.lineA ?? r.position,
    lineB: r.lineB ?? r.position,
  }));
}

function formatBytes(n: number | undefined) {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function DualPaneDiffStrip({ pathA, pathB, fileA, fileB, onNavigate, onClose }: Props) {
  const [dirEntries, setDirEntries] = useState<DiffEntry[]>([]);
  const [lineDiffs, setLineDiffs] = useState<LineDiff[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'same' | 'different' | 'onlyA' | 'onlyB'>('all');
  const [mode, setMode] = useState<'dir' | 'file'>('dir');
  const abortRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  const runDirCompare = useCallback(async () => {
    if (!pathA || !pathB) return;
    const token = { cancelled: false };
    abortRef.current = token;
    setLoading(true);
    setError(null);
    setDirEntries([]);
    setLineDiffs([]);
    setMode('dir');
    try {
      const res = await IPC.compareDirectories(pathA, pathB, false);
      if (token.cancelled) return;
      const items: unknown[] = Array.isArray(res) ? res : Array.isArray(res?.items) ? res.items : [];
      setDirEntries(normalizeDirEntries(items));
    } catch (e) {
      if (!token.cancelled) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!token.cancelled) setLoading(false);
    }
  }, [pathA, pathB]);

  const runFileCompare = useCallback(async (fa: string, fb: string) => {
    const token = { cancelled: false };
    abortRef.current = token;
    setLoading(true);
    setError(null);
    setDirEntries([]);
    setLineDiffs([]);
    setMode('file');
    try {
      const res = await IPC.compareFiles(fa, fb);
      if (token.cancelled) return;
      const lines: unknown[] = Array.isArray(res?.lines) ? res.lines : [];
      setLineDiffs(normalizeLineDiff(lines as any[]));
      if (res?.identical) setLineDiffs([{ type: 'unchanged', text: '(files are identical)' }]);
    } catch (e) {
      if (!token.cancelled) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!token.cancelled) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (fileA && fileB) {
      void runFileCompare(fileA, fileB);
    } else {
      void runDirCompare();
    }
    return () => { abortRef.current.cancelled = true; };
  }, [pathA, pathB, fileA, fileB, runDirCompare, runFileCompare]);

  const filtered = filter === 'all'
    ? dirEntries
    : dirEntries.filter(e => e.status === filter);

  const counts = {
    same: dirEntries.filter(e => e.status === 'same').length,
    different: dirEntries.filter(e => e.status === 'different').length,
    onlyA: dirEntries.filter(e => e.status === 'onlyA').length,
    onlyB: dirEntries.filter(e => e.status === 'onlyB').length,
  };

  return (
    <div
      className="flex flex-col border-t border-[#2a2a3a] bg-[#0c0e16] text-xs text-[#c9d1d9]"
      style={{ maxHeight: 220, minHeight: 80 }}
    >
      {/* Header bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[#1e2030] bg-[#0e1022] shrink-0 flex-wrap">
        <span className="font-semibold text-[11px] tracking-wider text-[#7c7fba] uppercase mr-1">
          {mode === 'file' ? 'File Diff' : 'Folder Diff'}
        </span>
        {mode === 'dir' && (
          <>
            <button
              onClick={() => setFilter('all')}
              className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border transition-colors ${filter === 'all' ? 'bg-[#2d2f5a] border-[#5b5fd6] text-white' : 'border-[#2a2a3a] text-[#6b7280] hover:text-white'}`}
            >All {dirEntries.length}</button>
            {counts.different > 0 && (
              <button onClick={() => setFilter('different')} className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border transition-colors ${filter === 'different' ? 'bg-[#3a2800] border-[#f59e0b] text-[#f59e0b]' : 'border-[#2a2a3a] text-[#6b7280] hover:text-[#f59e0b]'}`}>
                ≠ {counts.different}
              </button>
            )}
            {counts.onlyA > 0 && (
              <button onClick={() => setFilter('onlyA')} className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border transition-colors ${filter === 'onlyA' ? 'bg-[#0a2440] border-[#38bdf8] text-[#38bdf8]' : 'border-[#2a2a3a] text-[#6b7280] hover:text-[#38bdf8]'}`}>
                ← Only A {counts.onlyA}
              </button>
            )}
            {counts.onlyB > 0 && (
              <button onClick={() => setFilter('onlyB')} className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border transition-colors ${filter === 'onlyB' ? 'bg-[#1a1040] border-[#a78bfa] text-[#a78bfa]' : 'border-[#2a2a3a] text-[#6b7280] hover:text-[#a78bfa]'}`}>
                Only B → {counts.onlyB}
              </button>
            )}
            {counts.same > 0 && (
              <button onClick={() => setFilter('same')} className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border transition-colors ${filter === 'same' ? 'bg-[#002a10] border-[#22c55e] text-[#22c55e]' : 'border-[#2a2a3a] text-[#6b7280] hover:text-[#22c55e]'}`}>
                ≡ Same {counts.same}
              </button>
            )}
            <button
              onClick={runDirCompare}
              disabled={loading}
              className="ml-auto px-2 py-0.5 rounded text-[10px] bg-[#1e2030] hover:bg-[#252640] border border-[#3a3a5a] text-[#8b9cf8] disabled:opacity-40 transition-colors"
            >
              {loading ? '⟳ Comparing…' : '⟳ Refresh'}
            </button>
          </>
        )}
        {mode === 'file' && (
          <button
            onClick={() => fileA && fileB && void runFileCompare(fileA, fileB)}
            disabled={loading}
            className="ml-auto px-2 py-0.5 rounded text-[10px] bg-[#1e2030] hover:bg-[#252640] border border-[#3a3a5a] text-[#8b9cf8] disabled:opacity-40 transition-colors"
          >
            {loading ? '⟳ Comparing…' : '⟳ Refresh'}
          </button>
        )}
        <button
          onClick={onClose}
          className="px-1.5 py-0.5 rounded text-[10px] border border-[#2a2a3a] text-[#6b7280] hover:text-[#ef4444] hover:border-[#ef4444] transition-colors"
          title="Close diff strip"
        >✕</button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto overflow-x-auto min-h-0">
        {loading && (
          <div className="flex items-center justify-center h-full text-[#5b5fd6] text-[11px] py-4">
            <span className="animate-spin mr-2 text-base">⟳</span> Running DiffPlex comparison…
          </div>
        )}
        {!loading && error && (
          <div className="px-3 py-2 text-[#ef4444] text-[11px]">Error: {error}</div>
        )}
        {!loading && !error && mode === 'dir' && filtered.length === 0 && dirEntries.length > 0 && (
          <div className="px-3 py-2 text-[#6b7280] text-[11px]">No entries match this filter.</div>
        )}
        {!loading && !error && mode === 'dir' && dirEntries.length === 0 && (
          <div className="px-3 py-2 text-[#6b7280] text-[11px]">No differences found — folders are identical.</div>
        )}
        {!loading && !error && mode === 'dir' && filtered.length > 0 && (
          <table className="w-full text-[11px] border-collapse">
            <tbody>
              {filtered.map((e, i) => (
                <tr
                  key={i}
                  className="border-b border-[#1e2030] hover:bg-[#12152a] cursor-pointer transition-colors"
                >
                  <td className="pl-3 pr-1 py-0.5 w-6 text-center font-bold" style={{ color: statusColor(e.status) }}>
                    {statusLabel(e.status)}
                  </td>
                  <td
                    className="pr-2 py-0.5 flex-1 text-[#c9d1d9] truncate max-w-xs"
                    style={{ maxWidth: '40vw' }}
                    title={e.name}
                    onClick={() => onNavigate?.(e.name, 'A')}
                  >
                    {e.name}
                  </td>
                  {e.sizeA != null && (
                    <td className="px-2 py-0.5 text-right text-[#38bdf8] font-mono w-20">{formatBytes(e.sizeA)}</td>
                  )}
                  {e.sizeB != null && (
                    <td className="px-2 py-0.5 text-right text-[#a78bfa] font-mono w-20">{formatBytes(e.sizeB)}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!loading && !error && mode === 'file' && lineDiffs.length > 0 && (
          <table className="w-full text-[11px] border-collapse font-mono">
            <tbody>
              {lineDiffs.map((l, i) => (
                <tr
                  key={i}
                  className="border-b border-[#1a1a2a]"
                  style={{
                    background:
                      l.type === 'added' ? 'rgba(34,197,94,0.08)' :
                      l.type === 'removed' ? 'rgba(239,68,68,0.08)' :
                      l.type === 'modified' ? 'rgba(245,158,11,0.08)' :
                      'transparent',
                  }}
                >
                  <td className="pl-2 pr-1 py-0 text-right text-[#4a5060] w-8 select-none">{l.lineA ?? ''}</td>
                  <td className="px-1 py-0 text-center w-4 font-bold" style={{
                    color: l.type === 'added' ? '#22c55e' : l.type === 'removed' ? '#ef4444' : l.type === 'modified' ? '#f59e0b' : '#4a5060',
                  }}>
                    {l.type === 'added' ? '+' : l.type === 'removed' ? '−' : l.type === 'modified' ? '~' : ' '}
                  </td>
                  <td className="pr-3 py-0 text-[#c9d1d9] whitespace-pre">{l.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
