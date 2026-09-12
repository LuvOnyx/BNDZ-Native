import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icons8Icon } from './Icons8Icon';
import { IPC } from '../lib/ipcBridge';
import { EMPTY_LICENSE_STATUS } from '../lib/licenseTypes';
import { CloseGlyph } from './ChromeGlyphs';

const SEGMENT_COUNT = 4;
const SEGMENT_LEN = 4;

function splitSerial(raw: string): string[] {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const body = cleaned.startsWith('BNDZ') && cleaned.length > 4 ? cleaned.slice(4) : cleaned;
  const parts: string[] = [];
  for (let i = 0; i < SEGMENT_COUNT; i++) {
    parts.push(body.slice(i * SEGMENT_LEN, (i + 1) * SEGMENT_LEN));
  }
  return parts;
}

function joinSerial(parts: string[]): string {
  const body = parts.map(p => p.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, SEGMENT_LEN));
  if (body.every(p => !p)) return '';
  return `BNDZ-${body.join('-')}`.replace(/-+$/g, '');
}

function TrialDial({ pct, expired, label }: { pct: number; expired: boolean; label: string }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  const dash = (clamped / 100) * c;
  return (
    <div className={`bndz-key-dial${expired ? ' is-expired' : ''}`}>
      <svg viewBox="0 0 88 88" width="88" height="88" aria-hidden>
        <circle className="bndz-key-dial-track" cx="44" cy="44" r={r} />
        <circle
          className="bndz-key-dial-arc"
          cx="44"
          cy="44"
          r={r}
          strokeDasharray={`${dash} ${c}`}
          transform="rotate(-90 44 44)"
        />
      </svg>
      <div className="bndz-key-dial-core">
        <strong>{expired ? '0' : Math.round(clamped)}</strong>
        <span>{expired ? 'ended' : '% left'}</span>
      </div>
      <span className="bndz-key-dial-caption">{label}</span>
    </div>
  );
}

/**
 * Register BNDZ — license certificate (not a form sheet).
 * Trial dial, segmented serial wells, licensed seal.
 */
