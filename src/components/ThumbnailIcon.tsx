import { useState, useEffect, useRef, memo } from 'react';
import { shouldFetchNativeShellIcon, shouldFetchNativeThumbnail } from '../lib/settingsRuntime';
import { getOverlaysBehavior } from '../lib/settingsBehavior';
import { useAppConfig } from '../data/configContext';
import { FSEntity } from '../types';
import {
  getDeviconIdForExtension,
  getSkillIconIdForApp,
  fetchIconifySvg,
  iconifySvgToDataUrl,
} from '../lib/fileTypeIcons';
import { applyIconCacheBuster, invalidateIconUrl, getRuntimeListThumbPx, getRuntimeHiResThumbPx, requestNativeIcon } from '../lib/nativeIconService';
import { entityShellIsDirectory } from '../lib/shellPaths';
import { useNativeIcon } from '../lib/useNativeIcon';
import { resolveSvgInlineThumb } from '../lib/svgInlineThumb';
import { IconPlaceholder } from './IconPlaceholder';
import { EmblemIcon } from './EmblemIcon';
import { audioPlaybackSession } from '../lib/audioPlaybackSession';
import { toVirtualStreamUrl } from '../lib/pathUtils';

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

/** Request native icons at display resolution — avoids upscaling tiny shell glyphs in zoomed grid. */
function iconRequestPx(displaySize: number): number {
  const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2.5) : 1;
  const largeTile = displaySize >= 72;
  const heroTile = displaySize >= 120;
  const mediumTile = displaySize >= 48;
  const boost = heroTile ? 1.75 : largeTile ? 1.5 : mediumTile ? 1.25 : 1;
  const want = Math.ceil(displaySize * dpr * boost);
  const listPx = getRuntimeListThumbPx();
  const hiPx = getRuntimeHiResThumbPx();
  if (heroTile) {
    // Files Extra Large / jumbo: prefer 256–512 native extract, never soft-upscale a 32px glyph.
    return Math.min(512, Math.max(192, Math.ceil(displaySize * 1.5), want, hiPx));
  }
  if (largeTile) {
    return Math.min(384, Math.max(128, Math.ceil(displaySize * 1.35), want, Math.min(hiPx, 256)));
  }
  if (mediumTile) {
    return Math.min(256, Math.max(64, displaySize, want));
  }
  // Details / small icons — band to list preset, not full jumbo.
  return Math.min(128, Math.max(32, listPx, displaySize * dpr));
}

function buildThumbnailIconPolicyKey(config: ReturnType<typeof useAppConfig>['config']): string {
  return [
    config.iconCacheBuster,
    config.showFolderThumbnails,
    config.showThumbnailsForNonImages,
    config.showThumbnailsForRawFiles,
    config.useGenericIconsForSuperFastBrowsing,
    config.butOnlyInNetworkLocations,
    config.showFileIconOnThumbnail,
    config.showFilmStripOverlayOnVideoThumbnails,
    config.showIconOverlays,
    config.inNetworkLocationsAsWell,
    config.showShortcutOverlays,
    config.showSharedFolderOverlays,
    config.audioPreview,
  ].join('|');
}

type ThumbnailIconProps = {
  entity: FSEntity;
  isDir: boolean;
  path: string;
  size?: number;
  eager?: boolean;
  forceShellOnly?: boolean;
  policyKey: string;
};

/**
 * List/grid icon — CAS thumb first, shell glyph second.
 * Virtualized rows are already viewport-culled, so we fetch eagerly (no IntersectionObserver).
 */
