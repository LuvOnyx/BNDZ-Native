import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { IPC } from '../../lib/ipcBridge';
import { formatUiPath } from '../../lib/displayPath';
import { isMeshPath, parseMeshPath } from '../../lib/meshPaths';
import { toWindowsPath } from '../../lib/pathUtils';
import { isNativeShellHostBoot } from '../../lib/nativeShellHostBoot';
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
import { useAppConfig } from '../../data/configContext';

const useNativeWinUiTerminal = () => isNativeShellHostBoot();

const DEFAULT_TERMINAL_THEME = {
  fontFamily: 'Cascadia Mono',
  fontSize: 11,
  foreground: '#d8dee9',
  background: '#07090e',
  cursor: '#7dd3fc',
} as const;

function readTerminalTheme(config: { [key: string]: any } | null | undefined) {
  const c = config || {};
  const fontSize = Number(c.terminalFontSize);
  return {
    fontFamily: (typeof c.terminalFontFamily === 'string' && c.terminalFontFamily.trim())
      ? c.terminalFontFamily.trim()
      : DEFAULT_TERMINAL_THEME.fontFamily,
    fontSize: Number.isFinite(fontSize) && fontSize > 0 ? fontSize : DEFAULT_TERMINAL_THEME.fontSize,
    foreground: (typeof c.terminalForeground === 'string' && c.terminalForeground.trim())
      ? c.terminalForeground.trim()
      : DEFAULT_TERMINAL_THEME.foreground,
    background: (typeof c.terminalBackground === 'string' && c.terminalBackground.trim())
      ? c.terminalBackground.trim()
      : DEFAULT_TERMINAL_THEME.background,
    cursor: (typeof c.terminalCursor === 'string' && c.terminalCursor.trim())
      ? c.terminalCursor.trim()
      : DEFAULT_TERMINAL_THEME.cursor,
  };
}



function buildSshCommandLine(host: MeshHost): string {
  const user = host.username || '';
  const hostname = host.hostname || host.alias || '';
  const port = Number(host.port) || 22;
  const target = user ? `${user}@${hostname}` : hostname;
  const portArg = port !== 22 ? ` -p ${port}` : '';
  return `ssh${portArg} ${target}`.trim();
}

/** Reports the React hole rect so WinUI can align TermControl overlay. */
function NativeTerminalHole({
  active,
  sessionLabel,
  busy,
}: {
  active: boolean;
  sessionLabel: string | null;
  busy: boolean;
}) {
  const holeRef = useRef<HTMLDivElement>(null);

  const publishLayout = useCallback((visible: boolean) => {
    const el = holeRef.current;
    if (!el) {
      IPC.nativeTerminalLayout({ x: 0, y: 0, width: 0, height: 0, visible: false });
      return;
    }
    const r = el.getBoundingClientRect();
    IPC.nativeTerminalLayout({
      x: r.left,
      y: r.top,
      width: r.width,
      height: r.height,
      visible: visible && r.width >= 24 && r.height >= 24,
    });
  }, []);

  useEffect(() => {
    if (!active) {
      publishLayout(false);
      return;
    }
    publishLayout(true);
    const el = holeRef.current;
    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => publishLayout(true))
      : null;
    ro?.observe(el!);
    const onWin = () => publishLayout(true);
    window.addEventListener('resize', onWin);
    const t1 = window.setTimeout(() => publishLayout(true), 32);
    const t2 = window.setTimeout(() => publishLayout(true), 160);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', onWin);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      publishLayout(false);
    };
  }, [active, publishLayout]);

  return (
    <div
      ref={holeRef}
      className="absolute inset-0 w-full h-full bndz-native-term-hole bg-[#07090e]"
      aria-label={sessionLabel ? `Terminal â€” ${sessionLabel}` : 'Terminal'}
      role="application"
    >
      {/* Only while Open is in flight â€” never after Close (sessionLabel cleared). */}
      {busy && !sessionLabel && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-gray-500 p-6 text-center">
          Starting terminalâ€¦
        </div>
      )}
    </div>
  );
}

