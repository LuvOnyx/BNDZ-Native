import React, { lazy, Suspense, useEffect, useState } from 'react';
import { NativeDialogShell } from './native/NativeDialogShell';
import { IPC, type LicenseStatus } from '../lib/ipcBridge';
import { EMPTY_LICENSE_STATUS } from '../lib/licenseTypes';

const RegisterDialog = lazy(() => import('./RegisterDialog'));

/**
 * Trial expired gate. Never stacks with Register:
 * - gate phase shows only the trial alert
 * - register phase shows only RegisterDialog
 * - externalRegisterOpen (Help → Register) also suppresses the gate
 */
export default function TrialExpiredGate({
  children,
  onActivated,
  externalRegisterOpen = false,
}: {
  children: React.ReactNode;
  onActivated?: () => void;
  /** True while the app-level Register dialog is open (menu / banner). */
  externalRegisterOpen?: boolean;
}) {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [phase, setPhase] = useState<'gate' | 'register'>('gate');

  useEffect(() => {
    IPC.getLicenseStatus().then(setStatus).catch(() => setStatus(EMPTY_LICENSE_STATUS));
  }, []);

  useEffect(() => {
    if (externalRegisterOpen) setPhase('gate');
  }, [externalRegisterOpen]);

  if (!status || status.canUseApp !== false) {
    return <>{children}</>;
  }

  const showGate = phase === 'gate' && !externalRegisterOpen;
  const showRegister = phase === 'register' && !externalRegisterOpen;

  return (
    <>
      {children}
      {showGate && (
        <NativeDialogShell
          open
          title="Your 14-day trial has ended"
          subtitle="Activate BNDZ to continue using the file manager"
          tone="warning"
          variant="alert"
          size="sm"
          zIndexClass="z-[9000]"
          showCloseButton={false}
          panelClassName="bndz-license-gate-dialog"
          footer={
            <div className="w-full flex flex-col items-stretch gap-2.5">
              <button
                type="button"
                onClick={() => setPhase('register')}
                className="bndz-native-btn bndz-native-btn--primary bndz-native-btn--hero w-full"
              >
                Enter license key
              </button>
              <p className="text-[10px] bndz-native-dialog-muted text-center leading-relaxed">
                Help → Register BNDZ · Purchase at your vendor portal
              </p>
            </div>
          }
        >
          <p className="bndz-native-alert-message">
            Activate BNDZ with your license key to continue.
            Your settings and workspace are preserved.
          </p>
        </NativeDialogShell>
      )}
      {showRegister && (
        <Suspense fallback={null}>
          <RegisterDialog
            onClose={() => setPhase('gate')}
            onActivated={() => {
              setPhase('gate');
              onActivated?.();
            }}
          />
        </Suspense>
      )}
    </>
  );
}
