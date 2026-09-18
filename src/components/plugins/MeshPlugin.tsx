import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { IPC } from '../../lib/ipcBridge';
import { formatUiPath } from '../../lib/displayPath';
import { isMeshPath, parseMeshPath } from '../../lib/meshPaths';
import { toWindowsPath } from '../../lib/pathUtils';
import MeshHostsManager from '../mesh/MeshHostsManager';
import MeshBucketsSharesPanel from '../mesh/MeshBucketsSharesPanel';
import MeshEphemeralPanel from '../mesh/MeshEphemeralPanel';
import MeshDropPanel from '../meshdrop/MeshDropPanel';
import { Icons8Icon } from '../Icons8Icon';
import PluginPanelShell from './PluginPanelShell';
import {
  PluginToolbarButton, PluginCard, PluginFieldLabel,
  PluginEmptyState, PLUGIN_INPUT_CLASS,
} from './PluginPanelPrimitives';
import { type MeshSyncRule, type MeshHost, normalizeMeshHost } from '../../lib/meshTypes';
import type { BottomPluginLaunchContext } from '../BottomPluginPanel';

function decodeTerminalB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function encodeTerminalUtf8ToB64(data: string): string {
  // Prefer TextEncoder — unescape(encodeURIComponent) can mangle some VT sequences in WebView2.
  const bytes = new TextEncoder().encode(data);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

/** Survives MeshSshTerminalPanel remounts — ConPTY often emits before React commits sessionId. */
const meshTerminalOrphanChunks = new Map<string, string[]>();
type MeshTermWriter = (sid: string, data: string) => boolean;
const meshTermWriters = new Set<MeshTermWriter>();
let meshTermOutputHubUnsub: (() => void) | null = null;

function pushMeshTerminalOrphan(sid: string, b64: string) {
  const list = meshTerminalOrphanChunks.get(sid) ?? [];
  list.push(b64);
  if (list.length > 400) list.splice(0, list.length - 400);
  meshTerminalOrphanChunks.set(sid, list);
}

function takeMeshTerminalOrphans(sid: string): string[] {
  const chunks = meshTerminalOrphanChunks.get(sid) ?? [];
  meshTerminalOrphanChunks.delete(sid);
  return chunks;
}

function ensureMeshTerminalOutputHub() {
  if (meshTermOutputHubUnsub) return;
  meshTermOutputHubUnsub = IPC.onMeshTerminalOutput((payload) => {
    const sid = payload?.sessionId || (payload as { SessionId?: string })?.SessionId;
    const data = payload?.data || (payload as { Data?: string })?.Data;
    if (!sid || !data) return;
    for (const write of meshTermWriters) {
      if (write(sid, data)) return;
    }
    pushMeshTerminalOrphan(sid, data);
  });
}

function MeshSshTerminalPanel({ sessionId, active }: { sessionId: string | null; active: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const readyResolveRef = useRef<((term: Terminal) => void) | null>(null);
  const readyPromiseRef = useRef<Promise<Terminal> | null>(null);

  if (!readyPromiseRef.current) {
    readyPromiseRef.current = new Promise<Terminal>(resolve => {
      readyResolveRef.current = resolve;
    });
  }

  const writeBytes = useCallback((bytes: Uint8Array) => {
    termRef.current?.write(bytes);
  }, []);

  const flushOrphans = useCallback((sid: string) => {
    const chunks = takeMeshTerminalOrphans(sid);
    if (!chunks.length) return;
    const term = termRef.current;
    if (!term) {
      for (const b64 of chunks) pushMeshTerminalOrphan(sid, b64);
      return;
    }
    for (const b64 of chunks) term.write(decodeTerminalB64(b64));
  }, []);

  const fitAndResize = useCallback(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    const el = containerRef.current;
    if (!term || !fit || !el) return;
    if (el.clientWidth < 8 || el.clientHeight < 8) return;
    try { fit.fit(); } catch { /* ignore */ }
    const current = sessionIdRef.current;
    if (current && term.cols > 0 && term.rows > 0) {
      IPC.meshTerminalResize(current, term.cols, term.rows);
    }
  }, []);

  const scheduleFit = useCallback(() => {
    // Fit after flex/layout settles so ConPTY rows match the visible hole, not under chrome.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        fitAndResize();
        window.setTimeout(fitAndResize, 48);
        window.setTimeout(fitAndResize, 160);
      });
    });
  }, [fitAndResize]);

  useEffect(() => {
    const host = containerRef.current;
    if (!host || termRef.current) return;
    const term = new Terminal({
      theme: {
        background: '#07090e',
        foreground: '#d8dee9',
        cursor: '#7dd3fc',
        selectionBackground: 'rgba(56,189,248,0.28)',
      },
      fontFamily: 'Cascadia Mono, JetBrains Mono, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      // Leave false — ConPTY already speaks CRLF/VT; convertEol can desync the DA handshake paint.
      convertEol: false,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    termRef.current = term;
    fitRef.current = fit;
    try { fit.fit(); } catch { /* ignore */ }
    readyResolveRef.current?.(term);
    const sid = sessionIdRef.current;
    if (sid) flushOrphans(sid);
    term.onData(data => {
      const current = sessionIdRef.current;
      if (!current) return;
      try {
        IPC.meshTerminalInput(current, encodeTerminalUtf8ToB64(data));
      } catch { /* ignore */ }
    });
    // Click / focus so keys aren't swallowed by the file list.
    const focusTerm = () => { try { term.focus(); } catch { /* ignore */ } };
    host.addEventListener('pointerdown', focusTerm);
    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => scheduleFit())
      : null;
    ro?.observe(host);
    scheduleFit();
    return () => {
      ro?.disconnect();
      host.removeEventListener('pointerdown', focusTerm);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      readyPromiseRef.current = new Promise<Terminal>(resolve => {
        readyResolveRef.current = resolve;
      });
    };
  }, [flushOrphans, scheduleFit]);

  useEffect(() => {
    if (!active) return;
    scheduleFit();
    try { termRef.current?.focus(); } catch { /* ignore */ }
  }, [active, sessionId, scheduleFit]);

  useEffect(() => {
    ensureMeshTerminalOutputHub();
    const writer: MeshTermWriter = (sid, data) => {
      if (sid !== sessionIdRef.current || !termRef.current) return false;
      writeBytes(decodeTerminalB64(data));
      return true;
    };
    meshTermWriters.add(writer);
    return () => { meshTermWriters.delete(writer); };
  }, [writeBytes]);

  useEffect(() => {
    const term = termRef.current;
    if (!term || !sessionId) return;
    // Attach order (Windows Terminal / VS Code model):
    // 1) bind sessionId so onData DA replies route to ConPTY
    // 2) ACK host → flush buffered ConPTY handshake bytes into xterm
    // 3) fit + resize so WINSIZE matches the visible hole
    flushOrphans(sessionId);
    IPC.meshTerminalAck(sessionId);
    scheduleFit();
    try { term.focus(); } catch { /* ignore */ }
    // Second ACK after fit settles — covers any bytes that arrived between flush and resize.
    const t = window.setTimeout(() => {
      IPC.meshTerminalAck(sessionId);
      fitAndResize();
    }, 32);
    return () => window.clearTimeout(t);
  }, [sessionId, flushOrphans, scheduleFit, fitAndResize]);

  // Expose geometry helper for openTerminal (real FitAddon cols/rows, not CSS guesses).
  useEffect(() => {
    (window as any).__bndzMeshTermReady = async () => {
      const term = termRef.current ?? await readyPromiseRef.current;
      const fit = fitRef.current;
      const el = containerRef.current;
      if (fit && el && el.clientWidth > 8) {
        try { fit.fit(); } catch { /* ignore */ }
      }
      return {
        cols: Math.max(40, term?.cols || 120),
        rows: Math.max(12, term?.rows || 30),
      };
    };
    return () => {
      delete (window as any).__bndzMeshTermReady;
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 w-full h-full bndz-mesh-terminal"
      tabIndex={0}
      role="application"
      aria-label="Terminal"
    />
  );
}

function MeshTerminalPanel({
  sessionId,
  active,
}: {
  sessionId: string | null;
  active: boolean;
}) {
  return <MeshSshTerminalPanel sessionId={sessionId} active={active} />;
}

export const MeshPluginDef = {
  id: 'remote-mesh',
  name: 'Remote',
  icon: 'cloud_ui',
  targetPanel: 'bottom' as const,
  installOnFirstUse: false,
};

type Props = {
  onNavigate?: (path: string) => void;
  currentPath?: string;
  pluginLaunch?: BottomPluginLaunchContext | null;
  selectedPaths?: string[];
};

export default function MeshPlugin({ onNavigate, currentPath, pluginLaunch, selectedPaths }: Props) {
  const [tab, setTab] = useState<'buckets' | 'hosts' | 'ephemeral' | 'drop' | 'mirror' | 'terminal' | 'liveshare'>('hosts');
  const [hosts, setHosts] = useState<MeshHost[]>([]);
  const [rules, setRules] = useState<MeshSyncRule[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionLabel, setSessionLabel] = useState<string | null>(null);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [selectedHostId, setSelectedHostId] = useState<string | null>(null);
  const [liveShareOn, setLiveShareOn] = useState(false);
  const [livePeers, setLivePeers] = useState<any[]>([]);

  const refreshRules = useCallback(async () => {
    const [h, r] = await Promise.all([IPC.meshListHosts(), IPC.meshGetSyncRules()]);
    setHosts((h as Record<string, unknown>[]).map(normalizeMeshHost));
    setRules(r as MeshSyncRule[]);
  }, []);

  useEffect(() => { void refreshRules(); }, [refreshRules]);

  // Buffer ConPTY/SSH output even before the Terminal tab mounts xterm.
  useEffect(() => {
    ensureMeshTerminalOutputHub();
  }, []);

  useEffect(() => {
    if (!pluginLaunch) return;
    if (pluginLaunch.tab === 'terminal') setTab('terminal');
    if (pluginLaunch.tab === 'ephemeral') setTab('ephemeral');
    if (pluginLaunch.tab === 'hosts') setTab('hosts');
    if (pluginLaunch.tab === 'drop' || pluginLaunch.tab === 'mesh-drop') setTab('drop');
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

  const closeTerminalSession = useCallback(() => {
    if (sessionId) {
      IPC.meshTerminalClose(sessionId);
    }
    setSessionId(null);
    setSessionLabel(null);
  }, [sessionId]);

  const openTerminal = useCallback(async (hostId?: string, local = false) => {
    setBusy(true);
    setTab('terminal');
    setNewMenuOpen(false);
    try {
      let cwd: string | undefined;
      let label = 'Local';

      if (local) {
        const launchCwd = pluginLaunch?.cwd ? String(pluginLaunch.cwd).trim() : '';
        cwd = launchCwd
          ? toWindowsPath(launchCwd)
          : (currentPath && !isMeshPath(currentPath) ? toWindowsPath(currentPath) : undefined);
        label = cwd ? `Local · ${cwd}` : 'Local';
      } else if (currentPath && isMeshPath(currentPath)) {
        const parsed = parseMeshPath(currentPath);
        if (parsed.hostId && (!hostId || parsed.hostId === hostId)) {
          hostId = parsed.hostId;
          cwd = parsed.remotePath || '/';
        }
      }

      if (!local && hostId) {
        const host = hosts.find(h => h.id === hostId);
        label = host ? `SSH · ${host.alias}` : `SSH · ${hostId}`;
        const conn = await IPC.meshConnect(hostId);
        if (conn?.error) {
          setStatus(String(conn.error));
          return;
        }
      }

      // ConPTY (local) / SSH.NET → xterm.js — same path on BNDZShell and classic.
      // Do NOT use WinUI EasyTerminalControl HWND overlay over WebView2 (freezes UI + Close).
      let cols = 120;
      let rows = 30;
      for (let i = 0; i < 24; i++) {
        await new Promise<void>(r => requestAnimationFrame(() => r()));
        const ready = (window as any).__bndzMeshTermReady as undefined | (() => Promise<{ cols: number; rows: number }>);
        if (ready) {
          try {
            const geo = await ready();
            cols = geo.cols;
            rows = geo.rows;
            break;
          } catch { /* keep trying */ }
        }
      }
      if (sessionId) IPC.meshTerminalClose(sessionId);
      const session = await IPC.meshTerminalOpen({
        hostId,
        local,
        cwd,
        cols,
        rows,
      });
      if (session?.error) {
        setStatus(session.error);
        return;
      }
      const sid = session.id || session.Id || session.sessionId;
      if (!sid) {
        setStatus('Terminal opened but session id was missing');
        return;
      }
      setSessionId(sid);
      setSessionLabel(label);
      setStatus(local ? 'Local PowerShell' : `SSH — ${hostId}${cwd ? ` @ ${cwd}` : ''}`);
    } catch (e: any) {
      setStatus(e?.message || 'Terminal failed to open');
    } finally { setBusy(false); }
  }, [currentPath, hosts, pluginLaunch?.cwd, sessionId]);

  // First visit to Terminal tab → open Local so the prompt paints without an extra click.
  const autoLocalOpenedRef = useRef(false);
  useEffect(() => {
    if (tab !== 'terminal' || sessionId || busy) return;
    if (autoLocalOpenedRef.current) return;
    if (pluginLaunch?.sessionId) {
      autoLocalOpenedRef.current = true;
      return;
    }
    autoLocalOpenedRef.current = true;
    void openTerminal(undefined, true);
  }, [tab, sessionId, busy, pluginLaunch?.sessionId, openTerminal]);

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

  const terminalMode = tab === 'terminal';

  // Compress bottom tabstrip while Terminal owns the hole (header/footer inset).
  useEffect(() => {
    const panel = document.querySelector('.bndz-bottom-panel') as HTMLElement | null;
    if (!panel) return;
    if (terminalMode) panel.setAttribute('data-terminal-active', 'true');
    else if (panel.getAttribute('data-terminal-active') === 'true') panel.removeAttribute('data-terminal-active');
    return () => {
      if (panel.getAttribute('data-terminal-active') === 'true') panel.removeAttribute('data-terminal-active');
    };
  }, [terminalMode]);

  return (
    <PluginPanelShell
      title="Remote"
      icon="cloud_ui"
      iconColor="#38bdf8"
      subtitle="Remote PCs · send files · temporary cloud · sync · terminal"
      variant="embedded"
      scrollable={!terminalMode}
      density={terminalMode ? 'terminal' : 'default'}
      toolbar={terminalMode ? (
        <div className="bndz-mesh-term-actions flex items-center gap-2 w-full min-h-0 relative">
          <div className="min-w-0 flex-1 truncate text-[11px] text-sky-100/85 font-medium tracking-wide">
            {sessionLabel || (busy ? 'Opening…' : 'Terminal')}
          </div>
          <div className="flex items-center gap-1 shrink-0 relative">
            <div className="relative">
              <PluginToolbarButton
                onClick={() => setNewMenuOpen(v => !v)}
                disabled={busy}
              >
                New
              </PluginToolbarButton>
              {newMenuOpen && (
                <div className="absolute right-0 top-[calc(100%+4px)] z-40 min-w-[168px] rounded-lg border border-white/10 bg-[#12151c] shadow-xl py-1">
                  <button
                    type="button"
                    className="w-full text-left px-3 py-1.5 text-[11px] text-gray-200 hover:bg-white/8"
                    onClick={() => void openTerminal(undefined, true)}
                  >
                    Local shell
                  </button>
                  {meshBrowseHint && (
                    <button
                      type="button"
                      className="w-full text-left px-3 py-1.5 text-[11px] text-gray-200 hover:bg-white/8"
                      onClick={() => void openTerminal()}
                    >
                      Shell Here
                    </button>
                  )}
                  {hosts.filter(h => h.provider === 0).slice(0, 8).map(h => (
                    <button
                      key={h.id}
                      type="button"
                      className="w-full text-left px-3 py-1.5 text-[11px] text-gray-200 hover:bg-white/8"
                      onClick={() => { setSelectedHostId(h.id); void openTerminal(h.id); }}
                    >
                      SSH · {h.alias}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {sessionId && (
              <PluginToolbarButton onClick={closeTerminalSession}>
                Close
              </PluginToolbarButton>
            )}
            <PluginToolbarButton onClick={() => { setNewMenuOpen(false); setTab('hosts'); }}>
              Hosts
            </PluginToolbarButton>
          </div>
        </div>
      ) : (
        <>
          {meshBrowseHint && (
            <PluginToolbarButton onClick={() => void openTerminal()}>
              <Icons8Icon id="terminal" size={12} /> Shell Here
            </PluginToolbarButton>
          )}
          <PluginToolbarButton onClick={() => setTab('drop')}>
            <Icons8Icon id="cloud_ui" size={12} /> Send files
          </PluginToolbarButton>
          <PluginToolbarButton onClick={() => {
            window.dispatchEvent(new CustomEvent('bndz-open-configuration', { detail: { tab: 'Workspace Tools' } }));
          }}>
            <Icons8Icon id="config" size={12} /> Settings
          </PluginToolbarButton>
        </>
      )}
      status={!terminalMode && status ? <span className="text-xs text-sky-200/80 bndz-mesh-status-pulse">{status}</span> : undefined}
    >
      <div className={`flex flex-col flex-1 min-h-0 h-full bndz-mesh-surface ${terminalMode ? 'bndz-mesh-surface--terminal' : ''}`}>
        {!terminalMode && (
          <>
            <div className="bndz-mesh-opsrail">
              <div className="bndz-mesh-opsrail-copy">
                <strong>{hosts.length}</strong> host{hosts.length === 1 ? '' : 's'}
                <em>·</em>
                <span>{rules.length} sync rule{rules.length === 1 ? '' : 's'}</span>
                {sessionId ? <><em>·</em><span>terminal open</span></> : null}
              </div>
              <div className="bndz-mesh-opsrail-actions">
                <PluginToolbarButton onClick={() => void openTerminal(undefined, true)} disabled={busy}>
                  Local shell
                </PluginToolbarButton>
                <PluginToolbarButton onClick={() => setTab('drop')}>
                  Send files
                </PluginToolbarButton>
              </div>
            </div>
            <div className="bndz-mesh-tabrail flex gap-1 px-3 pt-2 shrink-0 flex-wrap">
            {([
              ['hosts', 'Hosts'],
              ['drop', 'Send files'],
              ['ephemeral', 'Temp cloud'],
              ['buckets', 'Shares'],
              ['mirror', 'Sync'],
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
          </>
        )}

        <div
          className={`flex-1 min-h-0 min-w-0 ${
            terminalMode
              ? 'overflow-hidden p-0 flex flex-col relative'
              : 'relative p-3 overflow-y-auto bndz-scrollbar'
          }`}
        >
          {/* ConPTY / SSH → xterm.js (never WinUI TermControl HWND over WebView2). */}
          {(terminalMode || sessionId) && (
            <div
              className={`bndz-mesh-terminal-frame bg-[#07090e] ${
                terminalMode
                  ? 'relative flex-1 min-h-0 min-w-0 w-full overflow-hidden'
                  : 'hidden'
              }`}
              aria-hidden={!terminalMode}
            >
              <MeshTerminalPanel
                sessionId={sessionId}
                active={terminalMode}
              />
              {!sessionId && terminalMode && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-gray-500 p-6 text-center z-[1]">
                  Opening Local PowerShell…
                </div>
              )}
            </div>
          )}
          {!terminalMode && (
            <>
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

          {tab === 'drop' && (
            <MeshDropPanel
              selectionPaths={(selectedPaths || []).filter(Boolean)}
              onStatus={setStatus}
            />
          )}

          {tab === 'ephemeral' && (
            <MeshEphemeralPanel
              onNavigate={onNavigate}
              onStatus={setStatus}
              onOpenTerminal={(sessionId, hostId) => {
                setSessionId(sessionId);
                setSelectedHostId(hostId);
                setTab('terminal');
              }}
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
            </>
          )}
        </div>
      </div>
    </PluginPanelShell>
  );
}
