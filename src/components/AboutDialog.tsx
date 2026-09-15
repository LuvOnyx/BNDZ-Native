import React, { useEffect, useState } from 'react';
import { Icons8Icon } from './Icons8Icon';
import { BndzPlaque } from './BndzPlaque';
import { showNativeAlert } from '../lib/nativeDialog';
import { NativeDialogShell } from './native/NativeDialogShell';

const FALLBACK_VERSION = '1.0.0';

type UpdateInfo = {
  currentVersion: string;
  latestVersion?: string | null;
  updateAvailable: boolean;
  releaseUrl?: string | null;
  releaseNotes?: string | null;
  error?: string | null;
};

export default function AboutDialog({
  onClose,
  updateCheckUrl,
  includeBetaVersions = false,
}: {
  onClose: () => void;
  updateCheckUrl?: string;
  includeBetaVersions?: boolean;
}) {
  const [version, setVersion] = useState(FALLBACK_VERSION);
  const [checking, setChecking] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    import('../lib/ipcBridge').then(({ IPC }) => {
      IPC.getAppVersion().then(v => { if (v) setVersion(v); }).catch(() => {});
    });
  }, []);

  const checkUpdates = async () => {
    setChecking(true);
    setUpdateInfo(null);
    try {
      const { IPC } = await import('../lib/ipcBridge');
      const result = await IPC.checkForUpdates(updateCheckUrl, includeBetaVersions);
      setUpdateInfo(result);
      if (result.currentVersion) setVersion(result.currentVersion);
    } catch (err: any) {
      setUpdateInfo({ currentVersion: version, updateAvailable: false, error: err?.message || 'Check failed' });
    } finally {
      setChecking(false);
    }
  };

  const openLegal = (key: 'eula' | 'privacy' | 'third-party') => {
    void import('../lib/ipcBridge').then(({ IPC }) =>
      IPC.openLegalDoc(key).then(r => {
        if (!r.ok && r.error) showNativeAlert(r.error, 'Legal document', 'error');
      }),
    );
  };

  return (
    <NativeDialogShell
      open
      title="About BNDZ"
      subtitle="Native file manager for Windows"
      tone="info"
      variant="sheet"
      onClose={onClose}
      showCloseButton
      zIndexClass="z-[520]"
      size="md"
      footerButtons={[{ label: 'Close', style: 'primary', onClick: onClose }]}
    >
      <div className="bndz-about-body space-y-4 -mt-1">
        <div className="bndz-register-brand !mb-0">
          <BndzPlaque tone="brand" size="md" className="bndz-register-brand-mark" animate={false} />
          <div className="bndz-register-brand-copy">
            <div className="bndz-register-brand-name">BNDZ</div>
            <div className="bndz-register-brand-tag">Built for people who live in files all day</div>
          </div>
        </div>

        <div className="bndz-native-dialog-panel grid grid-cols-2 gap-3 p-3">
          <div>
            <div className="bndz-native-dialog-muted text-[10px] uppercase tracking-wide">Version</div>
            <div className="font-mono text-[13px] mt-0.5">{version}</div>
          </div>
          <div>
            <div className="bndz-native-dialog-muted text-[10px] uppercase tracking-wide">Runtime</div>
            <div className="text-[13px] mt-0.5">64-bit · WebView2</div>
          </div>
        </div>

        <div className="space-y-2">
          <button
            type="button"
            disabled={checking}
            onClick={() => void checkUpdates()}
            className="bndz-native-dialog-primary w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-[12px] font-medium disabled:opacity-50"
          >
            {checking ? <Icons8Icon id="loading" size={14} spin /> : <Icons8Icon id="download" size={14} />}
            {checking ? 'Checking…' : 'Check for updates'}
          </button>
          {updateInfo && (
            <div className="bndz-native-dialog-panel p-3 space-y-1.5 text-[11px]">
              {updateInfo.updateAvailable ? (
                <>
                  <p className="text-emerald-400 font-medium">Update available — v{updateInfo.latestVersion}</p>
                  {updateInfo.releaseNotes && (
                    <p className="bndz-native-dialog-muted line-clamp-4 whitespace-pre-wrap">{updateInfo.releaseNotes}</p>
                  )}
                  {updateInfo.releaseUrl && (
                    <a href={updateInfo.releaseUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#7eb8e8] hover:underline">
                      Open release page <Icons8Icon id="external_link" size={11} />
                    </a>
                  )}
                </>
              ) : updateInfo.error ? (
                <p className="text-amber-300/90">{updateInfo.error}</p>
              ) : (
                <p className="bndz-native-dialog-muted">You&apos;re on the latest build.</p>
              )}
            </div>
          )}
        </div>

        <div className="pt-1 border-t border-white/5 space-y-2">
          <p className="text-[12px] bndz-native-dialog-muted leading-relaxed">
            Dual-pane browsing, native shell integration, staging, sync, cleanup, and deep preview —
            engineered as a real Windows host, not a thin web shell.
          </p>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px]">
            {([
              ['eula', 'EULA'],
              ['privacy', 'Privacy'],
              ['third-party', 'Third-party licenses'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className="text-[#7eb8e8]/90 hover:text-[#99c9f0] hover:underline"
                onClick={() => openLegal(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-[10px] bndz-native-dialog-muted pt-1">
            <Icons8Icon id="sparkles_ui" size={12} />
            <span>© {new Date().getFullYear()} BNDZ. All rights reserved.</span>
          </div>
        </div>
      </div>
    </NativeDialogShell>
  );
}
