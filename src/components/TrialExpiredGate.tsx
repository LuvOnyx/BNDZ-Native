import React, { useEffect, useState } from 'react';
import { NativeDialogShell } from './native/NativeDialogShell';
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
    <NativeDialogShell
      open
      title="Your 14-day trial has ended"
      subtitle="Activate BNDZ to continue using the file manager"
      tone="warning"
      variant="alert"
      size="sm"
      zIndexClass="z-[99999]"
      showCloseButton={false}
      footer={
        <div className="w-full flex flex-col items-stretch gap-2">
          <button
            type="button"
            onClick={onRegister}
            className="bndz-native-btn bndz-native-btn--primary w-full"
          >
            Enter license key
          </button>
          <p className="text-[10px] bndz-native-dialog-muted text-center">
            Help → Register BNDZ · Purchase at your vendor portal
          </p>
        </div>
      }
    >
      <p className="bndz-native-alert-message text-center">
        Activate BNDZ with your license key to continue.
        Your settings and workspace are preserved.
      </p>
    </NativeDialogShell>
  );
}
