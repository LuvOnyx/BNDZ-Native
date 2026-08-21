import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { toVirtualStreamUrl, toWindowsPath } from '../../lib/pathUtils';
import { isImageExt } from '../../lib/mediaTypes';
import { useEditorIframeKeyBridge, type EditorKeyPayload } from '../../lib/editorIframeKeys';
import {
  filesToStudioDropImages,
  hitIsStudioSurface,
  pathsToStudioDropImages,
} from '../../lib/studioDropBridge';

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
  const outExt = ext === 'jpg' || ext === 'jpeg'
    ? 'jpg'
    : ext === 'webp'
      ? 'webp'
      : ext === 'svg'
        ? 'svg'
        : ext === 'ico'
          ? 'ico'
          : 'png';
  return `${stem}_edited.${outExt}`;
}

function dataUrlToBase64(dataUrl: string): string {
  const i = dataUrl.indexOf(',');
  return i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
}

/**
 * Host for Photo Studio: BNDZ host bar + OpenShop raster engine
 * (public/editors/engines/openshop/). Legacy fabric studio remains at
 * editors/bndz-photo-studio.html?engine=legacy. Keys stay in the iframe.
 */

function photoStudioSrc(): string {
  const base = import.meta.env.BASE_URL || '/';
  const prefix = base.endsWith('/') ? base : `${base}/`;
  try {
    if (typeof window !== 'undefined' && /engine=legacy/i.test(window.location.search || '')) {
      return `${prefix}editors/bndz-photo-studio.html`;
    }
  } catch { /* ignore */ }
  return `${prefix}editors/engines/openshop/index.html`;
}

async function collectInstalledFontFamilies(): Promise<string[]> {
  const names = new Set<string>();
  try {
    const { IPC } = await import('../../lib/ipcBridge');
    if (IPC.isNative) {
      const host = await IPC.getInstalledFonts();
      for (const n of host) names.add(n);
    }
  } catch { /* ignore */ }
  return [...names].sort((a, b) => a.localeCompare(b));
}

async function pushSystemFonts(frame: HTMLIFrameElement | null) {
  const win = frame?.contentWindow;
  if (!win) return;
  const families = await collectInstalledFontFamilies();
  if (!families.length) return;
  try {
    win.postMessage({ type: 'bndz-system-fonts', families }, '*');
  } catch { /* ignore */ }
}

