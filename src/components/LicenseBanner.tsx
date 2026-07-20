import React, { useEffect, useState } from 'react';
import { Icons8Icon } from './Icons8Icon';
import { CloseGlyph } from './ChromeGlyphs';
import { IPC } from '../lib/ipcBridge';
import type { LicenseStatus } from '../lib/licenseTypes';

export default function LicenseBanner({
  onRegister,
  refreshKey = 0,
}: {
  onRegister: () => void;
  /** Bump after activate/deactivate so the banner re-reads license state. */
  refreshKey?: number;
}) {
  const [dismissed, setDismissed] = useState(false);
  const [status, setStatus] = useState<LicenseStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDismissed(false);
    IPC.getLicenseStatus()
      .then(next => { if (!cancelled) setStatus(next); })
      .catch(() => { if (!cancelled) setStatus(null); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  if (dismissed || !status || status.activated) return null;

  const trialLine = status.trialExpired
    ? 'Your trial has ended.'
    : `Trial: ${status.trialDaysRemaining} day${status.trialDaysRemaining === 1 ? '' : 's'} remaining.`;

  return (
    <div className="shrink-0 flex items-center justify-between gap-3 px-3 py-1.5 bg-[#2a2418] border-b border-amber-500/20 text-[11px]">
      <div className="flex items-center gap-2 text-amber-200/90 min-w-0">
        <Icons8Icon id="key_ui" size={13} className="shrink-0" />
        <span className="truncate">
          {trialLine}{' '}
          <button type="button" onClick={onRegister} className="text-[#7eb8e8] hover:text-[#99c9f0] underline underline-offset-2 font-medium">
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
          <CloseGlyph size={12} />
        </button>
      )}
    </div>
  );
}
