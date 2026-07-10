import React, { useEffect, useState } from 'react';
import { Icons8Icon } from './Icons8Icon';
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
}: {
  onClose: () => void;
  updateCheckUrl?: string;
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
      const result = await IPC.checkForUpdates(updateCheckUrl);
      setUpdateInfo(result);
      if (result.currentVersion) setVersion(result.currentVersion);
    } catch (err: any) {
      setUpdateInfo({ currentVersion: version, updateAvailable: false, error: err?.message || 'Check failed' });
    } finally {
      setChecking(false);
    }
  };

  return (
    <NativeDialogShell
      open
      title="About BNDZ"
      subtitle="File manager for Windows"
      tone="info"
      variant="sheet"
      onClose={onClose}
      showCloseButton
      zIndexClass="z-[520]"
      size="md"
      footerButtons={[{ label: 'Close', style: 'primary', onClick: onClose }]}
    >
      <div className="space-y-3 -mt-1">
        <div className="flex items-center justify-between text-[12px]">
          <span className="bndz-native-dialog-muted">Version</span>
          <span className="font-mono">{version}</span>
        </div>
        <div className="flex items-center justify-between text-[12px]">
          <span className="bndz-native-dialog-muted">Build</span>
          <span>64-bit · WebView2</span>
        </div>

        <div className="pt-2 border-t border-white/5 space-y-2">
          <button
            type="button"
            disabled={checking}
            onClick={() => void checkUpdates()}
            className="bndz-native-dialog-cancel w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[12px] disabled:opacity-50"
          >
            {checking ? <Icons8Icon id="loading" size={14} spin /> : <Icons8Icon id="download" size={14} />}
            Check for updates
          </button>
          {updateInfo && (
            <div className="bndz-native-dialog-panel p-3 space-y-1.5 text-[11px]">
              {updateInfo.updateAvailable ? (
                <>
                  <p className="text-emerald-400 font-medium">Update available: v{updateInfo.latestVersion}</p>
                  {updateInfo.releaseNotes && (
                    <p className="bndz-native-dialog-muted line-clamp-4 whitespace-pre-wrap">{updateInfo.releaseNotes}</p>
                  )}
                  {updateInfo.releaseUrl && (
                    <a href={updateInfo.releaseUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#7eb8e8] hover:underline">
                      Download release <Icons8Icon id="external_link" size={11} />
                    </a>
                  )}
                </>
              ) : updateInfo.error ? (
                <p className="text-amber-300/90">{updateInfo.error}</p>
              ) : (
                <p className="bndz-native-dialog-muted">You&apos;re on the latest version.</p>
              )}
            </div>
          )}
        </div>

        <p className="text-[12px] bndz-native-dialog-muted leading-relaxed pt-1 border-t border-white/5">
          Dual-pane navigation, native shell integration, Folder Sync, Storage Cleanup, Icon Studio, and hundreds of tuning options.
        </p>
        <ul className="text-[11px] bndz-native-dialog-muted space-y-1">
          <li>· Cross-pane drag &amp; drop · Everything search · Virtualized tree &amp; list</li>
          <li>· Rich preview panel · Background file queue · Offline license activation</li>
        </ul>
        <div className="flex flex-wrap gap-x-3 gap-y-1 pt-2 text-[10px]">
          {(['eula', 'privacy', 'third-party'] as const).map(key => {
            const labels = { eula: 'EULA', privacy: 'Privacy', 'third-party': 'Third-party licenses' };
            return (
              <button
                key={key}
                type="button"
                className="text-[#7eb8e8]/90 hover:text-[#99c9f0] hover:underline"
                onClick={() => {
                  void import('../lib/ipcBridge').then(({ IPC }) =>
                    IPC.openLegalDoc(key).then(r => {
                      if (!r.ok && r.error) showNativeAlert(r.error, 'Legal document', 'error');
                    }),
                  );
                }}
              >
                {labels[key]}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 text-[10px] bndz-native-dialog-muted pt-1">
          <Icons8Icon id="sparkles_ui" size={12} />
          <span>© {new Date().getFullYear()} BNDZ. All rights reserved.</span>
        </div>
      </div>
    </NativeDialogShell>
  );
}
