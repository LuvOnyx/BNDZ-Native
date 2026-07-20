import React, { useCallback, useMemo, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import PluginPanelShell from './PluginPanelShell';
import { IPC } from '../../lib/ipcBridge';
import { normalizePanePath, toWindowsPath } from '../../lib/pathUtils';
import { pushToast } from '../ToastHost';
import {
  PluginTabStrip,
  PluginTab,
  PluginCard,
  PluginEmptyState,
  PluginHeroStrip,
  PluginHeroActionButton,
  PluginFieldLabel,
  PluginToolbarButton,
  PLUGIN_INPUT_CLASS,
} from './PluginPanelPrimitives';

export const ComparePluginDef = {
  id: 'compare',
  name: 'Compare',
  icon: 'compare_ui',
  targetPanel: 'bottom' as const,
  installOnFirstUse: false,
};

type Props = {
  selectedPaths?: string[];
  focusedPath?: string;
  onNavigate?: (path: string) => void;
};

type DirFilter = 'all' | 'same' | 'different' | 'onlyA' | 'onlyB';

function pathLeaf(p: string) {
  const parts = p.replace(/[/\\]+$/, '').split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

/** Normalize backend statuses (onlyLeft/onlyRight) and UI aliases to a stable set. */
function normalizeCompareStatus(status: unknown): 'same' | 'different' | 'onlyA' | 'onlyB' | 'unknown' {
  const s = String(status || '').toLowerCase();
  if (s === 'same' || s === 'identical') return 'same';
  if (s === 'different' || s === 'differ') return 'different';
  if (s === 'onlya' || s === 'onlyleft' || s === 'left') return 'onlyA';
  if (s === 'onlyb' || s === 'onlyright' || s === 'right') return 'onlyB';
  return 'unknown';
}

function joinWinPath(base: string, rel: string) {
  const root = base.replace(/[/\\]+$/, '');
  const part = rel.replace(/\//g, '\\').replace(/^\\+/, '');
  return part ? `${root}\\${part}` : root;
}

function parentWinPath(full: string) {
  const normalized = full.replace(/\//g, '\\').replace(/\\+$/, '');
  const idx = normalized.lastIndexOf('\\');
  if (idx <= 0) return normalized;
  // Drive root like C:\file → C:\
  if (/^[A-Za-z]:$/i.test(normalized.slice(0, idx))) return `${normalized.slice(0, idx)}\\`;
  return normalized.slice(0, idx);
}

function StatusPill({ status }: { status: string }) {
  const norm = normalizeCompareStatus(status);
  const cfg =
    norm === 'same'
      ? { color: '#34d399', label: 'same' }
      : norm === 'different'
        ? { color: '#fbbf24', label: 'different' }
        : norm === 'onlyA'
          ? { color: '#38bdf8', label: 'only A' }
          : norm === 'onlyB'
            ? { color: '#a78bfa', label: 'only B' }
            : { color: '#94a3b8', label: String(status || 'unknown') };
  return (
    <span
      className="bndz-plugin-kind-pill shrink-0 capitalize"
      style={{ color: cfg.color, borderColor: `${cfg.color}44`, background: `${cfg.color}15` }}
    >
      {cfg.label}
    </span>
  );
}

export default function ComparePlugin({ selectedPaths = [], focusedPath, onNavigate }: Props) {
  const [pathA, setPathA] = useState('');
  const [pathB, setPathB] = useState('');
  const [loading, setLoading] = useState(false);
  const [dirResults, setDirResults] = useState<any[]>([]);
  const [fileResult, setFileResult] = useState<any>(null);
  const [mode, setMode] = useState<'files' | 'dirs'>('files');
  const [dirFilter, setDirFilter] = useState<DirFilter>('all');

  React.useEffect(() => {
    if (selectedPaths.length >= 2) {
      setPathA(toWindowsPath(selectedPaths[0]));
      setPathB(toWindowsPath(selectedPaths[1]));
    } else if (selectedPaths.length === 1) {
      setPathA(toWindowsPath(selectedPaths[0]));
    } else if (focusedPath) {
      setPathA(toWindowsPath(focusedPath));
    }
  }, [selectedPaths, focusedPath]);

  const runFileCompare = useCallback(async () => {
    if (!pathA.trim() || !pathB.trim()) {
      pushToast({ kind: 'warning', title: 'Compare', message: 'Select two files to compare.' });
      return;
    }
    setLoading(true);
    setFileResult(null);
    try {
      const r = await IPC.compareFiles(pathA, pathB);
      setFileResult(r);
      if (r.ok) {
        pushToast({
          kind: r.identical ? 'success' : 'info',
          title: 'File compare',
          message: r.identical ? 'Files are identical.' : 'Files differ.',
        });
      }
    } catch {
      pushToast({ kind: 'error', title: 'Compare failed', message: 'Could not compare files.' });
    } finally {
      setLoading(false);
    }
  }, [pathA, pathB]);

  const runDirCompare = useCallback(async () => {
    if (!pathA.trim() || !pathB.trim()) return;
    setLoading(true);
    setDirResults([]);
    setDirFilter('all');
    try {
      const items = await IPC.compareDirectories(pathA, pathB, true);
      setDirResults(Array.isArray(items) ? items : []);
    } catch {
      pushToast({ kind: 'error', title: 'Compare failed', message: 'Directory compare failed.' });
    } finally {
      setLoading(false);
    }
  }, [pathA, pathB]);

  const browsePath = useCallback(async (side: 'A' | 'B') => {
    try {
      if (mode === 'dirs') {
        const picked = await IPC.openFolderDialog(side === 'A' ? 'Select folder A' : 'Select folder B');
        if (picked) {
          if (side === 'A') setPathA(picked);
          else setPathB(picked);
        }
      } else {
        const files = await IPC.openFileDialog('All files (*.*)|*.*');
        const picked = Array.isArray(files) && files.length ? files[0] : '';
        if (picked) {
          if (side === 'A') setPathA(picked);
          else setPathB(picked);
        }
      }
    } catch {
      pushToast({ kind: 'error', title: 'Browse failed', message: 'Could not open the system picker.' });
    }
  }, [mode]);

  const filterCounts = useMemo(() => {
    const counts = { same: 0, different: 0, onlyA: 0, onlyB: 0 };
    for (const row of dirResults) {
      const s = normalizeCompareStatus(row.status);
      if (s === 'same') counts.same += 1;
      else if (s === 'different') counts.different += 1;
      else if (s === 'onlyA') counts.onlyA += 1;
      else if (s === 'onlyB') counts.onlyB += 1;
    }
    return counts;
  }, [dirResults]);

  const filteredDirResults = useMemo(() => {
    if (dirFilter === 'all') return dirResults;
    return dirResults.filter(row => normalizeCompareStatus(row.status) === dirFilter);
  }, [dirResults, dirFilter]);

  const navigateToRow = useCallback((row: any) => {
    if (!onNavigate) return;
    const rel = String(row.relativePath || row.name || '').trim();
    if (!rel) return;
    const status = normalizeCompareStatus(row.status);
    const base =
      status === 'onlyB' ? pathB :
      status === 'onlyA' ? pathA :
      pathA || pathB;
    if (!base) return;
    const full = joinWinPath(base, rel);
    // Compare rows are files; land in the containing folder for reliable pane navigation.
    const targetWin = row.isDirectory ? full : parentWinPath(full);
    onNavigate(normalizePanePath(targetWin));
  }, [onNavigate, pathA, pathB]);

  const heroMeta =
    mode === 'files' && fileResult?.ok
      ? (fileResult.identical ? 'Files are identical' : 'Files differ')
      : mode === 'dirs' && dirResults.length
        ? `${dirResults.length} item(s) compared`
        : 'Select two paths to compare';

  const filterChips: { id: DirFilter; label: string; count?: number }[] = [
    { id: 'all', label: 'All', count: dirResults.length },
    { id: 'same', label: 'Same', count: filterCounts.same },
    { id: 'different', label: 'Different', count: filterCounts.different },
    { id: 'onlyA', label: 'Only A', count: filterCounts.onlyA },
    { id: 'onlyB', label: 'Only B', count: filterCounts.onlyB },
  ];

  return (
    <PluginPanelShell
      title="Compare"
      icon="compare_ui"
      iconColor="#34d399"
      subtitle="Binary file and folder diff"
      variant="embedded"
    >
      <div className="flex flex-col h-full min-h-0 overflow-hidden">
        <PluginHeroStrip
          icon={<Icons8Icon id="compare_ui" size={52} className="opacity-90" />}
          name={pathA && pathB ? `${pathLeaf(pathA)}  ↔  ${pathLeaf(pathB)}` : 'File & folder compare'}
          typeLabel={mode === 'files' ? 'Binary file diff' : 'Directory diff'}
          meta={<span className="bndz-panel-muted text-xs">{heroMeta}</span>}
          actions={
            <PluginHeroActionButton
              icon={loading ? 'loading' : 'compare_ui'}
              variant="primary"
              onClick={() => void (mode === 'files' ? runFileCompare() : runDirCompare())}
              disabled={loading || !pathA.trim() || !pathB.trim()}
            >
              Compare
            </PluginHeroActionButton>
          }
        />

        <PluginTabStrip>
          <PluginTab active={mode === 'files'} onClick={() => setMode('files')}>Files</PluginTab>
          <PluginTab active={mode === 'dirs'} onClick={() => setMode('dirs')}>Folders</PluginTab>
        </PluginTabStrip>

        <div className="flex flex-col flex-1 min-h-0 p-4 gap-3 overflow-hidden">
          {/* Dual-pane A/B path cards */}
          <div className="grid grid-cols-2 gap-3 shrink-0">
            <PluginCard className="!py-3 !px-3 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="bndz-plugin-kind-pill !text-[10px] bg-sky-500/15 border-sky-400/30 text-sky-300">A</span>
                <PluginFieldLabel>Path A</PluginFieldLabel>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  value={pathA}
                  onChange={e => setPathA(e.target.value)}
                  placeholder={mode === 'files' ? 'First file…' : 'First folder…'}
                  className={`flex-1 min-w-0 ${PLUGIN_INPUT_CLASS} bndz-mono`}
                />
                <PluginToolbarButton
                  icon="folder_open_ui"
                  title={mode === 'files' ? 'Browse for file A' : 'Browse for folder A'}
                  onClick={() => void browsePath('A')}
                >
                  Browse
                </PluginToolbarButton>
              </div>
            </PluginCard>
            <PluginCard className="!py-3 !px-3 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="bndz-plugin-kind-pill !text-[10px] bg-violet-500/15 border-violet-400/30 text-violet-300">B</span>
                <PluginFieldLabel>Path B</PluginFieldLabel>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  value={pathB}
                  onChange={e => setPathB(e.target.value)}
                  placeholder={mode === 'files' ? 'Second file…' : 'Second folder…'}
                  className={`flex-1 min-w-0 ${PLUGIN_INPUT_CLASS} bndz-mono`}
                />
                <PluginToolbarButton
                  icon="folder_open_ui"
                  title={mode === 'files' ? 'Browse for file B' : 'Browse for folder B'}
                  onClick={() => void browsePath('B')}
                >
                  Browse
                </PluginToolbarButton>
              </div>
            </PluginCard>
          </div>

          {/* File mode results */}
          {mode === 'files' && fileResult?.ok && (
            <div className="flex flex-col flex-1 min-h-0 gap-3 overflow-hidden">
              <div
                className={`shrink-0 rounded-lg border px-4 py-2.5 flex items-center gap-3 ${
                  fileResult.identical
                    ? 'border-emerald-500/35 bg-emerald-950/30'
                    : 'border-amber-500/35 bg-amber-950/25'
                }`}
              >
                <Icons8Icon
                  id={fileResult.identical ? 'check' : 'warning'}
                  size={18}
                  className={fileResult.identical ? 'text-emerald-400' : 'text-amber-400'}
                />
                <div className="min-w-0 flex-1">
                  <div className={`text-sm font-semibold ${fileResult.identical ? 'text-emerald-300' : 'text-amber-300'}`}>
                    {fileResult.identical ? 'Identical files' : 'Files differ'}
                  </div>
                  {!fileResult.identical && fileResult.firstDiffOffset >= 0 && (
                    <div className="text-[11px] bndz-panel-muted mt-0.5">
                      First difference at byte {fileResult.firstDiffOffset}
                    </div>
                  )}
                </div>
                <StatusPill status={fileResult.identical ? 'identical' : 'differ'} />
              </div>

              <div className="grid grid-cols-2 gap-3 flex-1 min-h-0">
                <PluginCard className="flex flex-col min-h-0 !p-0 overflow-hidden">
                  <div className="px-3 py-2 border-b border-white/[0.06] flex items-center gap-2 shrink-0 bg-sky-500/[0.04]">
                    <span className="bndz-plugin-kind-pill !text-[10px] bg-sky-500/15 border-sky-400/30 text-sky-300">A</span>
                    <span className="text-xs font-medium text-slate-200 truncate">{pathLeaf(pathA)}</span>
                  </div>
                  <div className="p-3 flex-1 min-h-0 overflow-y-auto bndz-scrollbar space-y-2">
                    <div className="bndz-plugin-section-title">SHA-256</div>
                    <p className="bndz-mono text-[11px] text-slate-300 break-all leading-relaxed">{fileResult.hashA || '—'}</p>
                    {!fileResult.identical && fileResult.previewA != null && (
                      <>
                        <div className="bndz-plugin-section-title mt-2">Preview</div>
                        <pre className="bg-black/35 p-2.5 rounded-md overflow-x-auto border border-white/[0.06] bndz-mono text-[11px] text-slate-300">
                          {fileResult.previewA || '—'}
                        </pre>
                      </>
                    )}
                  </div>
                </PluginCard>
                <PluginCard className="flex flex-col min-h-0 !p-0 overflow-hidden">
                  <div className="px-3 py-2 border-b border-white/[0.06] flex items-center gap-2 shrink-0 bg-violet-500/[0.04]">
                    <span className="bndz-plugin-kind-pill !text-[10px] bg-violet-500/15 border-violet-400/30 text-violet-300">B</span>
                    <span className="text-xs font-medium text-slate-200 truncate">{pathLeaf(pathB)}</span>
                  </div>
                  <div className="p-3 flex-1 min-h-0 overflow-y-auto bndz-scrollbar space-y-2">
                    <div className="bndz-plugin-section-title">SHA-256</div>
                    <p className="bndz-mono text-[11px] text-slate-300 break-all leading-relaxed">{fileResult.hashB || '—'}</p>
                    {!fileResult.identical && fileResult.previewB != null && (
                      <>
                        <div className="bndz-plugin-section-title mt-2">Preview</div>
                        <pre className="bg-black/35 p-2.5 rounded-md overflow-x-auto border border-white/[0.06] bndz-mono text-[11px] text-slate-300">
                          {fileResult.previewB || '—'}
                        </pre>
                      </>
                    )}
                  </div>
                </PluginCard>
              </div>
            </div>
          )}

          {/* Dir mode results */}
          {mode === 'dirs' && dirResults.length > 0 && (
            <PluginCard className="flex-1 min-h-0 overflow-hidden !p-0 !py-0 flex flex-col">
              <div className="px-3 py-2 border-b border-white/[0.06] flex flex-col gap-2 shrink-0 bg-[rgba(12,16,24,0.95)] backdrop-blur-sm z-10">
                <div className="flex items-center justify-between">
                  <span className="bndz-plugin-section-title">Diff results</span>
                  <span className="bndz-plugin-kind-pill">{filteredDirResults.length}/{dirResults.length}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {filterChips.map(chip => (
                    <button
                      key={chip.id}
                      type="button"
                      onClick={() => setDirFilter(chip.id)}
                      className={`bndz-plugin-kind-pill transition-colors ${
                        dirFilter === chip.id
                          ? 'bg-sky-500/20 border-sky-400/40 text-sky-200'
                          : 'hover:bg-white/[0.06] text-slate-400'
                      }`}
                    >
                      {chip.label}
                      {typeof chip.count === 'number' && (
                        <span className="ml-1 tabular-nums opacity-70">{chip.count}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto bndz-scrollbar">
                {filteredDirResults.length === 0 ? (
                  <PluginEmptyState
                    icon="compare_ui"
                    title="No rows for this filter"
                    description="Choose another status chip to see matching differences."
                  />
                ) : (
                  filteredDirResults.map(row => {
                    const clickable = !!onNavigate;
                    const rowBody = (
                      <>
                        <StatusPill status={String(row.status || 'unknown')} />
                        <Icons8Icon
                          id={row.isDirectory ? 'folder' : 'file_ui'}
                          size={13}
                          className="shrink-0 opacity-70"
                        />
                        <span className="truncate flex-1 text-slate-200 font-medium">{row.name}</span>
                        {(row.relativePath && row.relativePath !== row.name) && (
                          <span className="bndz-panel-muted bndz-mono text-[10px] truncate max-w-[40%]" title={row.relativePath}>
                            {row.relativePath}
                          </span>
                        )}
                      </>
                    );
                    const rowClass = `w-full flex items-center gap-2.5 px-3 py-1.5 border-b border-white/[0.04] text-xs text-left transition-colors ${
                      clickable
                        ? 'hover:bg-sky-500/[0.08] cursor-pointer'
                        : 'hover:bg-white/[0.02]'
                    }`;
                    if (clickable) {
                      return (
                        <button
                          key={row.id || row.name}
                          type="button"
                          onClick={() => navigateToRow(row)}
                          className={rowClass}
                          title="Open containing folder"
                        >
                          {rowBody}
                        </button>
                      );
                    }
                    return (
                      <div key={row.id || row.name} className={rowClass}>
                        {rowBody}
                      </div>
                    );
                  })
                )}
              </div>
            </PluginCard>
          )}

          {mode === 'files' && !fileResult?.ok && !loading && (
            <PluginEmptyState
              icon="compare_ui"
              title="Ready to compare"
              description="Browse or enter two file paths, then run Compare for a SHA-256 binary diff."
            />
          )}
          {mode === 'dirs' && !loading && dirResults.length === 0 && (
            <PluginEmptyState
              icon="compare_ui"
              title="No folder diff yet"
              description="Browse or enter two folder paths and run Compare to see denser status rows."
            />
          )}
        </div>
      </div>
    </PluginPanelShell>
  );
}
