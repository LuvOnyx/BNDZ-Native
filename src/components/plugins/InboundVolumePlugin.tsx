import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { EmblemIcon } from '../EmblemIcon';
import { IPC } from '../../lib/ipcBridge';
import { pushToast } from '../ToastHost';
import { toWindowsPath } from '../../lib/pathUtils';
import PluginPanelShell from './PluginPanelShell';
import {
  PluginToolbarButton,
  PluginTabStrip,
  PluginTab,
  PluginCard,
  PluginEmptyState,
  PluginHeroStrip,
  PluginHeroActionButton,
  PluginStatCard,
  PluginSectionTitle,
} from './PluginPanelPrimitives';

export const InboundVolumePluginDef = {
  id: 'inbound-volume',
  name: 'Inbound Volume',
  icon: 'download_ui',
  description: 'Clipboard catcher and inbound file watcher — capture, review, and copy into your library.',
  targetPanel: 'bottom' as const,
  installOnFirstUse: false,
};

type TabId = 'inbox' | 'settings';

type InboundEntry = {
  id: string;
  label: string;
  sourceKind: string;
  capturedUtc?: string;
  pathCount: number;
  paths?: string[];
  size?: number;
};

const SOURCE_META: Record<string, { icon: string; label: string; color: string }> = {
  files:     { icon: 'copy_ui',      label: 'File drop',    color: 'text-sky-400' },
  image:     { icon: 'image_ui',     label: 'Image',        color: 'text-violet-400' },
  text:      { icon: 'text_ui',      label: 'Text',         color: 'text-amber-400' },
  clipboard: { icon: 'clipboard_ui', label: 'Clipboard',    color: 'text-gray-400' },
};

function normalizeEntry(raw: Record<string, unknown>): InboundEntry {
  const name = String(raw.name ?? raw.Name ?? raw.label ?? raw.Label ?? 'Capture');
  const type = String(raw.type ?? raw.Type ?? raw.sourceKind ?? raw.SourceKind ?? 'clipboard');
  return {
    id: String(raw.id ?? raw.Id ?? ''),
    label: name,
    sourceKind: type === 'files' || type === 'image' || type === 'text' ? type : 'clipboard',
    capturedUtc: (raw.capturedUtc as string | undefined)
      ?? (raw.CapturedUtc as string | undefined)
      ?? (raw.createdUtc as string | undefined)
      ?? (raw.CreatedUtc as string | undefined),
    pathCount: Number(raw.pathCount ?? raw.PathCount ?? (raw.size ? 1 : 0) ?? 0) || 1,
    size: typeof raw.size === 'number' ? raw.size as number : undefined,
  };
}

