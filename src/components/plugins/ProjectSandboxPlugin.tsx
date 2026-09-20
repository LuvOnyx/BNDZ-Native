import React, { useCallback, useEffect, useState, useRef } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { EmblemIcon } from '../EmblemIcon';
import { IPC } from '../../lib/ipcBridge';
import { pushToast } from '../ToastHost';
import { toWindowsPath } from '../../lib/pathUtils';
import { formatUiPath } from '../../lib/displayPath';
import PluginPanelShell from './PluginPanelShell';
import ZkVaultPlugin from './ZkVaultPlugin';
import {
  PluginToolbarButton,
  PluginTabStrip,
  PluginTab,
  PluginEmptyState,
  PluginHeroActionButton,
  PLUGIN_INPUT_CLASS,
} from './PluginPanelPrimitives';

export const ProjectSandboxPluginDef = {
  id: 'project-sandbox',
  name: 'Project Sandbox',
  icon: 'layers_ui',
  description: 'Safe work folders with restore points and optional locked vaults',
  targetPanel: 'bottom' as const,
  installOnFirstUse: false,
};

type TabId = 'active' | 'history' | 'checkpoints' | 'vault';

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
  selectedPaths,
  pluginLaunch,
}: {
  selectedPaths?: string[];
  currentPath?: string;
  pluginLaunch?: { tab?: string } | null;
}) {
  const [activeTab, setActiveTab] = useState<TabId>('active');

  React.useEffect(() => {
    const tab = String(pluginLaunch?.tab || '').toLowerCase();
    if (tab === 'vault' || tab === 'zk-vault' || tab === 'zk') setActiveTab('vault');
  }, [pluginLaunch?.tab]);
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
          ? ` -- ${r.details[0]}` : '';
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
          ? ` -- ${r.details.slice(0, 3).join('; ')}` : '';
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
    { id: 'vault', label: 'Vault', icon: 'lock_ui' },
  ];

  const primary = activeSessions[0] ?? null;

  return (
    <PluginPanelShell
      title="Project Sandbox"
      icon="layers_ui"
      iconColor="#34d399"
      variant="embedded"
      subtitle="Safe work folders | restore points | locked vault"
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
      <div className="flex flex-col min-h-0 h-full bndz-sandbox-root">
        {activeTab === 'vault' ? (
          <div className="flex-1 min-h-0 overflow-hidden">
            <ZkVaultPlugin currentPath={currentPath} selectedPaths={selectedPaths} embedded />
          </div>
        ) : (
          <>
            <div className="bndz-sandbox-rail">
              <div className="bndz-sandbox-rail-mark" aria-hidden>
                <EmblemIcon id="emblem-documents" size={36} />
              </div>
              <div className="bndz-sandbox-rail-copy min-w-0">
                <div className="bndz-sandbox-rail-title">
                  {primary ? primary.name : 'No live session'}
                </div>
                <div className="bndz-sandbox-rail-path" title={primary ? formatUiPath(primary.rootPath) : currentPath || ''}>
                  {primary
                    ? formatUiPath(primary.rootPath)
                    : (currentPath && currentPath !== '/'
                      ? formatUiPath(toWindowsPath(currentPath))
                      : 'Open a folder, then start a sandbox')}
                </div>
              </div>
              <div className="bndz-sandbox-rail-actions">
                <PluginHeroActionButton
                  icon="plus_ui"
                  variant="primary"
                  onClick={() => void startSession()}
                  disabled={busy}
                >
                  Start
                </PluginHeroActionButton>
                <PluginToolbarButton icon="refresh_ui" title="Refresh" onClick={() => void refresh()} disabled={busy} />
              </div>
            </div>

            {primary && sessionStatus && (
              <div className="bndz-sandbox-live" role="status">
                <span className="bndz-sandbox-live-dot" />
                <span className="bndz-sandbox-live-label">Live</span>
                <span className="bndz-sandbox-live-metric">
                  <Icons8Icon id="data_transfer" size={10} />
                  <strong>{sessionStatus.pendingOpsCount}</strong> ops
                </span>
                <span className="bndz-sandbox-live-metric">
                  <Icons8Icon id="data_backup" size={10} />
                  {formatBytes(sessionStatus.shadowSizeBytes)} shadow
                </span>
                {sessionStatus.lastCheckpoint ? (
                  <span className="bndz-sandbox-live-metric">
                    <Icons8Icon id="bookmark_ui" size={10} />
                    <span className="truncate max-w-[140px]">{sessionStatus.lastCheckpoint.name}</span>
                    <em>{relativeTime(sessionStatus.lastCheckpoint.createdUtc)}</em>
                  </span>
                ) : null}
              </div>
            )}

            <div className="flex-1 min-h-0 overflow-y-auto bndz-scrollbar">
              {activeTab === 'active' && (
                <div className="bndz-sandbox-pad">
                  {!primary ? (
                    <PluginEmptyState
                      icon="layers_ui"
                      title="No active sandboxes"
                      description="Start a sandbox on the current folder to experiment safely. Commit when ready, or discard to revert."
                    />
                  ) : (
                    <article className="bndz-sandbox-stage">
                      <header className="bndz-sandbox-stage-head">
                        <div className="min-w-0">
                          <div className="bndz-sandbox-stage-name">{primary.name}</div>
                          <div className="bndz-sandbox-stage-meta">
                            Started {relativeTime(primary.createdUtc) || '--'}
                            {typeof primary.fileCount === 'number' && primary.fileCount > 0
                              ? ` | ${primary.fileCount.toLocaleString()} files`
                              : ''}
                          </div>
                        </div>
                      </header>
                      <div className="bndz-sandbox-stage-actions">
                        <button
                          type="button"
                          className="bndz-sandbox-btn bndz-sandbox-btn-primary"
                          disabled={busy}
                          onClick={() => void commitSession(primary.id)}
                        >
                          <Icons8Icon id="check" size={12} /> Commit
                        </button>
                        <button
                          type="button"
                          className="bndz-sandbox-btn"
                          disabled={busy}
                          onClick={() => void discardSession(primary.id)}
                        >
                          <Icons8Icon id="delete" size={12} /> Discard
                        </button>
                        <button
                          type="button"
                          className="bndz-sandbox-btn bndz-sandbox-btn-quiet"
                          onClick={() => { setExpandedSession(primary.id); setActiveTab('checkpoints'); }}
                        >
                          <Icons8Icon id="bookmark_ui" size={12} /> Checkpoints
                        </button>
                      </div>
                    </article>
                  )}
                </div>
              )}

              {activeTab === 'history' && (
                <div className="bndz-sandbox-pad">
                  {sessions.length === 0 ? (
                    <PluginEmptyState
                      icon="clock_ui"
                      title="No sandbox history"
                      description="Previous sandbox sessions will appear here."
                    />
                  ) : (
                    <ol className="bndz-sandbox-timeline">
                      {sessions.map((s, i) => {
                        const tone = s.status === 'active'
                          ? 'is-live' : s.status === 'committed'
                          ? 'is-ok' : s.status === 'discarded'
                          ? 'is-warn' : '';
                        return (
                          <li key={s.id} className={`bndz-sandbox-tl-node ${tone}`}>
                            <div className="bndz-sandbox-tl-rail" aria-hidden>
                              <span className="bndz-sandbox-tl-dot" />
                              {i < sessions.length - 1 ? <span className="bndz-sandbox-tl-line" /> : null}
                            </div>
                            <div className="bndz-sandbox-tl-body">
                              <div className="bndz-sandbox-tl-row">
                                <span className="bndz-sandbox-tl-name">{s.name}</span>
                                <span className={`bndz-sandbox-tl-status ${tone}`}>{s.status}</span>
                                <span className="bndz-sandbox-tl-when">{relativeTime(s.createdUtc)}</span>
                              </div>
                              <div className="bndz-sandbox-tl-path" title={formatUiPath(s.rootPath)}>
                                {formatUiPath(s.rootPath)}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </div>
              )}

              {activeTab === 'checkpoints' && (
                <div className="bndz-sandbox-pad">
                  {expandedSession && (
                    <div className="bndz-sandbox-composer">
                      <input
                        className={`${PLUGIN_INPUT_CLASS} flex-1 bndz-sandbox-composer-input`}
                        value={cpName}
                        onChange={e => setCpName(e.target.value)}
                        placeholder="Name this restore point..."
                        onKeyDown={e => { if (e.key === 'Enter') void createCheckpoint(expandedSession); }}
                      />
                      <button
                        type="button"
                        className="bndz-sandbox-btn bndz-sandbox-btn-primary"
                        disabled={busy || !cpName.trim()}
                        onClick={() => void createCheckpoint(expandedSession)}
                      >
                        <Icons8Icon id="bookmark_ui" size={12} /> Save
                      </button>
                    </div>
                  )}
                  {checkpoints.length === 0 ? (
                    <PluginEmptyState
                      icon="bookmark_ui"
                      title="No checkpoints"
                      description="Save named checkpoints during a sandbox session to roll back later."
                    />
                  ) : (
                    <ol className="bndz-sandbox-cp-rail">
                      {checkpoints.map(cp => (
                        <li key={cp.id} className="bndz-sandbox-cp-strip">
                          <Icons8Icon id="bookmark_ui" size={14} className="text-amber-400/80 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <div className="bndz-sandbox-cp-name">{cp.name}</div>
                            <div className="bndz-sandbox-cp-when">{relativeTime(cp.createdUtc)}</div>
                          </div>
                          <button
                            type="button"
                            className="bndz-sandbox-btn"
                            disabled={busy}
                            onClick={() => void restoreCheckpoint(cp.sessionId, cp.id)}
                          >
                            <Icons8Icon id="reset_ui" size={12} /> Restore
                          </button>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </PluginPanelShell>
  );
}
