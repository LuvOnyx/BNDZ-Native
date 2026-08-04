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
import { applyIconCacheBuster, invalidateIconUrl, LIST_THUMB_PX, requestNativeIcon } from '../lib/nativeIconService';
import { entityShellIsDirectory } from '../lib/shellPaths';
import { useNativeIcon } from '../lib/useNativeIcon';
import { resolveSvgInlineThumb } from '../lib/svgInlineThumb';
import { IconPlaceholder } from './IconPlaceholder';
import { EmblemIcon } from './EmblemIcon';

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tiff', 'tif', 'heic', 'jfif', 'avif']);
const VIDEO_EXTS = new Set(['mp4', 'mkv', 'mov', 'avi', 'webm', 'm4v', 'wmv', 'mpg', 'mpeg', 'flv', 'ts', 'm2ts']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'oga', 'wma', 'opus', 'aiff', 'ape']);
const ARCHIVE_EXTS = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'cab', 'iso']);
const DOC_PREVIEW_EXTS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'psd', 'ai']);

function entityExt(entity: FSEntity): string {
  const direct = ((entity as any).extension || '').toLowerCase().replace(/^\./, '');
  if (direct) return direct;
  const name = String(entity.name || '');
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

/**
 * List/grid icon — CAS thumb first, shell glyph second.
 * Virtualized rows are already viewport-culled, so we fetch eagerly (no IntersectionObserver).
 */
export function ThumbnailIcon({
  entity,
  isDir,
  path,
  size = 16,
  eager = true,
}: {
  entity: FSEntity;
  isDir: boolean;
  path: string;
  size?: number;
  /** When true (default), fetch immediately — required for virtualized list rows. */
  eager?: boolean;
}) {
  const { config } = useAppConfig();
  const ext = entityExt(entity);
  const isExe = ext === 'exe' || ext === 'lnk' || ext === 'msi';
  const isVideo = VIDEO_EXTS.has(ext);
  const folderThumbs = config.showFolderThumbnails === true;
  const useThumbnail = (isDir && folderThumbs) || (!isDir && (
    IMAGE_EXTS.has(ext) || isVideo || AUDIO_EXTS.has(ext) || ARCHIVE_EXTS.has(ext) || DOC_PREVIEW_EXTS.has(ext)
  ));
  const dirFlag = entityShellIsDirectory(entity, path);
  const [iconifyUrl, setIconifyUrl] = useState<string | null>(null);
  const [svgInline, setSvgInline] = useState<string | null>(null);
  const [nativeFailed, setNativeFailed] = useState(false);
  const [thumbBroken, setThumbBroken] = useState(false);
  const [shellBroken, setShellBroken] = useState(false);
  const [isVisible, setIsVisible] = useState(eager);
  const containerRef = useRef<HTMLDivElement>(null);
  const showFilm = isVideo && config.showFilmStripOverlayOnVideoThumbnails === true;
  const showTypeBadge = useThumbnail && config.showFileIconOnThumbnail === true;
  const isGhostLink = !!(entity as any).isGhostLink;

  useEffect(() => {
    if (config.iconCacheBuster) {
      applyIconCacheBuster(config.iconCacheBuster);
      setIconifyUrl(null);
      setNativeFailed(false);
      setThumbBroken(false);
      setShellBroken(false);
    }
  }, [config.iconCacheBuster]);

  useEffect(() => {
    setIconifyUrl(null);
    setSvgInline(null);
    setNativeFailed(false);
    setThumbBroken(false);
    setShellBroken(false);
    if (eager) {
      setIsVisible(true);
      return;
    }
    setIsVisible(false);
  }, [path, dirFlag, ext, eager]);

  useEffect(() => {
    if (eager) {
      setIsVisible(true);
      return;
    }
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setIsVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '160px', threshold: 0 });
    observer.observe(el);
    // Synchronous check — IO callbacks are async and can miss already-visible rows in WebView2.
    if (typeof observer.takeRecords === 'function') {
      const hits = observer.takeRecords();
      if (hits.some(h => h.isIntersecting)) {
        setIsVisible(true);
        observer.disconnect();
      }
    }
    return () => observer.disconnect();
  }, [path, eager]);

  const thumbFetchEnabled = isVisible && useThumbnail && shouldFetchNativeThumbnail(entity, config);
  // Always fetch shell glyphs for first paint; thumbs upgrade afterward (Explorer model).
  const shellFetchEnabled = isVisible && shouldFetchNativeShellIcon(entity, config);

  // Direct fetch — shell first (high priority), then thumbs. Viewport shells fill before offscreen thumbs.
  useEffect(() => {
    if (!isVisible || !path) return;
    const boost = eager ? 800 : 400;
    if (shellFetchEnabled) void requestNativeIcon(path, dirFlag, 'shell', LIST_THUMB_PX, boost);
    if (thumbFetchEnabled) void requestNativeIcon(path, dirFlag, 'thumbnail', LIST_THUMB_PX, Math.max(0, boost - 200));
  }, [path, dirFlag, isVisible, thumbFetchEnabled, shellFetchEnabled, eager]);

  const shellSrc = useNativeIcon(path, dirFlag, 'shell', !!path);
  const thumbSrc = useNativeIcon(path, dirFlag, 'thumbnail', useThumbnail);

  // SVG: CAS PNG first; else inline blob: — never bndz-stream (404s poison previews).
  useEffect(() => {
    if (!isVisible || !path || dirFlag || ext !== 'svg' || (thumbSrc && !thumbBroken)) {
      setSvgInline(null);
      return;
    }
    let active = true;
    void resolveSvgInlineThumb(path).then(url => {
      if (active) setSvgInline(url);
    });
    return () => { active = false; };
  }, [isVisible, path, dirFlag, ext, thumbSrc, thumbBroken]);

  const usableThumb = useThumbnail && thumbSrc && !thumbBroken ? thumbSrc : null;
  const usableShell = shellSrc && !shellBroken ? shellSrc : null;
  // Shell-first paint; upgrade to CAS thumb when ready (Explorer imagelist → preview).
  const nativeSrc = usableThumb || svgInline || usableShell || entity.iconBase64 || null;

  useEffect(() => {
    if (nativeSrc) {
      setNativeFailed(false);
      return;
    }
    if (!isVisible || (!shellFetchEnabled && !thumbFetchEnabled)) return;
    if (!path) return;
    let active = true;
    const timer = window.setTimeout(() => {
      if (active && !nativeSrc) setNativeFailed(true);
    }, 4500);
    return () => { active = false; window.clearTimeout(timer); };
  }, [nativeSrc, isVisible, shellFetchEnabled, thumbFetchEnabled, path]);

  useEffect(() => {
    if (nativeSrc || !nativeFailed) return;
    if (config.enableIconifyFileIcons === false || config.showCachedIconsOnly) return;
    // Prefer not to flash Devicon letters over media that should have real thumbs.
    if (useThumbnail) return;
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
  }, [nativeSrc, nativeFailed, isExe, ext, entity.name, config.enableIconifyFileIcons, config.showCachedIconsOnly, useThumbnail]);

  const displaySrc = nativeSrc || iconifyUrl;
  const hasRealThumb = !!usableThumb;

  return (
    <div
      ref={containerRef}
      className={showFilm && hasRealThumb ? 'bndz-list-thumb bndz-list-thumb--film' : 'bndz-list-thumb'}
      style={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, position: 'relative' }}
    >
      {displaySrc ? (
        <img
          src={displaySrc}
          alt=""
          decoding="async"
          loading="eager"
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          draggable={false}
          onError={() => {
            invalidateIconUrl(displaySrc);
            if (usableThumb && displaySrc === usableThumb) {
              setThumbBroken(true);
              return;
            }
            if (usableShell && displaySrc === usableShell) {
              setShellBroken(true);
              return;
            }
            setNativeFailed(true);
          }}
        />
      ) : (
        <IconPlaceholder size={size} />
      )}
      {showTypeBadge && hasRealThumb && usableShell && usableShell !== usableThumb && size >= 28 && (
        <img
          src={usableShell}
          alt=""
          decoding="async"
          draggable={false}
          style={{
            position: 'absolute',
            right: -1,
            bottom: -1,
            width: Math.max(10, Math.round(size * 0.38)),
            height: Math.max(10, Math.round(size * 0.38)),
            objectFit: 'contain',
            filter: 'drop-shadow(0 0 1px rgba(0,0,0,.8))',
            pointerEvents: 'none',
          }}
        />
      )}
      {isGhostLink && size >= 14 && (
        <span className="bndz-ghostlink-emblem absolute -right-0.5 -bottom-0.5 leading-none pointer-events-none" title="Ghost link">
          <EmblemIcon id="emblem-symbolic-link" size={Math.max(10, Math.round(size * 0.35))} />
        </span>
      )}
    </div>
  );
}