export default function BndzPhotoStudio({ path, title, onSaved, onRequestClose }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const blobUrlRef = useRef<string | null>(null);
  const saveModeRef = useRef<SaveMode>('sibling');
  const saveDestRef = useRef<string | null>(null);
  const helloSentRef = useRef(false);
  const embedBoundRef = useRef(false);
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

  const postOpenShop = useCallback((msg: Record<string, unknown>) => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage({ version: 1, ...msg }, '*');
  }, []);

  const bindOpenShop = useCallback(() => {
    if (helloSentRef.current) return;
    helloSentRef.current = true;
    postOpenShop({ type: 'openshop:hello', id: `hi_${Date.now()}` });
  }, [postOpenShop]);

  const configureOpenShop = useCallback(() => {
    postOpenShop({
      type: 'openshop:configure',
      id: `cfg_${Date.now()}`,
      overrides: { open: true, save: true },
    });
  }, [postOpenShop]);

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
    // OpenShop embed export
    postOpenShop({ type: 'openshop:export', id: `ex_${Date.now()}`, format: kind === 'jpeg' ? 'jpeg' : 'png' });
    // Legacy photo-studio fallback
    postToStudio({ type: 'requestExport', kind });
  }, [postOpenShop, postToStudio]);

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

  const persistExport = useCallback(async (opts: { dataUrl?: string; blob?: Blob; ext: string }) => {
    setBusy(true);
    setStatus(null);
    try {
      let dataUrl = opts.dataUrl;
      if (!dataUrl && opts.blob) {
        dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(reader.error || new Error('read failed'));
          reader.readAsDataURL(opts.blob!);
        });
      }
      if (!dataUrl) {
        setStatus('Export failed — empty image');
        return;
      }
      const ext = opts.ext === 'jpg' || opts.ext === 'jpeg'
        ? 'jpg'
        : opts.ext === 'webp'
          ? 'webp'
          : opts.ext === 'svg'
            ? 'svg'
            : opts.ext === 'ico'
              ? 'ico'
              : 'png';
      const mode = saveModeRef.current;
      let dest = saveDestRef.current;
      if (!dest) {
        if (mode === 'overwrite') dest = toWindowsPath(path);
        else dest = editedPathFor(path, ext);
      }
      const base64 = dataUrlToBase64(dataUrl);
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
  }, [onSaved, path]);

  const openInEngine = useCallback(async (payload: { url: string; name: string }) => {
    try {
      const res = await fetch(payload.url);
      const blob = await res.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('read failed'));
        reader.readAsDataURL(blob);
      });
      postOpenShop({
        type: 'openshop:open',
        id: `open_${Date.now()}`,
        document: { dataUrl, name: payload.name },
      });
    } catch {
      postToStudio({ type: 'openImage', url: payload.url, name: payload.name });
    }
  }, [postOpenShop, postToStudio]);

  const placeDropImages = useCallback(async (paths?: string[], files?: File[]) => {
    const fromFiles = files?.length ? await filesToStudioDropImages(files) : [];
    const fromPaths = !fromFiles.length && paths?.length ? await pathsToStudioDropImages(paths) : [];
    const images = fromFiles.length ? fromFiles : fromPaths;
    if (!images.length) {
      setStatus('Drop an image (PNG, JPG, WEBP, SVG, ICO…)');
      return;
    }
    postOpenShop({
      type: 'openshop:place',
      id: `place_${Date.now()}`,
      documents: images,
    });
    setStatus(`Placed ${images.length} image${images.length === 1 ? '' : 's'}`);
  }, [postOpenShop]);

  useEffect(() => {
    const onExternalDrop = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const paths = detail.paths as string[] | undefined;
      if (!paths?.length) return;
      const clientX = typeof detail.webViewX === 'number' ? detail.webViewX : null;
      const clientY = typeof detail.webViewY === 'number' ? detail.webViewY : null;
      if (clientX != null && clientY != null) {
        if (!hitIsStudioSurface(clientX, clientY, ['.bndz-photo-studio', '[data-studio-drop-surface="photo-studio"]'])) return;
      }
      void placeDropImages(paths);
    };
    window.addEventListener('bndz-external-drop', onExternalDrop);
    return () => window.removeEventListener('bndz-external-drop', onExternalDrop);
  }, [placeDropImages]);

  const onHostDragOver = useCallback((e: React.DragEvent) => {
    const types = e.dataTransfer?.types;
    if (!types || (![...types].includes('Files') && !e.dataTransfer.files?.length)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onHostDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    void placeDropImages(undefined, [...(e.dataTransfer?.files || [])]);
  }, [placeDropImages]);

  useEffect(() => {
    if (!frameReady || !imagePayload) return;
    void openInEngine(imagePayload);
    // Legacy fallback (no-op on OpenShop)
    postToStudio({ type: 'openImage', url: imagePayload.url, name: imagePayload.name });
  }, [frameReady, imagePayload, openInEngine, postToStudio]);

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const data = ev.data as any;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'bndz-request-system-fonts') {
        if (ev.source === iframeRef.current?.contentWindow) {
          void pushSystemFonts(iframeRef.current);
        }
        return;
      }

      if (typeof data.type === 'string' && data.type.startsWith('openshop:')) {
        if (data.type === 'openshop:ready') {
          if (!data.capabilities) {
            bindOpenShop();
            return;
          }
          embedBoundRef.current = true;
          configureOpenShop();
          window.setTimeout(() => setFrameReady((ready) => ready || true), 3000);
          return;
        }
        if (data.type === 'openshop:configured') {
          setFrameReady(true);
          setStatus('OpenShop engine ready');
          void pushSystemFonts(iframeRef.current);
          return;
        }
        if (data.type === 'openshop:opened') {
          setStatus(imagePayload?.name ? `Editing ${imagePayload.name}` : 'Image loaded');
          return;
        }
        if (data.type === 'openshop:exported') {
          const format = String(data.format || 'png').toLowerCase();
          const ext = format === 'jpeg' || format === 'jpg' ? 'jpg' : format === 'webp' ? 'webp' : format === 'svg' ? 'svg' : 'png';
          void persistExport({
            blob: data.blob as Blob | undefined,
            dataUrl: typeof data.dataUrl === 'string' ? data.dataUrl : undefined,
            ext,
          });
          return;
        }
        if (data.type === 'openshop:save-requested') {
          const filename = typeof data.filename === 'string' ? data.filename : 'export.png';
          const extMatch = filename.match(/\.([a-z0-9]+)$/i);
          const ext = (extMatch?.[1] || 'png').toLowerCase();
          const normalized = ext === 'jpeg' ? 'jpg' : ext;
          void persistExport({
            blob: data.blob as Blob | undefined,
            dataUrl: typeof data.dataUrl === 'string' ? data.dataUrl : undefined,
            ext: normalized === 'jpg' || normalized === 'webp' || normalized === 'svg' || normalized === 'png' || normalized === 'ico'
              ? normalized
              : 'png',
          });
          return;
        }
        if (data.type === 'openshop:error') {
          setStatus(data.message || 'OpenShop error');
          return;
        }
        return;
      }

      if (data.source !== 'bndz-photo-studio') return;
      const legacy = data as StudioMsg;
      switch (legacy.type) {
        case 'ready':
          setFrameReady(true);
          break;
        case 'opened':
          setStatus(legacy.name ? `Editing ${legacy.name}` : 'Image loaded');
          break;
        case 'error':
          setError(legacy.message || 'Studio error');
          break;
        case 'requestClose':
          onRequestClose?.();
          break;
        case 'export':
          void persistExport({
            dataUrl: legacy.dataUrl,
            ext: legacy.ext === 'jpg' || legacy.ext === 'jpeg' ? 'jpg' : legacy.ext === 'webp' ? 'webp' : 'png',
          });
          break;
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [bindOpenShop, configureOpenShop, imagePayload, onRequestClose, persistExport]);

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
    <div
      className="bndz-photo-studio bndz-photo-studio--no-hostbar"
      tabIndex={-1}
      data-studio-drop-surface="photo-studio"
      onDragEnter={onHostDragOver}
      onDragOver={onHostDragOver}
      onDrop={onHostDrop}
    >      <div className="bndz-photo-studio-float-actions" role="toolbar" aria-label="Save actions">
        <button type="button" className="bndz-lens-chip bndz-lens-chip--accent" onClick={onSave} disabled={busy} title="Save PNG beside original">Save PNG</button>
        <button type="button" className="bndz-lens-chip" onClick={() => requestExport('sibling', null, 'jpeg')} disabled={busy} title="Save JPG beside original">Save JPG</button>
        <button type="button" className="bndz-lens-chip" onClick={onSaveOverwrite} disabled={busy} title="Overwrite original">Overwrite</button>
        <button type="button" className="bndz-lens-chip" onClick={() => void onSaveAs()} disabled={busy} title="Save As…">Save As…</button>
        {onRequestClose && (
          <button type="button" className="bndz-lens-chip" onClick={onRequestClose} title="Close studio">Close</button>
        )}
      </div>
      <div
        className="bndz-photo-studio-stage"
        onPointerDown={() => {
          try {
            iframeRef.current?.focus({ preventScroll: true });
            iframeRef.current?.contentWindow?.focus?.();
          } catch { /* ignore */ }
        }}
      >
      <iframe
        ref={iframeRef}
        className="bndz-photo-studio-frame"
        title="BNDZ Photo Studio (hosted engine)"
        tabIndex={0}
        src={photoStudioSrc()}
        sandbox="allow-scripts allow-same-origin allow-downloads allow-modals allow-forms"
        onLoad={() => {
          helloSentRef.current = false;
          embedBoundRef.current = false;
          setFrameReady(false);
          setTimeout(() => {
            bindOpenShop();
            postToStudio({ type: 'setTheme', theme: studioTheme });
          }, 40);
          try {
            iframeRef.current?.focus({ preventScroll: true });
          } catch { /* ignore */ }
        }}
      />
      </div>
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
