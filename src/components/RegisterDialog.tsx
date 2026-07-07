import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Icons8Icon } from './Icons8Icon';
import { CloseGlyph } from './ChromeGlyphs';
import { IPC } from '../lib/ipcBridge';
import { EMPTY_LICENSE_STATUS } from '../lib/licenseTypes';

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
    <div
      className="fixed inset-0 z-[520] flex items-center justify-center p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="relative w-full max-w-[460px] rounded-2xl border border-white/10 bg-gradient-to-br from-[#1c1c24] to-[#141418] shadow-2xl overflow-hidden"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between bg-gradient-to-r from-emerald-900/30 to-transparent">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-emerald-500/15 flex items-center justify-center">
              <Icons8Icon id="key_ui" size={18} />
            </div>
            <div>
              <h2 className="text-[15px] font-bold text-white">Register BNDZ</h2>
              <p className="text-[10px] text-gray-500">Activate your license on this PC</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/10">
            <CloseGlyph size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          {status?.activated ? (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 flex items-start gap-3">
              <Icons8Icon id="checksquare_ui" size={18} className="shrink-0 mt-0.5" />
              <div className="text-[12px]">
                <div className="text-emerald-200 font-semibold">Licensed</div>
                <div className="text-gray-400 mt-1">{status.name || 'Registered user'}</div>
                <div className="text-gray-500">{status.email}</div>
                <div className="text-gray-600 font-mono text-[10px] mt-1">{status.serialMasked}</div>
              </div>
            </div>
          ) : (
            <>
              {!status?.trialExpired && status && (
                <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-2.5 text-[11px] text-amber-100/90 mb-1">
                  {status.trialDaysRemaining} day{status.trialDaysRemaining === 1 ? '' : 's'} left in your trial.
                  Enter your license key to activate permanently.
                </div>
              )}
              {status?.trialExpired && (
                <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-[11px] text-rose-200 mb-1">
                  Your 14-day trial has ended. Activate to continue using BNDZ.
                </div>
              )}
              <label className="block text-[11px] text-gray-400">Serial number</label>
              <input
                value={serial}
                onChange={e => setSerial(e.target.value.toUpperCase())}
                placeholder="BNDZ-XXXX-XXXX-XXXX"
                className="w-full bg-[#0d0d10] border border-[#444] rounded-lg px-3 py-2 text-[13px] text-white font-mono outline-none focus:border-sky-500"
              />
              <label className="block text-[11px] text-gray-400">Email</label>
              <input
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@company.com"
                type="email"
                className="w-full bg-[#0d0d10] border border-[#444] rounded-lg px-3 py-2 text-[13px] text-white outline-none focus:border-sky-500"
              />
              <label className="block text-[11px] text-gray-400">Name / Organization</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Your name or company"
                className="w-full bg-[#0d0d10] border border-[#444] rounded-lg px-3 py-2 text-[13px] text-white outline-none focus:border-sky-500"
              />
            </>
          )}

          {message && (
            <div className={`text-[11px] flex items-center gap-2 ${message.kind === 'ok' ? 'text-emerald-400' : 'text-rose-400'}`}>
              {message.kind === 'ok' ? <Icons8Icon id="check" size={14} /> : <Icons8Icon id="error_ui" size={14} />}
              {message.text}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/5 flex justify-between gap-2">
          {status?.activated ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={deactivate}
                className="px-3 py-1.5 rounded-lg border border-[#555] text-gray-400 hover:text-white text-[12px] transition-colors"
              >
                Deactivate
              </button>
              <button type="button" onClick={onClose} className="px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-[12px]">
                Done
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg text-gray-400 hover:text-white text-[12px]">
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || !serial.trim() || !email.trim()}
                onClick={activate}
                className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-[12px] flex items-center gap-2"
              >
                {busy && <Icons8Icon id="loading" size={14} spin />}
                Activate
              </button>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
