import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icons8Icon } from './Icons8Icon';
import { showNativeAlert } from '../lib/nativeDialog';
import { CloseGlyph } from './ChromeGlyphs';

const FALLBACK_VERSION = '1.0.0';

type UpdateInfo = {
  currentVersion: string;
  latestVersion?: string | null;
  updateAvailable: boolean;
  releaseUrl?: string | null;
  releaseNotes?: string | null;
  error?: string | null;
};

/**
 * About BNDZ — product plaque (not a sheet skin).
 * Embossed mark face, machined version chip, property ledger, update bay.
 */
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
  const year = new Date().getFullYear();

  useEffect(() => {
    import('../lib/ipcBridge').then(({ IPC }) => {
      IPC.getAppVersion().then(v => { if (v) setVersion(v); }).catch(() => {});
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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

  return createPortal(
    <div
      className="bndz-about-scrim"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bndz-about-plaque"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bndz-about-title"
        onMouseDown={e => e.stopPropagation()}
      >
        <button type="button" className="bndz-about-x" onClick={onClose} aria-label="Close">
          <CloseGlyph size={11} />
        </button>

        <section className="bndz-about-face">
          <div className="bndz-about-watermark" aria-hidden>BNDZ</div>
          <div className="bndz-about-mark">
            <div className="bndz-about-mark-ring">
              <img src="/bndz-light.png" alt="" draggable={false} />
            </div>
          </div>
          <h1 id="bndz-about-title" className="bndz-about-name">BNDZ</h1>
          <p className="bndz-about-epithet">Native file manager for Windows</p>
          <div className="bndz-about-chip">
            <span className="bndz-about-chip-dot" aria-hidden />
            <span>Version {version}</span>
            <span className="bndz-about-chip-sep" aria-hidden />
            <span>{includeBetaVersions ? 'Stable + beta' : 'Stable channel'}</span>
          </div>
        </section>

        <dl className="bndz-about-ledger">
          <div className="bndz-about-row">
            <dt>Platform</dt>
            <dd>Windows · x64</dd>
          </div>
          <div className="bndz-about-row">
            <dt>UI host</dt>
            <dd>WebView2</dd>
          </div>
          <div className="bndz-about-row">
            <dt>Shell</dt>
            <dd>Native host process</dd>
          </div>
          <div className="bndz-about-row">
            <dt>Edition</dt>
            <dd>Desktop</dd>
          </div>
        </dl>

        <section className="bndz-about-bay">
          <div className="bndz-about-bay-copy">
            <strong>Software updates</strong>
            <span>Query the release feed for a newer build of this install.</span>
          </div>
          <button
            type="button"
            className="bndz-about-bay-btn"
            disabled={checking}
            onClick={() => void checkUpdates()}
          >
            {checking ? <Icons8Icon id="loading" size={13} spin /> : <Icons8Icon id="download" size={13} />}
            {checking ? 'Checking…' : 'Check for updates'}
          </button>
          {updateInfo && (
            <div
              className={`bndz-about-bay-result${
                updateInfo.updateAvailable ? ' is-ok' : updateInfo.error ? ' is-warn' : ' is-muted'
              }`}
            >
              {updateInfo.updateAvailable ? (
                <>
                  Update available — v{updateInfo.latestVersion}
                  {updateInfo.releaseNotes && (
                    <div className="bndz-about-bay-notes">{updateInfo.releaseNotes.slice(0, 240)}</div>
                  )}
                  {updateInfo.releaseUrl && (
                    <a href={updateInfo.releaseUrl} target="_blank" rel="noreferrer">Open release notes</a>
                  )}
                </>
              ) : updateInfo.error ? (
                updateInfo.error
              ) : (
                'This build is up to date.'
              )}
            </div>
          )}
        </section>

        <footer className="bndz-about-rail">
          <div className="bndz-about-legal">
            <button type="button" onClick={() => openLegal('eula')}>EULA</button>
            <button type="button" onClick={() => openLegal('privacy')}>Privacy</button>
            <button type="button" onClick={() => openLegal('third-party')}>Third-party</button>
          </div>
          <div className="bndz-about-rail-end">
            <span className="bndz-about-copy">© {year} BNDZ</span>
            <button type="button" className="bndz-about-ok" onClick={onClose}>OK</button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
