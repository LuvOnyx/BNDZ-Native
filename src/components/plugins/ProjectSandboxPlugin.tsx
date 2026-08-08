import React, { useCallback, useEffect, useState, useRef } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { EmblemIcon } from '../EmblemIcon';
import { IPC } from '../../lib/ipcBridge';
import { pushToast } from '../ToastHost';
import { toWindowsPath } from '../../lib/pathUtils';
import { formatUiPath } from '../../lib/displayPath';
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
  installOnFirstUse: true,
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

type SessionStatus = {
  pendingOpsCount: number;
  shadowSizeBytes: number;
  lastCheckpoint: { id: string; name: string; createdUtc?: string } | null;
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
  const [sessionStatus, setSessionStatus] = useState<SessionStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [cpName, setCpName] = useState('');
  const [expandedSession, setExpandedSession] = useState<string | null>(null);
  const statusPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const loadSessionStatus = useCallback(async (sessionId: string) => {
    try {
      const r = await IPC.sandboxGetStatus(sessionId);
      if (r.error) return;
      setSessionStatus({
        pendingOpsCount: r.pendingOpsCount ?? 0,
        shadowSizeBytes: r.shadowSizeBytes ?? 0,
        lastCheckpoint: r.lastCheckpoint ?? null,
      });
    } catch {
      setSessionStatus(null);
    }
  }, []);

  useEffect(() => {
    if (statusPollRef.current) clearInterval(statusPollRef.current);
    const activeSession = activeSessions[0];
    if (activeSession) {
      void loadSessionStatus(activeSession.id);
      statusPollRef.current = setInterval(() => void loadSessionStatus(activeSession.id), 8000);
    } else {
      setSessionStatus(null);
    }
    return () => { if (statusPollRef.current) clearInterval(statusPollRef.current); };
  }, [activeSessions, loadSessionStatus]);

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
      const r = await IPC.sandboxCommit(sessionId) as any;
      if (r.error) {
        const details = Array.isArray(r.details) && r.details.length > 0
          ? ` — ${r.details[0]}` : '';
        pushToast({ kind: 'error', title: 'Commit refused', message: `${r.error}${details}` });
        return;
      }
      const opsMsg = typeof r.opsProcessed === 'number' ? ` (${r.opsProcessed} ops applied)` : '';
      pushToast({ kind: 'success', title: 'Committed', message: `Sandbox changes applied to disk${opsMsg}. Shadow overlay merged via transfer queue when present.` });
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
      const r = await IPC.sandboxDiscard(sessionId) as any;
      const opsMsg = typeof r.opsProcessed === 'number' ? `${r.opsProcessed} operation(s) reversed` : 'Original files unchanged';
      if (r.error) {
        const detailStr = Array.isArray(r.details) && r.details.length > 0
          ? ` — ${r.details.slice(0, 3).join('; ')}` : '';
        pushToast({ kind: 'warning', title: 'Partial discard', message: `${opsMsg}. ${r.error}${detailStr}` });
      } else {
        pushToast({ kind: 'success', title: 'Discarded', message: `${opsMsg}.` });
      }
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
      const savedName = cpName.trim();
      setCpName('');
      pushToast({ kind: 'success', title: 'Checkpoint saved', message: savedName });
      await loadCheckpoints(sessionId);
      if (activeSessions[0]?.id === sessionId) await loadSessionStatus(sessionId);
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
      if (activeSessions[0]?.id === sessionId) await loadSessionStatus(sessionId);
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

        {/* ── Live session status bar ── */}
        {activeSessions.length > 0 && sessionStatus && (
          <div className="shrink-0 px-5 py-2.5 border-b border-white/[0.06] bg-emerald-500/[0.06]">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                  Active
                </span>
              </div>
              <div className="flex items-center gap-3 text-[10px] text-gray-400">
                <span className="inline-flex items-center gap-1">
                  <Icons8Icon id="data_transfer" size={10} className="text-emerald-400/60" />
                  <span className="font-mono font-semibold text-white">{sessionStatus.pendingOpsCount}</span> pending ops
                </span>
                <span className="text-white/10">|</span>
                <span className="inline-flex items-center gap-1">
                  <Icons8Icon id="data_backup" size={10} className="text-emerald-400/60" />
                  {formatBytes(sessionStatus.shadowSizeBytes)} shadow
                </span>
                {sessionStatus.lastCheckpoint && (
                  <>
                    <span className="text-white/10">|</span>
                    <span className="inline-flex items-center gap-1">
                      <Icons8Icon id="bookmark_ui" size={10} className="text-amber-400/60" />
                      <span className="text-amber-300/80 truncate max-w-[120px]">{sessionStatus.lastCheckpoint.name}</span>
                      <span className="text-gray-500">{relativeTime(sessionStatus.lastCheckpoint.createdUtc)}</span>
                    </span>
                  </>
                )}
              </div>
            </div>
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
                        <div className="bndz-mono text-[10px] text-gray-500 truncate">{formatUiPath(s.rootPath)}</div>
                      </div>
                      <span className="text-[10px] text-gray-500">{relativeTime(s.createdUtc)}</span>
                    </div>

                    {/* Session stats row */}
                    {sessionStatus && (
                      <div className="grid grid-cols-3 gap-2 mb-3">
                        <div className="bg-black/20 rounded-lg px-3 py-2 text-center">
                          <div className="text-sm font-bold text-white font-mono">{sessionStatus.pendingOpsCount}</div>
                          <div className="text-[9px] text-gray-500 uppercase tracking-wider mt-0.5">Operations</div>
                        </div>
                        <div className="bg-black/20 rounded-lg px-3 py-2 text-center">
                          <div className="text-sm font-bold text-white font-mono">{formatBytes(sessionStatus.shadowSizeBytes)}</div>
                          <div className="text-[9px] text-gray-500 uppercase tracking-wider mt-0.5">Shadow size</div>
                        </div>
                        <div className="bg-black/20 rounded-lg px-3 py-2 text-center">
                          <div className="text-sm font-bold text-white truncate">
                            {sessionStatus.lastCheckpoint?.name ?? '—'}
                          </div>
                          <div className="text-[9px] text-gray-500 uppercase tracking-wider mt-0.5">
                            {sessionStatus.lastCheckpoint ? `CP ${relativeTime(sessionStatus.lastCheckpoint.createdUtc)}` : 'No checkpoint'}
                          </div>
                        </div>
                      </div>
                    )}

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
                sessions.map(s => {
                  const statusStyle = s.status === 'active'
                    ? 'text-emerald-400' : s.status === 'committed'
                    ? 'text-sky-400' : s.status === 'discarded'
                    ? 'text-amber-400' : 'text-gray-500';
                  return (
                    <PluginCard key={s.id}>
                      <div className="flex items-center gap-3">
                        <Icons8Icon id={s.status === 'active' ? 'zap_ui' : s.status === 'committed' ? 'check' : 'reset_ui'} size={14}
                          className={statusStyle} />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-white truncate">{s.name}</div>
                          <div className="bndz-mono text-[10px] text-gray-500 truncate">{formatUiPath(s.rootPath)}</div>
                        </div>
                        <span className={`text-[10px] shrink-0 font-semibold uppercase tracking-wider ${statusStyle}`}>{s.status}</span>
                        <span className="text-[10px] text-gray-600 shrink-0">{relativeTime(s.createdUtc)}</span>
                      </div>
                    </PluginCard>
                  );
                })
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
