import React, { useCallback, useEffect, useState } from 'react';
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
  PLUGIN_INPUT_CLASS,
} from './PluginPanelPrimitives';

export const ProjectSandboxPluginDef = {
  id: 'project-sandbox',
  name: 'Project Sandbox',
  icon: 'layers_ui',
  description: 'Isolated sandbox sessions — experiment freely, commit or discard changes.',
  targetPanel: 'bottom' as const,
  installOnFirstUse: false,
};

type TabId = 'active' | 'history' | 'checkpoints';

type Session = {
  id: string;
  name: string;
  rootPath: string;
  status: string;
  createdUtc?: string;
  fileCount?: number;
};

type Checkpoint = {
  id: string;
  name: string;
  createdUtc?: string;
  sessionId: string;
};

function normalizeSession(raw: Record<string, unknown>): Session {
  return {
    id: String(raw.id ?? raw.Id ?? ''),
    name: String(raw.name ?? raw.Name ?? 'Session'),
    rootPath: String(raw.rootPath ?? raw.RootPath ?? raw.rootWinPath ?? raw.RootWinPath ?? ''),
    status: String(raw.status ?? raw.Status ?? 'active'),
    createdUtc: (raw.createdUtc as string | undefined) ?? (raw.CreatedUtc as string | undefined),
    fileCount: Number(raw.fileCount ?? raw.FileCount ?? 0),
  };
}

