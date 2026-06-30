import React, { useState, useEffect, useRef } from 'react';
import { useAppConfig } from '../data/configContext';
import { FSEntity } from '../types';
import { toWindowsPath, toVirtualStreamUrl, encodeLocalStreamPath, formatFsDate, joinPanePath } from '../lib/pathUtils';
import { isPreviewEnabledForExt, buildSettingsRuntime } from '../lib/settingsRuntime';
import { entityShellIsDirectory } from '../lib/shellPaths';
import { getLocationIconPath } from '../lib/virtualLocations';
import { File, Folder, Image, Music, FileText, Code, Settings, HardDrive, Binary, ShieldUser, KeyRound, ExternalLink, Copy, Info, Film } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import MediaPreviewPlayer from './MediaPreviewPlayer';
import TextPreviewEditor from './TextPreviewEditor';
import ImageZoomPreview from './ImageZoomPreview';
import { isTextEditableExt, isCodeExt, isHtmlExt } from '../lib/textFileTypes';
import ArchivePreviewPanel from './ArchivePreviewPanel';
import TorrentPreviewPanel from './TorrentPreviewPanel';
import { PreviewHeroIcon } from './PreviewHeroIcon';
import { isArchiveExt, isTorrentExt } from '../lib/archiveTypes';
import { isAudioExt, isVideoExt, isImageExt } from '../lib/mediaTypes';

type PreviewTab = 'preview' | 'details' | 'media';

interface RightPreviewPanelProps {
  entity: FSEntity | null;
  path?: string | null;
  onNavigate?: (path: string) => void;
}

