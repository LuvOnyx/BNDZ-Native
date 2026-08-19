import React, { useState, useEffect, useRef, useCallback, Suspense, lazy } from 'react';
import { useAppConfig } from '../data/configContext';
import { FSEntity } from '../types';
import { toWindowsPath, toVirtualStreamUrl, encodeLocalStreamPath, formatFsDate, joinPanePath, normalizePanePath, isRecycleBinPath } from '../lib/pathUtils';
import { formatUiPath } from '../lib/displayPath';
import { isPreviewEnabledForExt, buildSettingsRuntime } from '../lib/settingsRuntime';
import { getBlowUpMouseBehavior, getPreviewAvBehavior } from '../lib/settingsBehavior';
import { applyWebPathMap } from '../lib/listReportExport';
import { entityShellIsDirectory } from '../lib/shellPaths';
import { getLocationIconPath } from '../lib/virtualLocations';
import { isBndzVirtualPath } from '../lib/bndzVirtualViews';
import { Icons8Icon } from './Icons8Icon';
import { motion, AnimatePresence } from 'framer-motion';
import MediaPreviewPlayer from './MediaPreviewPlayer';
import TextPreviewEditor from './TextPreviewEditor';
const MonacoMicroEditor = lazy(() => import('./preview/MonacoMicroEditor'));
const AudioWaveformEditor = lazy(() => import('./preview/AudioWaveformEditor'));
import SvgVectorPreview from './SvgVectorPreview';
import InspectionViewportRouter from '../workstation/inspection/InspectionViewportRouter';
import type { InspectionShaderMode } from '../workstation/inspection/InspectionViewportRouter';
import { probeWebGL } from '../workstation/webglProbe';
import PdfPreviewPanel from './PdfPreviewPanel';
import MarkdownPreviewPanel from './MarkdownPreviewPanel';
import HtmlPreviewPanel from './HtmlPreviewPanel';
const DocxPreviewPanel = lazy(() => import('./DocxPreviewPanel'));
const GpuModelViewport = lazy(() => import('../workstation/inspection/GpuModelViewport'));
import { isTextEditableExt, isCodeExt, isHtmlExt, isMarkdownExt, isDocxExt, isFontExt } from '../lib/textFileTypes';
import ArchivePreviewPanel from './ArchivePreviewPanel';
import TorrentPreviewPanel from './TorrentPreviewPanel';
import { PreviewHeroIcon } from './PreviewHeroIcon';
import { isArchiveExt, isTorrentExt } from '../lib/archiveTypes';
import { isAudioExt, isVideoExt, isImageExt, isModelExt, isGpuNativeModelExt, isRageConvertModelExt, isShellActivateExt } from '../lib/mediaTypes';
import { useModelPreviewSource } from '../lib/useModelPreviewSource';
import { isQueuedIpcResult } from '../lib/transferIpc';
import { listCatalogs, type CatalogEntry } from '../lib/catalog';
import { curatedPreviewFacts } from './preview/PreviewMetadataStrip';
import PreviewMetadataStrip from './preview/PreviewMetadataStrip';
import { SelectionFilmstrip } from './SelectionFilmstrip';
import BndzLensStage from './preview/BndzLensStage';
import { resolveSvgInlineThumb } from '../lib/svgInlineThumb';
import { audioPlaybackSession } from '../lib/audioPlaybackSession';
import { launcherIconUrl } from '../lib/toolbarLauncherIcons';
import { getLensStageCollapsed, setLensStageCollapsed } from '../lib/lensStageSession';
import { IPC } from '../lib/ipcBridge';
import FileLineagePanel from './preview/FileLineagePanel';
import AclDramaPanel from './preview/AclDramaPanel';
import ContentDnaRelativesPanel from './preview/ContentDnaRelativesPanel';
import JobTicketPanel from './preview/JobTicketPanel';

type PreviewTab = 'preview' | 'details' | 'media';

/** Hero icon sizes in the right preview panel (2× the prior 88/112 defaults). */
const PREVIEW_HERO_ICON_SIZE = { dir: 144, file: 176 } as const;
const PREVIEW_HERO_FALLBACK_ICON = 128;

interface RightPreviewPanelProps {
  entity: FSEntity | null;
  path?: string | null;
  pathContentsCache?: Record<string, any[]>;
  onNavigate?: (path: string) => void;
  onOpenFloatingPreview?: () => void;
  /** Multi-select filmstrip paths (Windows or pane). */
  selectionPaths?: string[];
  onSelectPath?: (path: string) => void;
  onToast?: (message: string, tone?: 'info' | 'warning') => void;
}

