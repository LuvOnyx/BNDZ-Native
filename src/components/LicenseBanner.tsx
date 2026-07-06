import React, { useEffect, useState } from 'react';
import { KeyRound, X } from 'lucide-react';
import { IPC } from '../lib/ipcBridge';
import type { LicenseStatus } from '../lib/licenseTypes';

export default function LicenseBanner({ onRegister }: { onRegister: () => void }) {
  const [dismissed, setDismissed] = useState(false);
  const [status, setStatus] = useState<LicenseStatus | null>(null);

  useEffect(() => {
    IPC.getLicenseStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  if (dismissed || !status || status.activated) return null;

  const trialLine = status.trialExpired
    ? 'Your trial has ended.'
    : `Trial: ${status.trialDaysRemaining} day${status.trialDaysRemaining === 1 ? '' : 's'} remaining.`;

  return (
    <div className="shrink-0 flex items-center justify-between gap-3 px-3 py-1.5 bg-gradient-to-r from-amber-950/50 via-[#1a1510] to-transparent border-b border-amber-500/20 text-[11px]">
      <div className="flex items-center gap-2 text-amber-200/90 min-w-0">
        <KeyRound size={13} className="text-amber-400 shrink-0" />
        <span className="truncate">
          {trialLine}{' '}
          <button type="button" onClick={onRegister} className="text-sky-400 hover:text-sky-300 underline underline-offset-2 font-medium">
            {status.trialExpired ? 'Activate now' : 'Enter license key'}
          </button>
          {!status.trialExpired && ' for full support and updates.'}
        </span>
      </div>
      {!status.trialExpired && (
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="p-1 rounded hover:bg-white/5 text-gray-500 hover:text-gray-300 shrink-0"
          aria-label="Dismiss"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}