function decodeTerminalB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function encodeTerminalUtf8ToB64(data: string): string {
  // Prefer TextEncoder â€” unescape(encodeURIComponent) can mangle some VT sequences in WebView2.
  const bytes = new TextEncoder().encode(data);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

/** Survives MeshSshTerminalPanel remounts â€” ConPTY often emits before React commits sessionId. */
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
  const { config } = useAppConfig();
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
    const theme = readTerminalTheme(config);
    const term = new Terminal({
      theme: {
        background: theme.background,
        foreground: theme.foreground,
        cursor: theme.cursor,
        selectionBackground: 'rgba(56,189,248,0.28)',
      },
      fontFamily: theme.fontFamily,
      fontSize: theme.fontSize,
      lineHeight: 1.2,
      cursorBlink: true,
      // Leave false â€” ConPTY already speaks CRLF/VT; convertEol can desync the DA handshake paint.
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
    // 2) ACK host -> flush buffered ConPTY handshake bytes into xterm
    // 3) fit + resize so WINSIZE matches the visible hole
    flushOrphans(sessionId);
    IPC.meshTerminalAck(sessionId);
    scheduleFit();
    try { term.focus(); } catch { /* ignore */ }
    // Second ACK after fit settles â€” covers any bytes that arrived between flush and resize.
    const t = window.setTimeout(() => {
      IPC.meshTerminalAck(sessionId);
      fitAndResize();
    }, 32);
    return () => window.clearTimeout(t);
  }, [sessionId, flushOrphans, scheduleFit, fitAndResize]);


  // Live-apply Fonts -> Terminal settings to classic xterm.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    const apply = () => {
      const t = readTerminalTheme(config);
      try {
        term.options.fontSize = t.fontSize;
        term.options.fontFamily = t.fontFamily;
        term.options.theme = {
          background: t.background,
          foreground: t.foreground,
          cursor: t.cursor,
          selectionBackground: 'rgba(56,189,248,0.28)',
        };
        fitRef.current?.fit();
      } catch { /* ignore */ }
    };
    apply();
    const onEvt = () => apply();
    window.addEventListener('bndz-terminal-theme-changed', onEvt);
    return () => window.removeEventListener('bndz-terminal-theme-changed', onEvt);
  }, [config.terminalFontFamily, config.terminalFontSize, config.terminalForeground, config.terminalBackground, config.terminalCursor, config]);

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
  /** False when BottomPluginPanel keep-alive hides this plugin (native overlay must hide). */
  isPluginTabActive?: boolean;
  /** True when hosted in PluginPopoutShell (owns TermControl while main strip shows Remote UI). */
  popout?: boolean;
};


function resolveLocalShellCwd(currentPath?: string, launch?: { cwd?: string; currentPath?: string } | null): string {
  const isThisPc = (p?: string) => !p || p === '/' || p === '/this-pc';
  if (currentPath && !isMeshPath(currentPath) && !isThisPc(currentPath)) {
    const w = toWindowsPath(currentPath);
    if (w) return w;
  }
  const launchRaw = launch?.cwd || launch?.currentPath;
  if (launchRaw && !isThisPc(launchRaw) && !isMeshPath(launchRaw)) {
    const w = toWindowsPath(launchRaw);
    if (w) return w;
  }
  return 'C:\\';
}

