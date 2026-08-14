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

/**
 * Resolve a WebGL-ready model URL. RAGE formats (.ydr/.ybn/…) are converted on the host to OBJ.
 */
export function useModelPreviewSource(path: string | null | undefined, ext: string): ModelPreviewSource {
  const [state, setState] = useState<ModelPreviewSource>({ url: '', badge: ext || '3d', loading: false });

  useEffect(() => {
    let cancelled = false;
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
    void IPC.getModelPreview(toWindowsPath(path)).then(res => {
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
      setState({
        url: toVirtualStreamUrl(res.path),
        badge: `${ext}→${res.format || 'obj'}`,
        loading: false,
        vertices: res.vertices,
        triangles: res.triangles,
      });
    }).catch(err => {
      if (cancelled) return;
      setState({
        url: '',
        badge: ext,
        loading: false,
        error: err instanceof Error ? err.message : 'Model preview failed',
      });
    });

    return () => { cancelled = true; };
  }, [path, ext]);

  return state;
}
