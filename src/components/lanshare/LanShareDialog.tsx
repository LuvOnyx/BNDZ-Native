import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { IPC } from '../../lib/ipcBridge';
import { pushToast } from '../ToastHost';

type LanShareSession = {
  shareId?: string;
  folderPath?: string;
  folderName?: string;
  token?: string;
  lanAddress?: string;
  port?: number;
  url?: string;
  hasPassword?: boolean;
  running?: boolean;
  lastError?: string;
  bytesServed?: number;
  requestCount?: number;
};

type Props = {
  paths?: string[];
  onClose: () => void;
};

function pickFolder(paths: string[]): string | null {
  const first = (paths || []).find(Boolean);
  if (!first) return null;
  // If a file was selected, share its parent folder.
  const normalized = first.replace(/\//g, '\\');
  if (/\.[^\\/]+$/.test(normalized) && !normalized.endsWith('\\')) {
    const idx = normalized.lastIndexOf('\\');
    return idx > 0 ? normalized.slice(0, idx) : normalized;
  }
  return normalized;
}

export default function LanShareDialog({ paths: initialPaths = [], onClose }: Props) {
  const folder = useMemo(() => pickFolder(initialPaths), [initialPaths]);
  const [session, setSession] = useState<LanShareSession | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(
    folder
      ? 'Ready to share this folder on your LAN (read-only).'
      : 'Select a folder first, then open Share on LAN.',
  );
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [honestNote, setHonestNote] = useState(
    'Phone must be on the same Wi‑Fi. This is not an internet / “sent” link.',
  );

  const refresh = useCallback(async () => {
    try {
      const r = await IPC.lanShareStatus();
      const sessions = Array.isArray(r.sessions) ? r.sessions as LanShareSession[] : [];
      const active = sessions.find(s => s.running) || sessions[0] || null;
      setSession(active);
      if (!active?.running) {
        setHonestNote('Share is stopped. Nothing is reachable on the phone until you Start again.');
      } else {
        setHonestNote('Share is live on LAN only. If the phone is off this Wi‑Fi, the page will fail — that is expected.');
      }
    } catch (e) {
      setStatus((e as Error).message || 'Could not read share status');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => { void refresh(); }, 4000);
    return () => window.clearInterval(t);
  }, [refresh]);

  const url = session?.running ? (session.url || '') : '';

  useEffect(() => {
    if (!url) {
      setQrDataUrl('');
      return;
    }
    let cancelled = false;
    import('qrcode')
      .then(QR => QR.toDataURL(url, { margin: 1, width: 220, color: { dark: '#22d3ee', light: '#0a0e14' } }))
      .then(u => { if (!cancelled) setQrDataUrl(u); })
      .catch(() => { if (!cancelled) setQrDataUrl(''); });
    return () => { cancelled = true; };
  }, [url]);

  const start = useCallback(async () => {
    if (!folder) {
      setStatus('Select a folder in BNDZ first.');
      return;
    }
    setBusy(true);
    setStatus('Starting BNDZ LAN share server...');
    try {
      const r = await IPC.lanShareStart(folder, password.trim() || undefined);
      if (!r.ok || !r.session) throw new Error(r.error || 'Failed to start share');
      setSession(r.session as LanShareSession);
      setStatus('Share is running. Open the URL on your phone (same Wi‑Fi).');
      pushToast({ kind: 'success', title: 'LAN Share started', detail: (r.session as LanShareSession).url || folder });
    } catch (e) {
      setStatus((e as Error).message);
      pushToast({ kind: 'error', title: 'LAN Share failed', detail: (e as Error).message });
    } finally {
      setBusy(false);
      void refresh();
    }
  }, [folder, password, refresh]);

  const stop = useCallback(async () => {
    setBusy(true);
    try {
      if (session?.shareId) await IPC.lanShareStop(session.shareId);
      else await IPC.lanShareStopAll();
      setSession(null);
      setStatus('Share stopped. Phone links no longer work.');
      pushToast({ kind: 'info', title: 'LAN Share stopped' });
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
      void refresh();
    }
  }, [session?.shareId, refresh]);

  const copyUrl = useCallback(async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      pushToast({ kind: 'success', title: 'Copied LAN URL' });
    } catch {
      pushToast({ kind: 'error', title: 'Copy failed' });
    }
  }, [url]);

  return (
    <div className="bndz-meshdrop-overlay" role="dialog" aria-modal="true" aria-label="Share on LAN">
      <div className="bndz-meshdrop-dialog" style={{ width: 'min(540px, 100%)' }}>
        <div className="bndz-meshdrop-aurora" />
        <div className="bndz-meshdrop-head">
          <div>
            <div className="bndz-meshdrop-title">Share on LAN</div>
            <div className="bndz-meshdrop-sub">
              BNDZ-owned folder browser for phones on your Wi‑Fi (CopyParty-style, read-only)
            </div>
          </div>
          <button type="button" className="bndz-meshdrop-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="bndz-meshdrop-body space-y-3">
          <div className="bndz-meshdrop-panel">
            <label className="bndz-meshdrop-label">Folder</label>
            <code className="bndz-meshdrop-code bndz-meshdrop-code--full">{folder || 'No folder selected'}</code>
          </div>

          <div className="bndz-meshdrop-panel">
            <label className="bndz-meshdrop-label">Optional password (HTTP Basic)</label>
            <input
              className="bndz-meshdrop-input"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Leave blank for token-only URL"
              autoComplete="new-password"
              disabled={!!session?.running}
            />
            <p className="bndz-meshdrop-micro">
              Safe defaults: read-only · token in URL · bind LAN IP only · no write · no SMB/FTP.
            </p>
          </div>

          {url ? (
            <>
              <div className="bndz-meshdrop-panel">
                <label className="bndz-meshdrop-label">LAN URL</label>
                <div className="bndz-meshdrop-code-row">
                  <code className="bndz-meshdrop-code bndz-meshdrop-code--link">{url}</code>
                  <button type="button" className="bndz-meshdrop-btn" onClick={() => void copyUrl()}>Copy</button>
                </div>
                <p className="bndz-meshdrop-micro">
                  {session?.lanAddress}:{session?.port} · {session?.requestCount ?? 0} requests ·{' '}
                  {Math.round((session?.bytesServed ?? 0) / 1024)} KB served
                </p>
              </div>
              <div className="bndz-meshdrop-panel bndz-meshdrop-qr-wrap">
                {qrDataUrl ? (
                  <img src={qrDataUrl} alt="LAN share QR" className="bndz-meshdrop-qr" />
                ) : (
                  <div className="bndz-meshdrop-qr-placeholder">Generating QR...</div>
                )}
                <p className="bndz-meshdrop-micro text-center">Scan on your phone (same Wi‑Fi).</p>
              </div>
            </>
          ) : null}

          <p className={session?.running ? 'bndz-meshdrop-micro' : 'bndz-meshdrop-warn'}>{honestNote}</p>
          <p className="bndz-meshdrop-micro">{status}</p>
          {session?.lastError ? <p className="bndz-meshdrop-warn">Last error: {session.lastError}</p> : null}

          <div className="flex gap-2 pt-1">
            {!session?.running ? (
              <button type="button" className="bndz-meshdrop-cta flex-1" disabled={busy || !folder} onClick={() => void start()}>
                <Icons8Icon id="emblem-shared" size={14} /> Start LAN Share
              </button>
            ) : (
              <button type="button" className="bndz-meshdrop-btn flex-1" disabled={busy} onClick={() => void stop()}>
                Stop share
              </button>
            )}
            <button type="button" className="bndz-meshdrop-btn" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
