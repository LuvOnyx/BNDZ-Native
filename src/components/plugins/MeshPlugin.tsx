import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { IPC } from '../../lib/ipcBridge';
import { formatUiPath } from '../../lib/displayPath';
import { isMeshPath, parseMeshPath } from '../../lib/meshPaths';
import MeshHostsManager from '../mesh/MeshHostsManager';
import MeshBucketsSharesPanel from '../mesh/MeshBucketsSharesPanel';
import MeshEphemeralPanel from '../mesh/MeshEphemeralPanel';
import { Icons8Icon } from '../Icons8Icon';
import PluginPanelShell from './PluginPanelShell';
import {
  PluginToolbarButton, PluginCard, PluginFieldLabel,
  PluginEmptyState, PLUGIN_INPUT_CLASS,
} from './PluginPanelPrimitives';
import { type MeshSyncRule, type MeshHost, normalizeMeshHost } from '../../lib/meshTypes';
import type { BottomPluginLaunchContext } from '../BottomPluginPanel';

function MeshTerminalPanel({ sessionId, active }: { sessionId: string | null; active: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current || termRef.current) return;
    const term = new Terminal({
      theme: {
        background: '#07090e',
        foreground: '#d8dee9',
        cursor: '#7dd3fc',
        selectionBackground: 'rgba(56,189,248,0.28)',
      },
      fontFamily: 'JetBrains Mono, Cascadia Mono, Consolas, monospace',
      fontSize: 12,
      cursorBlink: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;
    term.onData(data => {
      if (!sessionId) return;
      IPC.meshTerminalInput(sessionId, btoa(unescape(encodeURIComponent(data))));
    });
    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
          fit.fit();
          if (sessionId) {
            IPC.meshTerminalResize(sessionId, term.cols, term.rows);
          }
        })
      : null;
    ro?.observe(containerRef.current);
    return () => {
      ro?.disconnect();
      term.dispose();
      termRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!active || !sessionId) return;
    requestAnimationFrame(() => {
      fitRef.current?.fit();
      const term = termRef.current;
      if (term) IPC.meshTerminalResize(sessionId, term.cols, term.rows);
    });
  }, [active, sessionId]);

  useEffect(() => {
    return IPC.onMeshTerminalOutput(({ sessionId: sid, data }) => {
      if (!sessionId || sid !== sessionId || !termRef.current) return;
      const bin = atob(data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      termRef.current.write(bytes);
    });
  }, [sessionId]);

  return <div ref={containerRef} className="w-full h-full min-h-[200px] bndz-mesh-terminal" />;
}

export const MeshPluginDef = {
  id: 'remote-mesh',
  name: 'Remote Mesh',
  icon: 'cloud_ui',
  targetPanel: 'bottom' as const,
  installOnFirstUse: false,
};

type Props = {
  onNavigate?: (path: string) => void;
  currentPath?: string;
  pluginLaunch?: BottomPluginLaunchContext | null;
};

