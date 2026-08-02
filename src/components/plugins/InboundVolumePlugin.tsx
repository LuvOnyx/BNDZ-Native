import React, { useCallback, useEffect, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { EmblemIcon } from '../EmblemIcon';
import { IPC } from '../../lib/ipcBridge';
import { pushToast } from '../ToastHost';
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
};

function normalizeEntry(raw: Record<string, unknown>): InboundEntry {
  const name = String(raw.name ?? raw.Name ?? raw.label ?? raw.Label ?? 'Capture');
  const type = String(raw.type ?? raw.Type ?? raw.sourceKind ?? raw.SourceKind ?? 'clipboard');
  return {
    id: String(raw.id ?? raw.Id ?? ''),
    label: name,
    sourceKind: type === 'files' || type === 'image' || type === 'text' ? type : (type || 'clipboard'),
    capturedUtc: (raw.capturedUtc as string | undefined)
      ?? (raw.CapturedUtc as string | undefined)
      ?? (raw.createdUtc as string | undefined)
      ?? (raw.CreatedUtc as string | undefined),
    pathCount: Number(raw.pathCount ?? raw.PathCount ?? (raw.size ? 1 : 0) ?? 0) || 1,
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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<string[]>([]);
  const [inboundRoot, setInboundRoot] = useState('');

  const refresh = useCallback(async () => {
    const [list, root] = await Promise.all([
      IPC.inboundList(),
      IPC.inboundGetRoot(),
    ]);
    setEntries((list.entries || []).map(e => normalizeEntry(e as Record<string, unknown>)));
    setInboundRoot(root.root || '');
    if (typeof (list as { watching?: boolean }).watching === 'boolean') {
      setWatching(!!(list as { watching?: boolean }).watching);
    } else if (typeof root.watching === 'boolean') {
      setWatching(!!root.watching);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

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
        pushToast({ kind: 'success', title: 'Watcher started', message: 'Auto-capturing clipboard changes.' });
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

  const copyToActive = (paths: string[]) => {
    window.dispatchEvent(new CustomEvent('bndz-inbound-copy', {
      detail: { paths, destination: currentPath },
    }));
    pushToast({ kind: 'info', title: 'Copy started', message: `${paths.length} item(s) → active folder.` });
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

        {watching && (
          <div className="shrink-0 px-5 py-2 border-b border-white/[0.06] bg-emerald-500/[0.06] flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">
              Watching clipboard for new content
            </span>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto bndz-scrollbar">
          {activeTab === 'inbox' && (
            <div className="p-5 space-y-2">
              {entries.length === 0 ? (
                <PluginEmptyState
                  icon="download_ui"
                  title="Inbox empty"
                  description="Capture clipboard contents or enable the watcher to automatically catch file drops and copies."
                />
              ) : (
                entries.map(entry => {
                  const isExpanded = expandedId === entry.id;
                  return (
                    <PluginCard key={entry.id} className="bndz-inbound-entry-card">
                      <div
                        className="flex items-center gap-3 cursor-pointer"
                        onClick={() => void expandEntry(entry.id)}
                      >
                        <Icons8Icon
                          id={entry.sourceKind === 'clipboard' ? 'clipboard_ui' : 'download_ui'}
                          size={16}
                          className="text-sky-400/70 shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold text-white truncate">{entry.label}</div>
                          <div className="text-[10px] text-gray-500">
                            {entry.pathCount} path{entry.pathCount === 1 ? '' : 's'} · {entry.sourceKind} · {relativeTime(entry.capturedUtc)}
                          </div>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <PluginToolbarButton
                            icon="move_ui"
                            onClick={(e: any) => { e?.stopPropagation?.(); void expandEntry(entry.id).then(() => { if (expandedPaths.length) copyToActive(expandedPaths); }); }}
                            title="Copy into active folder"
                          >
                            Copy in
                          </PluginToolbarButton>
                          <PluginToolbarButton
                            icon="delete"
                            onClick={(e: any) => { e?.stopPropagation?.(); void deleteEntry(entry.id); }}
                            disabled={busy}
                          >
                            Delete
                          </PluginToolbarButton>
                        </div>
                      </div>
                      {isExpanded && expandedPaths.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-white/[0.06] space-y-1">
                          {expandedPaths.map((p, i) => (
                            <div key={i} className="bndz-mono text-[10px] text-gray-400 truncate pl-6" title={p}>
                              {p}
                            </div>
                          ))}
                          <div className="pt-1 pl-6">
                            <PluginToolbarButton icon="move_ui" onClick={() => copyToActive(expandedPaths)}>
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
                    <div className={`w-2.5 h-2.5 rounded-full ${watching ? 'bg-emerald-400' : 'bg-gray-600'}`} />
                    <span className="text-xs text-gray-300">
                      Clipboard watcher: <strong className={watching ? 'text-emerald-300' : 'text-gray-500'}>
                        {watching ? 'Active' : 'Inactive'}
                      </strong>
                    </span>
                  </div>
                </div>
              </PluginCard>

              <PluginCard>
                <PluginSectionTitle icon="data_information">How Inbound Volume works</PluginSectionTitle>
                <ul className="mt-3 space-y-1.5 text-xs text-gray-400 leading-relaxed list-disc list-inside">
                  <li><strong className="text-gray-300">Capture now</strong> — grabs the current clipboard (files or text) into the inbound staging area.</li>
                  <li><strong className="text-gray-300">Watch mode</strong> — continuously monitors the clipboard and auto-captures new content.</li>
                  <li><strong className="text-gray-300">Copy in</strong> — moves captured content from staging into your active folder.</li>
                </ul>
              </PluginCard>
            </div>
          )}
        </div>
      </div>
    </PluginPanelShell>
  );
}
