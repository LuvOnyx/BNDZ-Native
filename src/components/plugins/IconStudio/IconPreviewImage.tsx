import React, { useEffect, useState, useRef } from 'react';
import { Icons8Icon } from '../../Icons8Icon';
import { IPC } from '../../../lib/ipcBridge';
import { toWindowsPath } from '../../../lib/pathUtils';
import { fetchIconifySvg, iconifySvgToDataUrl, parseIconifyLibraryPath } from '../../../lib/fileTypeIcons';
import { IconPlaceholder } from '../../IconPlaceholder';

const previewCache = new Map<string, string>();

interface IconPreviewImageProps {
  path: string;
  size?: number;
  className?: string;
}

/** IPC-backed icon preview — supports filesystem paths and iconify: virtual library entries */
export default function IconPreviewImage({ path, size = 48, className = '' }: IconPreviewImageProps) {
  const [src, setSrc] = useState<string | null>(previewCache.get(path) || null);
  const [loading, setLoading] = useState(!src);
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setVisible(true); obs.disconnect(); }
    }, { rootMargin: '80px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Reset when the path prop changes on a mounted instance
  const lastPathRef = useRef(path);
  useEffect(() => {
    if (lastPathRef.current !== path) {
      lastPathRef.current = path;
      const cached = previewCache.get(path);
      setSrc(cached || null);
      setLoading(!cached);
    }
  }, [path]);

  useEffect(() => {
    if (!visible || !path || src) return;

    const iconifyId = parseIconifyLibraryPath(path);
    if (iconifyId) {
      const cached = previewCache.get(path);
      if (cached) { setSrc(cached); setLoading(false); return; }
      let active = true;
      setLoading(true);
      fetchIconifySvg(iconifyId).then(svg => {
        if (!active) return;
        if (svg) {
          const data = iconifySvgToDataUrl(svg);
          previewCache.set(path, data);
          setSrc(data);
        }
        setLoading(false);
      }).catch(() => { if (active) setLoading(false); });
      return () => { active = false; };
    }

    const winPath = toWindowsPath(path);
    if (!winPath) return;

    const cached = previewCache.get(winPath);
    if (cached) { setSrc(cached); setLoading(false); return; }

    let active = true;
    setLoading(true);

    // Strip ",index" suffix (shell32.dll,5 / icon.ico,3) before extension detection
    const baseFile = winPath.replace(/,-?\d+$/, '');
    const ext = baseFile.split(/[/\\]/).pop()?.split('.').pop()?.toLowerCase() || '';
    const isRaster = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'ico'].includes(ext);

    // Raster images: high-res thumbnail; DLL/EXE resources + SVG + others: shell icon
    const fetchPreview = isRaster && baseFile === winPath
      ? IPC.getNativeThumbnailBase64(winPath).then(t => t || IPC.getNativeShellIconBase64(winPath, false))
      : IPC.getNativeShellIconBase64(winPath, false);

    fetchPreview.then(b64 => {
      if (!active) return;
      if (b64) {
        const data = b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`;
        previewCache.set(winPath, data);
        setSrc(data);
      }
      setLoading(false);
    }).catch(() => {
      if (active) setLoading(false);
    });

    return () => { active = false; };
  }, [path, visible, src]);

  return (
    <div
      ref={ref}
      className={`flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
    >
      {loading && <Icons8Icon id="loading" size={size * 0.35} spin className="text-pink-400/60" />}
      {!loading && src && (
        <img src={src} alt="" className="max-w-full max-h-full object-contain drop-shadow-md" draggable={false} />
      )}
      {!loading && !src && <IconPlaceholder size={size * 0.85} />}
    </div>
  );
}