export default function RightPreviewPanel({ entity, path, onNavigate }: RightPreviewPanelProps) {
  const { config } = useAppConfig();
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
  const [fileHashes, setFileHashes] = useState<{ md5?: string; sha256?: string } | null>(null);
  const [svgPreviewUrl, setSvgPreviewUrl] = useState<string | null>(null);
  const [htmlView, setHtmlView] = useState<'render' | 'source'>('render');
  const svgBlobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    setBrowsePath(path ?? null);
    setSelectedChild(null);
  }, [path, entity?.id]);

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

        import('../lib/nativeIconService').then(({ requestNativeIcon }) => {
           const useThumb = !shellIsDir && !isDriveEntity && config.enableNativeThumbnails !== false;
           if (useThumb) {
             requestNativeIcon(path, shellIsDir, 'thumbnail').then(data => {
               if (!active || !data) return;
               setThumbnailNative(data.replace(/^data:image\/[^;]+;base64,/, ''));
             });
           }
           requestNativeIcon(path, shellIsDir, 'shell').then(data => {
             if (active && data) setShellIcon(data);
           });
        });
        import('../lib/ipcBridge').then(({ IPC }) => {
           const winPath = toWindowsPath(path);

           if (IPC.isNative) {
               IPC.getExtendedMetadata(winPath).then(details => {
                   if (active) setExtendedDetails(details);
               }).catch(() => {
                   if (active) setExtendedDetails({});
               });
               if (!shellIsDir) {
                  IPC.getAsyncHashes(winPath).then(hashes => {
                     if (active) setFileHashes(hashes);
                  }).catch(() => {});
               }
           }
        });
        if (shellIsDir && folderBrowsePath) {
           import('../lib/ipcBridge').then(({ IPC }) => {
              IPC.getDirContents(folderBrowsePath).then(items => {
                 if (!active || !items) return;
                 const files = items.filter((i: any) => i.type === 'file').length;
                 const folders = items.filter((i: any) => i.type === 'directory').length;
                 const size = items.reduce((sum: number, i: any) => sum + (i.type === 'file' ? (i.size || 0) : 0), 0);
                 setFolderStats({ files, folders, size });
                 setFolderChildren(
                   items
                     .slice(0, 48)
                     .map((i: any) => ({ name: i.name, type: i.type, size: i.size }))
                     .sort((a: any, b: any) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1))
                 );
              }).catch(() => { if (active) { setFolderStats(null); setFolderChildren([]); } });
           });
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
  }, [entity?.id, entity?.type, config.enableNativeThumbnails, config.highResNativeWindowsThumbnails, path, folderBrowsePath]);

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
  const isSvg = ext === 'svg';
  const isAudio = isAudioExt(ext);
  const isVideo = isVideoExt(ext);
  const isTextRaw = isTextEditableExt(ext) && !isCodeExt(ext) && !isHtmlExt(ext);
  const isCode = isCodeExt(ext);
  const isHtml = isHtmlExt(ext);
  const isEditableText = isTextRaw || isCode;
  const isPdf = ext === 'pdf';
  const isBinary = ['exe', 'dll', 'sys', 'dat', 'bin'].includes(ext);
  const isArchive = isArchiveExt(ext);
  const isTorrent = isTorrentExt(ext);
  const isDrive = !!(entity as any)?.driveInfo;
  
  // Use local-stream prefix so C# WebResourceRequested can intercept and stream local files securely
  // For web fallback, use the Express backend route
  const isNative = typeof window !== 'undefined' && !!(window as any).chrome?.webview;
  const virtualUrl = path
      ? (isNative ? toVirtualStreamUrl(path) : `/local-stream/${encodeLocalStreamPath(toWindowsPath(path))}`)
      : '';
  const previewAllowed = isArchive || isTorrent || isPreviewEnabledForExt(ext, config);

  useEffect(() => {
    if (!entity) return;
    if (isHtml) setHtmlView('render');
    if (isAudio || isVideo) setActiveTab('media');
    else setActiveTab('preview');
  }, [entity?.id, isAudio, isVideo, isHtml]);

  const previewRt = buildSettingsRuntime(config).preview;

  const mediaPlayerProps = {
    src: virtualUrl,
    filePath: path,
    extension: ext,
    title: entity?.name,
    poster: thumbnailNative ? `data:image/png;base64,${thumbnailNative}` : undefined,
    autoplay: previewRt.autoplay,
    preferBlob: previewRt.preferBlob || isAudio,
  };

  useEffect(() => {
     setFileContent(null);
     setHexContent(null);
     setContentError(null);
     setIsLoadingContent(false);

     if (!path || isDir || !previewAllowed || isArchive || isTorrent) return;
     if (isHtml && htmlView === 'render') return;

     const fetchContent = async () => {
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
             } else if (isBinary || (!isImage && !isAudio && !isVideo && !isPdf)) {
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

     if (isEditableText || isBinary || (isHtml && htmlView === 'source') || (!isImage && !isAudio && !isVideo && !isPdf && !isHtml)) {
         fetchContent();
     }

  }, [path, isDir, isEditableText, isBinary, isImage, isAudio, isVideo, isPdf, isHtml, htmlView, isArchive, isTorrent, virtualUrl, previewAllowed]);

  useEffect(() => {
    if (!path || isDir || !isSvg || !previewAllowed) {
      if (svgBlobUrlRef.current) {
        URL.revokeObjectURL(svgBlobUrlRef.current);
        svgBlobUrlRef.current = null;
      }
      setSvgPreviewUrl(null);
      return;
    }
    let active = true;
    (async () => {
      try {
        const { IPC } = await import('../lib/ipcBridge');
        if (IPC.isNative) {
          const result = await IPC.readTextFile(toWindowsPath(path));
          if (!active) return;
          if (result.content) {
            const blob = new Blob([result.content], { type: 'image/svg+xml' });
            const objectUrl = URL.createObjectURL(blob);
            if (svgBlobUrlRef.current) URL.revokeObjectURL(svgBlobUrlRef.current);
            svgBlobUrlRef.current = objectUrl;
            setSvgPreviewUrl(objectUrl);
            return;
          }
        }
        if (active) setSvgPreviewUrl(virtualUrl);
      } catch {
        if (active) setSvgPreviewUrl(virtualUrl);
      }
    })();
    return () => {
      active = false;
      if (svgBlobUrlRef.current) {
        URL.revokeObjectURL(svgBlobUrlRef.current);
        svgBlobUrlRef.current = null;
      }
    };
  }, [path, isDir, isSvg, previewAllowed, virtualUrl]);

  if (!entity) {
    return (
      <div className="bndz-preview-panel w-full h-full flex flex-col items-center justify-center text-gray-500 p-4 shrink-0 z-10 select-none">
        <File size={48} className="mb-4 opacity-20" />
        <span className="text-[13px]">Select a file to preview</span>
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
     if (isDrive) return <HardDrive size={80} className={(entity as any).name.includes('C:') ? "text-[#6db4e6]" : "text-gray-400"} />;
     if (isDir) return <Folder size={80} className="text-[#dcb67a]" />;
     if (isImage) return <Image size={80} className="text-purple-400" />;
     if (isAudio) return <Music size={80} className="text-sky-400" />;
     if (isCode) return <Code size={80} className="text-emerald-400" />;
     if (isTextRaw) return <FileText size={80} className="text-amber-400" />;
     return <File size={80} className="text-gray-400" />;
  };

  const showThumb = previewRt.asThumbnail;
  const zoom = config.selectConfig || "100%";
  const animDuration = previewRt.animDuration;

  const extractArchive = () => {
    if (!path) return;
    const win = toWindowsPath(path);
    const base = win.replace(/\\[^\\]+$/, '');
    const name = entity.name.replace(/\.[^.]+$/, '');
    import('../lib/ipcBridge').then(({ IPC }) => IPC.extractArchive(win, `${base}\\${name}`));
  };

  const renderUniversalPreview = () => {
      if (isTorrent && path) {
          return <TorrentPreviewPanel path={path} />;
      }
      if (isArchive && path) {
          return <ArchivePreviewPanel path={path} format={ext} onExtract={extractArchive} />;
      }
      if ((isAudio || isVideo) && !previewRt.audioVideoEnabled) {
          return (
            <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-gray-500 text-xs p-4 text-center">
              <Music size={48} className="opacity-30" />
              <p>Audio/video preview disabled in Configuration → Preview.</p>
            </div>
          );
      }

      if (isSvg && previewAllowed) {
          const src = svgPreviewUrl || virtualUrl;
          return (
            <div className="w-full h-full flex items-center justify-center bndz-preview-stage pattern-checkerboard p-4 overflow-auto bndz-scrollbar">
              {src ? (
                <img src={src} alt={entity.name} className="max-w-full max-h-full object-contain drop-shadow-lg" />
              ) : (
                <div className="text-xs text-gray-500 animate-pulse">Loading SVG…</div>
              )}
            </div>
          );
      }

      if (isImage && previewAllowed) {
          const primarySrc = thumbnailNative
              ? `data:image/png;base64,${thumbnailNative}`
              : shellIcon || virtualUrl;
          const fallbackChain = [
              thumbnailNative ? virtualUrl : null,
              shellIcon && !thumbnailNative ? shellIcon : null,
              thumbnailNative ? `data:image/png;base64,${thumbnailNative}` : null,
          ].filter(Boolean) as string[];
          return (
              <ImageZoomPreview
                  src={primarySrc}
                  alt={entity.name}
                  fallbackSrc={fallbackChain[0]}
              />
          );
      }

      // 3. Document / PDF Frame
      if (isPdf) {
          return (
              <div className="w-full h-full bndz-preview-stage flex flex-col">
                 <iframe src={virtualUrl} className="w-full flex-1 border-none bg-[#525252]" title={entity.name} />
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
                  className={`px-2.5 py-1 text-[10px] font-semibold rounded ${htmlView === 'render' ? 'bg-sky-600 text-white' : 'text-gray-400 hover:bg-white/5'}`}
                >
                  Preview
                </button>
                <button
                  type="button"
                  onClick={() => setHtmlView('source')}
                  className={`px-2.5 py-1 text-[10px] font-semibold rounded ${htmlView === 'source' ? 'bg-sky-600 text-white' : 'text-gray-400 hover:bg-white/5'}`}
                >
                  Source
                </button>
              </div>
              {htmlView === 'render' ? (
                <iframe src={virtualUrl} sandbox="allow-same-origin allow-scripts" className="w-full flex-1 border-0 bg-white" title={entity.name} />
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
                  <div className="flex items-center gap-2 mb-4 text-[#eab308] font-mono text-[11px] pb-2 border-b border-[#333]">
                      <Binary size={14} /> <span>HEX INSPECTOR (First 256 Bytes)</span>
                  </div>
                  {isLoadingContent && <div className="text-xs text-gray-500 font-mono animate-pulse">Mapping virtual stream...</div>}
                  {contentError && <div className="p-4 text-xs text-red-400 font-mono border border-red-500/20 bg-red-500/5 rounded">{contentError}</div>}
                  {!isLoadingContent && !contentError && hexContent && (
                      <pre className="text-[11px] font-mono text-gray-400 leading-relaxed overflow-y-auto bndz-scrollbar break-all whitespace-pre-wrap select-text">
                         {hexContent}
                      </pre>
                  )}
              </div>
          );
      }

      return (
         <div className={`w-full h-full flex flex-col items-center justify-center p-4 relative bndz-preview-stage ${showThumb ? 'pattern-checkerboard' : ''}`}>
             <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-10 pointer-events-none" />
             <div className="transition-transform duration-300 flex flex-col items-center gap-3">
                 {path ? (
                    <PreviewHeroIcon
                       path={heroPath || path}
                       isDir={isDir}
                       isDrive={isDrive}
                       size={isDir ? 112 : 144}
                       extension={ext}
                       preferThumbnail={!isDir && isImage}
                    />
                 ) : thumbnailNative ? (
                    <img src={`data:image/png;base64,${thumbnailNative}`} className="max-w-[200px] max-h-[200px] object-contain drop-shadow-2xl" alt="Preview" />
                 ) : shellIcon ? (
                    <img src={shellIcon} className="max-w-[128px] max-h-[128px] object-contain drop-shadow-2xl" alt="Shell Icon" />
                 ) : (
                    <div className="flex flex-col items-center drop-shadow-2xl">{getPreviewIcon()}</div>
                 )}
                 {isDir && folderStats && (
                    <div className="text-[11px] text-gray-400 text-center font-mono">
                       {folderStats.folders} folders · {folderStats.files} files · {formatSize(folderStats.size)}
                    </div>
                 )}
                 {isDir && folderChildren.length > 0 && (
                    <div className="w-full max-w-[280px] mt-2 max-h-[180px] overflow-y-auto bndz-scrollbar rounded-md border border-white/10 bg-black/30 text-left">
                      <div className="text-[9px] uppercase tracking-wider text-gray-500 px-2 py-1 border-b border-white/5 flex items-center justify-between gap-2">
                        <span>Contents preview</span>
                        {browsePath && path && browsePath !== path && (
                          <button
                            type="button"
                            className="text-sky-400/90 hover:text-sky-300 normal-case tracking-normal"
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
                      {folderChildren.map(c => (
                        <button
                          key={c.name}
                          type="button"
                          onClick={() => openChild(c)}
                          onDoubleClick={() => openChild(c, { navigateMain: true })}
                          className={`w-full flex items-center gap-2 px-2 py-1 text-[10px] text-gray-300 truncate text-left transition-colors ${
                            selectedChild === c.name ? 'bg-sky-500/20 text-sky-100' : 'hover:bg-white/[0.06]'
                          }`}
                          title={c.type === 'directory' ? 'Click to browse · Double-click to open in list' : 'Double-click to show in folder'}
                        >
                          {c.type === 'directory' ? <Folder size={10} className="text-amber-400 shrink-0" /> : <File size={10} className="text-slate-400 shrink-0" />}
                          <span className="truncate flex-1">{c.name}</span>
                          {c.type === 'file' && c.size != null && <span className="text-gray-600 shrink-0">{formatSize(c.size)}</span>}
                        </button>
                      ))}
                      {folderStats && folderStats.files + folderStats.folders > folderChildren.length && (
                        <div className="text-[9px] text-gray-600 px-2 py-1">+ more items…</div>
                      )}
                    </div>
                 )}
                 {isDrive && (entity as any).driveInfo && (
                    <div className="text-[11px] text-gray-400 text-center">
                       {formatSize((entity as any).driveInfo.freeSpace)} free of {formatSize((entity as any).driveInfo.totalSpace)}
                    </div>
                 )}
             </div>
             <div className="absolute bottom-2 right-2 flex gap-1 shadow-md">
                {isDir ? (
                   <span className="bg-black/90 text-[#dcb67a] text-[9px] px-2 py-0.5 rounded-[2px] uppercase font-bold border border-[#dcb67a]/40 shadow-inner tracking-wider">DIR</span>
                ) : ext && (
                   <span className="bg-black/90 text-white text-[9px] px-2 py-0.5 rounded-[2px] uppercase font-bold border border-white/20 shadow-inner tracking-wider">{ext}</span>
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
    { id: 'preview', label: isArchive || isTorrent ? 'Contents' : 'Preview', show: true },
    { id: 'media', label: 'Media', show: isAudio || isVideo },
    { id: 'details', label: 'Details', show: true },
  ];

  return (
    <div className="bndz-preview-panel w-full h-full flex flex-col shrink-0 shadow-[-6px_0_24px_rgba(0,0,0,0.35)] z-10 overflow-hidden">
       <div className="bndz-preview-tabstrip border-b border-white/[0.06] px-2.5 py-1.5 flex justify-between items-center z-10 shrink-0 select-none gap-2 backdrop-blur-sm">
          <div className="flex gap-1">
             {tabs.filter(t => t.show).map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTab(t.id)}
                  className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all duration-150 ${
                    activeTab === t.id ? 'bndz-preview-tab-active text-sky-100' : 'text-gray-500 hover:text-gray-200 hover:bg-white/[0.04]'
                  }`}
                >
                  {t.label}
                </button>
             ))}
          </div>
          <div className="flex gap-0.5">
             <button type="button" onClick={openInShell} className="p-1 hover:bg-[#333] rounded" title="Open"><ExternalLink size={12} className="text-gray-400" /></button>
             <button type="button" onClick={copyPath} className="p-1 hover:bg-[#333] rounded" title="Copy path"><Copy size={12} className="text-gray-400" /></button>
             <button type="button" onClick={showProperties} className="p-1 hover:bg-[#333] rounded" title="Properties"><Settings size={12} className="text-gray-400" /></button>
          </div>
       </div>
       
       <div className="bndz-preview-content flex-1 overflow-y-auto relative flex flex-col bndz-scrollbar">
          <AnimatePresence mode="wait">
             <motion.div 
                key={`${entity.id}-${activeTab}`}
                initial={{ opacity: 0, y: animDuration > 0 ? 10 : 0 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: animDuration > 0 ? -10 : 0 }}
                transition={{ duration: animDuration, ease: "easeOut" }}
                className="flex flex-col flex-1"
             >
                {(activeTab === 'preview' || activeTab === 'media') && (
                <div className={`w-full shrink-0 border-b border-[#282830] relative group ${isArchive || isTorrent ? 'h-[420px]' : 'h-[340px]'}`}>
                    {activeTab === 'preview' && (isArchive || isTorrent) ? (
                      isTorrent && path ? <TorrentPreviewPanel path={path} /> : path ? <ArchivePreviewPanel path={path} format={ext} onExtract={extractArchive} /> : null
                    ) : activeTab === 'media' && (isAudio || isVideo) ? (
                      previewRt.audioVideoEnabled ? (
                        isVideo ? (
                          <MediaPreviewPlayer {...mediaPlayerProps} type="video" />
                        ) : (
                          <MediaPreviewPlayer {...mediaPlayerProps} type="audio" />
                        )
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-gray-500 text-xs p-6 text-center">
                          <Music size={40} className="opacity-30" />
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
                       <div className="text-[11px] text-gray-500 mt-1 uppercase tracking-widest font-mono">
                          {isDrive ? (entity as any).typeDescription : (isDir ? 'File Folder' : `${ext.toUpperCase()} File`)}
                       </div>
                    </div>

                    {/* Quick Stats Grid */}
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid grid-cols-[80px_1fr] gap-y-2 text-[11px] font-mono leading-relaxed">
                       {isDrive ? (
                           <>
                               <div className="text-gray-500 flex items-center gap-1"><HardDrive size={10} /> Total Size:</div>
                               <div className="text-sky-300">{formatSize((entity as any).driveInfo.totalSpace)}</div>
                               <div className="text-gray-500 flex items-center gap-1">Free Space:</div>
                               <div className="text-emerald-400">{formatSize((entity as any).driveInfo.freeSpace)}</div>
                               <div className="text-gray-500 flex items-center gap-1">Format:</div>
                               <div className="text-gray-300">{(entity as any).driveInfo.format}</div>
                           </>
                       ) : (
                           <>
                               <div className="text-gray-500 flex items-center gap-1"><HardDrive size={10} /> {isDir ? 'Size on disk:' : 'Size:'}</div>
                               <div className="text-sky-300">
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
                                     <div className="text-gray-500 flex items-center gap-1"><Info size={10} /> Path:</div>
                                     <div className="text-gray-400 text-[10px] break-all leading-snug">{toWindowsPath(path)}</div>
                                  </>
                               )}
                               {fileHashes?.md5 && (
                                  <>
                                     <div className="text-gray-500">MD5:</div>
                                     <div className="text-gray-400 text-[9px] break-all font-mono">{fileHashes.md5}</div>
                                  </>
                               )}
                               {fileHashes?.sha256 && (
                                  <>
                                     <div className="text-gray-500">SHA-256:</div>
                                     <div className="text-gray-400 text-[9px] break-all font-mono">{fileHashes.sha256}</div>
                                  </>
                               )}
                               <div className="text-gray-500">Created:</div>
                               <div className="text-gray-300">{formatFsDate((entity as any).created)}</div>

                               <div className="text-gray-500">Modified:</div>
                               <div className="text-gray-300">{formatFsDate(entity.modified)}</div>
                           </>
                       )}
                    </motion.div>

                    {/* Security & Access Box */}
                    <div className="mt-2 border bndz-preview-detail-card rounded-[4px] p-3 shadow-inner">
                       <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-bold text-gray-400 mb-2">
                          <ShieldUser size={12} className="text-emerald-400" /> Access Properties
                       </div>
                       
                       <div className="grid grid-cols-[80px_1fr] gap-y-1.5 text-[11px] font-mono">
                          <div className="text-gray-500">Owner:</div>
                          <div className="text-gray-300 flex items-center break-all">{extendedDetails ? (extendedDetails["Owner"] || 'SYSTEM\\Administrator') : 'Fetching...'}</div>
                          
                          <div className="text-gray-500 flex items-center gap-1"><KeyRound size={10} /> ACL:</div>
                          <div className="text-gray-300">
                               {extendedDetails ? 
                                    (extendedDetails["ACL Rule"]?.includes("F") ? "Full Control" : 
                                       (extendedDetails["ACL Rule"]?.includes("W") ? "Read / Write" : "Read Only")) 
                                    : 'Fetching...'}
                          </div>
                       </div>
                       
                       <div className="mt-3 pt-3 border-t border-[#282830] flex gap-4">
                          <label className="flex items-center gap-1.5 cursor-not-allowed">
                             <input type="checkbox" className="accent-sky-500 bg-[#222] border-[#444] rounded-sm" readOnly checked={extendedDetails ? extendedDetails["ReadOnly"] === "true" : (entity as any).readOnly !== false} /> 
                             <span className="text-[11px] text-gray-300">Read-only</span>
                          </label>
                          <label className="flex items-center gap-1.5 cursor-not-allowed">
                             <input type="checkbox" className="accent-sky-500 bg-[#222] border-[#444] rounded-sm" readOnly checked={extendedDetails ? extendedDetails["Hidden"] === "true" : (entity as any).hidden === true} /> 
                             <span className="text-[11px] text-gray-300">Hidden</span>
                          </label>
                       </div>
                    </div>

                    {extendedDetails && Object.keys(extendedDetails).length > 0 && (
                       <div className="border bndz-preview-detail-card rounded-[4px] p-3">
                          <div className="text-[10px] uppercase tracking-widest font-bold text-gray-400 mb-2 flex items-center gap-1">
                             <Film size={12} /> Extended Metadata
                          </div>
                          <div className="grid grid-cols-[90px_1fr] gap-y-1 text-[10px] font-mono max-h-[160px] overflow-y-auto styled-scrollbar">
                             {Object.entries(extendedDetails).filter(([k]) => !['Owner', 'ACL Rule', 'ReadOnly', 'Hidden'].includes(k)).map(([k, v]) => (
                                <React.Fragment key={k}>
                                   <div className="text-gray-500">{k}:</div>
                                   <div className="text-gray-300 break-all">{String(v)}</div>
                                </React.Fragment>
                             ))}
                          </div>
                       </div>
                    )}
                </div>
                )}

                {activeTab === 'preview' && (
                <div className="px-4 py-3 border-t border-white/[0.06] bg-gradient-to-r from-[#0d0d12] to-[#111118] shrink-0">
                   <h2 className="text-[14px] font-semibold text-white truncate tracking-tight">{entity.name}</h2>
                   <p className="text-[10px] text-sky-400/70 uppercase tracking-widest mt-1 font-medium">
                      {isDrive ? (entity as any).typeDescription : (isDir ? 'Folder' : `${ext.toUpperCase()} file`)}
                   </p>
                </div>
                )}
             </motion.div>
          </AnimatePresence>
       </div>
    </div>
  );
}
