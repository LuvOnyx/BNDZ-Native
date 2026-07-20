import React, { lazy, Suspense, useEffect, useState } from 'react';
import { NativeDialogShell } from './native/NativeDialogShell';
import { IPC, type LicenseStatus } from '../lib/ipcBridge';
import { DENIED_LICENSE_STATUS, PENDING_LICENSE_STATUS } from '../lib/licenseTypes';

const RegisterDialog = lazy(() => import('./RegisterDialog'));

/**
 * Trial expired gate. Never stacks with Register:
 * - gate phase shows only the trial alert
 * - register phase shows only RegisterDialog
 * - externalRegisterOpen (Help → Register) also suppresses the gate
 *
 * Fail-closed: native status errors deny use after retries. Pending status
 * does not show the gate (avoids flash on startup).
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
    let cancelled = false;
    const load = async () => {
      const isNative = IPC.isNative;
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const next = await IPC.getLicenseStatus();
          if (!cancelled) setStatus({ ...next, statusPending: false });
          return;
        } catch (err) {
          lastError = err;
          await new Promise(r => setTimeout(r, 150 * (attempt + 1)));
        }
      }
      if (cancelled) return;
      // Native: fail closed. Browser preview: stay permissive for Vite-only work.
      setStatus(isNative ? DENIED_LICENSE_STATUS : { ...PENDING_LICENSE_STATUS, statusPending: false });
      if (lastError) console.warn('[license] status failed', lastError);
    };
    setStatus(PENDING_LICENSE_STATUS);
    void load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (externalRegisterOpen) setPhase('gate');
  }, [externalRegisterOpen]);

  // Still loading — render app without gate flash.
  if (!status || status.statusPending) {
    return <>{children}</>;
  }

  if (status.canUseApp !== false) {
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
