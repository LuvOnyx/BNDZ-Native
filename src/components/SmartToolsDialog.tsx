import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Icons8Icon } from './Icons8Icon';
import { BndzWindowFrame } from './native/BndzWindowFrame';
import { toWindowsPath } from '../lib/pathUtils';
import { IPC } from '../lib/ipcBridge';
import BndzAssistantPanel from './assistant/BndzAssistantPanel';
import BndzDuplicatesPanel from './duplicates/BndzDuplicatesPanel';
import MusicStudioPanel from './music/MusicStudioPanel';
import {
  ORGANIZE_BUCKETS,
  applyOrganizePlan,
  buildOrganizePlanForMode,
  groupOrganizePlanByBucket,
  panePathFromWin,
  type OrganizeMode,
  type OrganizePlanEntry,
} from '../lib/storageOrganize';

export type SmartToolsTab = 'assistant' | 'organize' | 'duplicates' | 'music';

interface SmartToolsDialogProps {
  isOpen?: boolean;
  onClose: () => void;
  selectedItems?: string[];
  selectedFiles?: Array<{ path?: string; name?: string }>;
  currentPath?: string;
  initialPrompt?: string;
  /** Legacy aliases map to assistant — agent/tasks/memories tabs are not separate surfaces yet. */
  initialTab?: SmartToolsTab | 'agent' | 'organize' | 'tasks' | 'memories' | 'music';
  onNavigate?: (path: string) => void;
}

function resolveSelectedPaths(props: SmartToolsDialogProps): string[] {
  if (props.selectedItems?.length) {
    return props.selectedItems.map(p => toWindowsPath(p));
  }
  if (props.selectedFiles?.length) {
    const base = toWindowsPath(props.currentPath || '');
    return props.selectedFiles.map(f => {
      if (f.path) return toWindowsPath(f.path);
      if (f.name && base) return `${base}\\${f.name}`;
      return '';
    }).filter(Boolean);
  }
  return [];
}

function normalizeTab(tab?: SmartToolsDialogProps['initialTab']): SmartToolsTab {
  if (tab === 'agent' || tab === 'tasks' || tab === 'memories') return 'assistant';
  if (tab === 'duplicates') return 'duplicates';
  if (tab === 'organize') return 'organize';
  if (tab === 'music') return 'music';
  if (tab === 'assistant') return 'assistant';
  return 'assistant';
}

const ORGANIZE_MODES: Array<{ id: OrganizeMode; label: string; desc: string; icon: string; accent: string }> = [
  { id: 'buckets', label: 'Auto-Organize', desc: 'Sort into Images, Documents, Audio, Video, Archives, Code', icon: 'category_ui', accent: '#0078d4' },
  { id: 'date-tree', label: 'Date tree', desc: 'Group files into YYYY\\MM folders by modified date', icon: 'calendar_ui', accent: '#a78bfa' },
  { id: 'dedupe-folders', label: 'By extension', desc: 'Place each extension family into its own folder', icon: 'layers_ui', accent: '#34d399' },
  { id: 'flatten', label: 'Flatten', desc: 'Pull nested files up into the folder root', icon: 'arrow_down_ui', accent: '#fb923c' },
];

