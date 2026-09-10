import { useEffect, useState } from 'react';
import { IPC } from './ipcBridge';
import { toVirtualStreamUrl, toWindowsPath } from './pathUtils';
import { isGpuNativeModelExt, isRageConvertModelExt } from './mediaTypes';

export type ModelPreviewSource = {
  url: string;
  badge: string;
  error?: string;
  loading: boolean;
  vertices?: number;
  triangles?: number;
};

function base64ToObjectUrl(base64: string, mime: string): string {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mime || 'model/gltf-binary' }));
}

/**
 * Resolve a WebGL-ready model URL. RAGE formats (.ydr/.ybn/…) are converted on the host to GLB.
 * Prefers bndz-stream; falls back to an in-memory blob when the custom scheme fails for Three.js.
 */
export function useModelPreviewSource(path: string | null | undefined, ext: string): ModelPreviewSource {
  const [state, setState] = useState<ModelPreviewSource>({ url: '', badge: ext || '3d', loading: false });

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    const revoke = () => {
      if (objectUrl) {
        try { URL.revokeObjectURL(objectUrl); } catch { /* ignore */ }
        objectUrl = null;
      }
    };

    if (!path || !ext) {
      setState({ url: '', badge: ext || '3d', loading: false });
      return;
    }

    if (isGpuNativeModelExt(ext)) {
      setState({
        url: toVirtualStreamUrl(path),
        badge: ext,
        loading: false,
      });
      return;
    }

    if (!isRageConvertModelExt(ext)) {
      setState({
        url: '',
        badge: ext,
        loading: false,
        error: `${ext.toUpperCase()} preview needs conversion support`,
      });
      return;
    }

    setState(s => ({ ...s, url: '', badge: ext, loading: true, error: undefined }));
    void (async () => {
      try {
        const res = await IPC.getModelPreview(toWindowsPath(path));
        if (cancelled) return;
        if (res?.error || !res?.path) {
          setState({
            url: '',
            badge: ext,
            loading: false,
            error: res?.error || 'Could not convert RAGE model',
          });
          return;
        }

        const streamUrl = toVirtualStreamUrl(res.path);
        const verts = res.vertices;
        const tris = res.triangles;
        const badge = `${ext}→${res.format || 'glb'}`;

        // Prefer blob for Three.js — custom-scheme MIME mismatches used to blank the viewport
        // even when conversion succeeded (verts/tris known).
        try {
          const blob = await IPC.getMediaBlob(res.path, 64 * 1024 * 1024);
          if (cancelled) return;
          if (blob?.base64 && !blob.error) {
            revoke();
            objectUrl = base64ToObjectUrl(blob.base64, blob.mime || 'model/gltf-binary');
            setState({
              url: objectUrl,
              badge,
              loading: false,
              vertices: verts,
              triangles: tris,
            });
            return;
          }
        } catch { /* fall through to stream */ }

        if (cancelled) return;
        setState({
          url: streamUrl,
          badge,
          loading: false,
          vertices: verts,
          triangles: tris,
        });
      } catch (err) {
        if (cancelled) return;
        setState({
          url: '',
          badge: ext,
          loading: false,
          error: err instanceof Error ? err.message : 'Model preview failed',
        });
      }
    })();

    return () => {
      cancelled = true;
      revoke();
    };
  }, [path, ext]);

  return state;
}