const ThumbnailIconInner = memo(function ThumbnailIconInner({
  entity,
  isDir,
  path,
  size = 16,
  eager = true,
  forceShellOnly = false,
  policyKey: _policyKey,
}: ThumbnailIconProps) {
  const { config } = useAppConfig();
  const overlays = getOverlaysBehavior(config);
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
  const shellRetryRef = useRef(0);
  const showFilm = isVideo && config.showFilmStripOverlayOnVideoThumbnails === true;
  const showTypeBadge = useThumbnail && config.showFileIconOnThumbnail === true;
  const isGhostLink = !!(entity as any).isGhostLink;
  const isShortcut = !dirFlag && (ext === 'lnk' || !!(entity as any).isShortcut || !!(entity as any).isLink);
  const isSharedFolder = dirFlag && !!(
    (entity as any).isShared
    || (entity as any).isShare
    || (entity as any).shareName
    || ((entity as any).attributes || []).includes?.('shared')
  );
  const pathStr = typeof path === 'string' ? path : String(path ?? '');
  const networkProbe = pathStr.startsWith('//') || pathStr.startsWith('\\\\') || /^\/\//.test(pathStr);
  const overlaysBlockedOnNetwork = networkProbe
    && !!config.showIconOverlays
    && !config.inNetworkLocationsAsWell;
  const showShortcutOverlay = (overlays.showShortcutOverlays || !!config.showShortcutOverlays)
    && isShortcut
    && !overlaysBlockedOnNetwork;
  const showSharedOverlay = (overlays.showSharedFolderOverlays || !!config.showSharedFolderOverlays)
    && isSharedFolder
    && !overlaysBlockedOnNetwork;

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
    shellRetryRef.current = 0;
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

  const forceGeneric = !!config.useGenericIconsForSuperFastBrowsing
    && (!config.butOnlyInNetworkLocations || networkProbe);
  const allowThumbs = config.showThumbnailsForNonImages !== false
    || IMAGE_EXTS.has(ext)
    || VIDEO_EXTS.has(ext)
    || (config.showThumbnailsForRawFiles !== false && ['raw', 'cr2', 'nef', 'arw', 'dng', 'orf', 'rw2'].includes(ext));
  const thumbFetchEnabled = !forceGeneric && !forceShellOnly && isVisible && useThumbnail && allowThumbs
    && shouldFetchNativeThumbnail(entity, config, path);
  // Always fetch shell glyphs for first paint; thumbs upgrade afterward (Explorer model).
  const shellFetchEnabled = !forceGeneric && isVisible && shouldFetchNativeShellIcon(entity, config, path);

  // Direct fetch — shell first (high priority), then thumbs. Viewport shells fill before offscreen thumbs.
  const requestPx = iconRequestPx(size);
  useEffect(() => {
    if (!isVisible || !path) return;
    const boost = eager ? 800 : 400;
    if (shellFetchEnabled) void requestNativeIcon(path, dirFlag, 'shell', requestPx, boost);
    if (thumbFetchEnabled) void requestNativeIcon(path, dirFlag, 'thumbnail', requestPx, Math.max(0, boost - 200));
  }, [path, dirFlag, isVisible, thumbFetchEnabled, shellFetchEnabled, eager, requestPx]);

  const shellSrc = useNativeIcon(path, dirFlag, 'shell', !!path, requestPx);
  const thumbSrc = useNativeIcon(path, dirFlag, 'thumbnail', useThumbnail, requestPx);

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
    if (config.showCustomFileIcons === false) return;
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
      className={`${showFilm && hasRealThumb ? 'bndz-list-thumb bndz-list-thumb--film' : 'bndz-list-thumb'}${size >= 64 ? ' bndz-list-thumb--hero' : ''}`}
      data-thumb-transparency={String(config.thumbnailTransparency || 'Neutral')}
      style={{
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        position: 'relative',
        borderRadius: 3,
        boxShadow: config.useThumbnailChromeColor && config.thumbnailChromeColor
          ? `inset 0 0 0 1px #${String(config.thumbnailChromeColor).replace(/^#/, '')}`
          : undefined,
        background:
          String(config.thumbnailTransparency || 'Neutral') === 'Checkered'
            ? 'repeating-conic-gradient(#3a3a3a 0% 25%, #2a2a2a 0% 50%) 50% / 8px 8px'
            : String(config.thumbnailTransparency || 'Neutral') === 'White'
              ? '#ffffff'
              : String(config.thumbnailTransparency || 'Neutral') === 'Black'
                ? '#000000'
                : undefined,
      }}
    >
      {displaySrc ? (
        <img
          src={displaySrc}
          alt=""
          decoding="async"
          loading="eager"
          className={config.autoRotateThumbnails !== false ? 'bndz-auto-rotate-thumbs' : undefined}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            imageRendering: size >= 96 ? 'auto' : undefined,
          }}
          draggable={false}
          onMouseEnter={() => {
            // Settings → Audio preview (hover thumbnail / icon)
            if (!config.audioPreview || dirFlag || !AUDIO_EXTS.has(ext) || !path) return;
            const src = toVirtualStreamUrl(path);
            if (!src) return;
            audioPlaybackSession.load(path, src);
            audioPlaybackSession.setLoop(!!config.loop);
            audioPlaybackSession.play();
          }}
          onError={() => {
            const broken = displaySrc;
            invalidateIconUrl(broken);
            if (usableThumb && broken === usableThumb) {
              // Fall back to shell glyph; CAS thumbs stay on custom scheme.
              setThumbBroken(true);
              void requestNativeIcon(path, dirFlag, 'shell', requestPx, 1000);
              return;
            }
            if (usableShell && broken === usableShell) {
              if (shellRetryRef.current >= 1) {
                setShellBroken(true);
                setNativeFailed(true);
                return;
              }
              shellRetryRef.current += 1;
              setShellBroken(false);
              void requestNativeIcon(path, dirFlag, 'shell', requestPx, 1000);
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
      {showShortcutOverlay && size >= 14 && !isGhostLink && (
        <span
          className="bndz-shortcut-overlay absolute -right-0.5 -bottom-0.5 leading-none pointer-events-none rounded-[2px] bg-[#1a1d21]/92 text-[8px] font-bold text-sky-200 px-[2px] ring-1 ring-black/50"
          title="Shortcut"
          aria-hidden
        >
          ↗
        </span>
      )}
      {showSharedOverlay && size >= 14 && (
        <span
          className="bndz-shared-overlay absolute -left-0.5 -bottom-0.5 leading-none pointer-events-none rounded-[2px] bg-[#1a1d21]/92 text-[8px] font-bold text-emerald-300 px-[2px] ring-1 ring-black/50"
          title="Shared folder"
          aria-hidden
        >
          S
        </span>
      )}
    </div>
  );
}, (prev, next) => (
  prev.policyKey === next.policyKey
  && prev.entity.id === next.entity.id
  && prev.path === next.path
  && prev.size === next.size
  && prev.isDir === next.isDir
  && prev.eager === next.eager
  && prev.forceShellOnly === next.forceShellOnly
));

export function ThumbnailIcon(props: Omit<ThumbnailIconProps, 'policyKey'>) {
  const { config } = useAppConfig();
  return <ThumbnailIconInner {...props} policyKey={buildThumbnailIconPolicyKey(config)} />;
}
