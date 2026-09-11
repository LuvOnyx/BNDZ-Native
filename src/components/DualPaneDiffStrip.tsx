import React, { useCallback, useEffect, useRef, useState } from 'react';
import { IPC } from '../lib/ipcBridge';

export type DiffEntry = {
  name: string;
  status: 'same' | 'different' | 'onlyA' | 'onlyB';
  type?: string;
  sizeA?: number;
  sizeB?: number;
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
  /** Full paths when a *file* is selected in both panes — triggers inline line diff. */
  fileA?: string | null;
  fileB?: string | null;
  onNavigate?: (name: string, pane: 'A' | 'B') => void;
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

function normStatus(s: string): DiffEntry['status'] {
  const l = s.toLowerCase();
  if (l === 'same' || l === 'identical') return 'same';
  if (l === 'different' || l === 'differ' || l === 'modified') return 'different';
  if (l === 'onlya' || l === 'onlyleft' || l === 'left') return 'onlyA';
  if (l === 'onlyb' || l === 'onlyright' || l === 'right') return 'onlyB';
  return 'different';
}

function normalizeDirEntries(raw: unknown[]): DiffEntry[] {
  return raw.map((r: any) => ({
    name: String(r.name ?? r.Name ?? r.relativePath ?? r.RelativePath ?? r.id ?? ''),
    status: normStatus(String(r.status ?? r.Status ?? '')),
    type: r.type ?? r.Type ?? 'file',
    sizeA: typeof r.sizeA === 'number' ? r.sizeA
      : typeof r.leftSize === 'number' ? r.leftSize
      : undefined,
    sizeB: typeof r.sizeB === 'number' ? r.sizeB
      : typeof r.rightSize === 'number' ? r.rightSize
      : undefined,
  }));
}

function mapLineType(raw: string | undefined): LineDiff['type'] {
  const t = String(raw || '').toLowerCase();
  if (t === 'insert' || t === 'inserted' || t === 'added' || t === 'add') return 'added';
  if (t === 'delete' || t === 'deleted' || t === 'removed' || t === 'remove') return 'removed';
  if (t === 'modify' || t === 'modified' || t === 'change') return 'modified';
  return 'unchanged';
}

function normalizeLineDiff(raw: any[]): LineDiff[] {
  return raw.map((r: any) => ({
    type: mapLineType(r.type) || (r.isAdded ? 'added' : r.isDeleted ? 'removed' : 'unchanged'),
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
      if ((res as any)?.identical) {
        setLineDiffs([{ type: 'unchanged', text: '(files are identical)' }]);
        return;
      }
      // Host returns DiffPlex under textDiff.lines (insert/delete/same/modify).
      const rawLines: unknown[] = Array.isArray((res as any)?.textDiff?.lines)
        ? (res as any).textDiff.lines
        : Array.isArray((res as any)?.lines)
          ? (res as any).lines
          : [];
      const mapped = normalizeLineDiff(rawLines as any[]);
      setLineDiffs(mapped.length
        ? mapped
        : [{
            type: 'unchanged',
            text: (res as any)?.ok === false
              ? String((res as any)?.message || 'Compare failed')
              : '(no text diff — binary or empty)',
          }]);
    } catch (e) {
      if (!token.cancelled) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!token.cancelled) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (fileA && fileB) void runFileCompare(fileA, fileB);
    else void runDirCompare();
    return () => { abortRef.current.cancelled = true; };
  }, [pathA, pathB, fileA, fileB, runDirCompare, runFileCompare]);

  const filtered = filter === 'all' ? dirEntries : dirEntries.filter((e) => e.status === filter);
  const counts = {
    same: dirEntries.filter((e) => e.status === 'same').length,
    different: dirEntries.filter((e) => e.status === 'different').length,
    onlyA: dirEntries.filter((e) => e.status === 'onlyA').length,
    onlyB: dirEntries.filter((e) => e.status === 'onlyB').length,
  };

  const chip = (active: boolean) =>
    `px-1.5 py-0.5 rounded-[6px] text-[10px] font-semibold border transition-colors ${
      active ? 'border-[color-mix(in_srgb,var(--accent,#c026d3)_55%,#888)] text-[var(--fg,#e8e8ec)] bg-[color-mix(in_srgb,var(--accent,#c026d3)_18%,transparent)]'
        : 'border-[color-mix(in_srgb,var(--fg,#fff)_12%,transparent)] text-[color-mix(in_srgb,var(--fg,#fff)_55%,transparent)] hover:text-[var(--fg,#e8e8ec)]'
    }`;

  return (
    <div className="bndz-dual-diff-strip flex flex-col border-t text-xs shrink-0" style={{ maxHeight: 220, minHeight: 80 }}>
      <div className="bndz-dual-diff-strip__hdr flex items-center gap-2 px-3 py-1.5 border-b shrink-0 flex-wrap">
        <span className="font-semibold text-[11px] tracking-wider uppercase mr-1 opacity-80">
          {mode === 'file' ? 'File Diff' : 'Folder Diff'}
        </span>
        {mode === 'dir' && (
          <>
            <button type="button" onClick={() => setFilter('all')} className={chip(filter === 'all')}>All {dirEntries.length}</button>
            {counts.different > 0 && (
              <button type="button" onClick={() => setFilter('different')} className={chip(filter === 'different')}>≠ {counts.different}</button>
            )}
            {counts.onlyA > 0 && (
              <button type="button" onClick={() => setFilter('onlyA')} className={chip(filter === 'onlyA')}>← Only A {counts.onlyA}</button>
            )}
            {counts.onlyB > 0 && (
              <button type="button" onClick={() => setFilter('onlyB')} className={chip(filter === 'onlyB')}>Only B → {counts.onlyB}</button>
            )}
            {counts.same > 0 && (
              <button type="button" onClick={() => setFilter('same')} className={chip(filter === 'same')}>≡ Same {counts.same}</button>
            )}
            <button
              type="button"
              onClick={() => void runDirCompare()}
              disabled={loading}
              className="ml-auto px-2 py-0.5 rounded-[6px] text-[10px] border border-[color-mix(in_srgb,var(--accent,#8b9cf8)_40%,transparent)] text-[color-mix(in_srgb,var(--accent,#8b9cf8)_90%,#fff)] disabled:opacity-40"
            >
              {loading ? 'Comparing…' : 'Refresh'}
            </button>
          </>
        )}
        {mode === 'file' && (
          <button
            type="button"
            onClick={() => fileA && fileB && void runFileCompare(fileA, fileB)}
            disabled={loading}
            className="ml-auto px-2 py-0.5 rounded-[6px] text-[10px] border border-[color-mix(in_srgb,var(--accent,#8b9cf8)_40%,transparent)] disabled:opacity-40"
          >
            {loading ? 'Comparing…' : 'Refresh'}
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="px-1.5 py-0.5 rounded-[6px] text-[10px] border border-[color-mix(in_srgb,var(--fg,#fff)_14%,transparent)] opacity-70 hover:opacity-100 hover:text-[#ef4444]"
          title="Close diff strip"
        >
          ✕
        </button>
      </div>

      <div className="bndz-dual-diff-strip__body flex-1 overflow-y-auto overflow-x-auto min-h-0">
        {loading && (
          <div className="flex items-center justify-center h-full text-[11px] py-4 opacity-70">
            Running DiffPlex comparison…
          </div>
        )}
        {!loading && error && (
          <div className="px-3 py-2 text-[#ef4444] text-[11px]">Error: {error}</div>
        )}
        {!loading && !error && mode === 'dir' && filtered.length === 0 && dirEntries.length > 0 && (
          <div className="px-3 py-2 text-[11px] opacity-60">No entries match this filter.</div>
        )}
        {!loading && !error && mode === 'dir' && dirEntries.length === 0 && (
          <div className="px-3 py-2 text-[11px] opacity-60">No differences found — folders are identical.</div>
        )}
        {!loading && !error && mode === 'dir' && filtered.length > 0 && (
          <table className="w-full text-[11px] border-collapse">
            <tbody>
              {filtered.map((e, i) => (
                <tr key={`${e.name}-${i}`} className="bndz-dual-diff-strip__row border-b border-[color-mix(in_srgb,var(--fg,#fff)_6%,transparent)] hover:bg-[color-mix(in_srgb,var(--accent,#c026d3)_8%,transparent)] cursor-pointer">
                  <td className="pl-3 pr-1 py-0.5 w-6 text-center font-bold" style={{ color: statusColor(e.status) }}>
                    {statusLabel(e.status)}
                  </td>
                  <td
                    className="pr-2 py-0.5 truncate max-w-xs"
                    style={{ maxWidth: '40vw' }}
                    title={e.name}
                    onClick={() => onNavigate?.(e.name, 'A')}
                  >
                    {e.name}
                  </td>
                  <td className="px-2 py-0.5 text-right font-mono w-20 opacity-70">{formatBytes(e.sizeA)}</td>
                  <td className="px-2 py-0.5 text-right font-mono w-20 opacity-70">{formatBytes(e.sizeB)}</td>
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
                  className="border-b border-[color-mix(in_srgb,var(--fg,#fff)_5%,transparent)]"
                  style={{
                    background:
                      l.type === 'added' ? 'rgba(34,197,94,0.08)'
                        : l.type === 'removed' ? 'rgba(239,68,68,0.08)'
                          : l.type === 'modified' ? 'rgba(245,158,11,0.08)'
                            : 'transparent',
                  }}
                >
                  <td className="pl-2 pr-1 py-0 text-right opacity-40 w-8 select-none">{l.lineA ?? ''}</td>
                  <td
                    className="px-1 py-0 text-center w-4 font-bold"
                    style={{
                      color: l.type === 'added' ? '#22c55e'
                        : l.type === 'removed' ? '#ef4444'
                          : l.type === 'modified' ? '#f59e0b'
                            : 'inherit',
                    }}
                  >
                    {l.type === 'added' ? '+' : l.type === 'removed' ? '−' : l.type === 'modified' ? '~' : ' '}
                  </td>
                  <td className="pr-3 py-0 whitespace-pre">{l.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
