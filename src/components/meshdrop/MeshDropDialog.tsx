import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { EmblemIcon } from '../EmblemIcon';
import { IPC } from '../../lib/ipcBridge';
import { pushToast } from '../ToastHost';
import { useAppConfig } from '../../data/configContext';
import { meshDropCodeChecksum } from '../../lib/meshDrop';
import {
  DEFAULT_MESH_DROP_WEB_BASE,
  buildMeshDropDeepLink,
  buildMeshDropWebLink,
  extractMeshDropCode,
  formatTransferSize,
  type MeshDropShareMode,
} from '../../lib/meshDropLinks';

type Mode = 'host' | 'receive';
type ReceiveChannel = 'paste' | 'lan' | 'relay';

type SessionMeta = {
  fileCount?: number;
  totalBytes?: number;
  label?: string;
};

type LanPeer = {
  displayName?: string;
  hostName?: string;
  address?: string;
  port?: number;
  sessionHint?: string;
};

type Props = {
  paths?: string[];
  onClose: () => void;
};

const SHARE_MODES: { id: MeshDropShareMode; label: string; icon: string; hint: string }[] = [
  { id: 'code', label: 'Mesh Code', icon: 'copy_path', hint: 'Copy-paste encrypted SDP bundle into another BNDZ desktop' },
  { id: 'link', label: 'Deep Link', icon: 'emblem-shared', hint: 'bndz:// deep link for another BNDZ install' },
  { id: 'qr', label: 'QR', icon: 'view_grid', hint: 'QR of deep link / Mesh Code for a second BNDZ screen' },
  { id: 'relay', label: 'Relay', icon: 'cloud_ui', hint: 'Auto answer exchange via signaling relay' },
  { id: 'lan', label: 'LAN', icon: 'explorer', hint: 'Discover peers on your subnet' },
];

function normalizePeer(raw: Record<string, unknown>): LanPeer {
  return {
    displayName: String(raw.displayName ?? raw.DisplayName ?? raw.hostName ?? raw.HostName ?? 'BNDZ Peer'),
    hostName: String(raw.hostName ?? raw.HostName ?? ''),
    address: String(raw.address ?? raw.Address ?? ''),
    port: Number(raw.port ?? raw.Port ?? 0),
    sessionHint: String(raw.sessionHint ?? raw.SessionHint ?? ''),
  };
}

function parseRoomIdFromJoinInput(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw.includes('://') ? raw : `https://relay.local/${raw}`);
    const parts = url.pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] || null;
  } catch {
    return raw.replace(/^.*\//, '') || null;
  }
}

