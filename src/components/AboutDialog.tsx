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
      variant="sheet"
      onClose={onClose}
      showCloseButton
      zIndexClass="z-[520]"
      size="sm"
      panelClassName="bndz-about-dialog"
      footerButtons={[{ label: 'OK', style: 'primary', onClick: onClose }]}
    >
      <div className="bndz-about-body">
        <div className="bndz-about-identity">
          <img src="/bndz-light.png" alt="" className="bndz-about-mark" draggable={false} />
          <div>
            <div className="bndz-about-product">BNDZ</div>
            <div className="bndz-about-edition">File Manager</div>
            <div className="bndz-about-version">Version {version}</div>
          </div>
        </div>

        <dl className="bndz-about-facts">
          <div>
            <dt>Platform</dt>
            <dd>Windows 64-bit</dd>
          </div>
          <div>
            <dt>UI host</dt>
            <dd>WebView2</dd>
          </div>
        </dl>

        <button
          type="button"
          disabled={checking}
          onClick={() => void checkUpdates()}
          className="bndz-about-update-btn"
        >
          {checking ? <Icons8Icon id="loading" size={14} spin /> : <Icons8Icon id="download" size={14} />}
          {checking ? 'Checking…' : 'Check for updates'}
        </button>

        {updateInfo && (
          <div className="bndz-about-update-status">
            {updateInfo.updateAvailable ? (
              <>
                <p className="bndz-about-update-ok">Update available — v{updateInfo.latestVersion}</p>
                {updateInfo.releaseNotes && (
                  <p className="bndz-about-muted bndz-about-notes">{updateInfo.releaseNotes}</p>
                )}
                {updateInfo.releaseUrl && (
                  <a href={updateInfo.releaseUrl} target="_blank" rel="noreferrer" className="bndz-about-link">
                    Open release notes
                  </a>
                )}
              </>
            ) : updateInfo.error ? (
              <p className="bndz-about-update-warn">{updateInfo.error}</p>
            ) : (
              <p className="bndz-about-muted">This build is up to date.</p>
            )}
          </div>
        )}

        <div className="bndz-about-footer">
          <div className="bndz-about-legal">
            {([
              ['eula', 'EULA'],
              ['privacy', 'Privacy'],
              ['third-party', 'Third-party licenses'],
            ] as const).map(([key, label]) => (
              <button key={key} type="button" className="bndz-about-link" onClick={() => openLegal(key)}>
                {label}
              </button>
            ))}
          </div>
          <p className="bndz-about-copy">© {new Date().getFullYear()} BNDZ. All rights reserved.</p>
        </div>
      </div>
    </NativeDialogShell>
  );
}
