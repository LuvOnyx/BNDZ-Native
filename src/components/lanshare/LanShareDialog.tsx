import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { IPC } from '../../lib/ipcBridge';
import { pushToast } from '../ToastHost';

type ProtocolStatus = {
  http?: boolean; webdav?: boolean; ftp?: boolean; ftps?: boolean;
  sftp?: boolean; sshShell?: boolean; tftp?: boolean; smb?: boolean;
  ftpNote?: string; ftpsNote?: string; sshNote?: string; tftpNote?: string; smbNote?: string;
};

type LanShareSession = {
  shareId?: string; folderPath?: string; folderName?: string; token?: string;
  lanAddress?: string; httpPort?: number; port?: number; url?: string; hubUrl?: string;
  label?: string; username?: string; hasPassword?: boolean; allowWrite?: boolean;
  expiresUtc?: string; running?: boolean; expired?: boolean; lastError?: string;
  bytesServed?: number; requestCount?: number; protocols?: ProtocolStatus;
  connectionHints?: Record<string, string>;
};

type Props = { paths?: string[]; onClose: () => void };

function pickFolder(paths: string[]): string | null {
  const first = (paths || []).find(Boolean);
  if (!first) return null;
  const normalized = first.replace(/\//g, '\\');
  // Prefer directory; if it looks like a file, use parent.
  if (/\.[^\\/.]+$/.test(normalized) && !normalized.endsWith('\\')) {
    const idx = normalized.lastIndexOf('\\');
    return idx > 0 ? normalized.slice(0, idx) : normalized;
  }
  return normalized;
}

export default function LanShareDialog({ paths: initialPaths = [], onClose }: Props) {
  const folder = useMemo(() => pickFolder(initialPaths), [initialPaths]);
  const [sessions, setSessions] = useState<LanShareSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('bndz');
  const [slug, setSlug] = useState('');
  const [label, setLabel] = useState('');
  const [expiryMinutes, setExpiryMinutes] = useState(0);
  const [allowWrite, setAllowWrite] = useState(false);
  const [proto, setProto] = useState({
    http: true, webdav: true, ftp: false, ftps: false, sftp: false, sshShell: false, tftp: false, smb: false,
  });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(folder ? 'Ready to share any folder on your LAN.' : 'Select a folder, then open Share on LAN.');
  const [qrDataUrl, setQrDataUrl] = useState('');

  const selected = sessions.find(s => s.shareId === selectedId) || sessions.find(s => s.running) || null;
  const url = selected?.running ? (selected.url || '') : '';

  const refresh = useCallback(async () => {
    try {
      const r = await IPC.lanShareStatus();
      const list = Array.isArray(r.sessions) ? (r.sessions as LanShareSession[]) : [];
      setSessions(list);
      if (selectedId && !list.some(s => s.shareId === selectedId)) setSelectedId(list[0]?.shareId ?? null);
      else if (!selectedId && list[0]?.shareId) setSelectedId(list[0].shareId ?? null);
    } catch (e) {
      setStatus((e as Error).message || 'Could not read share status');
    }
  }, [selectedId]);

  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => { void refresh(); }, 4000);
    return () => window.clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    if (!url) { setQrDataUrl(''); return; }
    let cancelled = false;
    import('qrcode')
      .then(QR => QR.toDataURL(url, { margin: 1, width: 220, color: { dark: '#22d3ee', light: '#0a0e14' } }))
      .then(u => { if (!cancelled) setQrDataUrl(u); })
      .catch(() => { if (!cancelled) setQrDataUrl(''); });
    return () => { cancelled = true; };
  }, [url]);

  const start = useCallback(async () => {
    if (!folder) { setStatus('Select a folder in BNDZ first.'); return; }
    if (proto.smb && !window.confirm('SMB is high-risk and uses LGPL SMBLibrary. It binds port 445 (often needs admin). Enable anyway?')) return;
    setBusy(true);
    setStatus('Starting BNDZ share daemons...');
    try {
      const r = await IPC.lanShareStart(folder, {
        password: password.trim() || undefined,
        username: username.trim() || 'bndz',
        slug: slug.trim() || undefined,
        label: label.trim() || undefined,
        expiryMinutes: expiryMinutes > 0 ? expiryMinutes : undefined,
        allowWrite,
        protocols: proto,
      });
      if (!r.ok || !r.session) throw new Error(r.error || 'Failed to start share');
      const sess = r.session as LanShareSession;
      setSelectedId(sess.shareId ?? null);
      setStatus('Share running. Use HTTP URL/QR on phones; other protocols show connection strings below.');
      pushToast({ kind: 'success', title: 'LAN Share started', detail: sess.url || folder });
    } catch (e) {
      setStatus((e as Error).message);
      pushToast({ kind: 'error', title: 'LAN Share failed', detail: (e as Error).message });
    } finally {
      setBusy(false);
      void refresh();
    }
  }, [folder, password, username, slug, label, expiryMinutes, allowWrite, proto, refresh]);

  const stopOne = useCallback(async (id?: string) => {
    setBusy(true);
    try {
      if (id) await IPC.lanShareStop(id);
      else await IPC.lanShareStopAll();
      setStatus('Share stopped.');
      pushToast({ kind: 'info', title: 'LAN Share stopped' });
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
      void refresh();
    }
  }, [refresh]);

  const copyText = useCallback(async (text: string, title: string) => {
    try { await navigator.clipboard.writeText(text); pushToast({ kind: 'success', title: `Copied ${title}` }); }
    catch { pushToast({ kind: 'error', title: 'Copy failed' }); }
  }, []);

  const toggle = (key: keyof typeof proto) => setProto(p => ({ ...p, [key]: !p[key] }));

  return (
    <div className="bndz-meshdrop-overlay" role="dialog" aria-modal="true" aria-label="Share on LAN">
      <div className="bndz-meshdrop-dialog" style={{ width: 'min(640px, 100%)', maxHeight: '90vh', overflow: 'auto' }}>
        <div className="bndz-meshdrop-aurora" />
        <div className="bndz-meshdrop-head">
          <div>
            <div className="bndz-meshdrop-title">Share on LAN</div>
            <div className="bndz-meshdrop-sub">
              BNDZ-owned CopyParty-style sharer — any folder, multi-volume, HTTP/WebDAV + opt-in FTP/SFTP/SSH/TFTP/SMB
            </div>
          </div>
          <button type="button" className="bndz-meshdrop-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="bndz-meshdrop-body space-y-3">
          <div className="bndz-meshdrop-panel">
            <label className="bndz-meshdrop-label">Folder to add</label>
            <code className="bndz-meshdrop-code bndz-meshdrop-code--full">{folder || 'No folder selected'}</code>
          </div>

          <div className="bndz-meshdrop-panel grid gap-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div>
              <label className="bndz-meshdrop-label">Username</label>
              <input className="bndz-meshdrop-input" value={username} onChange={e => setUsername(e.target.value)} />
            </div>
            <div>
              <label className="bndz-meshdrop-label">Password (optional)</label>
              <input className="bndz-meshdrop-input" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" />
            </div>
            <div>
              <label className="bndz-meshdrop-label">Custom link slug</label>
              <input className="bndz-meshdrop-input" value={slug} onChange={e => setSlug(e.target.value)} placeholder="auto token if blank" />
            </div>
            <div>
              <label className="bndz-meshdrop-label">Label</label>
              <input className="bndz-meshdrop-input" value={label} onChange={e => setLabel(e.target.value)} placeholder="shown on hub" />
            </div>
            <div>
              <label className="bndz-meshdrop-label">Expiry</label>
              <select className="bndz-meshdrop-input" value={expiryMinutes} onChange={e => setExpiryMinutes(Number(e.target.value))}>
                <option value={0}>No expiry</option>
                <option value={60}>1 hour</option>
                <option value={1440}>24 hours</option>
                <option value={10080}>7 days</option>
              </select>
            </div>
            <div className="flex items-end">
              <label className="bndz-meshdrop-micro flex items-center gap-2">
                <input type="checkbox" checked={allowWrite} onChange={e => setAllowWrite(e.target.checked)} />
                Allow write (off by default)
              </label>
            </div>
          </div>

          <div className="bndz-meshdrop-panel">
            <label className="bndz-meshdrop-label">Protocols (dangerous ones off by default)</label>
            <div className="flex flex-wrap gap-2" style={{ fontSize: 12 }}>
              {([
                ['http', 'HTTP'],
                ['webdav', 'WebDAV'],
                ['ftp', 'FTP'],
                ['ftps', 'FTPS'],
                ['sftp', 'SFTP'],
                ['sshShell', 'SSH shell'],
                ['tftp', 'TFTP'],
                ['smb', 'SMB (opt-in)'],
              ] as const).map(([k, lab]) => (
                <label key={k} className="bndz-meshdrop-micro flex items-center gap-1" style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '4px 8px' }}>
                  <input type="checkbox" checked={proto[k]} onChange={() => toggle(k)} disabled={k === 'http'} />
                  {lab}
                </label>
              ))}
            </div>
            <p className="bndz-meshdrop-micro">
              Safe defaults: HTTP+WebDAV on, LAN bind, token URL. SMB needs admin (port 445) and is LGPL. SSH shell is real cmd Process (share-rooted); SFTP is BNDZ SFTP v3 in the share folder.
            </p>
          </div>

          {sessions.length > 0 && (
            <div className="bndz-meshdrop-panel">
              <label className="bndz-meshdrop-label">Active volumes</label>
              {sessions.map(s => (
                <div key={s.shareId} className="flex items-center gap-2" style={{ marginBottom: 6 }}>
                  <button type="button" className={`bndz-meshdrop-btn ${selectedId === s.shareId ? 'is-active' : ''}`} onClick={() => setSelectedId(s.shareId ?? null)}>
                    {(s.label || s.folderName || s.shareId) + (s.running ? '' : ' (stopped)')}
                  </button>
                  <button type="button" className="bndz-meshdrop-btn" disabled={busy} onClick={() => void stopOne(s.shareId)}>Stop</button>
                </div>
              ))}
              <button type="button" className="bndz-meshdrop-btn" disabled={busy} onClick={() => void stopOne()}>Stop all</button>
            </div>
          )}

          {url ? (
            <>
              <div className="bndz-meshdrop-panel">
                <label className="bndz-meshdrop-label">HTTP URL (phones)</label>
                <div className="bndz-meshdrop-code-row">
                  <code className="bndz-meshdrop-code bndz-meshdrop-code--link">{url}</code>
                  <button type="button" className="bndz-meshdrop-btn" onClick={() => void copyText(url, 'URL')}>Copy</button>
                </div>
                {selected?.hubUrl ? (
                  <p className="bndz-meshdrop-micro">Hub: <button type="button" className="bndz-meshdrop-btn" onClick={() => void copyText(selected.hubUrl!, 'hub')}>{selected.hubUrl}</button></p>
                ) : null}
              </div>
              <div className="bndz-meshdrop-panel bndz-meshdrop-qr-wrap">
                {qrDataUrl ? <img src={qrDataUrl} alt="Share QR" className="bndz-meshdrop-qr" /> : <div className="bndz-meshdrop-qr-placeholder">Generating QR...</div>}
              </div>
              {selected?.connectionHints && (
                <div className="bndz-meshdrop-panel">
                  <label className="bndz-meshdrop-label">Connection strings</label>
                  {Object.entries(selected.connectionHints).map(([k, v]) => (
                    <div key={k} className="bndz-meshdrop-code-row" style={{ marginBottom: 6 }}>
                      <code className="bndz-meshdrop-code">{k}: {v}</code>
                      <button type="button" className="bndz-meshdrop-btn" onClick={() => void copyText(v, k)}>Copy</button>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : null}

          <p className="bndz-meshdrop-warn">
            Same Wi‑Fi only. This is not “sent over the internet.” If the share is stopped or the phone leaves LAN, links fail — that is honest.
          </p>
          <p className="bndz-meshdrop-micro">{status}</p>
          {selected?.lastError ? <p className="bndz-meshdrop-warn">Notes: {selected.lastError}</p> : null}

          <div className="flex gap-2 pt-1">
            <button type="button" className="bndz-meshdrop-cta flex-1" disabled={busy || !folder} onClick={() => void start()}>
              <Icons8Icon id="emblem-shared" size={14} /> {sessions.some(s => s.running) ? 'Add volume / apply protocols' : 'Start share'}
            </button>
            <button type="button" className="bndz-meshdrop-btn" onClick={onClose}>Close</button>
          </div>
          <p className="bndz-meshdrop-micro">
            Mesh Drop remains available as desktop↔desktop P2P. For phone / link sharing, use this Share on LAN path.
          </p>
        </div>
      </div>
    </div>
  );
}