export default function MeshDropDialog({ paths = [], onClose }: Props) {
  const { config } = useAppConfig();
  const [mode, setMode] = useState<Mode>(paths.length ? 'host' : 'receive');
  const [shareMode, setShareMode] = useState<MeshDropShareMode>('link');
  const [receiveChannel, setReceiveChannel] = useState<ReceiveChannel>('paste');

  const [meshCode, setMeshCode] = useState('');
  const [answerCode, setAnswerCode] = useState('');
  const [pasteCode, setPasteCode] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [sessionMeta, setSessionMeta] = useState<SessionMeta>({});
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [destDir, setDestDir] = useState('');
  const [showFullCode, setShowFullCode] = useState(false);

  const [lanPeers, setLanPeers] = useState<LanPeer[]>([]);
  const [lanScanning, setLanScanning] = useState(false);

  const [relayJoinUrl, setRelayJoinUrl] = useState('');
  const [relayRoomId, setRelayRoomId] = useState('');
  const [relayPollUrl, setRelayPollUrl] = useState('');
  const [relayPolling, setRelayPolling] = useState(false);

  const [qrDataUrl, setQrDataUrl] = useState('');
  const relayPollRef = useRef(0);

  const webBase = config.meshDropWebLinkBase || 'https://bndz.app/mesh-drop';
  const relayBase = (config.meshDropSignalingRelayUrl || '').trim();

  const deepLink = useMemo(() => (meshCode ? buildMeshDropDeepLink(meshCode) : ''), [meshCode]);
  const webLink = useMemo(() => (meshCode ? buildMeshDropWebLink(meshCode, webBase) : ''), [meshCode, webBase]);
  const hasCustomWebReceiver = Boolean(
    webBase
    && webBase.replace(/\/$/, '').toLowerCase() !== DEFAULT_MESH_DROP_WEB_BASE.replace(/\/$/, '').toLowerCase(),
  );
  // QR / phone scan must not advertise a dead public web receiver — prefer deep link.
  const qrTarget = shareMode === 'qr' ? (deepLink || meshCode) : '';

  useEffect(() => {
    if (!qrTarget) {
      setQrDataUrl('');
      return;
    }
    let cancelled = false;
    import('qrcode')
      .then(QR => QR.toDataURL(qrTarget, { margin: 1, width: 220, color: { dark: '#22d3ee', light: '#0a0e14' } }))
      .then(url => { if (!cancelled) setQrDataUrl(url); })
      .catch(() => { if (!cancelled) setQrDataUrl(''); });
    return () => { cancelled = true; };
  }, [qrTarget]);

  const createOffer = useCallback(async () => {
    if (!paths.length) return;
    setBusy(true);
    setStatus('Generating encrypted Mesh Code…');
    try {
      const r = await IPC.meshDropCreateOffer(paths, `${paths.length} item(s)`);
      if (!r.ok || !r.meshCode) throw new Error(r.error || 'Failed to create offer');
      setMeshCode(r.meshCode);
      setSessionId(r.sessionId ?? '');
      const sess = r.session as Record<string, unknown> | undefined;
      setSessionMeta({
        fileCount: Number(sess?.fileCount ?? sess?.FileCount ?? paths.length),
        totalBytes: Number(sess?.totalBytes ?? sess?.TotalBytes ?? 0),
        label: String(sess?.label ?? sess?.Label ?? `${paths.length} item(s)`),
      });
      setStatus('Choose how to share with your collaborator');
      if (relayBase) void startRelayRoom(r.meshCode, String(sess?.label ?? `${paths.length} item(s)`));
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [paths, relayBase]);

  useEffect(() => {
    if (mode === 'host' && paths.length) void createOffer();
  }, [mode, paths, createOffer]);

  const startRelayRoom = async (code: string, label: string) => {
    if (!relayBase) return;
    const r = await IPC.meshDropRelayCreate(relayBase, code, label);
    if (!r.ok || !r.room) return;
    setRelayJoinUrl(r.room.joinUrl);
    setRelayRoomId(r.room.roomId);
    setRelayPollUrl(r.room.pollUrl);
    setRelayPolling(true);
  };

  useEffect(() => {
    if (!relayPolling || !relayPollUrl || !sessionId) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      const r = await IPC.meshDropRelayPoll(relayPollUrl);
      if (r.ok && r.answer) {
        setAnswerCode(r.answer);
        setRelayPolling(false);
        setStatus('Relay delivered answer — connect to stream');
        return;
      }
      relayPollRef.current = window.setTimeout(tick, 2000);
    };
    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(relayPollRef.current);
    };
  }, [relayPolling, relayPollUrl, sessionId]);

  const acceptOffer = async (codeOverride?: string) => {
    const code = (codeOverride ?? extractMeshDropCode(pasteCode) ?? pasteCode.trim());
    if (!code || !destDir.trim()) {
      pushToast({ kind: 'warning', title: 'Missing info', message: 'Paste a Mesh Code or link and choose a destination folder.' });
      return;
    }
    setBusy(true);
    setStatus('Connecting to peer…');
    try {
      const r = await IPC.meshDropAcceptOffer(code, destDir.trim());
      if (!r.ok || !r.answerCode) throw new Error(r.error || 'Failed to accept');
      setAnswerCode(r.answerCode);
      setSessionId(r.sessionId ?? '');
      if (relayBase && relayRoomId) {
        await IPC.meshDropRelaySubmitAnswer(relayBase, relayRoomId, r.answerCode);
        setStatus('Answer posted to relay — waiting for host to stream');
      } else {
        setStatus('Send the Answer Code back to the host (or use Relay tab)');
      }
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const connectAndSend = async () => {
    if (!sessionId || !answerCode.trim()) return;
    setBusy(true);
    setStatus('Establishing encrypted P2P tunnel…');
    try {
      const conn = await IPC.meshDropConnect(sessionId, answerCode.trim());
      if (!conn.ok) throw new Error(conn.error || 'Connection failed');
      setStatus('Streaming files directly to peer…');
      const send = await IPC.meshDropSend(sessionId);
      if (!send.ok) throw new Error(send.error || 'Transfer failed');
      pushToast({ kind: 'success', title: 'Mesh Drop complete', message: 'Files streamed directly to peer.' });
      onClose();
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copyText = (text: string, label: string) => {
    void navigator.clipboard.writeText(text);
    pushToast({ kind: 'info', title: 'Copied', message: `${label} copied to clipboard.` });
  };

  const pickDestFolder = async () => {
    const picked = await IPC.openFolderDialog('Select folder to receive Mesh Drop files');
    if (picked) setDestDir(picked);
  };

  const scanLan = async () => {
    setLanScanning(true);
    setStatus('Scanning LAN for BNDZ peers…');
    try {
      const r = await IPC.meshDropDiscoverLan();
      const peers = (r.peers as Record<string, unknown>[]).map(normalizePeer);
      setLanPeers(peers);
      setStatus(peers.length ? `Found ${peers.length} peer(s) on your network` : 'No LAN peers found — use Mesh Code or Deep Link');
    } finally {
      setLanScanning(false);
    }
  };

  const joinLanPeer = async (peer: LanPeer) => {
    if (!peer.address || !peer.port) return;
    if (!destDir.trim()) {
      pushToast({ kind: 'warning', title: 'Destination required', message: 'Choose a save folder first.' });
      return;
    }
    setBusy(true);
    setStatus(`Fetching offer from ${peer.displayName}…`);
    try {
      const r = await IPC.meshDropFetchLanOffer(peer.address, peer.port);
      if (!r.ok || !r.meshCode) throw new Error(r.error || 'Could not fetch LAN offer');
      setPasteCode(r.meshCode);
      await acceptOffer(r.meshCode);
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const resolveRelayRoom = async () => {
    if (!relayBase || !relayJoinUrl.trim()) {
      pushToast({ kind: 'warning', title: 'Relay not configured', message: 'Set a signaling relay URL in Settings → Workspace Tools → Mesh Drop.' });
      return;
    }
    const roomId = parseRoomIdFromJoinInput(relayJoinUrl);
    if (!roomId) return;
    setRelayRoomId(roomId);
    setBusy(true);
    setStatus('Resolving relay room…');
    try {
      const r = await IPC.meshDropRelayResolveOffer(relayBase, roomId);
      if (!r.ok || !r.meshCode) throw new Error(r.error || 'Room not found or expired');
      setPasteCode(r.meshCode);
      setStatus('Offer loaded from relay — choose destination and accept');
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onPasteInput = (value: string) => {
    setPasteCode(value);
    const extracted = extractMeshDropCode(value);
    if (extracted && extracted !== value.trim()) setPasteCode(extracted);
  };

  const displayCode = meshCode
    ? (showFullCode ? meshCode : `${meshCode.slice(0, 96)}…`)
    : '';

  return (
    <div className="bndz-meshdrop-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bndz-meshdrop-dialog bndz-meshdrop-dialog--wide">
        <div className="bndz-meshdrop-aurora" aria-hidden />
        <header className="bndz-meshdrop-head">
          <span className="bndz-meshdrop-sigil"><EmblemIcon id="share-check" size={22} /></span>
          <div className="min-w-0 flex-1">
            <h2 className="bndz-meshdrop-title">Mesh Drop</h2>
            <p className="bndz-meshdrop-sub">Zero-trust WebRTC P2P · encrypted pairing · unlimited size</p>
          </div>
          <button type="button" className="bndz-meshdrop-close" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="bndz-meshdrop-tabs">
          <button type="button" className={mode === 'host' ? 'is-active' : ''} onClick={() => setMode('host')} disabled={!paths.length}>
            Send {paths.length ? `(${paths.length})` : ''}
          </button>
          <button type="button" className={mode === 'receive' ? 'is-active' : ''} onClick={() => setMode('receive')}>Receive</button>
        </div>

        {mode === 'host' ? (
          <div className="bndz-meshdrop-body" data-mesh-drop-inbox="1">
            <div className="bndz-meshdrop-manifest">
              <div className="bndz-meshdrop-manifest-stat">
                <span className="label">Payload</span>
                <span className="value">{sessionMeta.label || `${paths.length} path(s)`}</span>
              </div>
              <div className="bndz-meshdrop-manifest-stat">
                <span className="label">Files</span>
                <span className="value">{sessionMeta.fileCount ?? paths.length}</span>
              </div>
              <div className="bndz-meshdrop-manifest-stat">
                <span className="label">Size</span>
                <span className="value">{formatTransferSize(sessionMeta.totalBytes ?? 0)}</span>
              </div>
              {meshCode && (
                <div className="bndz-meshdrop-manifest-stat">
                  <span className="label">Checksum</span>
                  <span className="value bndz-mono">{meshDropCodeChecksum(meshCode)}</span>
                </div>
              )}
            </div>

            {!meshCode ? (
              <button type="button" className="bndz-meshdrop-cta" disabled={busy || !paths.length} onClick={() => void createOffer()}>
                Generate secure offer
              </button>
            ) : (
              <>
                <div className="bndz-meshdrop-share-rail">
                  {SHARE_MODES.map(m => (
                    <button
                      key={m.id}
                      type="button"
                      className={`bndz-meshdrop-share-chip${shareMode === m.id ? ' is-active' : ''}${m.id === 'relay' && !relayBase ? ' is-muted' : ''}`}
                      onClick={() => setShareMode(m.id)}
                      title={m.hint}
                    >
                      <Icons8Icon id={m.icon} size={13} />
                      {m.label}
                    </button>
                  ))}
                </div>

                {shareMode === 'code' && (
                  <div className="bndz-meshdrop-panel">
                    <label className="bndz-meshdrop-label">Mesh Code (encrypted SDP bundle)</label>
                    <div className="bndz-meshdrop-code-row">
                      <code className="bndz-meshdrop-code bndz-meshdrop-code--full">{displayCode}</code>
                      <div className="flex flex-col gap-1 shrink-0">
                        <button type="button" className="bndz-meshdrop-btn" onClick={() => copyText(meshCode, 'Mesh Code')}>Copy</button>
                        <button type="button" className="bndz-meshdrop-btn" onClick={() => setShowFullCode(v => !v)}>{showFullCode ? 'Collapse' : 'Expand'}</button>
                      </div>
                    </div>
                  </div>
                )}

                {shareMode === 'link' && (
                  <div className="bndz-meshdrop-panel space-y-3">
                    <div>
                      <label className="bndz-meshdrop-label">Deep link (bndz://)</label>
                      <div className="bndz-meshdrop-code-row">
                        <code className="bndz-meshdrop-code bndz-meshdrop-code--link">{deepLink.slice(0, 100)}…</code>
                        <button type="button" className="bndz-meshdrop-btn" onClick={() => copyText(deepLink, 'Deep link')}>Copy</button>
                      </div>
                      <p className="bndz-meshdrop-micro">Paste into another BNDZ desktop (Receive → paste). Phone browsers need a hosted receiver.</p>
                    </div>
                    {hasCustomWebReceiver && (
                      <div>
                        <label className="bndz-meshdrop-label">Custom web link</label>
                        <div className="bndz-meshdrop-code-row">
                          <code className="bndz-meshdrop-code bndz-meshdrop-code--link">{webLink}</code>
                          <button type="button" className="bndz-meshdrop-btn" onClick={() => copyText(webLink, 'Web link')}>Copy</button>
                        </div>
                        <p className="bndz-meshdrop-micro">Uses your configured Mesh Drop web base.</p>
                      </div>
                    )}
                  </div>
                )}

                {shareMode === 'qr' && (
                  <div className="bndz-meshdrop-panel bndz-meshdrop-qr-wrap">
                    {qrDataUrl ? (
                      <img src={qrDataUrl} alt="Mesh Drop QR code" className="bndz-meshdrop-qr" />
                    ) : (
                      <div className="bndz-meshdrop-qr-placeholder">Generating QR…</div>
                    )}
                    <p className="bndz-meshdrop-micro text-center">Encodes a bndz:// deep link — open on another BNDZ desktop, or paste Mesh Code on Receive.</p>
                  </div>
                )}

                {shareMode === 'relay' && (
                  <div className="bndz-meshdrop-panel space-y-2">
                    {relayBase ? (
                      <>
                        {relayJoinUrl ? (
                          <>
                            <label className="bndz-meshdrop-label">Relay join link (share this)</label>
                            <div className="bndz-meshdrop-code-row">
                              <code className="bndz-meshdrop-code bndz-meshdrop-code--link">{relayJoinUrl}</code>
                              <button type="button" className="bndz-meshdrop-btn" onClick={() => copyText(relayJoinUrl, 'Relay link')}>Copy</button>
                            </div>
                            <p className="bndz-meshdrop-micro">
                              {relayPolling ? 'Waiting for receiver answer on relay…' : 'Answer received — connect below.'}
                            </p>
                          </>
                        ) : (
                          <p className="bndz-meshdrop-micro">Creating relay room…</p>
                        )}
                      </>
                    ) : (
                      <p className="bndz-meshdrop-warn">Configure <strong>Signaling relay URL</strong> in Settings → Workspace Tools → Mesh Drop for auto answer exchange.</p>
                    )}
                  </div>
                )}

                {shareMode === 'lan' && (
                  <div className="bndz-meshdrop-panel">
                    <p className="bndz-meshdrop-micro mb-2">This machine is broadcasting on your LAN. Receivers on the same subnet can discover you under Receive → LAN.</p>
                    <button type="button" className="bndz-meshdrop-btn" onClick={() => void scanLan()} disabled={lanScanning}>
                      {lanScanning ? 'Scanning…' : 'Refresh LAN peers'}
                    </button>
                  </div>
                )}

                <label className="bndz-meshdrop-label">Answer Code (paste from receiver, or auto via relay)</label>
                <textarea
                  className="bndz-meshdrop-input"
                  rows={3}
                  placeholder="Paste answer code here…"
                  value={answerCode}
                  onChange={e => setAnswerCode(e.target.value)}
                />
                <button type="button" className="bndz-meshdrop-cta" disabled={busy || !answerCode.trim()} onClick={() => void connectAndSend()}>
                  Connect &amp; Stream
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="bndz-meshdrop-body">
            <div className="bndz-meshdrop-share-rail">
              {([
                { id: 'paste' as const, label: 'Code / Link', icon: 'copy_path' },
                { id: 'lan' as const, label: 'LAN', icon: 'explorer' },
                { id: 'relay' as const, label: 'Relay', icon: 'cloud_ui' },
              ]).map(ch => (
                <button
                  key={ch.id}
                  type="button"
                  className={`bndz-meshdrop-share-chip${receiveChannel === ch.id ? ' is-active' : ''}`}
                  onClick={() => setReceiveChannel(ch.id)}
                >
                  <Icons8Icon id={ch.icon} size={13} />
                  {ch.label}
                </button>
              ))}
            </div>

            <label className="bndz-meshdrop-label">Save to folder</label>
            <div className="bndz-meshdrop-code-row mb-2">
              <input
                className="bndz-meshdrop-input flex-1"
                placeholder="D:\Downloads\MeshDrop"
                value={destDir}
                onChange={e => setDestDir(e.target.value)}
              />
              <button type="button" className="bndz-meshdrop-btn" onClick={() => void pickDestFolder()}>Browse…</button>
            </div>

            {receiveChannel === 'paste' && (
              <>
                <label className="bndz-meshdrop-label">Mesh Code, web link, or bndz:// URL</label>
                <textarea
                  className="bndz-meshdrop-input"
                  rows={4}
                  placeholder="Paste Mesh Code, https://…/mesh-drop#BNDZMD:… or bndz://mesh-drop?code=…"
                  value={pasteCode}
                  onChange={e => onPasteInput(e.target.value)}
                />
                {answerCode ? (
                  <div className="mt-3">
                    <label className="bndz-meshdrop-label">Answer Code (auto-submitted if relay used)</label>
                    <div className="bndz-meshdrop-code-row">
                      <code className="bndz-meshdrop-code">{answerCode.slice(0, 80)}…</code>
                      <button type="button" className="bndz-meshdrop-btn" onClick={() => copyText(answerCode, 'Answer Code')}>Copy</button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="bndz-meshdrop-cta" disabled={busy} onClick={() => void acceptOffer()}>
                    Accept &amp; Generate Answer
                  </button>
                )}
              </>
            )}

            {receiveChannel === 'lan' && (
              <div className="bndz-meshdrop-panel">
                <button type="button" className="bndz-meshdrop-btn mb-3" onClick={() => void scanLan()} disabled={lanScanning}>
                  {lanScanning ? 'Scanning LAN…' : 'Scan for nearby senders'}
                </button>
                {lanPeers.length === 0 ? (
                  <p className="bndz-meshdrop-micro">No peers found. Ensure sender has Mesh Drop open on the same network.</p>
                ) : (
                  <div className="bndz-meshdrop-lan-list">
                    {lanPeers.map(p => (
                      <button
                        key={`${p.address}:${p.port}`}
                        type="button"
                        className="bndz-meshdrop-lan-row"
                        disabled={busy}
                        onClick={() => void joinLanPeer(p)}
                      >
                        <EmblemIcon id="share-check" size={16} />
                        <div className="min-w-0 flex-1 text-left">
                          <div className="text-xs font-semibold text-white truncate">{p.displayName}</div>
                          <div className="bndz-mono text-[10px] text-gray-500">{p.address}:{p.port}</div>
                        </div>
                        <span className="text-[10px] text-cyan-300/80">Join</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {receiveChannel === 'relay' && (
              <div className="bndz-meshdrop-panel space-y-2">
                <label className="bndz-meshdrop-label">Relay join link or room ID</label>
                <div className="bndz-meshdrop-code-row">
                  <input
                    className="bndz-meshdrop-input flex-1"
                    placeholder="https://relay.example.com/join/abc123"
                    value={relayJoinUrl}
                    onChange={e => setRelayJoinUrl(e.target.value)}
                  />
                  <button type="button" className="bndz-meshdrop-btn" onClick={() => void resolveRelayRoom()} disabled={busy}>
                    Load
                  </button>
                </div>
                {pasteCode && (
                  <button type="button" className="bndz-meshdrop-cta" disabled={busy || !destDir.trim()} onClick={() => void acceptOffer()}>
                    Accept relay offer
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {status && <p className="bndz-meshdrop-status">{status}</p>}
      </div>
    </div>
  );
}
