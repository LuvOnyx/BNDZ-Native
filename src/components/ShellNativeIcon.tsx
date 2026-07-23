import { useState, useEffect, useRef } from 'react';
import { shellIconIsDirectory } from '../lib/shellPaths';
import { useAppConfig } from '../data/configContext';
import { shouldFetchNativeShellIcon } from '../lib/settingsRuntime';
import { applyIconCacheBuster } from '../lib/nativeIconService';
import { useNativeIcon, useNativeIconFetch } from '../lib/useNativeIcon';
import { IconPlaceholder } from './IconPlaceholder';

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tiff', 'tif']);
const VIDEO_EXTS = new Set(['mp4', 'mkv', 'mov', 'avi', 'webm', 'm4v']);

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
  /** Large preview/hero contexts — scale icon to fill the slot (shell PNGs have padding). */
  hero?: boolean;
}

export function ShellNativeIcon({
  path,
  isDir,
  size = 16,
  preferThumbnail,
  eager = false,
  hero = false,
}: ShellNativeIconProps) {
  const { config } = useAppConfig();
  const [visible, setVisible] = useState(eager);
  const ref = useRef<HTMLDivElement>(null);

  const ext = path ? extFromPath(path) : '';
  const useThumb = preferThumbnail ?? (IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext));
  const dirFlag = isDir ?? shellIconIsDirectory(path);
  const shellFetch = visible && !!path && shouldFetchNativeShellIcon({}, config);
  const thumbFetch = visible && !!path && useThumb
    && config.enableNativeThumbnails !== false
    && !config.showCachedIconsOnly;

  useEffect(() => {
    applyIconCacheBuster(config.iconCacheBuster);
  }, [config.iconCacheBuster]);

  useEffect(() => {
    if (eager) {
      setVisible(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        setVisible(true);
        obs.disconnect();
      }
    }, { rootMargin: '64px', threshold: 0 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [eager, path]);

  useNativeIconFetch(path, dirFlag, 'shell', visible, shellFetch);
  useNativeIconFetch(path, dirFlag, 'thumbnail', visible, thumbFetch);

  const shellSrc = useNativeIcon(path, dirFlag, 'shell', !!path);
  const thumbSrc = useNativeIcon(path, dirFlag, 'thumbnail', useThumb);
  const src = (useThumb && thumbSrc) || shellSrc;

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