function relativeTime(utc?: string): string {
  if (!utc) return '';
  const ms = Date.now() - new Date(utc).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function formatBytes(bytes?: number): string {
  if (bytes == null || bytes === 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function InboundVolumePlugin({
  currentPath,
}: {
  selectedPaths?: string[];
  currentPath?: string;
}) {
  const [activeTab, setActiveTab] = useState<TabId>('inbox');
  const [entries, setEntries] = useState<InboundEntry[]>([]);
  const [watching, setWatching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<string[]>([]);
  const [inboundRoot, setInboundRoot] = useState('');
  const watchPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [list, root] = await Promise.all([
        IPC.inboundList(),
        IPC.inboundGetRoot(),
      ]);
      setEntries((list.entries || []).map(e => normalizeEntry(e as Record<string, unknown>)));
      setInboundRoot(root.root || '');

      const watchState = typeof list.watching === 'boolean' ? list.watching
        : typeof root.watching === 'boolean' ? root.watching
        : false;
      setWatching(watchState);
    } catch (e) {
      pushToast({ kind: 'error', title: 'Inbound refresh failed', message: String(e) });
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Poll watcher state lightly — never list the whole inbox on an interval (disk thrash).
  useEffect(() => {
    if (watchPollRef.current) clearInterval(watchPollRef.current);
    watchPollRef.current = setInterval(async () => {
      try {
        const root = await IPC.inboundGetRoot();
        const next = !!root.watching;
        setWatching((prev) => {
          if (prev !== next && next) void refresh();
          return next;
        });
      } catch { /* silent */ }
    }, watching ? 8000 : 15000);
    return () => { if (watchPollRef.current) clearInterval(watchPollRef.current); };
  }, [watching, refresh]);

  const captureNow = async () => {
    setBusy(true);
    try {
      const r = await IPC.inboundCaptureNow();
      if (r.error) throw new Error(r.error);
      pushToast({ kind: 'success', title: 'Captured', message: 'Clipboard contents captured to inbound.' });
      await refresh();
    } catch (e) {
      pushToast({ kind: 'error', title: 'Capture failed', message: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const toggleWatch = async () => {
    setBusy(true);
    try {
      if (watching) {
        await IPC.inboundStopWatching();
        setWatching(false);
        pushToast({ kind: 'info', title: 'Watcher stopped' });
      } else {
        await IPC.inboundStartWatching();
        setWatching(true);
        pushToast({ kind: 'success', title: 'Watcher started', message: 'New file drops and images only — not the current clipboard, and not every Ctrl+C.' });
      }
    } catch (e) {
      pushToast({ kind: 'error', title: 'Watch toggle failed', message: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const deleteEntry = async (id: string) => {
    setBusy(true);
    try {
      await IPC.inboundDelete(id);
      pushToast({ kind: 'success', title: 'Deleted', message: 'Inbound entry removed.' });
      await refresh();
    } catch (e) {
      pushToast({ kind: 'error', title: 'Delete failed', message: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const expandEntry = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedPaths([]);
      return;
    }
    try {
      const r = await IPC.inboundGetPaths(id);
      setExpandedPaths(r.paths || []);
      setExpandedId(id);
    } catch {
      setExpandedPaths([]);
    }
  };

  const copyToLibrary = async (entryId: string) => {
    if (!currentPath || currentPath === '/') {
      pushToast({ kind: 'warning', title: 'No destination', message: 'Navigate to a folder first, then copy inbound items in.' });
      return;
    }
    setCopyingId(entryId);
    try {
      const dest = toWindowsPath(currentPath);
      const r = await IPC.inboundCopyToLibrary(entryId, dest);
      if (r.ok) {
        const names = Array.isArray(r.copiedNames) && r.copiedNames.length > 0
          ? r.copiedNames.length <= 3 ? r.copiedNames.join(', ') : `${r.copiedNames[0]} +${r.copiedNames.length - 1} more`
          : `${r.copiedCount ?? 0} item(s)`;
        pushToast({ kind: 'success', title: 'Copied to library', message: `${names} copied into active folder.` });
      } else {
        const errDetail = Array.isArray(r.errors) && r.errors.length > 0
          ? ` — ${r.errors[0]}` : '';
        pushToast({
          kind: r.copiedCount ? 'warning' : 'error',
          title: r.copiedCount ? 'Partial copy' : 'Copy failed',
          message: `${r.error || 'Unknown error'}${errDetail}`,
        });
      }
    } catch (e) {
      pushToast({ kind: 'error', title: 'Copy failed', message: String(e) });
    } finally {
      setCopyingId(null);
    }
  };

  const tabs: { id: TabId; label: string; icon: string; badge?: number }[] = [
    { id: 'inbox', label: 'Inbox', icon: 'download_ui', badge: entries.length },
    { id: 'settings', label: 'Settings', icon: 'settings_ui' },
  ];

  return (
    <PluginPanelShell
      title="Inbound Volume"
      icon="download_ui"
      iconColor="#60a5fa"
      variant="embedded"
      subtitle="Clipboard catcher · inbound file watcher"
      toolbar={
        <PluginTabStrip className="!border-0 !min-h-0 bg-black/20 rounded-md p-0.5 gap-0.5">
          {tabs.map(t => (
            <PluginTab key={t.id} active={activeTab === t.id} onClick={() => setActiveTab(t.id)}>
              <span className="inline-flex items-center gap-1">
                <Icons8Icon id={t.icon} size={11} />
                {t.label}
                {t.badge != null && t.badge > 0 && (
                  <span className="bndz-ghostlink-tab-badge">{t.badge}</span>
                )}
              </span>
            </PluginTab>
          ))}
        </PluginTabStrip>
      }
    >
      <div className="flex flex-col min-h-0">
        <PluginHeroStrip
          icon={
            <div className="flex items-center justify-center">
              <EmblemIcon id="emblem-downloads" size={48} />
            </div>
          }
          name="Inbound Volume"
          typeLabel="Clipboard catcher"
          meta={
            <span className="bndz-panel-muted text-xs">
              {entries.length} capture{entries.length === 1 ? '' : 's'}
              {watching && <span className="text-emerald-400 ml-1.5">· watching</span>}
            </span>
          }
          actions={
            <>
              <PluginHeroActionButton
                icon="download_ui"
                variant="primary"
                onClick={() => void captureNow()}
                disabled={busy}
              >
                Capture now
              </PluginHeroActionButton>
              <PluginHeroActionButton
                icon={watching ? 'emblem_pause' : 'media_playback_playing'}
                onClick={() => void toggleWatch()}
                active={watching}
                disabled={busy}
              >
                {watching ? 'Stop' : 'Watch'}
              </PluginHeroActionButton>
              <PluginHeroActionButton icon="reset_ui" onClick={() => void refresh()} disabled={busy}>
                Refresh
              </PluginHeroActionButton>
            </>
          }
        />

        {/* Live watcher status bar */}
        {watching && (
          <div className="shrink-0 px-5 py-2 border-b border-white/[0.06] bg-emerald-500/[0.06] flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">
              Watching clipboard
            </span>
            <span className="text-[10px] text-gray-500 ml-auto">
              {entries.length} capture{entries.length === 1 ? '' : 's'} in inbox
            </span>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto bndz-scrollbar">
          {activeTab === 'inbox' && (
            <div className="p-5 space-y-2">
              {entries.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 px-6">
                  <div className="w-16 h-16 rounded-2xl bg-sky-500/[0.08] border border-sky-500/15 flex items-center justify-center mb-4">
                    <Icons8Icon id="download_ui" size={28} className="text-sky-400/50" />
                  </div>
                  <div className="text-sm font-semibold text-white mb-1">Inbox empty</div>
                  <p className="text-xs text-gray-500 text-center max-w-xs leading-relaxed mb-4">
                    Copy files, images, or text, then press <strong className="text-gray-300">Capture now</strong>. Watch is off until you enable it — it only saves new file drops and screenshots, not every text copy.
                  </p>
                  <div className="flex gap-2">
                    <PluginToolbarButton icon="download_ui" onClick={() => void captureNow()} disabled={busy}>
                      Capture now
                    </PluginToolbarButton>
                    {!watching && (
                      <PluginToolbarButton icon="media_playback_playing" onClick={() => void toggleWatch()} disabled={busy}>
                        Start watching
                      </PluginToolbarButton>
                    )}
                  </div>
                </div>
              ) : (
                entries.map(entry => {
                  const isExpanded = expandedId === entry.id;
                  const isCopying = copyingId === entry.id;
                  const sourceMeta = SOURCE_META[entry.sourceKind] ?? SOURCE_META.clipboard;
                  return (
                    <PluginCard key={entry.id} className="bndz-inbound-entry-card">
                      <div
                        className="flex items-center gap-3 cursor-pointer"
                        onClick={() => void expandEntry(entry.id)}
                      >
                        <div className="w-8 h-8 rounded-lg bg-black/20 border border-white/[0.06] flex items-center justify-center shrink-0">
                          <Icons8Icon
                            id={sourceMeta.icon}
                            size={16}
                            className={sourceMeta.color}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold text-white truncate">{entry.label}</div>
                          <div className="flex items-center gap-2 text-[10px] text-gray-500 mt-0.5">
                            <span className={`inline-flex items-center gap-0.5 ${sourceMeta.color}`}>
                              {sourceMeta.label}
                            </span>
                            {entry.size != null && entry.size > 0 && (
                              <>
                                <span className="text-white/10">·</span>
                                <span>{formatBytes(entry.size)}</span>
                              </>
                            )}
                            <span className="text-white/10">·</span>
                            <span>{relativeTime(entry.capturedUtc)}</span>
                          </div>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <PluginToolbarButton
                            icon="move_ui"
                            onClick={(e: React.MouseEvent) => { e.stopPropagation(); void copyToLibrary(entry.id); }}
                            disabled={isCopying || busy}
                            title="Copy into active folder"
                          >
                            {isCopying ? 'Copying…' : 'Copy in'}
                          </PluginToolbarButton>
                          <PluginToolbarButton
                            icon="delete"
                            onClick={(e: React.MouseEvent) => { e.stopPropagation(); void deleteEntry(entry.id); }}
                            disabled={busy}
                          >
                            Delete
                          </PluginToolbarButton>
                        </div>
                      </div>
                      {isExpanded && expandedPaths.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-white/[0.06] space-y-1">
                          {expandedPaths.map((p, i) => {
                            const filename = p.replace(/^.*[\\/]/, '');
                            return (
                              <div key={i} className="flex items-center gap-2 pl-3" title={p}>
                                <Icons8Icon id="file_ui" size={10} className="text-gray-600 shrink-0" />
                                <span className="bndz-mono text-[10px] text-gray-400 truncate">{filename}</span>
                              </div>
                            );
                          })}
                          <div className="pt-1.5 pl-3">
                            <PluginToolbarButton
                              icon="move_ui"
                              onClick={() => void copyToLibrary(entry.id)}
                              disabled={isCopying || busy}
                            >
                              Copy all to active folder
                            </PluginToolbarButton>
                          </div>
                        </div>
                      )}
                    </PluginCard>
                  );
                })
              )}
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="p-5 space-y-5">
              <PluginCard>
                <PluginSectionTitle icon="settings_ui">Inbound configuration</PluginSectionTitle>
                <div className="mt-3 space-y-3">
                  <div>
                    <div className="bndz-plugin-field-label mb-1">Inbound root</div>
                    <div className="bndz-mono text-[11px] text-gray-300 bg-black/20 rounded-md px-3 py-2">
                      {inboundRoot || 'Not configured'}
                    </div>
                    <p className="text-[10px] text-gray-500 mt-1">
                      Files captured from clipboard are staged here before you copy them into your library.
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className={`w-2.5 h-2.5 rounded-full transition-colors ${watching ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.4)]' : 'bg-gray-600'}`} />
                    <span className="text-xs text-gray-300">
                      Clipboard watcher: <strong className={watching ? 'text-emerald-300' : 'text-gray-500'}>
                        {watching ? 'Active' : 'Inactive'}
                      </strong>
                    </span>
                    <PluginToolbarButton
                      icon={watching ? 'emblem_pause' : 'media_playback_playing'}
                      onClick={() => void toggleWatch()}
                      disabled={busy}
                    >
                      {watching ? 'Stop' : 'Start'}
                    </PluginToolbarButton>
                  </div>
                </div>
              </PluginCard>

              <PluginCard>
                <PluginSectionTitle icon="data_information">How Inbound Volume works</PluginSectionTitle>
                <ul className="mt-3 space-y-1.5 text-xs text-gray-400 leading-relaxed list-disc list-inside">
                  <li><strong className="text-gray-300">Capture now</strong> — grabs the current clipboard (files, images, or text) into the inbound staging area.</li>
                  <li><strong className="text-gray-300">Watch mode</strong> — opt-in. Saves new file drops and images only after you click Watch (never auto-starts, never rewrites the same screenshot).</li>
                  <li><strong className="text-gray-300">Copy in</strong> — copies captured content from staging into your active folder via the native host.</li>
                </ul>
              </PluginCard>
            </div>
          )}
        </div>
      </div>
    </PluginPanelShell>
  );
}
