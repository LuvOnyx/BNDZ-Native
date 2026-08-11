import { useState, useEffect, useRef } from 'react';
import { shellIconIsDirectory } from '../lib/shellPaths';
import { useAppConfig } from '../data/configContext';
import { shouldFetchNativeShellIcon } from '../lib/settingsRuntime';
import { applyIconCacheBuster, getRuntimeListThumbPx } from '../lib/nativeIconService';
import { useNativeIcon, useNativeIconFetch } from '../lib/useNativeIcon';
import { resolveSvgInlineThumb } from '../lib/svgInlineThumb';
import { IconPlaceholder } from './IconPlaceholder';

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tiff', 'tif', 'jfif', 'heic', 'avif']);
const VIDEO_EXTS = new Set(['mp4', 'mkv', 'mov', 'avi', 'webm', 'm4v', 'wmv', 'mpg', 'mpeg']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'oga', 'wma', 'opus']);

function extFromPath(path: string): string {
  const name = path.split(/[/\\]/).pop() || '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

interface ShellNativeIconProps {
  path?: string | null;
  isDir?: boolean;
  size?: number;
  preferThumbnail?: boolean;
  eager?: boolean;
  hero?: boolean;
  /** Lock first painted src — prevents shell↔thumb flash on Spatial/drag cards. */
  stableSrc?: boolean;
}

export function ShellNativeIcon({
  path,
  isDir,
  size = 16,
  preferThumbnail,
  eager = false,
  hero = false,
  stableSrc = false,
}: ShellNativeIconProps) {
  const { config } = useAppConfig();
  const [visible, setVisible] = useState(eager);
  const [svgInline, setSvgInline] = useState<string | null>(null);
  const [thumbSettled, setThumbSettled] = useState(!stableSrc);
  const lockedSrcRef = useRef<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const ext = path ? extFromPath(path) : '';
  const useThumb = preferThumbnail ?? (
    IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext) || AUDIO_EXTS.has(ext)
  );
  const dirFlag = isDir ?? shellIconIsDirectory(path);
  const networkProbe = !!path && (path.startsWith('//') || path.startsWith('\\\\') || /^\/\//.test(path));
  // Settings → Use generic icons + Apply to all controls (tree/tabs/etc.).
  const forceGeneric = !!config.useGenericIconsForSuperFastBrowsing
    && !!config.applyToAllControls
    && (!config.butOnlyInNetworkLocations || networkProbe);
  const shellFetch = !forceGeneric && visible && !!path && shouldFetchNativeShellIcon({}, config, path || undefined);
  const thumbFetch = !forceGeneric && visible && !!path && useThumb
    && config.enableNativeThumbnails !== false
    && !config.showCachedIconsOnly;
  const thumbPx = hero || size >= 48
    ? Math.max(getRuntimeListThumbPx(), Math.min(512, Math.ceil(size * (typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2.5) : 1) * 1.35)))
    : getRuntimeListThumbPx();
  const shellPx = hero || size >= 48
    ? Math.min(512, Math.max(64, Math.ceil(size * (typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2.5) : 1) * 1.5)))
    : Math.max(32, size);

  useEffect(() => {
    applyIconCacheBuster(config.iconCacheBuster);
  }, [config.iconCacheBuster]);

  useEffect(() => {
    setSvgInline(null);
    lockedSrcRef.current = null;
    setThumbSettled(!stableSrc);
  }, [path, stableSrc]);

  useEffect(() => {
    if (!stableSrc || !useThumb) {
      setThumbSettled(true);
      return;
    }
    setThumbSettled(false);
    const t = window.setTimeout(() => setThumbSettled(true), 140);
    return () => window.clearTimeout(t);
  }, [path, stableSrc, useThumb]);

  useEffect(() => {
    if (eager) {
      setVisible(true);
      return;
    }
    setVisible(false);
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        setVisible(true);
        obs.disconnect();
      }
    }, { rootMargin: '96px', threshold: 0 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [eager, path]);

  useNativeIconFetch(path, dirFlag, 'shell', visible, shellFetch, shellPx);
  useNativeIconFetch(path, dirFlag, 'thumbnail', visible, thumbFetch, thumbPx);

  const shellSrc = useNativeIcon(path, dirFlag, 'shell', !!path, shellPx);
  const thumbSrc = useNativeIcon(path, dirFlag, 'thumbnail', useThumb, thumbPx);

  // SVG: CAS PNG first; if empty, inline blob: (never bndz-stream — custom scheme 404s poison previews).
  useEffect(() => {
    if (!visible || !path || dirFlag || ext !== 'svg' || thumbSrc) {
      setSvgInline(null);
      return;
    }
    let active = true;
    void resolveSvgInlineThumb(path).then(url => {
      if (active) setSvgInline(url);
    });
    return () => { active = false; };
  }, [visible, path, dirFlag, ext, thumbSrc]);

  // Prefer thumb when requested; briefly withhold shell so stableSrc doesn't lock the wrong bitmap.
  const candidate = (useThumb && thumbSrc) || svgInline || ((thumbSettled || !useThumb) ? shellSrc : null) || null;
  if (stableSrc) {
    if (candidate && !lockedSrcRef.current) lockedSrcRef.current = candidate;
  } else {
    lockedSrcRef.current = candidate;
  }
  const src = stableSrc ? (lockedSrcRef.current || candidate) : candidate;
  const heroScale = hero ? 1.06 : 1;

  return (
    <div
      ref={ref}
      className={hero ? 'bndz-shell-icon-hero' : undefined}
      style={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
    >
      {src ? (
        <img
          src={src}
          alt=""
          className={hero ? 'bndz-shell-icon-hero-img' : undefined}
          style={{
            width: hero ? size * heroScale : '100%',
            height: hero ? size * heroScale : '100%',
            maxWidth: hero ? 'none' : '100%',
            maxHeight: hero ? 'none' : '100%',
            objectFit: 'contain',
          }}
          draggable={false}
        />
      ) : (
        <IconPlaceholder size={hero ? Math.round(size * 0.85) : size} />
      )}
    </div>
  );
}
