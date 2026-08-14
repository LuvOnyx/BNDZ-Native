import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { toVirtualStreamUrl, toWindowsPath } from '../../lib/pathUtils';
import { isImageExt } from '../../lib/mediaTypes';
import { useEditorIframeKeyBridge, type EditorKeyPayload } from '../../lib/editorIframeKeys';

type Props = {
  path: string;
  title?: string;
  onSaved?: (destPath: string) => void;
  onRequestClose?: () => void;
};

type StudioMsg =
  | { source: 'bndz-photo-studio'; type: 'ready' }
  | { source: 'bndz-photo-studio'; type: 'opened'; name?: string }
  | { source: 'bndz-photo-studio'; type: 'error'; message?: string }
  | { source: 'bndz-photo-studio'; type: 'requestClose' }
  | {
      source: 'bndz-photo-studio';
      type: 'export';
      mime?: string;
      ext?: string;
      dataUrl?: string;
      docName?: string;
    };

type SaveMode = 'sibling' | 'overwrite' | 'pick';

function editedPathFor(sourcePath: string, ext: string): string {
  const win = toWindowsPath(sourcePath);
  const stem = win.replace(/\.[^.]+$/, '');
  const outExt = ext === 'jpg' || ext === 'jpeg' ? 'jpg' : ext === 'webp' ? 'webp' : 'png';
  return `${stem}_edited.${outExt}`;
}

function dataUrlToBase64(dataUrl: string): string {
  const i = dataUrl.indexOf(',');
  return i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
}

/**
 * Host for the full Photoshop-clone UI (public/editors/bndz-photo-studio.html).
 * Exact PS chrome lives in that editor; React hosts load/save + IPC.
 * Keyboard shortcuts stay inside the iframe (do not leak to the FM).
 */