export default function RegisterDialog({
  onClose,
  onActivated,
}: {
  onClose: () => void;
  onActivated?: () => void;
}) {
  const [segments, setSegments] = useState(['', '', '', '']);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [status, setStatus] = useState<import('../lib/licenseTypes').LicenseStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    IPC.getLicenseStatus().then(setStatus).catch(() => setStatus(EMPTY_LICENSE_STATUS));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const serial = joinSerial(segments);
  const serialComplete = segments.every(s => s.length === SEGMENT_LEN);
  const canActivate = serialComplete && Boolean(email.trim()) && !busy;

  const setSegment = (index: number, value: string) => {
    const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (cleaned.length > SEGMENT_LEN) {
      const parts = splitSerial(cleaned);
      setSegments(parts);
      const focusAt = Math.min(SEGMENT_COUNT - 1, Math.floor(cleaned.replace(/^BNDZ/, '').length / SEGMENT_LEN));
      requestAnimationFrame(() => inputsRef.current[focusAt]?.focus());
      return;
    }
    const next = [...segments];
    next[index] = cleaned.slice(0, SEGMENT_LEN);
    setSegments(next);
    if (cleaned.length >= SEGMENT_LEN && index < SEGMENT_COUNT - 1) {
      inputsRef.current[index + 1]?.focus();
    }
  };

  const onSegmentKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !segments[index] && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
    if (e.key === 'ArrowLeft' && index > 0 && (e.currentTarget.selectionStart || 0) === 0) {
      inputsRef.current[index - 1]?.focus();
    }
    if (e.key === 'ArrowRight' && index < SEGMENT_COUNT - 1 && (e.currentTarget.selectionStart || 0) >= segments[index].length) {
      inputsRef.current[index + 1]?.focus();
    }
    if (e.key === 'Enter' && canActivate) void activate();
  };

  const activate = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await IPC.activateLicense(serial, email.trim(), name.trim());
      if (result.success) {
        setMessage({ kind: 'ok', text: result.message || 'Activation successful.' });
        const next = await IPC.getLicenseStatus();
        setStatus(next);
        onActivated?.();
      } else {
        setMessage({ kind: 'err', text: result.message || 'Activation failed.' });
      }
    } catch {
      setMessage({ kind: 'err', text: 'Could not reach the license server. Check your connection and try again.' });
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async () => {
    setBusy(true);
    try {
      await IPC.deactivateLicense();
      const next = await IPC.getLicenseStatus();
      setStatus(next);
      setSegments(['', '', '', '']);
      setMessage({ kind: 'ok', text: 'License removed from this PC. You can activate it on another machine.' });
    } finally {
      setBusy(false);
    }
  };

  const trialTotal = status?.trialDaysTotal || 14;
  const trialLeft = Math.max(0, status?.trialDaysRemaining ?? trialTotal);
  const trialPct = Math.round((trialLeft / Math.max(1, trialTotal)) * 100);
  const trialExpired = !!status?.trialExpired;
  const dialLabel = useMemo(() => {
    if (!status) return 'Loading trial…';
    if (trialExpired) return 'Trial ended — activate to continue';
    return `${trialLeft} of ${trialTotal} trial days left`;
  }, [status, trialExpired, trialLeft, trialTotal]);

  return createPortal(
    <div
      className="bndz-key-scrim"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bndz-key-ticket"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bndz-key-title"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="bndz-key-perf" aria-hidden />

        <div className="bndz-key-body">
          <header className="bndz-key-masthead">
            <div>
              <div className="bndz-key-kicker">Product license</div>
              <h1 id="bndz-key-title" className="bndz-key-title">
                {status?.activated ? 'Licensed workstation' : 'Register BNDZ'}
              </h1>
            </div>
            <button type="button" className="bndz-key-x" onClick={onClose} aria-label="Close">
              <CloseGlyph size={11} />
            </button>
          </header>

          {status?.activated ? (
            <div className="bndz-key-seal-card">
              <div className="bndz-key-seal" aria-hidden>
                <span>LICENSED</span>
              </div>
              <div className="bndz-key-seal-copy">
                <img src="/bndz-light.png" alt="" className="bndz-key-seal-mark" draggable={false} />
                <strong>{status.name || 'Registered user'}</strong>
                <span>{status.email}</span>
                <code>{status.serialMasked}</code>
                {status.onlineBound && <em>Online seat bound to this machine</em>}
              </div>
            </div>
          ) : (
            <div className="bndz-key-grid">
              <TrialDial pct={trialPct} expired={trialExpired} label={dialLabel} />

              <div className="bndz-key-entry">
                <label className="bndz-key-field-label" htmlFor="bndz-key-seg-0">Serial number</label>
                <div className="bndz-key-wells">
                  <span className="bndz-key-prefix" aria-hidden>BNDZ</span>
                  {segments.map((seg, i) => (
                    <React.Fragment key={i}>
                      {i > 0 && <span className="bndz-key-dash" aria-hidden>—</span>}
                      <input
                        id={i === 0 ? 'bndz-key-seg-0' : undefined}
                        ref={el => { inputsRef.current[i] = el; }}
                        value={seg}
                        onChange={e => setSegment(i, e.target.value)}
                        onKeyDown={e => onSegmentKeyDown(i, e)}
                        onPaste={e => {
                          const text = e.clipboardData.getData('text');
                          if (text && text.replace(/[^A-Za-z0-9]/g, '').length > SEGMENT_LEN) {
                            e.preventDefault();
                            setSegment(i, text);
                          }
                        }}
                        placeholder="XXXX"
                        maxLength={SEGMENT_LEN}
                        spellCheck={false}
                        autoComplete="off"
                        autoFocus={i === 0}
                        aria-label={`Serial group ${i + 1}`}
                      />
                    </React.Fragment>
                  ))}
                </div>

                <div className="bndz-key-fields">
                  <div className="bndz-key-field">
                    <label htmlFor="bndz-key-email">Email</label>
                    <input
                      id="bndz-key-email"
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="you@company.com"
                      autoComplete="email"
                      onKeyDown={e => {
                        if (e.key === 'Enter' && canActivate) void activate();
                      }}
                    />
                  </div>
                  <div className="bndz-key-field">
                    <label htmlFor="bndz-key-name">Name / Organization <em>(optional)</em></label>
                    <input
                      id="bndz-key-name"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder="Your name or company"
                      autoComplete="organization"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {message && (
            <div className={`bndz-key-message ${message.kind === 'ok' ? 'is-ok' : 'is-err'}`}>
              {message.kind === 'ok'
                ? <Icons8Icon id="check" size={14} />
                : <Icons8Icon id="error_ui" size={14} />}
              {message.text}
            </div>
          )}

          <div className="bndz-key-actions">
            {status?.activated ? (
              <>
                <button type="button" className="bndz-key-btn bndz-key-btn--ghost" onClick={() => void deactivate()} disabled={busy}>
                  {busy ? 'Releasing…' : 'Deactivate this PC'}
                </button>
                <button type="button" className="bndz-key-btn bndz-key-btn--solid" onClick={onClose}>
                  Done
                </button>
              </>
            ) : (
              <>
                <button type="button" className="bndz-key-btn bndz-key-btn--ghost" onClick={onClose}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="bndz-key-btn bndz-key-btn--solid"
                  disabled={!canActivate}
                  onClick={() => void activate()}
                >
                  {busy ? 'Activating…' : 'Activate license'}
                </button>
              </>
            )}
          </div>

          {!status?.activated && (
            <p className="bndz-key-footnote">
              One serial activates one PC. Internet is required. Deactivate here before moving the seat.
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