export default function RightPreviewPanel({ entity, path, pathContentsCache, onNavigate, onOpenFloatingPreview, selectionPaths, onSelectPath, onToast }: RightPreviewPanelProps) {
  const { config, updateConfig } = useAppConfig();
  const [thumbnailNative, setThumbnailNative] = useState<string | null>(null);
  const [shellIcon, setShellIcon] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [hexContent, setHexContent] = useState<string | null>(null);
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);
  const [folderStats, setFolderStats] = useState<{ files: number; folders: number; size: number } | null>(null);
  const [folderChildren, setFolderChildren] = useState<Array<{ name: string; type: string; size?: number }>>([]);
  const [browsePath, setBrowsePath] = useState<string | null>(null);
  const [selectedChild, setSelectedChild] = useState<string | null>(null);
  const [extendedDetails, setExtendedDetails] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<PreviewTab>('preview');
  const configInspectMode = (config.inspectionShaderMode as InspectionShaderMode) || 'passthrough';
  const [inspectMode, setInspectMode] = useState<InspectionShaderMode>(configInspectMode);
  useEffect(() => { setInspectMode(configInspectMode); }, [configInspectMode]);

  useEffect(() => {
    const onPreviewTab = (e: Event) => {
      const tab = (e as CustomEvent<{ tab?: PreviewTab }>).detail?.tab;
      if (tab === 'preview' || tab === 'details' || tab === 'media') setActiveTab(tab);
    };
    window.addEventListener('bndz-preview-tab', onPreviewTab);
    return () => window.removeEventListener('bndz-preview-tab', onPreviewTab);
  }, []);
  const [fileHashes, setFileHashes] = useState<{ md5?: string; sha256?: string } | null>(null);
  const [catalogs, setCatalogs] = useState<CatalogEntry[]>([]);
  const [svgPreviewUrl, setSvgPreviewUrl] = useState<string | null>(null);
  const [htmlView, setHtmlView] = useState<'render' | 'source'>('render');
  const [mdView, setMdView] = useState<'render' | 'source'>('render');
  const [naturalImageSize, setNaturalImageSize] = useState<{ w: number; h: number } | null>(null);
  const svgBlobUrlRef = useRef<string | null>(null);
  const showLensStage = config.showLensStage !== false;
  // Session survives RightPreviewPanel remounts on selection change — config alone can lag
  // and would briefly reopen a user-collapsed Lens.
  const [lensCollapsed, setLensCollapsed] = useState(() =>
    getLensStageCollapsed(config.lensCollapsedByDefault === true),
  );

  const toggleLensCollapsed = () => {
    setLensCollapsed(c => {
      const next = !c;
      setLensStageCollapsed(next);
      updateConfig({ lensCollapsedByDefault: next });
      return next;
    });
  };
  useEffect(() => {
    setBrowsePath(path ?? null);
    setSelectedChild(null);
  }, [path, entity?.id]);

  useEffect(() => {
    let active = true;
    listCatalogs().then(items => {
      if (active) setCatalogs(items);
    }).catch(() => {
      if (active) setCatalogs([]);
    });
    const onCatalogChanged = () => {
      listCatalogs().then(items => { if (active) setCatalogs(items); }).catch(() => {});
    };
    window.addEventListener('bndz-catalog-changed', onCatalogChanged);
    return () => {
      active = false;
      window.removeEventListener('bndz-catalog-changed', onCatalogChanged);
    };
  }, []);

  const folderBrowsePath = browsePath || path;

  // C# Wiring: hydrate high-resolution thumbnail and system info
  useEffect(() => {
     if (entity && path) {
        setThumbnailNative(null);
        setShellIcon(null);
        setExtendedDetails(null);
        setFileHashes(null);
        let active = true;
        const isDriveEntity = !!(entity as any)?.driveInfo;
        const shellIsDir = entityShellIsDirectory(entity, path);
        const cachedFolder = pathContentsCache?.[folderBrowsePath || ''];

        import('../lib/nativeIconService').then(({ requestNativeIcon, PREVIEW_THUMB_PX, LIST_THUMB_PX }) => {
           const useThumb = !shellIsDir && !isDriveEntity && config.enableNativeThumbnails !== false;
           if (useThumb) {
             requestNativeIcon(path, shellIsDir, 'thumbnail', PREVIEW_THUMB_PX, 2500).then(data => {
               if (!active || !data) return;
               setThumbnailNative(data.replace(/^data:image\/[^;]+;base64,/, ''));
             });
           }
           requestNativeIcon(path, shellIsDir, 'shell', LIST_THUMB_PX, 1500).then(data => {
             if (active && data) setShellIcon(data);
           });
        });
        import('../lib/extendedMetadataCache').then(({ getExtendedMetadataCached }) => {
           const winPath = toWindowsPath(path);
           const fileExt = String((entity as any)?.extension || '').toLowerCase().replace(/^\./, '');
           if (isShellActivateExt(fileExt)) {
             if (active) setExtendedDetails({});
             return;
           }

           if (IPC.isNative) {
               void getExtendedMetadataCached(winPath, { priority: 950 }).then(entry => {
                   if (active) setExtendedDetails(entry.meta);
               }).catch(() => {
                   if (active) setExtendedDetails({});
               });
           }
        });
        if (shellIsDir && folderBrowsePath && config.folderContentsPreview !== false) {
           const pane = normalizePanePath(folderBrowsePath);
           const skipStats = isDriveEntity
             || pane === '/'
             || pane === '/this-pc'
             || isRecycleBinPath(pane)
             || isBndzVirtualPath(pane)
             || pane.toLowerCase().startsWith('/shell:');
           if (skipStats) {
             setFolderStats(null);
             setFolderChildren([]);
           } else {
           const sortBy = String(config.folderContentsPreviewSortedBy || 'Name');
           const sortItems = (items: any[]) => {
             const dirsFirst = [...items].sort((a, b) => {
               if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
               switch (sortBy) {
                 case 'Size': return (b.size || 0) - (a.size || 0);
                 case 'Date': return String(b.modified || '').localeCompare(String(a.modified || ''));
                 case 'Type': return String(a.extension || '').localeCompare(String(b.extension || ''));
                 default: return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
               }
             });
             return dirsFirst;
           };
           const applyItems = (items: any[]) => {
              if (!active || !items) return;
              const sorted = sortItems(items);
              const files = sorted.filter((i: any) => i.type === 'file').length;
              const folders = sorted.filter((i: any) => i.type === 'directory').length;
              const size = sorted.reduce((sum: number, i: any) => sum + (i.type === 'file' ? (i.size || 0) : 0), 0);
              setFolderStats({ files, folders, size });
              setFolderChildren(
                sorted
                  .slice(0, 48)
                  .map((i: any) => ({ name: i.name, type: i.type, size: i.size }))
              );
           };
           if (cachedFolder?.length) {
              applyItems(cachedFolder);
           } else {
              import('../lib/ipcBridge').then(({ IPC }) => {
                 IPC.getDirContents(folderBrowsePath).then(items => {
                    applyItems(items || []);
                 }).catch(() => { if (active) { setFolderStats(null); setFolderChildren([]); } });
              });
           }
           }
        } else {
           setFolderStats(null);
           setFolderChildren([]);
        }

        return () => { active = false; };
     } else {
        setThumbnailNative(null);
        setShellIcon(null);
        setExtendedDetails(null);
        setFolderStats(null);
        setFolderChildren([]);
     }
  // Depend on the selected folder's cache entry only — not the whole pathContentsCache object.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity?.id, entity?.type, config.enableNativeThumbnails, config.highResNativeWindowsThumbnails, config.folderContentsPreview, config.folderContentsPreviewSortedBy, path, folderBrowsePath, pathContentsCache?.[folderBrowsePath || '']]);

  const openChild = (child: { name: string; type: string }, opts?: { navigateMain?: boolean }) => {
    if (!folderBrowsePath) return;
    const childPath = joinPanePath(folderBrowsePath, { name: child.name });
    setSelectedChild(child.name);
    if (child.type === 'directory') {
      setBrowsePath(childPath);
      if (opts?.navigateMain) onNavigate?.(childPath);
    } else if (opts?.navigateMain) {
      onNavigate?.(folderBrowsePath);
    }
  };

  const isDir = entity?.type === 'directory' || !!(entity as any)?.isVirtual;
  const heroPath = (entity as any)?.isVirtual ? getLocationIconPath(path) : path;
  const ext = !isDir ? (entity as any)?.extension?.toLowerCase() || '' : '';
  const isImage = isImageExt(ext);
  const isModel = isModelExt(ext);
  const isFont = isFontExt(ext);
  const isSvg = ext === 'svg';
  const isAudio = isAudioExt(ext);
  const isVideo = isVideoExt(ext);
  const isTextRaw = isTextEditableExt(ext) && !isCodeExt(ext) && !isHtmlExt(ext) && !isMarkdownExt(ext);
  const isCode = isCodeExt(ext);
  const isHtml = isHtmlExt(ext);
  const isMarkdown = isMarkdownExt(ext);
  const isDocx = isDocxExt(ext);
  const isEditableText = isTextRaw || isCode || isMarkdown;
  const isPdf = ext === 'pdf';
  const isBinary = ['exe', 'dll', 'sys', 'dat', 'bin'].includes(ext);
  const isArchive = isArchiveExt(ext);
  const isTorrent = isTorrentExt(ext);
  const isDrive = !!(entity as any)?.driveInfo;
  const modelPreview = useModelPreviewSource(isModel && path ? path : null, ext);
  const fontFamilyName = isFont && path
    ? `bndz-preview-font-${ext}-${(entity?.name || 'f').replace(/[^a-zA-Z0-9]/g, '')}`
    : '';
  
  // Use local-stream prefix so C# WebResourceRequested can intercept and stream local files securely
  // For web fallback, use the Express backend route
  const isNative = typeof window !== 'undefined' && !!(window as any).chrome?.webview;
  const virtualUrl = path && !isDir
      ? (isNative ? toVirtualStreamUrl(path) : `/local-stream/${encodeLocalStreamPath(toWindowsPath(path))}`)
      : '';
  const previewAllowed = isArchive || isTorrent || isPreviewEnabledForExt(ext, config);

  useEffect(() => {
    if (!entity) return;
    if (isHtml) setHtmlView('render');
    if (isMarkdown) setMdView('render');
    if (isAudio || isVideo) setActiveTab('media');
    else setActiveTab('preview');
    // Never auto-expand / reset lens on selection change — only force-collapse for archives
    // (no Lens UI) without writing the user's persisted preference.
    if (isArchive || isTorrent) setLensCollapsed(true);
  }, [path, entity?.id, isAudio, isVideo, isHtml, isArchive, isTorrent]);

  // Docked preview is selection-bound — pause shared audio when leaving the playing file
  // (otherwise folder selection keeps the previous WAV UI/session feeling "stuck").
  useEffect(() => {
    if (isAudio || isVideo) return;
    const snap = audioPlaybackSession.getSnapshot();
    if (snap.playing) audioPlaybackSession.pause();
  }, [path, entity?.id, isAudio, isVideo]);

  const previewRt = buildSettingsRuntime(config).preview;

  // Hashing is expensive — only compute when Details is visible.
  useEffect(() => {
    if (activeTab !== 'details' || !path || !entity) return;
    const shellIsDir = entityShellIsDirectory(entity, path);
    if (shellIsDir) {
      setFileHashes(null);
      return;
    }
    let active = true;
    setFileHashes(null);
    import('../lib/ipcBridge').then(({ IPC }) => {
      if (!IPC.isNative || !active) return;
      IPC.getAsyncHashes(toWindowsPath(path)).then(hashes => {
        if (active) setFileHashes(hashes);
      }).catch(() => {});
    });
    return () => { active = false; };
  }, [activeTab, path, entity?.id, entity?.type]);

  useEffect(() => {
    if (!path || !isImage || !config.showDimensionsOfOriginal) {
      setNaturalImageSize(null);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) setNaturalImageSize({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = () => {
      if (!cancelled) setNaturalImageSize(null);
    };
    img.src = virtualUrl;
    return () => { cancelled = true; };
  }, [path, isImage, virtualUrl, config.showDimensionsOfOriginal]);

  const mediaAv = getPreviewAvBehavior(config);
  const blowUp = getBlowUpMouseBehavior(config);
  // Keep previewCategories / previewFormats as live gates (Configuration → Preview).
  void config.previewCategories;
  void config.previewFormats;
  const previewDelayMs = typeof config.previewDelay === 'number'
    ? config.previewDelay
    : (previewRt.delayMs || 0);
  const nativePreviewHandling = config.useNativeHandlingInThePreviewPane !== false && previewRt.nativeHandling !== false;
  const avMode = String(config.audioVideoPreview || 'Play once');
  const audioVideoEnabled = avMode !== 'Disabled' && previewRt.audioVideoEnabled !== false;
  const seamlessLoop = !!config.seamlessWaveLooping || !!blowUp.loop || avMode === 'Loop' || !!previewRt.loopMedia;
  const mediaPlayerProps = {
    src: applyWebPathMap(config, virtualUrl),
    filePath: path,
    extension: ext,
    title: entity?.name,
    poster: thumbnailNative ? `data:image/png;base64,${thumbnailNative}` : undefined,
    autoplay: previewRt.autoplay
      || avMode === 'Play once'
      || avMode === 'Loop'
      || (config.audioPreview === true && avMode !== 'Manual' && avMode !== 'Disabled'),
    loop: seamlessLoop || !!config.loop,
    maxPlaySeconds: mediaAv.playOnlyTheFirstSeconds
      ? Number(mediaAv.playOnlyTheFirstSecondsValue) || 0
      : 0,
    keepPlayingWhenHidden: !!(mediaAv.keepPlayingWhenInfoPanelIsHidden || mediaAv.playAlsoWhenInfoPanelIsHidden),
    // Video/audio seeking needs byte-range on bndz-stream — prefer stream for both.
    preferBlob: (previewRt.preferBlob || !nativePreviewHandling) && !isVideo && !isAudio,
    onOpenFloating: onOpenFloatingPreview,
    skipIntroMs: config.skipVideoPreview && isVideo
      ? Math.max(0, Number(mediaAv.skipVideoPreviewValue) || 0)
      : 0,
    seamlessWaveLooping: !!config.seamlessWaveLooping,
    borderType: String(config.imageVideoBorderType || mediaAv.imageVideoBorderType || 'no-border'),
    showCaption: !!config.showCaption,
    overlayCaption: !!config.overlayCaption,
    showDimensions: !!config.showDimensionsOfOriginal && (isImage || (!!config.forVideosAsWell && isVideo)),
    compressionBg: String(config.compressionPreviewBgColor || ''),
    compressionFg: String(config.compressionPreviewFgColor || ''),
  };

  useEffect(() => {
     setFileContent(null);
     setHexContent(null);
     setContentError(null);
     setIsLoadingContent(false);

     if (!path || isDir || !previewAllowed || isArchive || isTorrent) return;
     if (isHtml && htmlView === 'render') return;
     if (isDocx || isPdf || isModel || isFont || isImage || isAudio || isVideo) return;

     const delayMs = previewDelayMs || 0;
     let cancelled = false;

     const fetchContent = async () => {
         if (cancelled) return;
         setIsLoadingContent(true);
         try {
             if (isEditableText) {
                 const { IPC } = await import('../lib/ipcBridge');
                 if (IPC.isNative) {
                     const result = await IPC.readTextFile(toWindowsPath(path));
                     if (result.error) throw new Error(result.error);
                     setFileContent(result.content ?? '');
                 } else {
                     const response = await fetch(virtualUrl);
                     if (!response.ok) throw new Error('Failed to load file.');
                     const text = await response.text();
                     setFileContent(text.length > 500000 ? text.substring(0, 500000) + '\n... [TRUNCATED]' : text);
                 }
             } else if (isBinary || (!isImage && !isAudio && !isVideo && !isPdf && !isDocx)) {
                 const response = await fetch(virtualUrl);
                 if (!response.ok) throw new Error("Failed to load local file via virtual host.");
                 const buffer = await response.arrayBuffer();
                 const bytes = new Uint8Array(buffer).slice(0, 256);
                 let hexStr = "";
                 for (let i = 0; i < bytes.length; i++) {
                     hexStr += bytes[i].toString(16).padStart(2, '0').toUpperCase() + " ";
                     if ((i + 1) % 16 === 0) hexStr += "\n";
                 }
                 setHexContent(hexStr || "Empty File");
             }
         } catch (err: any) {
             setContentError(err.message || "Failed to load preview.");
         } finally {
             setIsLoadingContent(false);
         }
     };

     if (isEditableText || isBinary || (isHtml && htmlView === 'source') || isMarkdown || (!isImage && !isAudio && !isVideo && !isPdf && !isHtml && !isMarkdown && !isDocx)) {
         const timer = setTimeout(() => { void fetchContent(); }, delayMs);
         return () => { cancelled = true; clearTimeout(timer); };
     }
     return () => { cancelled = true; };

  }, [path, isDir, isEditableText, isBinary, isImage, isAudio, isVideo, isPdf, isDocx, isHtml, isMarkdown, htmlView, mdView, isArchive, isTorrent, virtualUrl, previewAllowed, previewDelayMs]);

  useEffect(() => {
    if (!path || isDir || !isSvg || !previewAllowed) {
      svgBlobUrlRef.current = null;
      setSvgPreviewUrl(null);
      return;
    }
    let active = true;
    void resolveSvgInlineThumb(toWindowsPath(path)).then(url => {
      if (!active) return;
      svgBlobUrlRef.current = url;
      setSvgPreviewUrl(url);
    });
    return () => {
      active = false;
    };
  }, [path, isDir, isSvg, previewAllowed, virtualUrl]);

  useEffect(() => () => {
    svgBlobUrlRef.current = null;
  }, []);

  if (!entity) {
    return (
      <div className="bndz-preview-panel w-full h-full flex flex-col shrink-0 z-10 select-none">
        <div className="bndz-preview-empty">
          <Icons8Icon id="file_ui" size={40} className="opacity-25" />
          <div className="bndz-preview-empty-title">Inspector idle</div>
          <p className="bndz-preview-empty-desc">
            Select a file for preview, metadata, and media transport — or open a workspace.
          </p>
          <div className="bndz-preview-empty-actions">
            <button
              type="button"
              className="bndz-preview-empty-btn is-accent"
              onClick={() => window.dispatchEvent(new CustomEvent('bndz-navigate', { detail: { path: '/bndz/spatial-canvas' } }))}
            >
              <Icons8Icon id="view_grid" size={12} />
              Spatial Canvas
            </button>
            <button
              type="button"
              className="bndz-preview-empty-btn"
              onClick={() => window.dispatchEvent(new CustomEvent('bndz-navigate', { detail: { path: '/' } }))}
            >
              <Icons8Icon id="home" size={12} />
              Smart Views
            </button>
          </div>
        </div>
      </div>
    );
  }

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024, sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getPreviewIcon = () => {
     if (isDrive) return <Icons8Icon id="disk_mgmt" size={PREVIEW_HERO_FALLBACK_ICON} />;
     if (isDir) return <Icons8Icon id="explorer" size={PREVIEW_HERO_FALLBACK_ICON} />;
     if (isImage) return <Icons8Icon id="picture_ui" size={PREVIEW_HERO_FALLBACK_ICON} />;
     if (isAudio) return <Icons8Icon id="music_ui" size={PREVIEW_HERO_FALLBACK_ICON} />;
     if (isCode) return <Icons8Icon id="code_ui" size={PREVIEW_HERO_FALLBACK_ICON} />;
     if (isTextRaw) return <Icons8Icon id="file_ui" size={PREVIEW_HERO_FALLBACK_ICON} />;
     return <Icons8Icon id="file_ui" size={PREVIEW_HERO_FALLBACK_ICON} />;
  };

  const showThumb = previewRt.asThumbnail && config.previewAsThumbnail !== false;
  const zoom = config.previewZoomPercent || "100%";
  const animDuration = config.richTransitionAnimations === false ? 0 : previewRt.animDuration;
  const mediaBorderType = String(config.imageVideoBorderType || 'no-border');
  const showPreviewCaption = !!config.showCaption || !!config.overlayCaption;
  const showOriginalDims = !!config.showDimensionsOfOriginal;

  const extractArchive = async () => {
    if (!path) return;
    const win = toWindowsPath(path);
    const { IPC } = await import('../lib/ipcBridge');
    const dest = await IPC.openFolderDialog('Extract archive to…');
    if (!dest) return;
    const res = await IPC.extractArchive(win, dest);
    if (isQueuedIpcResult(res)) return;
    if (!res.ok) {
      window.dispatchEvent(new CustomEvent('bndz-native-alert', {
        detail: { title: 'Extract failed', message: res.error || 'Could not extract archive.' },
      }));
    }
  };

  const renderFolderContentsPreview = () => {
    if (config.folderContentsPreview === false || !isDir || folderChildren.length === 0) return null;
    return (
      <div className="flex flex-col min-h-0 flex-1 overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.03]">
        <div className="bndz-panel-section-title px-2 py-1.5 border-b border-white/5 flex items-center justify-between gap-2 shrink-0">
          <span>Contents preview</span>
          {browsePath && path && browsePath !== path && (
            <button
              type="button"
              className="text-[#7eb8e8] hover:text-[#99c9f0] normal-case tracking-normal text-xs font-medium"
              onClick={() => {
                const parent = browsePath.replace(/\/[^/]+$/, '') || path;
                setBrowsePath(parent);
                setSelectedChild(null);
              }}
            >
              ↑ Back
            </button>
          )}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto bndz-scrollbar">
          {folderChildren.map(c => (
            <button
              key={c.name}
              type="button"
              onClick={() => openChild(c)}
              onDoubleClick={() => openChild(c, { navigateMain: true })}
              className={`w-full flex items-center gap-2 px-2 py-1.5 text-left transition-colors ${
                selectedChild === c.name ? 'bg-[#094771]/35 text-[#cce4f7]' : 'hover:bg-white/[0.06] text-gray-300'
              }`}
              title={c.type === 'directory' ? 'Click to browse · Double-click to open in list' : 'Double-click to show in folder'}
            >
              <Icons8Icon id={c.type === 'directory' ? 'explorer' : 'file_ui'} size={10} className="shrink-0" />
              <span className="truncate flex-1 min-w-0">{c.name}</span>
              {c.type === 'file' && c.size != null && <span className="text-gray-600 shrink-0">{formatSize(c.size)}</span>}
            </button>
          ))}
          {folderStats && folderStats.files + folderStats.folders > folderChildren.length && (
            <div className="bndz-panel-muted px-2 py-1">+ more items…</div>
          )}
        </div>
      </div>
    );
  };

  const renderCatalogQuickPanel = () => {
    if (!config.catalog || !catalogs.length) return null;
    return (
      <div className="flex flex-col min-h-0 max-h-[120px] overflow-hidden rounded-md border border-white/[0.06] bg-white/[0.02]">
        <div className="bndz-panel-section-title px-2 py-1.5 border-b border-violet-500/15 flex items-center gap-1.5 shrink-0 text-violet-300/80">
          <Icons8Icon id="table_ui" size={10} />
          <span>Catalogs</span>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto bndz-scrollbar">
          {catalogs.slice(0, 8).map(cat => (
            <button
              key={cat.id}
              type="button"
              onClick={() => onNavigate?.(`/vf/${cat.id}`)}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-gray-300 hover:bg-violet-500/10 text-left transition-colors"
              title={`${cat.paths.length} item(s) · Open virtual catalog`}
            >
              <Icons8Icon id="table_ui" size={10} className="shrink-0" />
              <span className="truncate flex-1 min-w-0">{cat.name}</span>
              <span className="text-gray-600 shrink-0">{cat.paths.length}</span>
            </button>
          ))}
        </div>
      </div>
    );
  };

  const renderFolderDock = () => {
    const contentsPanel = renderFolderContentsPreview();
    const catalogPanel = renderCatalogQuickPanel();
    if (!contentsPanel && !catalogPanel) return null;
    return (
      <div className="flex flex-col gap-2 min-h-[140px] max-h-[min(280px,38vh)] w-full min-w-0">
        {contentsPanel}
        {catalogPanel}
      </div>
    );
  };

  const renderUniversalPreview = () => {
      if (isTorrent && path) {
          return <TorrentPreviewPanel path={path} />;
      }
      if (isArchive && path) {
          return <ArchivePreviewPanel path={path} format={ext} onExtract={extractArchive} />;
      }
      if (isAudio && audioVideoEnabled && path) {
        // Waveform stays mounted in the preview shell so Workspace tab switches
        // do not re-decode peaks.
        return null;
      }

      if (isVideo && audioVideoEnabled) {
        return (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-gray-500 text-xs p-6 text-center">
            <PreviewHeroIcon path={path} isDir={false} size={PREVIEW_HERO_ICON_SIZE.file} extension={ext} />
            <p>Playback and transport controls are on the Media tab.</p>
          </div>
        );
      }

      if ((isAudio || isVideo) && !audioVideoEnabled) {
          return (
            <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-gray-500 text-xs p-4 text-center">
              <Icons8Icon id="music_ui" size={48} className="opacity-30" />
              <p>Audio/video preview disabled in Configuration → Preview.</p>
            </div>
          );
      }

      if (isSvg && previewAllowed) {
          const wantInspect = inspectMode !== 'passthrough';
          // SVG is still 2D — Loupe/Luma tint/magnify the rasterized image.
          if (wantInspect) {
            const src = virtualUrl || svgPreviewUrl || '';
            if (!src) {
              return (
                <div className="w-full h-full flex items-center justify-center bndz-preview-stage pattern-checkerboard p-4">
                  <div className="text-xs text-gray-500 animate-pulse">Loading SVG…</div>
                </div>
              );
            }
            return (
              <div className={`relative w-full h-full min-h-0 flex-1 bndz-preview-media-frame bndz-preview-border-${mediaBorderType}`}>
                <InspectionViewportRouter
                  src={src}
                  alt={entity.name}
                  filePath={path}
                  onOpenFloating={onOpenFloatingPreview}
                  shaderMode={inspectMode}
                />
              </div>
            );
          }
          const src = svgPreviewUrl;
          if (!src) {
            return (
              <div className="w-full h-full flex items-center justify-center bndz-preview-stage pattern-checkerboard p-4">
                <div className="text-xs text-gray-500 animate-pulse">{svgPreviewUrl === null ? 'Loading SVG…' : 'SVG unavailable'}</div>
              </div>
            );
          }
          return (
            <div className={`relative w-full h-full min-h-0 bndz-preview-media-frame bndz-preview-border-${mediaBorderType}`}>
              <SvgVectorPreview
                key={path || src}
                src={src}
                alt={entity.name}
                filePath={path}
                onOpenFloating={onOpenFloatingPreview}
              />
            </div>
          );
      }

      if (isFont && previewAllowed && virtualUrl) {
        return (
          <div className="w-full h-full flex flex-col items-center justify-center gap-5 p-5 text-[color:var(--preview-text,#e8e8e8)] bndz-preview-stage">
            <style>{`@font-face{font-family:'${fontFamilyName}';src:url('${virtualUrl}');font-display:swap;}`}</style>
            <div className="text-[10px] uppercase tracking-[0.16em] opacity-45">Font preview</div>
            <div style={{ fontFamily: `'${fontFamilyName}', sans-serif` }} className="text-[28px] leading-snug text-center max-w-full">
              The quick brown fox jumps over the lazy dog
            </div>
            <div style={{ fontFamily: `'${fontFamilyName}', sans-serif` }} className="text-[16px] opacity-70 text-center">
              0123456789 · ABCDEFGHIJKLMNOPQRSTUVWXYZ
            </div>
            <div className="text-[11px] opacity-40 truncate max-w-full">{entity.name}</div>
          </div>
        );
      }

      if (isModel && previewAllowed) {
        // 3D / RAGE (.ydr/.ybn/…) — dedicated Orbit viewport only.
        // Loupe / Luma inspection modes are image-only and never wrap this path.
        const webGlReady = probeWebGL();
        const canShow = webGlReady && (isGpuNativeModelExt(ext) || isRageConvertModelExt(ext));
        if (!webGlReady) {
          return (
            <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-gray-500 text-xs p-6 text-center bndz-preview-stage">
              <PreviewHeroIcon path={path} isDir={false} size={PREVIEW_HERO_ICON_SIZE.file} extension={ext} />
              <p>WebGL is unavailable — enable GPU acceleration to preview 3D models.</p>
            </div>
          );
        }
        if (!canShow) {
          return (
            <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-gray-500 text-xs p-6 text-center bndz-preview-stage">
              <PreviewHeroIcon path={path} isDir={false} size={PREVIEW_HERO_ICON_SIZE.file} extension={ext} />
              <p>{ext.toUpperCase()} is recognized as a 3D/RAGE asset. Open externally for full tooling.</p>
            </div>
          );
        }
        if (modelPreview.loading) {
          return (
            <div className="w-full h-full flex items-center justify-center text-xs text-gray-400 animate-pulse bndz-preview-stage">
              Preparing {ext.toUpperCase()} mesh…
            </div>
          );
        }
        if (modelPreview.error || !modelPreview.url) {
          return (
            <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-gray-500 text-xs p-6 text-center bndz-preview-stage">
              <PreviewHeroIcon path={path} isDir={false} size={PREVIEW_HERO_ICON_SIZE.file} extension={ext} />
              <p>{modelPreview.error || '3D preview unavailable'}</p>
            </div>
          );
        }
        return (
          <div className={`relative w-full h-full min-h-0 bndz-preview-media-frame bndz-preview-border-${mediaBorderType}`}>
            <Suspense fallback={<div className="p-4 text-xs text-gray-400 animate-pulse">Loading 3D viewport…</div>}>
              <GpuModelViewport src={modelPreview.url} title={entity.name} badge={modelPreview.badge} />
            </Suspense>
            <div className="pointer-events-none absolute left-2 top-2 rounded-md bg-black/55 px-2 py-0.5 text-[10px] text-white/80">
              3D orbit · drag to rotate
            </div>
            {(modelPreview.vertices || modelPreview.triangles) ? (
              <div className="pointer-events-none absolute right-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white/80">
                {modelPreview.vertices?.toLocaleString()} verts · {modelPreview.triangles?.toLocaleString()} tris
              </div>
            ) : null}
          </div>
        );
      }

      if (isImage && previewAllowed) {
          // Loupe / Luma apply here only (2D photos). Never used for 3D meshes.
          // Always prefer full-res stream for the panel — CAS thumbs are interim/fallback only.
          // Preferring thumbs as primary made zoom look soft/pixelated.
          const thumbData = thumbnailNative
              ? `data:image/png;base64,${thumbnailNative}`
              : null;
          const primarySrc = virtualUrl || thumbData || '';
          const fallbackSrc = thumbData || undefined;
          return (
            <div
              className={`relative w-full h-full min-h-0 flex-1 bndz-preview-media-frame bndz-preview-media-frame--flush bndz-preview-border-${mediaBorderType}`}
            >
              <InspectionViewportRouter
                  src={primarySrc}
                  alt={entity.name}
                  fallbackSrc={fallbackSrc}
                  filePath={path}
                  onOpenFloating={onOpenFloatingPreview}
                  shaderMode={inspectMode}
              />
              {showPreviewCaption && (
                <div
                  className={`pointer-events-none absolute inset-x-0 ${config.overlayCaption ? 'bottom-0 bg-gradient-to-t from-black/75 to-transparent p-2' : 'top-0 bg-black/50 px-2 py-1'} text-[11px] text-white/90 truncate`}
                  style={config.compressionPreviewFgColor
                    ? { color: `#${String(config.compressionPreviewFgColor).replace(/^#/, '')}` }
                    : undefined}
                >
                  {entity.name}
                  {showOriginalDims && naturalImageSize ? ` · ${naturalImageSize.w}×${naturalImageSize.h}` : ''}
                </div>
              )}
              {!showPreviewCaption && showOriginalDims && naturalImageSize && (
                <div className="pointer-events-none absolute bottom-1 right-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white/85">
                  {naturalImageSize.w}×{naturalImageSize.h}
                </div>
              )}
            </div>
          );
      }

      // 3. Document / PDF
      if (isPdf && previewAllowed) {
          return <PdfPreviewPanel url={virtualUrl} title={entity.name} />;
      }

      // 3a. Word (.docx)
      if (isDocx && previewAllowed) {
          return (
            <Suspense fallback={<div className="p-4 text-gray-500 text-sm">Loading document preview…</div>}>
              <DocxPreviewPanel url={virtualUrl} title={entity.name} />
            </Suspense>
          );
      }

      // 3b. Markdown preview
      if (isMarkdown && previewAllowed) {
          return (
            <div className="w-full h-full bndz-preview-stage flex flex-col min-h-0">
              <div className="flex gap-1 p-1.5 border-b border-white/10 bg-black/20 shrink-0">
                <button
                  type="button"
                  onClick={() => setMdView('render')}
                  className={`px-2.5 py-1 text-xs font-semibold rounded bndz-preview-tab flex items-center gap-1 ${mdView === 'render' ? 'bndz-preview-tab-active' : ''}`}
                >
                  <Icons8Icon id="eye_ui" size={14} className="bndz-preview-tab-icon" />
                  Preview
                </button>
                <button
                  type="button"
                  onClick={() => setMdView('source')}
                  className={`px-2.5 py-1 text-xs font-semibold rounded bndz-preview-tab flex items-center gap-1 ${mdView === 'source' ? 'bndz-preview-tab-active' : ''}`}
                >
                  <Icons8Icon id="code_ui" size={14} className="bndz-preview-tab-icon" />
                  Source
                </button>
              </div>
              {mdView === 'render' ? (
                isLoadingContent ? (
                  <div className="p-4 text-xs text-gray-400 animate-pulse">Loading markdown…</div>
                ) : contentError ? (
                  <div className="p-4 text-xs text-red-400 font-mono border border-red-500/20 bg-red-500/5 m-2 rounded">{contentError}</div>
                ) : fileContent != null ? (
                  <MarkdownPreviewPanel content={fileContent} />
                ) : null
              ) : (
                fileContent != null && path ? (
                  <TextPreviewEditor path={path} fileName={entity.name} extension={ext} initialContent={fileContent} displayTabsAsSpaces={previewRt.displayTabsAsSpaces} />
                ) : (
                  <div className="p-4 text-xs text-gray-400 animate-pulse">Loading source…</div>
                )
              )}
            </div>
          );
      }

      // 3b. HTML live preview
      if (isHtml && previewAllowed) {
          return (
            <div className="w-full h-full bndz-preview-stage flex flex-col min-h-0">
              <div className="flex gap-1 p-1.5 border-b border-white/10 bg-black/20 shrink-0">
                <button
                  type="button"
                  onClick={() => setHtmlView('render')}
                  className={`px-2.5 py-1 text-xs font-semibold rounded bndz-preview-tab flex items-center gap-1 ${htmlView === 'render' ? 'bndz-preview-tab-active' : ''}`}
                >
                  <Icons8Icon id="eye_ui" size={14} className="bndz-preview-tab-icon" />
                  Preview
                </button>
                <button
                  type="button"
                  onClick={() => setHtmlView('source')}
                  className={`px-2.5 py-1 text-xs font-semibold rounded bndz-preview-tab flex items-center gap-1 ${htmlView === 'source' ? 'bndz-preview-tab-active' : ''}`}
                >
                  <Icons8Icon id="code_ui" size={14} className="bndz-preview-tab-icon" />
                  Source
                </button>
              </div>
              {htmlView === 'render' ? (
                path ? <HtmlPreviewPanel path={path} title={entity.name} /> : null
              ) : (
                fileContent != null && path ? (
                  <TextPreviewEditor path={path} fileName={entity.name} extension={ext} initialContent={fileContent} displayTabsAsSpaces={previewRt.displayTabsAsSpaces} />
                ) : (
                  <div className="p-4 text-xs text-gray-400 animate-pulse">Loading source…</div>
                )
              )}
            </div>
          );
      }

      if (isEditableText && previewAllowed) {
          if (isLoadingContent) {
              return <div className="p-4 text-xs text-gray-400 font-mono animate-pulse">Loading text...</div>;
          }
          if (contentError) {
              return <div className="p-4 text-xs text-red-400 font-mono border border-red-500/20 bg-red-500/5 m-2 rounded">{contentError}</div>;
          }
          if (fileContent != null && path) {
              if (isCode) {
                return (
                  <Suspense fallback={<div className="p-4 text-xs text-gray-400 animate-pulse">Loading editor…</div>}>
                    <MonacoMicroEditor path={path} fileName={entity.name} extension={ext} initialContent={fileContent} />
                  </Suspense>
                );
              }
              return (
                <TextPreviewEditor
                  path={path}
                  fileName={entity.name}
                  extension={ext}
                  initialContent={fileContent}
                  displayTabsAsSpaces={previewRt.displayTabsAsSpaces}
                />
              );
          }
      }

      // 5. Hex View Fallback
      if (isBinary || (!isDir && hexContent)) {
          return (
              <div className="w-full h-full flex flex-col bndz-preview-stage p-4 overflow-hidden">
                  <div className="flex items-center gap-2 mb-4 text-[#eab308] bndz-mono text-xs pb-2 border-b border-[#333]">
                      <Icons8Icon id="code_ui" size={14} /> <span>HEX INSPECTOR (First 256 Bytes)</span>
                  </div>
                  {isLoadingContent && <div className="text-xs text-gray-500 font-mono animate-pulse">Mapping virtual stream...</div>}
                  {contentError && <div className="p-4 text-xs text-red-400 font-mono border border-red-500/20 bg-red-500/5 rounded">{contentError}</div>}
                  {!isLoadingContent && !contentError && hexContent && (
                      <pre className="text-xs bndz-mono text-gray-400 leading-relaxed overflow-y-auto bndz-scrollbar break-all whitespace-pre-wrap select-text">
                         {hexContent}
                      </pre>
                  )}
              </div>
          );
      }

      return (
         <div className={`w-full h-full flex flex-col items-center justify-center p-6 relative bndz-preview-stage ${showThumb ? 'pattern-checkerboard' : ''}`}>
             <div className="absolute inset-0 " />
             <div className="px-8 py-6 flex flex-col items-center gap-4 max-w-[min(92%,560px)] bg-transparent border-0 shadow-none">
                 {path && isDir && !isDrive && !(entity as any)?.isVirtual ? (
                    <img
                      src={launcherIconUrl('ui_preview_folder') || '/Ui/preview-Big%20Folder.svg'}
                      alt=""
                      className="object-contain select-none pointer-events-none"
                      style={{
                        width: PREVIEW_HERO_ICON_SIZE.dir,
                        height: PREVIEW_HERO_ICON_SIZE.dir,
                        maxWidth: 'min(92%, 280px)',
                        maxHeight: 'min(40vh, 280px)',
                      }}
                      draggable={false}
                    />
                 ) : path && isDir && !isDrive && (entity as any)?.isVirtual ? (
                    <Icons8Icon
                      id={
                        normalizePanePath(path) === '/' || normalizePanePath(path) === '/this-pc'
                          ? 'this_pc'
                          : normalizePanePath(path) === '//'
                            ? 'go_network'
                            : isRecycleBinPath(path)
                              ? 'go_recycle_bin'
                              : normalizePanePath(path).toLowerCase().includes('libraries')
                                ? 'folder_open_ui'
                                : normalizePanePath(path).toLowerCase().includes('controlpanel')
                                  ? 'control_panel'
                                  : 'folder_open_ui'
                      }
                      size={PREVIEW_HERO_ICON_SIZE.dir}
                    />
                 ) : path ? (
                    <PreviewHeroIcon
                       path={heroPath || path}
                       isDir={isDir}
                       isDrive={isDrive}
                       size={isDir ? PREVIEW_HERO_ICON_SIZE.dir : PREVIEW_HERO_ICON_SIZE.file}
                       extension={ext}
                       preferThumbnail={!isDir && isImage}
                    />
                 ) : thumbnailNative ? (
                    <img src={`data:image/png;base64,${thumbnailNative}`} className="max-w-[280px] max-h-[280px] object-contain" alt="Preview" style={{ imageRendering: 'auto' }} />
                 ) : shellIcon ? (
                    <img src={shellIcon} className="max-w-[176px] max-h-[176px] object-contain" alt="Shell Icon" />
                 ) : (
                    <div className="flex flex-col items-center ">{getPreviewIcon()}</div>
                 )}
                 {isDir && folderStats && (
                    <div className="text-xs text-white/55 text-center font-medium tracking-wide">
                       {folderStats.folders} folders · {folderStats.files} files · {formatSize(folderStats.size)}
                    </div>
                 )}
                 {isDir && !folderStats && !isDrive && (() => {
                    const pane = normalizePanePath(path || '');
                    return pane !== '/' && pane !== '/this-pc' && !isRecycleBinPath(pane) && !isBndzVirtualPath(pane) && !pane.toLowerCase().startsWith('/shell:');
                 })() && (
                    <div className="bndz-panel-muted text-center animate-pulse">Calculating folder size…</div>
                 )}
                 {isDrive && (entity as any).driveInfo && (
                    <div className="text-xs text-white/55 text-center">
                       {formatSize((entity as any).driveInfo.freeSpace)} free of {formatSize((entity as any).driveInfo.totalSpace)}
                    </div>
                 )}
             </div>
             {!isDir && extendedDetails && curatedPreviewFacts(extendedDetails).length > 0 && (
               <div className="flex flex-wrap gap-x-3 gap-y-1 px-3 pb-2 text-[10px] text-[#9aa3ad]">
                 {curatedPreviewFacts(extendedDetails).map(f => (
                   <span key={`${f.label}:${f.value}`} className="min-w-0 max-w-full truncate" title={`${f.label}: ${f.value}`}>
                     <span className="text-[#6b7280]">{f.label}</span>{' '}
                     <span className="text-[#d1d5db]">{f.value}</span>
                   </span>
                 ))}
               </div>
             )}
             <div className="absolute bottom-3 right-3 flex gap-1.5">
                {isDir ? (
                   <span className="bndz-glass-chip text-[#38bdf8] text-[10px] px-2.5 py-1 uppercase font-semibold tracking-wide">DIR</span>
                ) : ext && (
                   <span className="bndz-glass-chip text-white/90 text-[10px] px-2.5 py-1 uppercase font-semibold tracking-wide">{ext}</span>
                )}
             </div>
         </div>
      );
  };

  const openInShell = () => {
    if (!path) return;
    import('../lib/ipcBridge').then(({ IPC }) => IPC.executeContextMenuVerb(toWindowsPath(path), 'open'));
  };

  const copyPath = () => {
    if (!path) return;
    import('../lib/ipcBridge').then(({ IPC }) => IPC.shellExecute('copyPath', toWindowsPath(path)));
  };

  const showProperties = () => {
    if (!path) return;
    import('../lib/ipcBridge').then(({ IPC }) => IPC.executeContextMenuVerb(toWindowsPath(path), 'properties'));
  };

  const tabs: { id: PreviewTab; label: string; show: boolean }[] = [
    { id: 'media', label: 'Media', show: isAudio || isVideo },
    { id: 'preview', label: isArchive || isTorrent ? 'Contents' : 'Workspace', show: true },
    { id: 'details', label: 'Details', show: true },
  ];

  const inspectionModes: { id: InspectionShaderMode; label: string }[] = [
    { id: 'passthrough', label: 'Standard' },
    { id: 'histogram', label: 'Luma inspect' },
    { id: 'loupe', label: 'Loupe' },
  ];

  const setInspectionMode = useCallback((mode: InspectionShaderMode) => {
    setInspectMode(mode);
    // Persist mode without forcing a full settings-runtime/shell sync storm on every click.
    updateConfig({ inspectionShaderMode: mode });
  }, [updateConfig]);

  return (
    <div className="bndz-preview-panel w-full h-full flex flex-col shrink-0 z-10 overflow-hidden">
       <div className="bndz-preview-tabstrip px-2 py-1 flex justify-between items-center z-10 shrink-0 select-none gap-2">
          <div className="flex gap-0.5 items-center min-w-0">
             {tabs.filter(t => t.show).map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTab(t.id)}
                  className={`bndz-preview-tab ${activeTab === t.id ? 'bndz-preview-tab-active' : ''}`}
                >
                  {t.label}
                </button>
             ))}
          </div>
          <div className="flex gap-0.5 shrink-0">
             <button type="button" onClick={openInShell} className="bndz-preview-action-btn" title="Open in default app"><Icons8Icon id="external_link" size={18} className="bndz-preview-action-icon" /></button>
             <button type="button" onClick={showProperties} className="bndz-preview-action-btn" title="Properties"><Icons8Icon id="sys_properties" size={18} className="bndz-preview-action-icon" /></button>
          </div>
       </div>
       
       <div className={`bndz-preview-content flex-1 relative flex flex-col min-h-0 ${
         isArchive || isTorrent || (isAudio && (activeTab === 'media' || activeTab === 'preview'))
           || ((isImage || isSvg) && activeTab === 'preview')
           ? 'overflow-hidden overscroll-contain'
           : 'overflow-y-auto bndz-scrollbar'
       }`}>
          {path && activeTab !== 'details' && (
            <PreviewMetadataStrip
              name={entity.name}
              path={toWindowsPath(path)}
              size={(entity as any).size}
              modified={entity.modified || extendedDetails?.Modified}
              kindLabel={isDrive ? (entity as any).typeDescription : (isDir ? 'Folder' : (ext ? `${ext.toUpperCase()} file` : 'File'))}
              isDirectory={isDir}
              facts={curatedPreviewFacts(extendedDetails)}
              onReveal={() => {
                if (!path) return;
                void import('../lib/ipcBridge').then(({ IPC }) => IPC.shellExecute('reveal', toWindowsPath(path)));
              }}
            />
          )}
          {isImage && activeTab === 'preview' && (
            <div className="bndz-inspection-mode-bar shrink-0" role="tablist" aria-label="Preview inspection mode">
              {inspectionModes.map(mode => (
                <button
                  key={mode.id}
                  type="button"
                  role="tab"
                  data-mode={mode.id}
                  aria-selected={inspectMode === mode.id}
                  title={`${mode.label} view`}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setInspectionMode(mode.id);
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setInspectionMode(mode.id);
                  }}
                  className={`bndz-inspection-mode-btn${inspectMode === mode.id ? ' is-active' : ''}`}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          )}
          {isAudio && audioVideoEnabled && path && (
            <div
              className={`flex-1 min-h-0 flex flex-col ${activeTab === 'preview' ? '' : 'hidden'}`}
              aria-hidden={activeTab !== 'preview'}
            >
              <Suspense fallback={<div className="p-4 text-xs text-gray-400 animate-pulse">Loading waveform…</div>}>
                <AudioWaveformEditor path={path} title={entity.name} />
              </Suspense>
            </div>
          )}
          {!(isAudio && activeTab === 'preview') && (
          <AnimatePresence mode="wait">
             <motion.div 
                key={`${path || entity.id}-${activeTab}-${isDir ? 'dir' : ext || 'file'}`}
                initial={{ opacity: 0, y: animDuration > 0 ? 10 : 0 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: animDuration > 0 ? -10 : 0 }}
                transition={{ duration: animDuration, ease: "easeOut" }}
                className={`flex flex-col flex-1 min-h-0 ${
                  isArchive || isTorrent || ((isImage || isSvg) && activeTab === 'preview') ? 'h-full' : ''
                }`}
             >
                {(activeTab === 'preview' || activeTab === 'media') && !(isAudio && activeTab === 'preview') && (
                <div className={`bndz-preview-stage w-full relative group flex flex-col min-h-0 flex-1 min-h-[160px] ${
                  isArchive || isTorrent
                    ? 'border-0'
                    : 'border-b border-white/[0.06]'
                }`}>
                    {activeTab === 'preview' && (isArchive || isTorrent) ? (
                      isTorrent && path ? <TorrentPreviewPanel path={path} /> : path ? <ArchivePreviewPanel path={path} format={ext} onExtract={extractArchive} /> : null
                    ) : activeTab === 'media' && (isAudio || isVideo) ? (
                      audioVideoEnabled ? (
                        isVideo ? (
                          <MediaPreviewPlayer {...mediaPlayerProps} type="video" />
                        ) : (
                          <MediaPreviewPlayer {...mediaPlayerProps} type="audio" />
                        )
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-gray-500 text-xs p-6 text-center">
                          <Icons8Icon id="music_ui" size={40} className="opacity-30" />
                          <p>Enable audio/video preview in Configuration → Preview.</p>
                        </div>
                      )
                    ) : activeTab === 'preview' ? renderUniversalPreview() : null}
                </div>
                )}

                {activeTab === 'details' && (
                <div className="p-4 flex-1 bndz-preview-details flex flex-col gap-4">
                    {/* Primary Identifier */}
                    <div className="pb-3 border-b border-[#282830]">
                       <h2 className="text-[14px] font-bold text-white break-words leading-tight">{entity.name}</h2>
                       <div className="bndz-panel-muted mt-1 bndz-mono">
                          {isDrive ? (entity as any).typeDescription : (isDir ? 'File Folder' : `${ext.toUpperCase()} File`)}
                       </div>
                    </div>

                    {/* Quick Stats Grid */}
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid grid-cols-[80px_1fr] gap-y-2 text-xs leading-relaxed">
                       {isDrive ? (
                           <>
                               <div className="text-gray-500 flex items-center gap-1"><Icons8Icon id="disk_mgmt" size={14} className="bndz-preview-inline-icon" /> Total Size:</div>
                               <div className="text-[#99c9f0]">{formatSize((entity as any).driveInfo.totalSpace)}</div>
                               <div className="text-gray-500 flex items-center gap-1">Free Space:</div>
                               <div className="text-emerald-400">{formatSize((entity as any).driveInfo.freeSpace)}</div>
                               <div className="text-gray-500 flex items-center gap-1">Format:</div>
                               <div className="text-gray-300">{(entity as any).driveInfo.format}</div>
                           </>
                       ) : (
                           <>
                               <div className="text-gray-500 flex items-center gap-1"><Icons8Icon id="disk_mgmt" size={14} className="bndz-preview-inline-icon" /> {isDir ? 'Size on disk:' : 'Size:'}</div>
                               <div className="text-[#99c9f0]">
                                  {isDir
                                    ? (folderStats ? formatSize(folderStats.size) : 'Calculating...')
                                    : ((entity as any).size != null ? formatSize((entity as any).size) : '--')}
                               </div>
                               {isDir && (
                                  <>
                                     <div className="text-gray-500">Contents:</div>
                                     <div className="text-gray-300">
                                        {folderStats
                                          ? `${folderStats.files} files · ${folderStats.folders} folders · ${formatSize(folderStats.size)}`
                                          : 'Calculating...'}
                                     </div>
                                  </>
                               )}
                               {path && (
                                  <>
                                     <div className="text-gray-500 flex items-center gap-1"><Icons8Icon id="info_ui" size={14} className="bndz-preview-inline-icon" /> Path:</div>
                                     <div className="bndz-mono text-gray-400 break-all leading-snug">{formatUiPath(path)}</div>
                                  </>
                               )}
                               {fileHashes?.md5 && (
                                  <>
                                     <div className="text-gray-500">MD5:</div>
                                     <div className="text-gray-400 break-all bndz-mono">{fileHashes.md5}</div>
                                  </>
                               )}
                               {fileHashes?.sha256 && (
                                  <>
                                     <div className="text-gray-500">SHA-256:</div>
                                     <div className="text-gray-400 break-all bndz-mono">{fileHashes.sha256}</div>
                                  </>
                               )}
                               <div className="text-gray-500">Created:</div>
                               <div className="text-gray-300">{formatFsDate((entity as any).created || extendedDetails?.Created)}</div>

                               <div className="text-gray-500">Modified:</div>
                               <div className="text-gray-300">{formatFsDate(entity.modified || extendedDetails?.Modified)}</div>

                               {extendedDetails?.Accessed && (
                                 <>
                                   <div className="text-gray-500">Accessed:</div>
                                   <div className="text-gray-300">{formatFsDate(extendedDetails.Accessed)}</div>
                                 </>
                               )}
                           </>
                       )}
                    </motion.div>

                    {/* Security & Access Box */}
                    <div className="mt-2 border bndz-preview-detail-card rounded-[4px] p-3 shadow-inner">
                       <div className="flex items-center gap-1.5 bndz-panel-section-title mb-2">
                          <Icons8Icon id="shield_ui" size={14} className="bndz-preview-inline-icon" /> Access Properties
                       </div>
                       
                       <div className="grid grid-cols-[80px_1fr] gap-y-1.5 text-xs">
                          <div className="text-gray-500">Owner:</div>
                          <div className="text-gray-300 flex items-center break-all">{extendedDetails ? (extendedDetails["Owner"] || 'SYSTEM\\Administrator') : 'Fetching...'}</div>
                          
                          <div className="text-gray-500 flex items-center gap-1"><Icons8Icon id="key_ui" size={14} className="bndz-preview-inline-icon" /> ACL:</div>
                          <div className="text-gray-300">
                               {extendedDetails ? 
                                    (extendedDetails["ACL Rule"]?.includes("F") ? "Full Control" : 
                                       (extendedDetails["ACL Rule"]?.includes("W") ? "Read / Write" : "Read Only")) 
                                    : 'Fetching...'}
                          </div>
                       </div>
                       
                       <div className="mt-3 pt-3 border-t border-[#282830] flex gap-4">
                          <label className="flex items-center gap-1.5 cursor-not-allowed">
                             <input type="checkbox" className="accent-[#0078d4] bg-[#222] border-[#444] rounded-sm" readOnly checked={extendedDetails ? extendedDetails["ReadOnly"] === "true" : (entity as any).readOnly !== false} /> 
                             <span className="text-gray-300">Read-only</span>
                          </label>
                          <label className="flex items-center gap-1.5 cursor-not-allowed">
                             <input type="checkbox" className="accent-[#0078d4] bg-[#222] border-[#444] rounded-sm" readOnly checked={extendedDetails ? extendedDetails["Hidden"] === "true" : (entity as any).hidden === true} /> 
                             <span className="text-gray-300">Hidden</span>
                          </label>
                       </div>
                    </div>

                    {extendedDetails && Object.keys(extendedDetails).length > 0 && (
                       <div className="border bndz-preview-detail-card rounded-[4px] p-3">
                          <div className="bndz-panel-section-title mb-2 flex items-center gap-1">
                             <Icons8Icon id="database_ui" size={14} className="bndz-preview-inline-icon" /> Extended Metadata
                          </div>
                          <div className="grid grid-cols-[90px_1fr] gap-y-1 text-xs max-h-[160px] overflow-y-auto bndz-scrollbar">
                             {Object.entries(extendedDetails).filter(([k]) => !['Owner', 'ACL Rule', 'ReadOnly', 'Hidden'].includes(k)).map(([k, v]) => (
                                <React.Fragment key={k}>
                                   <div className="text-gray-500">{k}:</div>
                                   <div className="text-gray-300 break-all">{String(v)}</div>
                                </React.Fragment>
                             ))}
                          </div>
                       </div>
                    )}

                    <FileLineagePanel path={path || null} onNavigate={onNavigate} />
                    <AclDramaPanel path={path || null} />
                    <ContentDnaRelativesPanel path={path || null} onNavigate={onNavigate} />
                    {isDir && <JobTicketPanel folderPath={path || null} />}
                </div>
                )}

                {activeTab === 'preview' && (
                isDir ? (
                  <>
                  <div className="shrink-0 border-t border-white/[0.06] bg-[#252526] grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(160px,42%)] gap-3 p-3 min-h-0">
                    <div className="min-w-0 flex flex-col justify-center">
                      <h2 className="text-[14px] font-semibold text-white truncate tracking-tight">{entity.name}</h2>
                      <p className="bndz-panel-section-title mt-1">Folder</p>
                      {folderStats && (
                        <p className="bndz-panel-muted mt-2 bndz-mono">
                          {folderStats.folders} folders · {folderStats.files} files · {formatSize(folderStats.size)}
                        </p>
                      )}
                    </div>
                    <div className="min-w-0 flex justify-end">
                      {renderFolderDock()}
                    </div>
                  </div>
                  <JobTicketPanel folderPath={path || null} />
                  </>
                ) : !isArchive && !isTorrent ? (
                <div className="px-4 py-3 border-t border-white/[0.06] bg-[#252526] shrink-0">
                   <h2 className="text-[14px] font-semibold text-white truncate tracking-tight">{entity.name}</h2>
                   <p className="bndz-panel-section-title mt-1 text-[#7eb8e8]">
                      {isDrive ? (entity as any).typeDescription : `${ext.toUpperCase()} file`}
                   </p>
                </div>
                ) : null
                )}
             </motion.div>
          </AnimatePresence>
          )}
       </div>
       {(selectionPaths?.length ?? 0) > 1 && (
         <SelectionFilmstrip
           paths={selectionPaths!}
           activePath={path || (entity as any)?.path}
           onSelect={onSelectPath}
         />
       )}
       {!isDir && path && !isBndzVirtualPath(path) && showLensStage && !isArchive && !isTorrent && (
         <div className={`bndz-lens-dock shrink-0 border-t border-white/[0.06] overflow-y-auto bndz-scrollbar${lensCollapsed ? ' is-collapsed' : ''}`}>
           <BndzLensStage
             path={path}
             isDir={false}
             collapsed={lensCollapsed}
             onToggleCollapsed={toggleLensCollapsed}
             onNavigate={onNavigate}
             onOpen={p => { void IPC.executeContextMenuVerb(toWindowsPath(p), 'open'); }}
             onOpenInNewWindow={p => {
               void IPC.openPathInNewWindow(p).then(r => {
                 if (!r.ok) onToast?.(r.error || 'Could not open Stage window.', 'warning');
                 else onToast?.('Opened in a new Stage window.');
               });
             }}
           />
         </div>
       )}
    </div>
  );
}