export default function BndzPhotoStudio({ path, title, onSaved, onRequestClose }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const blobUrlRef = useRef<string | null>(null);
  const saveModeRef = useRef<SaveMode>('sibling');
  const saveDestRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [frameReady, setFrameReady] = useState(false);
  const [imagePayload, setImagePayload] = useState<{ url: string; name: string } | null>(null);
  const [studioTheme, setStudioTheme] = useState<'dark' | 'light'>(() => {
    try {
      return localStorage.getItem('bndz-photo-studio-theme') === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });

  const revokeBlob = useCallback(() => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  }, []);

  const postToStudio = useCallback((msg: Record<string, unknown>) => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage({ source: 'bndz-host', ...msg }, '*');
  }, []);

  const postKey = useCallback(
    (payload: EditorKeyPayload) => postToStudio(payload),
    [postToStudio],
  );

  useEditorIframeKeyBridge({
    rootSelector: '.bndz-photo-studio',
    iframeRef,
    postKey,
    forceActive: true,
    passEscape: true,
  });

  const requestExport = useCallback((mode: SaveMode, dest?: string | null, kind: 'png' | 'jpeg' = 'png') => {
    saveModeRef.current = mode;
    saveDestRef.current = dest ?? null;
    postToStudio({ type: 'requestExport', kind });
  }, [postToStudio]);

  const loadImage = useCallback(async () => {
    setLoading(true);
    setError(null);
    setStatus(null);
    revokeBlob();
    try {
      const { IPC } = await import('../../lib/ipcBridge');
      let src = '';
      if (IPC.isNative) {
        const result = await IPC.getMediaBlob(toWindowsPath(path));
        if (result.base64 && result.mime) {
          const binary = atob(result.base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const blob = new Blob([bytes], { type: result.mime });
          src = URL.createObjectURL(blob);
          blobUrlRef.current = src;
        } else if (result.error) {
          throw new Error(result.error);
        }
      }
      if (!src) src = toVirtualStreamUrl(path);
      if (!src) throw new Error('Could not load image bytes for Photo Studio');
      const name = title || path.split(/[/\\]/).pop() || 'image';
      setImagePayload({ url: src, name });
      setLoading(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load image';
      setError(message);
      setLoading(false);
    }
  }, [path, title, revokeBlob]);

  useEffect(() => {
    void loadImage();
    return () => revokeBlob();
  }, [loadImage, revokeBlob]);

  useEffect(() => {
    if (!frameReady || !imagePayload) return;
    postToStudio({ type: 'openImage', url: imagePayload.url, name: imagePayload.name });
    const t = window.setTimeout(() => {
      postToStudio({ type: 'openImage', url: imagePayload.url, name: imagePayload.name });
    }, 180);
    return () => window.clearTimeout(t);
  }, [frameReady, imagePayload, postToStudio]);

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const data = ev.data as StudioMsg | null;
      if (!data || data.source !== 'bndz-photo-studio') return;
      switch (data.type) {
        case 'ready':
          setFrameReady(true);
          break;
        case 'opened':
          setStatus(data.name ? `Editing ${data.name}` : 'Image loaded');
          break;
        case 'error':
          setError(data.message || 'Studio error');
          break;
        case 'requestClose':
          onRequestClose?.();
          break;
        case 'export':
          void (async () => {
            if (!data.dataUrl) {
              setStatus('Export failed — empty image');
              return;
            }
            setBusy(true);
            setStatus(null);
            try {
              const ext = data.ext === 'jpg' || data.ext === 'jpeg' ? 'jpg' : data.ext === 'webp' ? 'webp' : 'png';
              const mode = saveModeRef.current;
              let dest = saveDestRef.current;
              if (!dest) {
                if (mode === 'overwrite') dest = toWindowsPath(path);
                else dest = editedPathFor(path, ext);
              }
              const base64 = dataUrlToBase64(data.dataUrl);
              const { IPC } = await import('../../lib/ipcBridge');
              const ok = await IPC.writeBinaryFile(dest, base64);
              if (!ok) throw new Error('Could not write file');
              setStatus(`Saved ${dest.split(/[/\\]/).pop()}`);
              onSaved?.(dest);
            } catch (err: unknown) {
              setStatus(err instanceof Error ? err.message : 'Save failed');
            } finally {
              setBusy(false);
              saveModeRef.current = 'sibling';
              saveDestRef.current = null;
            }
          })();
          break;
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onRequestClose, onSaved, path]);

  useEffect(() => {
    if (frameReady) {
      const t = window.setTimeout(() => {
        try {
          iframeRef.current?.focus({ preventScroll: true });
          iframeRef.current?.contentWindow?.focus?.();
        } catch { /* ignore */ }
      }, 120);
      return () => window.clearTimeout(t);
    }
  }, [frameReady]);

  const onSave = () => requestExport('sibling');
  const onSaveOverwrite = () => {
    if (!window.confirm('Overwrite the original file with your edits?')) return;
    requestExport('overwrite');
  };
  const onSaveAs = async () => {
    const { IPC } = await import('../../lib/ipcBridge');
    const stem = toWindowsPath(path).replace(/\.[^.]+$/, '');
    const picked = await IPC.saveFileDialog(`${stem}_edited.png`);
    if (!picked) return;
    requestExport('pick', picked);
  };

  const displayName = title || path.split(/[/\\]/).pop() || 'image';

  if (loading) {
    return (
      <div className="bndz-photo-studio bndz-photo-studio--status">
        <Icons8Icon id="loading" size={20} spin />
        <span>Loading into Photo Studio…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bndz-photo-studio bndz-photo-studio--status">
        <Icons8Icon id="warning" size={28} className="opacity-70" />
        <p>{error}</p>
        {onRequestClose && (
          <button type="button" className="bndz-lens-chip" onClick={onRequestClose}>Close</button>
        )}
      </div>
    );
  }

  return (
    <div className="bndz-photo-studio" tabIndex={-1}>
      <div className="bndz-photo-studio-hostbar">
        <div className="bndz-photo-studio-brand">
          <Icons8Icon id="paint" size={15} />
          <div>
            <strong>Photo Studio</strong>
            <span title={displayName}>{displayName}</span>
          </div>
        </div>
        <div className="bndz-photo-studio-host-actions">
          <button
            type="button"
            className="bndz-lens-chip"
            title="Toggle Photo Studio dark / light UI"
            disabled={busy}
            onClick={() => {
              const next = studioTheme === 'dark' ? 'light' : 'dark';
              setStudioTheme(next);
              try { localStorage.setItem('bndz-photo-studio-theme', next); } catch { /* ignore */ }
              postToStudio({ type: 'setTheme', theme: next });
            }}
          >
            {studioTheme === 'dark' ? 'Light UI' : 'Dark UI'}
          </button>
          <button
            type="button"
            className="bndz-lens-chip"
            title="Undo (Ctrl+Z)"
            disabled={busy}
            onClick={() => postToStudio({ type: 'keydown', key: 'z', code: 'KeyZ', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false })}
          >
            Undo
          </button>
          <button
            type="button"
            className="bndz-lens-chip"
            title="Redo (Ctrl+Shift+Z)"
            disabled={busy}
            onClick={() => postToStudio({ type: 'keydown', key: 'z', code: 'KeyZ', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false })}
          >
            Redo
          </button>
          <button type="button" className="bndz-lens-chip bndz-lens-chip--accent" onClick={onSave} disabled={busy}>Save PNG</button>
          <button type="button" className="bndz-lens-chip" onClick={() => requestExport('sibling', null, 'jpeg')} disabled={busy}>Save JPG</button>
          <button type="button" className="bndz-lens-chip" onClick={onSaveOverwrite} disabled={busy}>Overwrite</button>
          <button type="button" className="bndz-lens-chip" onClick={() => void onSaveAs()} disabled={busy}>Save As…</button>
          {onRequestClose && (
            <button type="button" className="bndz-lens-chip" onClick={onRequestClose}>Close</button>
          )}
        </div>
        <div className="bndz-photo-studio-host-hint" title="Keys stay inside the studio while it is open">
          Del · B E G · [ ] · Ctrl+Z/S
        </div>
      </div>
      <iframe
        ref={iframeRef}
        className="bndz-photo-studio-frame"
        title="BNDZ Photo Studio"
        tabIndex={0}
        src={(() => {
          const base = import.meta.env.BASE_URL || '/';
          const prefix = base.endsWith('/') ? base : `${base}/`;
          return `${prefix}editors/bndz-photo-studio.html`;
        })()}
        sandbox="allow-scripts allow-same-origin allow-downloads allow-modals"
        onLoad={() => {
          setTimeout(() => {
            postToStudio({ type: 'ping' });
            postToStudio({ type: 'setTheme', theme: studioTheme });
          }, 40);
          try {
            iframeRef.current?.focus({ preventScroll: true });
          } catch { /* ignore */ }
        }}
      />
      {(status || busy) && (
        <div className={`bndz-photo-studio-toast${status?.toLowerCase().includes('fail') ? ' is-error' : ''}`}>
          {busy ? 'Saving…' : status}
        </div>
      )}
    </div>
  );
}

/** Open Photo Studio for a single image path (context menu / shortcuts). */
export function dispatchOpenPhotoStudio(path: string) {
  if (!path || !isImageExt(path.split('.').pop() || '')) return;
  window.dispatchEvent(new CustomEvent('bndz-open-photo-studio', { detail: { path } }));
}