function normalizeCheckpoint(raw: Record<string, unknown>, sessionId: string): Checkpoint {
  return {
    id: String(raw.id ?? raw.Id ?? ''),
    name: String(raw.name ?? raw.Name ?? ''),
    createdUtc: raw.createdUtc as string | undefined ?? raw.CreatedUtc as string | undefined,
    sessionId,
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

export default function ProjectSandboxPlugin({
  currentPath,
}: {
  selectedPaths?: string[];
  currentPath?: string;
}) {
  const [activeTab, setActiveTab] = useState<TabId>('active');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessions, setActiveSessions] = useState<Session[]>([]);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [busy, setBusy] = useState(false);
  const [cpName, setCpName] = useState('');
  const [expandedSession, setExpandedSession] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [active, all] = await Promise.all([
      IPC.sandboxGetActive(),
      IPC.sandboxList(),
    ]);
    const act = (active.sessions || []).map(s => normalizeSession(s as Record<string, unknown>));
    const hist = (all.sessions || []).map(s => normalizeSession(s as Record<string, unknown>));
    setActiveSessions(act);
    setSessions(hist);
    if (act.length > 0 && !expandedSession) {
      setExpandedSession(act[0].id);
    }
  }, [expandedSession]);

  useEffect(() => { void refresh(); }, [refresh]);

  const loadCheckpoints = useCallback(async (sessionId: string) => {
    const r = await IPC.sandboxListCheckpoints(sessionId);
    setCheckpoints((r.checkpoints || []).map(c => normalizeCheckpoint(c as Record<string, unknown>, sessionId)));
  }, []);

  useEffect(() => {
    if (expandedSession) void loadCheckpoints(expandedSession);
  }, [expandedSession, loadCheckpoints]);

  const startSession = async () => {
    if (!currentPath || currentPath === '/') {
      pushToast({ kind: 'warning', title: 'Navigate first', message: 'Open a folder to sandbox.' });
      return;
    }
    setBusy(true);
    try {
      const r = await IPC.sandboxStart(toWindowsPath(currentPath));
      if (r.error) throw new Error(r.error);
      pushToast({ kind: 'success', title: 'Sandbox started', message: `Session created for ${currentPath}` });
      await refresh();
      setActiveTab('active');
    } catch (e) {
      pushToast({ kind: 'error', title: 'Failed to start sandbox', message: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const commitSession = async (sessionId: string) => {
    setBusy(true);
    try {
      const r = await IPC.sandboxCommit(sessionId);
      if (r.error) throw new Error(r.error);
      pushToast({ kind: 'success', title: 'Committed', message: 'Sandbox changes applied to disk.' });
      await refresh();
    } catch (e) {
      pushToast({ kind: 'error', title: 'Commit failed', message: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const discardSession = async (sessionId: string) => {
    setBusy(true);
    try {
      const r = await IPC.sandboxDiscard(sessionId);
      if (r.error) throw new Error(r.error);
      pushToast({ kind: 'success', title: 'Discarded', message: 'Sandbox reverted — original files unchanged.' });
      await refresh();
    } catch (e) {
      pushToast({ kind: 'error', title: 'Discard failed', message: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const createCheckpoint = async (sessionId: string) => {
    if (!cpName.trim()) return;
    setBusy(true);
    try {
      const r = await IPC.sandboxCheckpoint(sessionId, cpName.trim());
      if (r.error) throw new Error(r.error);
      setCpName('');
      pushToast({ kind: 'success', title: 'Checkpoint saved', message: cpName.trim() });
      await loadCheckpoints(sessionId);
    } catch (e) {
      pushToast({ kind: 'error', title: 'Checkpoint failed', message: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const restoreCheckpoint = async (sessionId: string, checkpointId: string) => {
    setBusy(true);
    try {
      const r = await IPC.sandboxRestoreCheckpoint(sessionId, checkpointId);
      if (r.error) throw new Error(r.error);
      pushToast({ kind: 'success', title: 'Restored', message: 'Sandbox rolled back to checkpoint.' });
      await loadCheckpoints(sessionId);
    } catch (e) {
      pushToast({ kind: 'error', title: 'Restore failed', message: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const tabs: { id: TabId; label: string; icon: string; badge?: number }[] = [
    { id: 'active', label: 'Active', icon: 'zap_ui', badge: activeSessions.length },
    { id: 'history', label: 'History', icon: 'clock_ui', badge: sessions.length },
    { id: 'checkpoints', label: 'Checkpoints', icon: 'bookmark_ui', badge: checkpoints.length },
  ];

  return (
    <PluginPanelShell
      title="Project Sandbox"
      icon="layers_ui"
      iconColor="#34d399"
      variant="embedded"
      subtitle="Isolated experiment sessions · commit or discard"
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
              <EmblemIcon id="emblem-documents" size={48} />
            </div>
          }
          name="Project Sandbox"
          typeLabel="Isolated sessions"
          meta={
            <span className="bndz-panel-muted text-xs">
              {activeSessions.length} active · {sessions.length} total
            </span>
          }
          actions={
            <>
              <PluginHeroActionButton
                icon="plus_ui"
                variant="primary"
                onClick={() => void startSession()}
                disabled={busy}
              >
                Start sandbox
              </PluginHeroActionButton>
              <PluginHeroActionButton icon="reset_ui" onClick={() => void refresh()} disabled={busy}>
                Refresh
              </PluginHeroActionButton>
            </>
          }
        />

        {activeSessions.length > 0 && (
          <div className="shrink-0 px-5 py-2 border-b border-white/[0.06] bg-emerald-500/[0.06] flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">
              {activeSessions.length} sandbox session{activeSessions.length > 1 ? 's' : ''} running
            </span>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto bndz-scrollbar">
          {activeTab === 'active' && (
            <div className="p-5 space-y-3">
              {activeSessions.length === 0 ? (
                <PluginEmptyState
                  icon="layers_ui"
                  title="No active sandboxes"
                  description="Start a sandbox from the current folder to experiment safely. Commit when ready, or discard to revert."
                />
              ) : (
                activeSessions.map(s => (
                  <PluginCard key={s.id} className="bndz-sandbox-session-card">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.4)]" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-white truncate">{s.name}</div>
                        <div className="bndz-mono text-[10px] text-gray-500 truncate">{s.rootPath}</div>
                      </div>
                      <span className="text-[10px] text-gray-500">{relativeTime(s.createdUtc)}</span>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-3">
                      <PluginToolbarButton icon="check" onClick={() => void commitSession(s.id)} disabled={busy}>
                        Commit
                      </PluginToolbarButton>
                      <PluginToolbarButton icon="delete" onClick={() => void discardSession(s.id)} disabled={busy}>
                        Discard
                      </PluginToolbarButton>
                      <PluginToolbarButton
                        icon="bookmark_ui"
                        onClick={() => { setExpandedSession(s.id); setActiveTab('checkpoints'); }}
                      >
                        Checkpoints
                      </PluginToolbarButton>
                    </div>
                  </PluginCard>
                ))
              )}
            </div>
          )}

          {activeTab === 'history' && (
            <div className="p-5 space-y-2">
              {sessions.length === 0 ? (
                <PluginEmptyState
                  icon="clock_ui"
                  title="No sandbox history"
                  description="Previous sandbox sessions will appear here."
                />
              ) : (
                sessions.map(s => (
                  <PluginCard key={s.id}>
                    <div className="flex items-center gap-3">
                      <Icons8Icon id={s.status === 'active' ? 'zap_ui' : 'check'} size={14}
                        className={s.status === 'active' ? 'text-emerald-400' : 'text-gray-500'} />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-white truncate">{s.name}</div>
                        <div className="bndz-mono text-[10px] text-gray-500 truncate">{s.rootPath}</div>
                      </div>
                      <span className="text-[10px] text-gray-500 shrink-0">{s.status}</span>
                      <span className="text-[10px] text-gray-600 shrink-0">{relativeTime(s.createdUtc)}</span>
                    </div>
                  </PluginCard>
                ))
              )}
            </div>
          )}

          {activeTab === 'checkpoints' && (
            <div className="p-5 space-y-4">
              {expandedSession && (
                <div className="flex items-center gap-2">
                  <input
                    className={`${PLUGIN_INPUT_CLASS} flex-1`}
                    value={cpName}
                    onChange={e => setCpName(e.target.value)}
                    placeholder="Checkpoint name…"
                    onKeyDown={e => { if (e.key === 'Enter') void createCheckpoint(expandedSession); }}
                  />
                  <PluginToolbarButton
                    icon="bookmark_ui"
                    onClick={() => void createCheckpoint(expandedSession)}
                    disabled={busy || !cpName.trim()}
                  >
                    Save
                  </PluginToolbarButton>
                </div>
              )}
              {checkpoints.length === 0 ? (
                <PluginEmptyState
                  icon="bookmark_ui"
                  title="No checkpoints"
                  description="Save named checkpoints during a sandbox session to roll back later."
                />
              ) : (
                checkpoints.map(cp => (
                  <PluginCard key={cp.id}>
                    <div className="flex items-center gap-3">
                      <Icons8Icon id="bookmark_ui" size={14} className="text-amber-400/70" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-white truncate">{cp.name}</div>
                        <div className="text-[10px] text-gray-500">{relativeTime(cp.createdUtc)}</div>
                      </div>
                      <PluginToolbarButton
                        icon="reset_ui"
                        onClick={() => void restoreCheckpoint(cp.sessionId, cp.id)}
                        disabled={busy}
                      >
                        Restore
                      </PluginToolbarButton>
                    </div>
                  </PluginCard>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </PluginPanelShell>
  );
}
