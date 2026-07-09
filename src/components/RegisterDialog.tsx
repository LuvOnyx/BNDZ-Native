import React, { useEffect, useState } from 'react';
import { Icons8Icon } from './Icons8Icon';
import { IPC } from '../lib/ipcBridge';
import { EMPTY_LICENSE_STATUS } from '../lib/licenseTypes';
import { NativeDialogShell } from './native/NativeDialogShell';

export default function RegisterDialog({ onClose, onActivated }: { onClose: () => void; onActivated?: () => void }) {
  const [serial, setSerial] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [status, setStatus] = useState<import('../lib/licenseTypes').LicenseStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    IPC.getLicenseStatus().then(setStatus).catch(() => setStatus(EMPTY_LICENSE_STATUS));
  }, []);

  const activate = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await IPC.activateLicense(serial.trim(), email.trim(), name.trim());
      if (result.success) {
        setMessage({ kind: 'ok', text: result.message || 'Activation successful.' });
        const next = await IPC.getLicenseStatus();
        setStatus(next);
        onActivated?.();
      } else {
        setMessage({ kind: 'err', text: result.message || 'Activation failed.' });
      }
    } catch {
      setMessage({ kind: 'err', text: 'Could not contact the license service.' });
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
      setSerial('');
      setMessage({ kind: 'ok', text: 'License removed from this device.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <NativeDialogShell
      open
      title="Register BNDZ"
      subtitle="Activate your license on this PC"
      tone="info"
      iconId="key_ui"
      onClose={onClose}
      zIndexClass="z-[520]"
      size="md"
      footerButtons={
        status?.activated
          ? [
              { label: 'Deactivate', style: 'secondary', onClick: deactivate },
              { label: 'Done', style: 'primary', onClick: onClose },
            ]
          : [
              { label: 'Cancel', style: 'secondary', onClick: onClose },
              {
                label: busy ? 'Activating…' : 'Activate',
                style: 'primary',
                onClick: () => { if (!busy && serial.trim() && email.trim()) void activate(); },
              },
            ]
      }
    >
      <div className="space-y-3 -mt-1">
        {status?.activated ? (
          <div className="bndz-native-status-ok flex items-start gap-3">
            <Icons8Icon id="checksquare_ui" size={18} className="shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">Licensed</div>
              <div className="bndz-native-dialog-muted mt-1">{status.name || 'Registered user'}</div>
              <div className="bndz-native-dialog-muted">{status.email}</div>
              <div className="bndz-native-dialog-muted font-mono text-[10px] mt-1">{status.serialMasked}</div>
            </div>
          </div>
        ) : (
          <>
            {!status?.trialExpired && status && (
              <div className="bndz-native-status-warn">
                {status.trialDaysRemaining} day{status.trialDaysRemaining === 1 ? '' : 's'} left in your trial.
                Enter your license key to activate permanently.
              </div>
            )}
            {status?.trialExpired && (
              <div className="bndz-native-status-error">
                Your 14-day trial has ended. Activate to continue using BNDZ.
              </div>
            )}
            <div>
              <label className="bndz-native-field-label">Serial number</label>
              <input
                value={serial}
                onChange={e => setSerial(e.target.value.toUpperCase())}
                placeholder="BNDZ-XXXX-XXXX-XXXX"
                className="bndz-native-input font-mono"
              />
            </div>
            <div>
              <label className="bndz-native-field-label">Email</label>
              <input
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@company.com"
                type="email"
                className="bndz-native-input"
              />
            </div>
            <div>
              <label className="bndz-native-field-label">Name / Organization</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Your name or company"
                className="bndz-native-input"
              />
            </div>
          </>
        )}

        {message && (
          <div className={`text-[11px] flex items-center gap-2 ${message.kind === 'ok' ? 'text-emerald-400' : 'text-rose-400'}`}>
            {message.kind === 'ok' ? <Icons8Icon id="check" size={14} /> : <Icons8Icon id="error_ui" size={14} />}
            {message.text}
          </div>
        )}
      </div>
    </NativeDialogShell>
  );
}
