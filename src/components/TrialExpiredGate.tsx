import React, { useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { IPC, type LicenseStatus } from '../lib/ipcBridge';
import { EMPTY_LICENSE_STATUS } from '../lib/licenseTypes';

export default function TrialExpiredGate({
  children,
  onRegister,
}: {
  children: React.ReactNode;
  onRegister: () => void;
}) {
  const [status, setStatus] = useState<LicenseStatus | null>(null);

  useEffect(() => {
    IPC.getLicenseStatus().then(setStatus).catch(() => setStatus(EMPTY_LICENSE_STATUS));
  }, []);

  if (!status || status.canUseApp !== false) {
    return <>{children}</>;
  }

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-[#0a0a0c]/95 backdrop-blur-sm p-6">
      <div className="max-w-md w-full rounded-[var(--bndz-radius-md)] border border-amber-500/30 bg-gradient-to-b from-[#1a1510] to-[#0f0f12] p-8 shadow-2xl text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/15 border border-amber-500/25">
          <KeyRound size={28} className="text-amber-400" />
        </div>
        <h2 className="text-lg font-bold text-gray-100 mb-2">Your 14-day trial has ended</h2>
        <p className="text-[13px] text-gray-400 mb-6 leading-relaxed">
          Activate BNDZ with your license key to continue using the file manager.
          Your settings and workspace are preserved.
        </p>
        <button
          type="button"
          onClick={onRegister}
          className="w-full py-2.5 rounded-[var(--bndz-radius-sm)] bg-sky-600 hover:bg-sky-500 text-white font-semibold text-sm transition-colors"
        >
          Enter license key
        </button>
        <p className="mt-4 text-[10px] text-gray-600">
          Help → Register BNDZ · Purchase at your vendor portal
        </p>
      </div>
    </div>
  );
}
