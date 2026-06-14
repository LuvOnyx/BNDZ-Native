import { useState, useEffect, useRef } from 'react';
import { shouldFetchNativeShellIcon, shouldFetchNativeThumbnail } from '../lib/settingsRuntime';
import { useAppConfig } from '../data/configContext';
import { FSEntity } from '../types';
import {
  getDeviconIdForExtension,
  getSkillIconIdForApp,
  fetchIconifySvg,
  iconifySvgToDataUrl,
} from '../lib/fileTypeIcons';
import { applyIconCacheBuster } from '../lib/nativeIconService';
import { entityShellIsDirectory } from '../lib/shellPaths';
import { useNativeIcon, useNativeIconFetch } from '../lib/useNativeIcon';
import { IconPlaceholder } from './IconPlaceholder';

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tiff', 'tif']);
const VIDEO_EXTS = new Set(['mp4', 'mkv', 'mov', 'avi', 'webm', 'm4v']);

export function ThumbnailIcon({ entity, isDir, path, size = 16 }: { entity: FSEntity, isDir: boolean, path: string, size?: number }) {
  const { config } = useAppConfig();
  const ext = (entity as any).extension ? (entity as any).extension.toLowerCase() : '';
  const isExe = ext === 'exe' || ext === 'lnk' || ext === 'msi';
  const useThumbnail = !isDir && (IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext));
  const dirFlag = entityShellIsDirectory(entity, path);
  const [iconifyUrl, setIconifyUrl] = useState<string | null>(null);
  const [nativeFailed, setNativeFailed] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (config.iconCacheBuster) {
      applyIconCacheBuster(config.iconCacheBuster);
      setIconifyUrl(null);
      setNativeFailed(false);
    }
  }, [config.iconCacheBuster]);

  useEffect(() => {
    setIconifyUrl(null);
    setNativeFailed(false);
  }, [path, dirFlag, ext]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setIsVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '120px', threshold: 0 });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const shellFetchEnabled = isVisible && shouldFetchNativeShellIcon(entity, config);
  const thumbFetchEnabled = isVisible && useThumbnail && shouldFetchNativeThumbnail(entity, config);

  useNativeIconFetch(path, dirFlag, 'shell', isVisible, shellFetchEnabled);
  useNativeIconFetch(path, dirFlag, 'thumbnail', isVisible, thumbFetchEnabled);

  const shellSrc = useNativeIcon(path, dirFlag, 'shell', !!path);
  const thumbSrc = useNativeIcon(path, dirFlag, 'thumbnail', useThumbnail);
  const nativeSrc = (useThumbnail && thumbSrc) || shellSrc || entity.iconBase64 || null;

  useEffect(() => {
    if (nativeSrc) {
      setNativeFailed(false);
      return;
    }
    if (!isVisible || !shellFetchEnabled) return;
    if (!path) return;
    let active = true;
    const timer = window.setTimeout(() => {
      if (active && !nativeSrc) setNativeFailed(true);
    }, 2800);
    return () => { active = false; window.clearTimeout(timer); };
  }, [nativeSrc, isVisible, shellFetchEnabled, path]);

  useEffect(() => {
    if (nativeSrc || !nativeFailed) return;
    if (config.enableIconifyFileIcons === false || config.showCachedIconsOnly) return;
    let active = true;
    (async () => {
      if (isExe || ext === 'lnk') {
        const skillId = getSkillIconIdForApp(entity.name);
        if (skillId) {
          const svg = await fetchIconifySvg(skillId);
          if (svg && active) {
            setIconifyUrl(iconifySvgToDataUrl(svg));
            return;
          }
        }
      }
      const devId = getDeviconIdForExtension(ext);
      if (devId) {
        const svg = await fetchIconifySvg(devId);
        if (svg && active) setIconifyUrl(iconifySvgToDataUrl(svg));
      }
    })();
    return () => { active = false; };
  }, [nativeSrc, nativeFailed, isExe, ext, entity.name, config.enableIconifyFileIcons, config.showCachedIconsOnly]);

  const displaySrc = nativeSrc || iconifyUrl;

  return (
    <div ref={containerRef} style={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {displaySrc ? (
        <img src={displaySrc} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} draggable={false} />
      ) : (
        <IconPlaceholder size={size} />
      )}
    </div>
  );
}