export default function MeshPlugin({ onNavigate, currentPath, pluginLaunch }: Props) {
  const [tab, setTab] = useState<'buckets' | 'hosts' | 'ephemeral' | 'mirror' | 'terminal' | 'liveshare'>('hosts');
  const [hosts, setHosts] = useState<MeshHost[]>([]);
  const [rules, setRules] = useState<MeshSyncRule[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [selectedHostId, setSelectedHostId] = useState<string | null>(null);
  const [liveShareOn, setLiveShareOn] = useState(false);
  const [livePeers, setLivePeers] = useState<any[]>([]);

  const refreshRules = useCallback(async () => {
    const [h, r] = await Promise.all([IPC.meshListHosts(), IPC.meshGetSyncRules()]);
    setHosts((h as Record<string, unknown>[]).map(normalizeMeshHost));
    setRules(r as MeshSyncRule[]);
  }, []);

  useEffect(() => { void refreshRules(); }, [refreshRules]);

  useEffect(() => {
    if (!pluginLaunch) return;
    if (pluginLaunch.tab === 'terminal') setTab('terminal');
    if (pluginLaunch.tab === 'ephemeral') setTab('ephemeral');
    if (pluginLaunch.tab === 'hosts') setTab('hosts');
    if (pluginLaunch.tab === 'mirror') setTab('mirror');
    if (pluginLaunch.tab === 'liveshare') setTab('liveshare');
    if (pluginLaunch.tab === 'buckets') setTab('buckets');
    if (pluginLaunch.sessionId) setSessionId(pluginLaunch.sessionId);
    if (pluginLaunch.hostId) setSelectedHostId(pluginLaunch.hostId);
  }, [pluginLaunch]);

  useEffect(() => {
    return IPC.onMeshSyncProgress(p => {
      setStatus(`${p.status}${p.currentFile ? ` — ${p.currentFile}` : ''}${p.message ? ` (${p.message})` : ''}`);
    });
  }, []);

  useEffect(() => {
    return IPC.onMeshHostsChanged((list) => {
      setHosts((list as Record<string, unknown>[]).map(normalizeMeshHost));
    });
  }, []);

  useEffect(() => {
    if (!liveShareOn || !currentPath || currentPath.startsWith('/mesh')) return;
    const win = currentPath.replace(/^\//, '').replace(/\//g, '\\');
    const poll = window.setInterval(() => {
      void IPC.liveShareGetPeers(win).then(r => setLivePeers(r.peers || []));
    }, 900);
    return () => window.clearInterval(poll);
  }, [liveShareOn, currentPath]);

  const toggleLiveShare = async () => {
    if (!currentPath || currentPath.startsWith('/mesh')) {
      setStatus('Open a local folder to share cursor state.');
      return;
    }
    const win = currentPath.replace(/^\//, '').replace(/\//g, '\\');
    setBusy(true);
    try {
      if (liveShareOn) {
        await IPC.liveShareStop(win);
        setLiveShareOn(false);
        setLivePeers([]);
        setStatus('Live Share stopped.');
        window.dispatchEvent(new CustomEvent('bndz-live-share-changed', { detail: { active: false } }));
      } else {
        await IPC.liveShareStart(win);
        setLiveShareOn(true);
        setStatus('Live Share active — peers see your selection in this folder.');
        window.dispatchEvent(new CustomEvent('bndz-live-share-changed', { detail: { active: true } }));
      }
    } finally { setBusy(false); }
  };

  const openTerminal = async (hostId?: string, local = false) => {
    setBusy(true);
    try {
      let cwd: string | undefined;
      if (local) {
        cwd = currentPath && !isMeshPath(currentPath) ? currentPath : undefined;
      } else if (currentPath && isMeshPath(currentPath)) {
        const parsed = parseMeshPath(currentPath);
        if (parsed.hostId && (!hostId || parsed.hostId === hostId)) {
          hostId = parsed.hostId;
          cwd = parsed.remotePath || '/';
        }
      }
      const session = await IPC.meshTerminalOpen({ hostId, local, cwd });
      if (session?.error) {
        setStatus(session.error);
        return;
      }
      setSessionId(session.id || session.Id);
      setTab('terminal');
      setStatus(local ? 'Local PowerShell' : `SSH — ${hostId}${cwd ? ` @ ${cwd}` : ''}`);
    } catch (e: any) {
      setStatus(e?.message || 'Terminal failed to open');
    } finally { setBusy(false); }
  };

  const addRule = () => {
    const hostId = selectedHostId || hosts[0]?.id || '';
    setRules(prev => [...prev, {
      id: `rule-${Date.now()}`,
      name: 'Deploy mirror',
      localPath: '',
      remoteHostId: hostId,
      remotePath: '/',
      pushOnSave: true,
      debounceMs: 800,
      enabled: true,
      excludeGlob: '',
    }]);
  };

  const saveRules = async () => {
    setBusy(true);
    try {
      await IPC.meshSaveSyncRules(rules);
      setStatus('Mirror rules saved');
    } finally { setBusy(false); }
  };

  const meshBrowseHint = currentPath && isMeshPath(currentPath)
    ? (() => {
        const { hostId, remotePath } = parseMeshPath(currentPath);
        return hostId ? `${hostId}:${remotePath || '/'}` : null;
      })()
    : null;

  return (
    <PluginPanelShell
      title="Remote Mesh"
      icon="cloud_ui"
      iconColor="#38bdf8"
      subtitle="FileSSH-class SSH/SFTP · Incus ephemeral VPS · parallel transfers · Shell Here · mirrors · Mesh Drop"
      variant="embedded"
      toolbar={
        <>
          {meshBrowseHint && (
            <PluginToolbarButton onClick={() => void openTerminal()}>
              <Icons8Icon id="terminal" size={12} /> Shell Here
            </PluginToolbarButton>
          )}
          <PluginToolbarButton onClick={() => {
            window.dispatchEvent(new CustomEvent('bndz-open-configuration', { detail: { tab: 'Workspace Tools' } }));
          }}>
            <Icons8Icon id="config" size={12} /> Settings
          </PluginToolbarButton>
        </>
      }
      status={status && <span className="text-xs text-sky-200/80 bndz-mesh-status-pulse">{status}</span>}
    >
      <div className="flex flex-col h-full min-h-0 bndz-mesh-surface">
        <div className="bndz-mesh-tabrail flex gap-1 px-3 pt-2 shrink-0 flex-wrap">
          {([
            ['hosts', 'Hosts'],
            ['ephemeral', 'Ephemeral'],
            ['buckets', 'Buckets & Shares'],
            ['mirror', 'Mirror'],
            ['terminal', 'Terminal'],
            ['liveshare', 'Live Share'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`bndz-mesh-tab ${tab === id ? 'is-active' : ''}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto bndz-scrollbar p-3">
          {tab === 'buckets' && (
            <MeshBucketsSharesPanel
              onNavigate={onNavigate}
              onStatus={setStatus}
            />
          )}

          {tab === 'hosts' && (
            <MeshHostsManager
              onNavigate={onNavigate}
              onStatus={setStatus}
              showHero
            />
          )}

          {tab === 'ephemeral' && (
            <MeshEphemeralPanel
              onNavigate={onNavigate}
              onStatus={setStatus}
            />
          )}

          {tab === 'mirror' && (
            <div className="space-y-3">
              <div className="flex gap-2 flex-wrap">
                <PluginToolbarButton onClick={addRule}>Add rule</PluginToolbarButton>
                <PluginToolbarButton onClick={() => void saveRules()} disabled={busy}>Save rules</PluginToolbarButton>
              </div>
              {rules.length === 0 ? (
                <PluginEmptyState icon="sync_folders" title="No mirror rules" description="Push local folders to remote hosts on save — ideal for instant deploys." />
              ) : rules.map((r, i) => (
                <PluginCard key={r.id} className="!p-3 grid gap-2 bndz-mesh-mirror-card">
                  <PluginFieldLabel>Name</PluginFieldLabel>
                  <input className={PLUGIN_INPUT_CLASS} value={r.name} onChange={e => setRules(prev => prev.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                  <PluginFieldLabel>Local folder</PluginFieldLabel>
                  <input className={PLUGIN_INPUT_CLASS} value={r.localPath} placeholder="C:\Projects\app" onChange={e => setRules(prev => prev.map((x, j) => j === i ? { ...x, localPath: e.target.value } : x))} />
                  <PluginFieldLabel>Remote host</PluginFieldLabel>
                  <select className={PLUGIN_INPUT_CLASS} value={r.remoteHostId} onChange={e => setRules(prev => prev.map((x, j) => j === i ? { ...x, remoteHostId: e.target.value } : x))}>
                    {hosts.map(h => <option key={h.id} value={h.id}>{h.alias}</option>)}
                  </select>
                  <PluginFieldLabel>Remote path</PluginFieldLabel>
                  <div className="flex gap-1.5">
                    <input className={`flex-1 ${PLUGIN_INPUT_CLASS}`} value={r.remotePath} onChange={e => setRules(prev => prev.map((x, j) => j === i ? { ...x, remotePath: e.target.value } : x))} />
                    <PluginToolbarButton
                      onClick={() => {
                        if (currentPath && isMeshPath(currentPath)) {
                          const { remotePath } = parseMeshPath(currentPath);
                          setRules(prev => prev.map((x, j) => j === i ? { ...x, remotePath: remotePath || '/' } : x));
                        }
                      }}
                    >
                      Use browse path
                    </PluginToolbarButton>
                  </div>
                  <PluginFieldLabel>Exclude globs (; separated)</PluginFieldLabel>
                  <input
                    className={PLUGIN_INPUT_CLASS}
                    value={r.excludeGlob || ''}
                    placeholder="*.tmp; node_modules; .git"
                    onChange={e => setRules(prev => prev.map((x, j) => j === i ? { ...x, excludeGlob: e.target.value } : x))}
                  />
                  <PluginFieldLabel>Include globs (optional)</PluginFieldLabel>
                  <input
                    className={PLUGIN_INPUT_CLASS}
                    value={r.includeGlob || ''}
                    placeholder="*.ts; *.tsx"
                    onChange={e => setRules(prev => prev.map((x, j) => j === i ? { ...x, includeGlob: e.target.value } : x))}
                  />
                  <div className="flex gap-2 items-center flex-wrap">
                    <label className="flex items-center gap-1.5 text-xs text-gray-400">
                      <input type="checkbox" checked={r.pushOnSave} onChange={e => setRules(prev => prev.map((x, j) => j === i ? { ...x, pushOnSave: e.target.checked } : x))} />
                      Push on save
                    </label>
                    <PluginToolbarButton onClick={() => void IPC.meshRunSync(r.id)} disabled={busy}>Run now</PluginToolbarButton>
                  </div>
                </PluginCard>
              ))}
            </div>
          )}

          {tab === 'terminal' && (
            <div className="flex flex-col h-full min-h-[280px] gap-2">
              <div className="flex gap-2 shrink-0 flex-wrap">
                <PluginToolbarButton onClick={() => void openTerminal(undefined, true)} disabled={busy}>
                  Local PowerShell
                </PluginToolbarButton>
                {hosts.filter(h => h.provider === 0).map(h => (
                  <PluginToolbarButton key={h.id} onClick={() => { setSelectedHostId(h.id); void openTerminal(h.id); }} disabled={busy}>
                    SSH · {h.alias}
                  </PluginToolbarButton>
                ))}
                {meshBrowseHint && (
                  <PluginToolbarButton onClick={() => void openTerminal()} disabled={busy}>
                    Shell Here · {meshBrowseHint}
                  </PluginToolbarButton>
                )}
                {sessionId && (
                  <PluginToolbarButton onClick={() => { IPC.meshTerminalClose(sessionId); setSessionId(null); }}>
                    Close session
                  </PluginToolbarButton>
                )}
              </div>
              <div className="flex-1 min-h-0 border border-sky-400/15 rounded-[18px] overflow-hidden bg-[#07090e] bndz-mesh-terminal-frame">
                {sessionId ? (
                  <MeshTerminalPanel sessionId={sessionId} active={tab === 'terminal'} />
                ) : (
                  <div className="flex items-center justify-center h-full text-xs text-gray-500 p-6 text-center">
                    Open a local PowerShell or SSH session. Browse a /mesh folder and use Shell Here to land in that remote path.
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'liveshare' && (
            <div className="space-y-3">
              <PluginCard className="!p-4 bndz-mesh-liveshare-card">
                <h3 className="text-sm font-semibold text-gray-100 mb-1">Live Share Cursor</h3>
                <p className="text-[11px] text-white/45 mb-3 leading-relaxed">
                  Peers browsing the same shared folder see your selection and cursor path highlighted in the list.
                  State is broadcast via local mesh files under %LocalAppData%\BNDZ\LiveShare.
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <PluginToolbarButton onClick={() => void toggleLiveShare()} disabled={busy}>
                    {liveShareOn ? 'Stop Live Share' : 'Start Live Share'}
                  </PluginToolbarButton>
                  {currentPath && !currentPath.startsWith('/mesh') && (
                    <span className="text-[10px] text-sky-300/70 bndz-mono truncate max-w-[280px]" title={formatUiPath(currentPath)}>
                      Folder: {formatUiPath(currentPath)}
                    </span>
                  )}
                </div>
              </PluginCard>
              {liveShareOn && (
                <div className="space-y-2">
                  <PluginFieldLabel>Active peers</PluginFieldLabel>
                  {livePeers.length === 0 ? (
                    <PluginEmptyState icon="users_ui" title="No peers yet" description="Other BNDZ instances in the same shared folder will appear here." />
                  ) : livePeers.map(p => (
                    <PluginCard key={p.peerId} className="!p-2.5 text-[11px]">
                      <div className="font-medium text-sky-200">{p.machineName || 'Peer'}</div>
                      <div className="text-white/40 mt-1">
                        {p.selectionPaths?.length || 0} selected
                        {p.cursorPath ? ` · cursor: ${String(p.cursorPath).split(/[/\\]/).pop()}` : ''}
                      </div>
                    </PluginCard>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </PluginPanelShell>
  );
}
