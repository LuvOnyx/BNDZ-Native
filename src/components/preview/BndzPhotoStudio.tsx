/**
 * Host for Photo Studio: owns opening the file, the save bar, drag-in
 * placing, and system fonts. Editing itself is the native studio
 * (src/components/photo-studio/PhotoStudioNative) built on photocraft's
 * document model — the old OpenShop iframe engine is retired.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { toVirtualStreamUrl, toWindowsPath } from '../../lib/pathUtils';
import { isImageExt } from '../../lib/mediaTypes';
import {
  filesToStudioDropImages,
  hitIsStudioSurface,
  pathsToStudioDropImages,
} from '../../lib/studioDropBridge';
import { PhotoStudioNative, type PhotoStudioHandle, type StudioImageInput } from '../photo-studio/PhotoStudioNative';

type Props = {
  path: string;
  title?: string;
  onSaved?: (destPath: string) => void;
  onRequestClose?: () => void;
};

type SaveMode = 'sibling' | 'overwrite' | 'pick';

function editedPathFor(sourcePath: string, ext: string): string {
  const win = toWindowsPath(sourcePath);
  const stem = win.replace(/\.[^.]+$/, '');
  const outExt = ext === 'jpg' || ext === 'jpeg' ? 'jpg' : ext === 'webp' ? 'webp' : ext === 'svg' ? 'svg' : ext === 'ico' ? 'ico' : 'png';
  return `${stem}_edited.${outExt}`;
}

function dataUrlToBase64(dataUrl: string): string {
  const i = dataUrl.indexOf(',');
  return i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
}

async function loadImageAsDataUrl(path: string): Promise<StudioImageInput> {
  const win = toWindowsPath(path);
  const name = win.split(/[\\/]/).pop() || 'Image';
  try {
    const { IPC } = await import('../../lib/ipcBridge');
    if (IPC.isNative) {
      const blob = await IPC.getMediaBlob(win);
      if (blob?.base64) {
        return { dataUrl: `data:${blob.mime || 'image/png'};base64,${blob.base64}`, name };
      }
    }
  } catch { /* fall through to stream */ }
  const res = await fetch(toVirtualStreamUrl(path));
  if (!res.ok) throw new Error(`Could not open the image (${res.status})`);
  const blob = await res.blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the image'));
    reader.readAsDataURL(blob);
  });
  return { dataUrl, name };
}