export default function SmartToolsDialog({
  isOpen = true,
  onClose,
  selectedItems,
  selectedFiles,
  currentPath,
  initialPrompt,
  initialTab = 'assistant',
  onNavigate,
}: SmartToolsDialogProps) {
  const [tab, setTab] = useState<SmartToolsTab>(normalizeTab(initialTab));
  const [scope, setScope] = useState<'selection' | 'folder'>('folder');
  const [mode, setMode] = useState<OrganizeMode>('buckets');
  const [plan, setPlan] = useState<OrganizePlanEntry[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setTab(normalizeTab(initialTab));
      setPlan([]);
      setStatus(null);
      setError(null);
    }
  }, [isOpen, initialTab]);

  const paths = resolveSelectedPaths({ isOpen, onClose, selectedItems, selectedFiles, currentPath });
  const folderWin = currentPath ? toWindowsPath(currentPath) : '';
  const hasSelection = paths.length > 0;

  useEffect(() => {
    if (hasSelection) setScope('selection');
    else setScope('folder');
  }, [hasSelection]);

  const bucketGroups = useMemo(() => groupOrganizePlanByBucket(plan), [plan]);

  const runPreview = useCallback(async () => {
    setAnalyzing(true);
    setError(null);
    setStatus(null);
    setPlan([]);
    try {
      let entries: Array<{ type?: string; name?: string; path?: string; dateModified?: string | number | Date }> = [];
      let root = folderWin;

      if (scope === 'selection' && paths.length) {
        root = folderWin || paths[0].replace(/\\[^\\]+$/, '');
        entries = paths.map(p => {
          const name = p.split(/[/\\]/).pop() || p;
          const isDir = !name.includes('.');
          return { type: isDir ? 'directory' : 'file', name, path: p };
        }).filter(e => e.type === 'file');
        // Prefer real dir listing for selected names when we have a folder context
        if (folderWin) {
          const all = await IPC.getDirContents(currentPath ? panePathFromWin(folderWin) : panePathFromWin(root));
          const selectedSet = new Set(paths.map(p => p.toLowerCase()));
          const nameSet = new Set(paths.map(p => (p.split(/[/\\]/).pop() || '').toLowerCase()));
          entries = all.filter((e: any) => {
            if (e.type !== 'file') return false;
            const win = e.path ? String(e.path).replace(/\//g, '\\') : `${root}\\${e.name}`;
            return selectedSet.has(win.toLowerCase()) || nameSet.has(String(e.name || '').toLowerCase());
          });
        }
      } else {
        if (!folderWin) {
          setError('Open a folder in the list, or select files first.');
          return;
        }
        const pane = currentPath || panePathFromWin(folderWin);
        entries = await IPC.getDirContents(pane);
        if (mode === 'flatten') {
          try {
            const deep = await IPC.performGlobalSearch('*', 2000, false, folderWin, true, false);
            const hits = deep?.items || [];
            if (hits.length) {
              entries = hits
                .map((h: any) => ({
                  type: 'file' as const,
                  name: h.name || String(h.path || h.fullPath || '').split(/[/\\]/).pop(),
                  path: h.path || h.fullPath,
                  dateModified: h.dateModified || h.modified,
                }))
                .filter((e: any) => e.name && e.path);
            }
          } catch {
            /* keep shallow listing */
          }
        }
      }

      const next = buildOrganizePlanForMode(mode, root, entries);
      if (!next.length) {
        setError(mode === 'flatten'
          ? 'Nothing to flatten — no nested files found.'
          : 'No files to organize in this scope.');
        return;
      }
      setPlan(next);
      setStatus(`Preview ready · ${next.length} file(s)`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Preview failed.');
    } finally {
      setAnalyzing(false);
    }
  }, [scope, paths, folderWin, currentPath, mode]);

  const runApply = useCallback(async () => {
    if (!plan.length) return;
    setApplying(true);
    setError(null);
    try {
      const moved = await applyOrganizePlan(plan, (id, op, src, dest) =>
        IPC.executeFsOperation(id, op as any, src, dest),
      );
      setStatus(`Organized ${moved} file(s).`);
      setPlan([]);
      if (folderWin) {
        window.dispatchEvent(new CustomEvent('bndz-refresh-path', {
          detail: { path: currentPath || panePathFromWin(folderWin) },
        }));
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Organize failed.');
    } finally {
      setApplying(false);
    }
  }, [plan, folderWin, currentPath]);

  if (!isOpen) return null;

  const selectionLabel = paths.length > 0 ? `${paths.length} selected` : undefined;

  return (
    <BndzWindowFrame
      title="Smart Tools"
      subtitle={selectionLabel}
      iconId="smart_tools"
      onClose={onClose}
      widthClass="w-[min(720px,calc(100vw-2rem))]"
      heightClass="h-[min(640px,calc(100vh-2rem))]"
      zIndexClass="z-[100]"
    >
      <div className="bndz-plugin-tabstrip flex border-b border-white/[0.06] shrink-0">
        {([
          { id: 'organize' as const, label: 'Organize', iconId: 'category_ui' },
          { id: 'music' as const, label: 'Music', iconId: 'music_ui' },
          { id: 'assistant' as const, label: 'Assistant', iconId: 'sparkles_ui' },
          { id: 'duplicates' as const, label: 'Duplicates', iconId: 'copy' },
        ]).map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`bndz-plugin-tab flex items-center gap-1.5 ${tab === t.id ? 'bndz-plugin-tab-active' : ''}`}
          >
            <Icons8Icon id={t.iconId} size={12} /> {t.label}
          </button>
        ))}
      </div>

      <div className="bndz-smarttools-context flex items-center gap-2 px-4 py-2 border-b border-white/[0.06] bg-black/20 shrink-0 min-h-[36px]">
        <Icons8Icon id="folder_ui" size={12} className="opacity-50 shrink-0" />
        <span className="text-[10px] uppercase tracking-wide text-white/35 shrink-0">Context</span>
        {currentPath && (
          <span className="text-[11px] text-sky-300/80 bndz-mono truncate max-w-[40%]" title={toWindowsPath(currentPath)}>
            {toWindowsPath(currentPath)}
          </span>
        )}
        {paths.length > 0 ? (
          <span className="text-[11px] text-emerald-300/90 truncate flex-1 min-w-0" title={paths.join('\n')}>
            {paths.length} selected · {paths.slice(0, 2).map(p => p.split(/[/\\]/).pop()).join(', ')}
            {paths.length > 2 ? ` +${paths.length - 2}` : ''}
          </span>
        ) : (
          <span className="text-[11px] text-white/30 flex-1">No selection — organize the open folder</span>
        )}
      </div>

      <div className="p-4 flex flex-col gap-3 overflow-y-auto flex-1 min-h-0 bg-black/15">
        {tab === 'organize' && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wide text-white/35">Scope</span>
              <div className="flex rounded-lg border border-white/[0.08] overflow-hidden">
                <button
                  type="button"
                  disabled={!hasSelection}
                  onClick={() => setScope('selection')}
                  className={`px-3 py-1.5 text-[11px] font-medium transition-colors ${scope === 'selection' ? 'bg-[#0078d4]/25 text-[#cce4f7]' : 'text-white/45 hover:bg-white/[0.04]'} disabled:opacity-30`}
                >
                  Selection{hasSelection ? ` (${paths.length})` : ''}
                </button>
                <button
                  type="button"
                  onClick={() => setScope('folder')}
                  className={`px-3 py-1.5 text-[11px] font-medium transition-colors ${scope === 'folder' ? 'bg-[#0078d4]/25 text-[#cce4f7]' : 'text-white/45 hover:bg-white/[0.04]'}`}
                >
                  Whole folder
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {ORGANIZE_MODES.map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => { setMode(m.id); setPlan([]); setStatus(null); setError(null); }}
                  className={`bndz-plugin-card !py-2.5 flex items-start gap-2.5 text-left transition-colors ${mode === m.id ? 'border-[rgba(56,189,248,0.35)] bg-[#094771]/20' : 'hover:border-[rgba(56,189,248,0.2)]'}`}
                >
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border border-white/[0.06]"
                    style={{ background: `${m.accent}22` }}
                  >
                    <Icons8Icon id={m.icon} size={14} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-[12px] font-semibold text-gray-100">{m.label}</h3>
                    <p className="text-[10px] text-white/40 mt-0.5 leading-snug">{m.desc}</p>
                  </div>
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void runPreview()}
                disabled={analyzing || applying}
                className="bndz-hub-btn-primary px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40"
              >
                {analyzing ? 'Building preview…' : 'Dry-run preview'}
              </button>
              <button
                type="button"
                onClick={() => void runApply()}
                disabled={!plan.length || applying || analyzing}
                className="px-3 py-1.5 text-[12px] font-semibold rounded-lg border border-emerald-500/30 bg-emerald-500/15 text-emerald-200 disabled:opacity-40"
              >
                {applying ? 'Applying…' : `Apply${plan.length ? ` (${plan.length})` : ''}`}
              </button>
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('bndz-open-bottom-plugin', {
                    detail: { id: 'batch-rename', paths, currentPath },
                  }));
                  onClose();
                }}
                className="text-[11px] text-white/45 hover:text-white/80 inline-flex items-center gap-1"
              >
                <Icons8Icon id="batch_rename" size={11} /> Rename
              </button>
              <button
                type="button"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('bndz-open-tag-assignment'));
                  onClose();
                }}
                className="text-[11px] text-white/45 hover:text-white/80 inline-flex items-center gap-1"
              >
                <Icons8Icon id="tag_manager" size={11} /> Tag
              </button>
              <button
                type="button"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('bndz-open-bottom-plugin', {
                    detail: { id: 'storage-cleanup', currentPath, paths },
                  }));
                  onClose();
                }}
                className="text-[11px] text-white/45 hover:text-white/80 inline-flex items-center gap-1"
              >
                <Icons8Icon id="storage_cleanup" size={11} /> Cleanup
              </button>
            </div>

            {error && <p className="text-[11px] text-rose-300/90">{error}</p>}
            {status && !error && <p className="text-[11px] text-emerald-300/80">{status}</p>}

            {plan.length > 0 && (
              <div className="rounded-xl border border-white/[0.08] bg-black/25 overflow-hidden">
                <div className="px-3 py-2 border-b border-white/[0.06] flex flex-wrap gap-2">
                  {Object.entries(bucketGroups).map(([bucket, items]) => {
                    const cfg = ORGANIZE_BUCKETS[bucket];
                    return (
                      <span
                        key={bucket}
                        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-medium border border-white/[0.08]"
                        style={{ color: cfg?.color || '#94a3b8' }}
                      >
                        <Icons8Icon id={cfg?.icon || 'folder_ui'} size={10} />
                        {bucket} · {items.length}
                      </span>
                    );
                  })}
                </div>
                <div className="max-h-[220px] overflow-y-auto divide-y divide-white/[0.04] bndz-scrollbar">
                  {plan.slice(0, 80).map((entry, i) => (
                    <div key={`${entry.file}-${i}`} className="px-3 py-1.5 flex items-center gap-2 text-[11px]">
                      <span className="text-gray-300 truncate min-w-0 flex-1" title={entry.file}>{entry.name}</span>
                      <span className="text-white/25 shrink-0">→</span>
                      <span className="text-sky-300/70 truncate max-w-[45%] bndz-mono" title={entry.dest}>
                        {entry.bucket}\\{entry.name}
                      </span>
                    </div>
                  ))}
                  {plan.length > 80 && (
                    <div className="px-3 py-2 text-[10px] text-white/35">+{plan.length - 80} more…</div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'music' && (
          <MusicStudioPanel
            paths={paths}
            folderPath={currentPath ? toWindowsPath(currentPath) : undefined}
          />
        )}

        {tab === 'assistant' && (
          <BndzAssistantPanel
            selectedPaths={paths}
            currentPath={currentPath ? toWindowsPath(currentPath) : undefined}
            initialPrompt={initialPrompt}
          />
        )}

        {tab === 'duplicates' && (
          <BndzDuplicatesPanel
            folderPath={currentPath || '/'}
            onReveal={p => {
              onNavigate?.(p.startsWith('/') ? p : `/${p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '/$1:')}`);
              onClose();
            }}
          />
        )}
      </div>
    </BndzWindowFrame>
  );
}
