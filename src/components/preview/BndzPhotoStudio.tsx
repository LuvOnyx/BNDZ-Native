import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { toVirtualStreamUrl, toWindowsPath } from '../../lib/pathUtils';

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

function editedPathFor(sourcePath: string, ext: string): string {
  const win = toWindowsPath(sourcePath);
  const stem = win.replace(/\.[^.]+$/, '');
  const outExt = ext === 'jpg' || ext === 'jpeg' ? 'jpg' : 'png';
  return `${stem}_edited.${outExt}`;
}

function dataUrlToBase64(dataUrl: string): string {
  const i = dataUrl.indexOf(',');
  return i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
}

export default function BndzPhotoStudio({ path, title, onSaved, onRequestClose }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const blobUrlRef = useRef<string | null>(null);
  const readyRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [frameReady, setFrameReady] = useState(false);
  const [imagePayload, setImagePayload] = useState<{ url: string; name: string } | null>(null);

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

  const loadImage = useCallback(async () => {
    setLoading(true);
    setError(null);
    setStatus(null);
    readyRef.current = false;
    revokeBlob();
    try {
      const { IPC } = await import('../../lib/ipcBridge');
      let src = toVirtualStreamUrl(path);
      if (IPC.isNative) {
        const result = await IPC.getMediaBlob(toWindowsPath(path));
        if (result.base64 && result.mime) {
          const binary = atob(result.base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const blob = new Blob([bytes], { type: result.mime });
          src = URL.createObjectURL(blob);
          blobUrlRef.current = src;
        }
      }
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
    postToStudio({
      type: 'openImage',
      url: imagePayload.url,
      name: imagePayload.name,
    });
  }, [frameReady, imagePayload, postToStudio]);

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const data = ev.data as StudioMsg | null;
      if (!data || data.source !== 'bndz-photo-studio') return;
      switch (data.type) {
        case 'ready':
          readyRef.current = true;
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
              const ext = data.ext === 'jpg' || data.ext === 'jpeg' ? 'jpg' : 'png';
              const dest = editedPathFor(path, ext);
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
            }
          })();
          break;
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onRequestClose, onSaved, path]);

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
      </div>
    );
  }

  return (
    <div className="bndz-photo-studio">
      <iframe
        ref={iframeRef}
        className="bndz-photo-studio-frame"
        title="BNDZ Photo Studio"
        src={(() => {
          const base = import.meta.env.BASE_URL || '/';
          const prefix = base.endsWith('/') ? base : `${base}/`;
          return `${prefix}editors/bndz-photo-studio.html`;
        })()}
        sandbox="allow-scripts allow-same-origin allow-downloads"
        onLoad={() => {
          // Hosted studio posts ready; ping in case we missed the first message.
          setTimeout(() => postToStudio({ type: 'ping' }), 40);
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