export default function MeshPlugin({ onNavigate, currentPath, pluginLaunch, selectedPaths, isPluginTabActive = true, popout = false }: Props) {
  const { config } = useAppConfig();
  const [tab, setTab] = useState<'buckets' | 'hosts' | 'ephemeral' | 'drop' | 'mirror' | 'terminal' | 'liveshare'>('hosts');
  const [hosts, setHosts] = useState<MeshHost[]>([]);
  const [rules, setRules] = useState<MeshSyncRule[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionLabel, setSessionLabel] = useState<string | null>(null);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [selectedHostId, setSelectedHostId] = useState<string | null>(null);
  const nativeTerm = useNativeWinUiTerminal();
  const holeMeasureRef = useRef<HTMLDivElement | null>(null);
  /** Prevents auto-open from fighting an explicit Close. */
  const autoLocalOpenedRef = useRef(false);
  const [liveShareOn, setLiveShareOn] = useState(false);
  const [livePeers, setLivePeers] = useState<any[]>([]);

  const refreshRules = useCallback(async () => {
    const [h, r] = await Promise.all([IPC.meshListHosts(), IPC.meshGetSyncRules()]);
    setHosts((h as Record<string, unknown>[]).map(normalizeMeshHost));
    setRules(r as MeshSyncRule[]);
  }, []);

  useEffect(() => { void refreshRules(); }, [refreshRules]);

  // Buffer ConPTY/SSH output even before the Terminal tab mounts xterm (classic host only).
  useEffect(() => {
    if (!nativeTerm) ensureMeshTerminalOutputHub();
  }, [nativeTerm]);

  useEffect(() => {
    if (!nativeTerm) return;
    return IPC.onNativeTerminalClosed((sid) => {
      setSessionId((cur) => (cur === sid ? null : cur));
      setSessionLabel((cur) => (cur && sid ? null : cur));
    });
  }, [nativeTerm]);


  // Push Fonts -> Terminal prefs into live WinUI TermControl.
  useEffect(() => {
    if (!nativeTerm) return;
    const push = () => {
      if (!sessionId) return;
      const t = readTerminalTheme(config);
      IPC.nativeTerminalTheme({
        fontFamily: t.fontFamily,
        fontSize: t.fontSize,
        foreground: t.foreground,
        background: t.background,
        cursor: t.cursor,
      });
    };
    push();
    const onEvt = () => push();
    window.addEventListener('bndz-terminal-theme-changed', onEvt);
    return () => window.removeEventListener('bndz-terminal-theme-changed', onEvt);
  }, [
    nativeTerm,
    sessionId,
    config.terminalFontFamily,
    config.terminalFontSize,
    config.terminalForeground,
    config.terminalBackground,
    config.terminalCursor,
    config,
  ]);

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
      setStatus(`${p.status}${p.currentFile ? ` â€” ${p.currentFile}` : ''}${p.message ? ` (${p.message})` : ''}`);
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
        setStatus('Live Share active â€” peers see your selection in this folder.');
        window.dispatchEvent(new CustomEvent('bndz-live-share-changed', { detail: { active: true } }));
      }
    } finally { setBusy(false); }
  };

  const measureHole = useCallback(() => {
    const el = document.querySelector('.bndz-native-term-hole') as HTMLElement | null
      ?? holeMeasureRef.current;
    if (!el) return { x: 0, y: 0, width: 0, height: 0 };
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }, []);

  const closeTerminalSession = useCallback(() => {
    autoLocalOpenedRef.current = true; // do not auto-reopen after explicit Close
    const sid = sessionId;
    const wasNative = nativeTerm;
    // 1) Drop FE session + leave terminal so LAYOUT(visible:false) parks HWND first.
    // 2) Defer native Close so DestroyWindow is not nested under the same click stack
    //    as hosts remount (StackOverflow @ Close — 00:36 / 00:57 CT).
    setNewMenuOpen(false);
    setSessionId(null);
    setSessionLabel(null);
    setBusy(false);
    if (tab === 'terminal') setTab('hosts');
    try {
      IPC.nativeTerminalLayout({ x: 0, y: 0, width: 0, height: 0, visible: false });
    } catch { /* ignore */ }
    window.setTimeout(() => {
      try {
        if (wasNative) IPC.nativeTerminalClose();
        else if (sid) IPC.meshTerminalClose(sid);
      } catch { /* ignore */ }
    }, 0);
  }, [nativeTerm, sessionId, tab]);

  /** Leave fullscreen terminal -> main Remote UI without killing warm ConPTY. */
  const leaveTerminalView = useCallback(() => {
    setNewMenuOpen(false);
    if (tab === 'terminal') setTab('hosts');
    // Existing effect parks HWND via nativeTerminalLayout(visible:false) when tab !== 'terminal'.
  }, [tab]);


  const openTerminal = useCallback(async (hostId?: string, local = false) => {
    setBusy(true);
    setTab('terminal');
    setNewMenuOpen(false);
    try {
      let cwd: string | undefined;
      let commandLine: string | undefined;
      let label = 'Local';

      if (local) {
        cwd = resolveLocalShellCwd(currentPath, pluginLaunch);
        label = `Local Â· ${cwd}`;
      } else if (currentPath && isMeshPath(currentPath)) {
        const parsed = parseMeshPath(currentPath);
        if (parsed.hostId && (!hostId || parsed.hostId === hostId)) {
          hostId = parsed.hostId;
          cwd = parsed.remotePath || '/';
        }
      }

      if (!local && hostId) {
        const host = hosts.find(h => h.id === hostId);
        label = host ? `SSH Â· ${host.alias}` : `SSH Â· ${hostId}`;
        if (nativeTerm) {
          if (host) commandLine = buildSshCommandLine(host);
          else commandLine = `ssh ${hostId}`;
        } else {
          const conn = await IPC.meshConnect(hostId);
          if (conn?.error) {
            setStatus(String(conn.error));
            return;
          }
        }
      }

      if (nativeTerm) {
        // One session at a time â€” close prior WinUI TermControl first.
        if (sessionId) IPC.nativeTerminalClose();
        // Wait until the hole has real pixels â€” TermControl ConPTY starts from Columns/Rows.
        let rect = { x: 0, y: 0, width: 0, height: 0 };
        for (let i = 0; i < 90; i++) {
          await new Promise<void>(r => requestAnimationFrame(() => r()));
          rect = measureHole();
          if (rect.width >= 48 && rect.height >= 48) break;
          await new Promise<void>(r => window.setTimeout(r, 16));
        }
        if (rect.width < 48 || rect.height < 48) {
          setStatus('Terminal hole has no size â€” enlarge the bottom panel and try New');
          setSessionId(null);
          setSessionLabel(null);
          return;
        }
        const termTheme = readTerminalTheme(config);
        const res = await IPC.nativeTerminalOpen({
          sessionId: `term-${Date.now().toString(36)}`,
          commandLine: local || !commandLine ? undefined : commandLine,
          cwd: local ? cwd : undefined,
          label,
          ...rect,
          fontFamily: termTheme.fontFamily,
          fontSize: termTheme.fontSize,
          foreground: termTheme.foreground,
          background: termTheme.background,
          cursor: termTheme.cursor,
        });
        if (!res.ok) {
          setStatus(res.error || 'Terminal failed to open');
          setSessionId(null);
          setSessionLabel(null);
          return;
        }
        setSessionId(res.sessionId || null);
        setSessionLabel(res.label || label);
        setStatus('');
        // Push layout again after label/chrome settle so TermControl restarts at final size.
        // Keep feeding real hole geometry until TermControl can mount at size (G1).
        for (const ms of [50, 200, 500, 1000]) {
          window.setTimeout(() => {
            const r = measureHole();
            if (r.width >= 48 && r.height >= 48) {
              IPC.nativeTerminalLayout({ ...r, visible: true });
            }
          }, ms);
        }
        return;
      }

      // Classic host: ConPTY/SSH.NET -> xterm
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
      setStatus('');
    } catch (e: any) {
      setStatus(e?.message || 'Terminal failed to open');
    } finally { setBusy(false); }
  }, [currentPath, hosts, measureHole, nativeTerm, pluginLaunch?.cwd, pluginLaunch?.currentPath, sessionId, config]);

  const pluginActive = isPluginTabActive !== false;

  // Dismiss New menu only â€” Esc must NOT leave terminal view (strip â† Remote is enough).
  useEffect(() => {
    if (!pluginActive || tab !== 'terminal' || !newMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setNewMenuOpen(false);
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pluginActive, tab, newMenuOpen]);

  // Main strip: when Remote is popped out, flip off terminal view (hosts UI) and drop FE session if handed off.
  useEffect(() => {
    if (popout) return;
    const onPop = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      setNewMenuOpen(false);
      if (tab === 'terminal') setTab('hosts');
      if (detail.handedOff) {
        setSessionId(null);
        setSessionLabel(null);
      }
    };
    window.addEventListener('bndz-remote-mesh-popout', onPop);
    return () => window.removeEventListener('bndz-remote-mesh-popout', onPop);
  }, [popout, tab]);

  // Main strip: pop-out closed -> adopt warm ConPTY back into bottom panel terminal.
  useEffect(() => {
    if (popout || !nativeTerm) return;
    return IPC.onRemoteMeshPopoutClosed((info) => {
      void (async () => {
        if (!info?.handedOff && !info?.sessionId) return;
        try {
          const adopted = await IPC.nativeTerminalHandoffAdopt();
          if (!adopted?.ok) return;
          setSessionId(adopted.sessionId || info.sessionId || null);
          setSessionLabel(adopted.label || info.label || null);
          setTab('terminal');
          setBusy(false);
        } catch { /* ignore */ }
      })();
    });
  }, [popout, nativeTerm]);

  // Pop-out window: adopt handed-off session and show terminal; otherwise main Remote UI.
  useEffect(() => {
    if (!popout || !nativeTerm) return;
    let cancelled = false;
    void (async () => {
      try {
        const adopted = await IPC.nativeTerminalHandoffAdopt();
        if (cancelled) return;
        if (adopted?.ok) {
          setSessionId(adopted.sessionId || null);
          setSessionLabel(adopted.label || null);
          setTab('terminal');
          setBusy(false);
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [popout, nativeTerm]);


  // First visit to Terminal tab -> open Local so the prompt paints without an extra click.
  // Never auto-open while this plugin is keep-alive-hidden (would fight restore / kill ConPTY).
  useEffect(() => {
    if (!pluginActive) return;
    if (tab !== 'terminal' || sessionId || busy) return;
    if (autoLocalOpenedRef.current) return;
    if (pluginLaunch?.sessionId) {
      autoLocalOpenedRef.current = true;
      return;
    }
    autoLocalOpenedRef.current = true;
    void openTerminal(undefined, true);
  }, [pluginActive, tab, sessionId, busy, pluginLaunch?.sessionId, openTerminal]);

  // Hide WinUI overlay when leaving the Remote plugin or Terminal tab â€” never nativeTerminalClose.
  // When returning to Terminal with an existing session, re-publish hole bounds (same ConPTY).
  useEffect(() => {
    if (!nativeTerm) return;
    if (!pluginActive || tab !== 'terminal') {
      IPC.nativeTerminalLayout({ x: 0, y: 0, width: 0, height: 0, visible: false });
      return;
    }
    if (!sessionId) return;
    const publish = () => {
      const r = measureHole();
      if (r.width >= 24 && r.height >= 24) {
        IPC.nativeTerminalLayout({ ...r, visible: true });
      }
    };
    publish();
    const t1 = window.setTimeout(publish, 32);
    const t2 = window.setTimeout(publish, 160);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [pluginActive, tab, nativeTerm, sessionId, measureHole]);

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
  const showNativeOverlay = pluginActive && terminalMode && (!!sessionId || busy);

  return (
    <PluginPanelShell
      title="Remote"
      icon="cloud_ui"
      iconColor="#38bdf8"
      subtitle="Remote PCs Â· send files Â· temporary cloud Â· sync Â· terminal"
      variant="embedded"
      scrollable={!terminalMode}
      density={terminalMode ? 'terminal' : 'default'}
      toolbar={!terminalMode && meshBrowseHint ? (
          <PluginToolbarButton onClick={() => void openTerminal()}>
            <Icons8Icon id="terminal" size={12} /> Shell Here
          </PluginToolbarButton>
        ) : undefined}
      status={(!terminalMode && status && !/^Local\b/.test(status) && !/^SSH\b/.test(status)) ? <span className="text-xs text-sky-200/80 bndz-mesh-status-pulse">{status}</span> : undefined}
    >
      <div className={`flex flex-col flex-1 min-h-0 h-full bndz-mesh-surface ${terminalMode ? 'bndz-mesh-surface--terminal' : ''}`}>
        {!terminalMode && (
          <>
            <div className="bndz-mesh-opsrail">
              <div className="bndz-mesh-opsrail-copy">
                <strong>{hosts.length}</strong> host{hosts.length === 1 ? '' : 's'}
                <em>Â·</em>
                <span>{rules.length} sync rule{rules.length === 1 ? '' : 's'}</span>
                {sessionId ? <><em>Â·</em><span>terminal open</span></> : null}
              </div>
              <div className="bndz-mesh-opsrail-actions">
                <PluginToolbarButton onClick={() => void openTerminal(undefined, true)} disabled={busy}>
                  Local shell
                </PluginToolbarButton>
                <PluginToolbarButton onClick={() => setTab('drop')}>
                  Send files
                </PluginToolbarButton>
                <PluginToolbarButton onClick={() => {
                  window.dispatchEvent(new CustomEvent('bndz-open-configuration', { detail: { tab: 'Fonts' } }));
                }}>
                  Settings
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
          {/* Native WinUI TermControl hole (BNDZShell) or classic xterm (WPF host).
              FE chrome (New / Close / â† Remote) MUST sit above the hole â€” TermControl HWND
              airspace covers any HTML painted over the same rect. */}
          {(terminalMode || sessionId) && (
            <div
              className={`bndz-mesh-terminal-frame bg-[#07090e] ${
                terminalMode
                  ? 'relative flex flex-col flex-1 min-h-0 min-w-0 w-full overflow-hidden'
                  : 'hidden'
              }`}
              aria-hidden={!terminalMode}
            >
              {terminalMode && (
                <div className="bndz-mesh-term-chrome shrink-0 flex items-center justify-end gap-0.5 px-2.5 py-0.5 border-b border-white/[0.05]">
                  <div className="relative flex items-center gap-0.5">
                    <div className="relative">
                      <button
                        type="button"
                        className="bndz-mesh-term-action"
                        onClick={() => setNewMenuOpen(v => !v)}
                        disabled={busy}
                        title="New terminal session"
                      >
                        New
                      </button>
                      {newMenuOpen && (
                        <div className="absolute right-0 top-[calc(100%+4px)] z-40 min-w-[168px] rounded-md border border-white/[0.08] bg-[#12151c]/98 shadow-lg py-0.5 backdrop-blur-sm">
                          <button
                            type="button"
                            className="w-full text-left px-2.5 py-1 text-[11px] text-slate-300/90 hover:bg-white/[0.05] hover:text-slate-100"
                            onClick={() => void openTerminal(undefined, true)}
                          >
                            Local shell
                          </button>
                          {meshBrowseHint && (
                            <button
                              type="button"
                              className="w-full text-left px-2.5 py-1 text-[11px] text-slate-300/90 hover:bg-white/[0.05] hover:text-slate-100"
                              onClick={() => void openTerminal()}
                            >
                              Shell Here
                            </button>
                          )}
                          {hosts.filter(h => h.provider === 0).slice(0, 8).map(h => (
                            <button
                              key={h.id}
                              type="button"
                              className="w-full text-left px-2.5 py-1 text-[11px] text-slate-300/90 hover:bg-white/[0.05] hover:text-slate-100"
                              onClick={() => { setSelectedHostId(h.id); void openTerminal(h.id); }}
                            >
                              SSH Â· {h.alias}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {sessionId && (
                      <button
                        type="button"
                        className="bndz-mesh-term-action"
                        onClick={closeTerminalSession}
                        title="Close terminal session"
                      >
                        Close
                      </button>
                    )}
                    <button
                      type="button"
                      className="bndz-mesh-term-action"
                      title="Back to Remote â€” keeps terminal session warm"
                      onClick={() => leaveTerminalView()}
                    >
                      {'\u2190 Remote'}
                    </button>
                  </div>
                </div>
              )}
              <div className="relative flex-1 min-h-0 min-w-0">
                {nativeTerm ? (
                  <NativeTerminalHole active={showNativeOverlay} sessionLabel={sessionLabel} busy={busy} />
                ) : (
                  <>
                    <MeshTerminalPanel
                      sessionId={sessionId}
                      active={pluginActive && terminalMode}
                    />
                    {!sessionId && terminalMode && (
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-gray-500 p-6 text-center z-[1]">
                        Opening Local PowerShellâ€¦
                      </div>
                    )}
                  </>
                )}
              </div>
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
                <PluginEmptyState icon="sync_folders" title="No mirror rules" description="Push local folders to remote hosts on save â€” ideal for instant deploys." />
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
                        {p.cursorPath ? ` Â· cursor: ${String(p.cursorPath).split(/[/\\]/).pop()}` : ''}
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