export default function BndzPhotoStudio({ path, title, onSaved, onRequestClose }: Props): React.ReactElement {
  const studioRef = useRef<PhotoStudioHandle | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [image, setImage] = useState<StudioImageInput | null>(null);
  const [docKey, setDocKey] = useState(0);
  const [fonts, setFonts] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    loadImageAsDataUrl(path)
      .then(img => { if (alive) { setImage(img); setLoading(false); setDirty(false); } })
      .catch(err => { if (alive) { setError(err instanceof Error ? err.message : 'Could not open the image'); setLoading(false); } });
    return () => { alive = false; };
  }, [path, docKey]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { IPC } = await import('../../lib/ipcBridge');
        if (IPC.isNative) {
          const families = await IPC.getInstalledFonts();
          if (alive && families?.length) setFonts(families);
        }
      } catch { /* fonts are best-effort */ }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const persistExport = useCallback(async (mode: SaveMode, format: 'png' | 'jpeg' | 'webp', pickedDest?: string) => {
    const studio = studioRef.current;
    if (!studio || busy) return;
    setBusy(true);
    try {
      const dataUrl = studio.exportDataUrl(format);
      const ext = format === 'jpeg' ? 'jpg' : format;
      const dest = pickedDest ?? (mode === 'overwrite' ? toWindowsPath(path) : editedPathFor(path, ext));
      const { IPC } = await import('../../lib/ipcBridge');
      const ok = await IPC.writeBinaryFile(dest, dataUrlToBase64(dataUrl));
      if (!ok) throw new Error('The file could not be written');
      setDirty(false);
      onSaved?.(dest);
      setToast(`Saved ${dest.split(/[\\/]/).pop()}`);
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }, [busy, onSaved, path]);

  const saveAs = useCallback(async () => {
    try {
      const { IPC } = await import('../../lib/ipcBridge');
      const stem = toWindowsPath(path).replace(/\.[^.]+$/, '');
      const dest = await IPC.saveFileDialog(`${stem}_edited.png`);
      if (dest) {
        const format = /\.jpe?g$/i.test(dest) ? 'jpeg' : /\.webp$/i.test(dest) ? 'webp' : 'png';
        await persistExport('pick', format, dest);
      }
    } catch { /* dialog cancelled */ }
  }, [path, persistExport]);

  const openImageDialog = useCallback(async (place: boolean) => {
    try {
      const { IPC } = await import('../../lib/ipcBridge');
      const picked = await IPC.openFileDialog('Images (*.png;*.jpg;*.jpeg;*.bmp;*.webp;*.gif;*.svg)|*.png;*.jpg;*.jpeg;*.bmp;*.webp;*.gif;*.svg');
      if (!picked?.length) return;
      if (place) {
        const images = await pathsToStudioDropImages(picked.slice(0, 8));
        studioRef.current?.placeImages(images);
      } else {
        const img = await loadImageAsDataUrl(picked[0]);
        setImage(img);
        setDocKey(k => k + 1);
        setDirty(false);
      }
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Could not open that image');
    }
  }, []);

  useEffect(() => {
    const onOpen = () => void openImageDialog(false);
    const onPlace = () => void openImageDialog(true);
    document.addEventListener('bndz-studio-open-image', onOpen);
    document.addEventListener('bndz-studio-place-image', onPlace);
    return () => {
      document.removeEventListener('bndz-studio-open-image', onOpen);
      document.removeEventListener('bndz-studio-place-image', onPlace);
    };
  }, [openImageDialog]);

  // Drag-in placing: host-level file drops + WebView2 native drops.
  useEffect(() => {
    const onDropFiles = async (e: DragEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) return;
      const files = e.dataTransfer?.files;
      if (!files?.length) return;
      e.preventDefault();
      const images = await filesToStudioDropImages(files, 8);
      if (images.length) studioRef.current?.placeImages(images);
    };
    const onExternal = (e: Event) => {
      const detail = (e as CustomEvent<{ paths?: string[]; x?: number; y?: number }>).detail;
      if (!detail?.paths?.length) return;
      if (detail.x != null && detail.y != null && !hitIsStudioSurface(detail.x, detail.y)) return;
      void pathsToStudioDropImages(detail.paths.slice(0, 8)).then(images => {
        if (images.length) studioRef.current?.placeImages(images);
      });
    };
    window.addEventListener('drop', onDropFiles);
    window.addEventListener('bndz-external-drop', onExternal as EventListener);
    return () => {
      window.removeEventListener('drop', onDropFiles);
      window.removeEventListener('bndz-external-drop', onExternal as EventListener);
    };
  }, []);

  return (
    <div className="bndz-photo-studio bndz-native-studio-host" ref={rootRef}>
      <div className="bndz-photo-studio-toolbar">
        <span className="bndz-photo-studio-title">
          <Icons8Icon id="image" size={16} /> {title || 'Photo Studio'}{dirty ? ' •' : ''}
        </span>
        <div className="bndz-photo-studio-actions">
          <button type="button" disabled={busy || loading} onClick={() => void persistExport('sibling', 'png')}>Save PNG</button>
          <button type="button" disabled={busy || loading} onClick={() => void persistExport('sibling', 'jpeg')}>Save JPG</button>
          <button type="button" disabled={busy || loading} onClick={() => {
            if (window.confirm('Overwrite the original file with the edited image?')) void persistExport('overwrite', 'png');
          }}>Overwrite</button>
          <button type="button" disabled={busy || loading} onClick={() => void saveAs()}>Save As...</button>
          {onRequestClose && (
            <button type="button" onClick={onRequestClose}>Close</button>
          )}
        </div>
      </div>

      {loading && <div className="bndz-photo-studio-loading">Opening image...</div>}
      {error && (
        <div className="bndz-photo-studio-error">
          <p>{error}</p>
          {onRequestClose && <button type="button" onClick={onRequestClose}>Close</button>}
        </div>
      )}
      {!loading && !error && image && (
        <PhotoStudioNative
          key={`${docKey}:${image.name}`}
          ref={studioRef}
          initialImage={image}
          fonts={fonts}
          onDirtyChange={setDirty}
        />
      )}
      {toast && <div className="bndz-photo-studio-toast">{toast}</div>}
    </div>
  );
}

export function dispatchOpenPhotoStudio(path: string): void {
  if (!path || typeof path !== 'string') return;
  if (!isImageExt(path)) return;
  window.dispatchEvent(new CustomEvent('bndz-open-photo-studio', { detail: { path } }));
}
