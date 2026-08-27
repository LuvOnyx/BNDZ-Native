import React, { useEffect, useMemo, useState, lazy, Suspense, useRef, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Icons8Icon } from '../Icons8Icon';
import { CloseGlyph } from '../ChromeGlyphs';
import { FSEntity } from '../../types';
import { toWindowsPath, toVirtualStreamUrl } from '../../lib/pathUtils';
import { isImageExt, isVideoExt, isAudioExt, isModelExt, isShellActivateExt, isGpuNativeModelExt, isRageConvertModelExt } from '../../lib/mediaTypes';
import { isTextEditableExt, isCodeExt, isHtmlExt, isMarkdownExt, isDocxExt, isFontExt } from '../../lib/textFileTypes';
import { isArchiveExt } from '../../lib/archiveTypes';
import { getExtendedMetadataCached } from '../../lib/extendedMetadataCache';
import { IPC } from '../../lib/ipcBridge';
import { useModelPreviewSource } from '../../lib/useModelPreviewSource';
import MediaPreviewPlayer, { type MediaPreviewPlayerHandle } from '../MediaPreviewPlayer';
import ImageZoomPreview from '../ImageZoomPreview';
import PdfPreviewPanel from '../PdfPreviewPanel';
import TextPreviewEditor from '../TextPreviewEditor';
import MarkdownPreviewPanel from '../MarkdownPreviewPanel';
import ArchivePreviewPanel from '../ArchivePreviewPanel';
import PreviewMetadataStrip, { curatedPreviewFacts } from './PreviewMetadataStrip';
import { PreviewHeroIcon } from '../PreviewHeroIcon';
import { requestMediaResume } from '../../lib/mediaPlaybackBridge';
import { audioPlaybackSession } from '../../lib/audioPlaybackSession';
import { useAppConfig } from '../../data/configContext';
import { probeWebGL } from '../../workstation/webglProbe';

const DocxPreviewPanel = lazy(() => import('../DocxPreviewPanel'));
const AudioWaveformEditor = lazy(() => import('./AudioWaveformEditor'));
const ImageMicroEditor = lazy(() => import('./ImageMicroEditor'));
const BndzPhotoStudio = lazy(() => import('./BndzPhotoStudio'));
const GpuModelViewport = lazy(() => import('../../workstation/inspection/GpuModelViewport'));

type QuickItem = {
  entity: FSEntity;
  path: string;
};

type Props = {
  open: boolean;
  items: QuickItem[];
  index: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  onNavigate?: (path: string) => void;
  /** Jump straight into Photo Studio edit mode when opened. */
  startInStudioEdit?: boolean;
};

export default function BndzQuickPreview({ open, items, index, onClose, onIndexChange, onNavigate, startInStudioEdit }: Props) {
  const { config } = useAppConfig();
  const safeItems = Array.isArray(items) ? items : [];
  const safeIndex = Math.min(Math.max(0, index), Math.max(0, safeItems.length - 1));
  const current = safeItems[safeIndex];
  const hasPrev = safeIndex > 0;
  const hasNext = safeIndex < safeItems.length - 1;
  const [indexedMeta, setIndexedMeta] = useState<Record<string, unknown> | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [extMeta, setExtMeta] = useState<Record<string, string> | null>(null);
  const [editMode, setEditMode] = useState(false);
  /** Image Edit: full Photo Studio (default) vs lightweight micro adjust. */
  const [imageEditMode, setImageEditMode] = useState<'studio' | 'quick'>('studio');
  const mediaPlayerRef = useRef<MediaPreviewPlayerHandle>(null);

  useEffect(() => {
    if (!open) {
      setEditMode(false);
      return;
    }
    if (startInStudioEdit) {
      setEditMode(true);
      setImageEditMode('studio');
    }
  }, [open, startInStudioEdit, current?.path]);
  const [panelOffset, setPanelOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  // Settings → Remember relative position (blow-up / Quick Look panel).
  useEffect(() => {
    if (!open || !config.rememberRelativePosition) {
      setPanelOffset({ x: 0, y: 0 });
      return;
    }
    try {
      const raw = sessionStorage.getItem('bndz.quickPreview.offset');
      if (raw) {
        const parsed = JSON.parse(raw) as { x?: number; y?: number };
        setPanelOffset({
          x: Number(parsed.x) || 0,
          y: Number(parsed.y) || 0,
        });
      }
    } catch { /* ignore */ }
  }, [open, config.rememberRelativePosition]);

  const persistOffset = useCallback((next: { x: number; y: number }) => {
    setPanelOffset(next);
    if (!config.rememberRelativePosition) return;
    try { sessionStorage.setItem('bndz.quickPreview.offset', JSON.stringify(next)); } catch { /* ignore */ }
  }, [config.rememberRelativePosition]);

  useEffect(() => {
    if (!open || !current?.path || !IPC.isNative) {
      setIndexedMeta(null);
      return;
    }
    let active = true;
    IPC.getIndexedEntry(current.path).then(meta => {
      if (active) setIndexedMeta(meta);
    }).catch(() => {
      if (active) setIndexedMeta(null);
    });
    return () => { active = false; };
  }, [open, current?.path]);

  useEffect(() => {
    if (!open || !current?.path || !IPC.isNative || current.entity?.type === 'directory') {
      setExtMeta(null);
      return;
    }
    const name = current.entity?.name || '';
    const dot = name.lastIndexOf('.');
    const fileExt = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
    if (isShellActivateExt(fileExt)) {
      setExtMeta(null);
      return;
    }
    let active = true;
    void getExtendedMetadataCached(toWindowsPath(current.path), { priority: 950 }).then(entry => {
      if (active) setExtMeta(entry.meta || null);
    }).catch(() => { if (active) setExtMeta(null); });
    return () => { active = false; };
  }, [open, current?.path, current?.entity?.type, current?.entity?.name]);

  const displaySize = (current?.entity as any)?.size ?? (indexedMeta?.size as number | undefined);
  const displayModified = (current?.entity as any)?.modified ?? (indexedMeta?.modified as number | undefined);
  const indexedKind = indexedMeta?.mediaKind as string | undefined;

  const ext = useMemo(() => {
    const name = current?.entity?.name || '';
    const dot = name.lastIndexOf('.');
    return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
  }, [current?.entity?.name]);

  const isDir = current?.entity?.type === 'directory';
  const isImage = !isDir && isImageExt(ext);
  const isVideo = !isDir && isVideoExt(ext);
  const isAudio = !isDir && isAudioExt(ext);
  const isPdf = !isDir && ext === 'pdf';
  const isMarkdown = !isDir && isMarkdownExt(ext);
  const isCode = !isDir && isCodeExt(ext);
  const isHtml = !isDir && isHtmlExt(ext);
  const isTextRaw = !isDir && isTextEditableExt(ext) && !isCode && !isHtml && !isMarkdown;
  const isDocx = !isDir && isDocxExt(ext);
  const isArchive = !isDir && isArchiveExt(ext);
  const isFont = !isDir && isFontExt(ext);
  const isModel = !isDir && isModelExt(ext);
  const isEditableText = isTextRaw || isCode || isMarkdown;
  const virtualUrl = current?.path ? toVirtualStreamUrl(current.path) : '';
  const canEditMedia = isImage || isAudio;
  const fontFamilyName = isFont ? `bndz-ql-font-${ext}-${(current?.entity?.name || 'f').replace(/[^a-zA-Z0-9]/g, '')}` : '';
  const modelPreview = useModelPreviewSource(isModel && current?.path ? current.path : null, ext);

  useEffect(() => {
    setEditMode(false);
    setImageEditMode('studio');
  }, [current?.path, open]);

  const handleClose = useCallback(() => {
    // Audio uses a shared decoder — leave it playing when Quick Look closes.
    // Video still handoffs timeline back to the docked panel player.
    if (!editMode && current?.path) {
      if (isVideo) {
        mediaPlayerRef.current?.stashPlayback();
        requestMediaResume(current.path);
      } else if (isAudio) {
        // Soft UI release only; keep session timeline/play state.
        audioPlaybackSession.releaseUi();
      }
    }
    setEditMode(false);
    onClose();
  }, [isAudio, isVideo, current?.path, editMode, onClose]);

  useEffect(() => {
    setFileContent(null);
    if (!open || !current?.path || isDir || isImage || isVideo || isAudio || isPdf || isDocx || isArchive || isFont || isModel) return;
    if (!isEditableText && !isHtml) return;

    let cancelled = false;
    setContentLoading(true);
    IPC.readTextFile(toWindowsPath(current.path))
      .then(res => {
        if (!cancelled) setFileContent(res.error ? null : (res.content ?? ''));
      })
      .catch(() => { if (!cancelled) setFileContent(null); })
      .finally(() => { if (!cancelled) setContentLoading(false); });
    return () => { cancelled = true; };
  }, [open, current?.path, isDir, isImage, isVideo, isAudio, isPdf, isDocx, isArchive, isFont, isModel, isEditableText, isHtml]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const mediaFocused = (e.target as HTMLElement)?.closest?.('video, audio');
      if (e.code === 'Escape') {
        e.preventDefault();
        if (editMode) setEditMode(false);
        else handleClose();
      } else if (e.code === 'Space' && !e.repeat && !mediaFocused) {
        // Space is Hand tool in Photo Studio / audio edit — don't dismiss preview.
        // Also ignore while an editable field or waveform control is focused.
        if (editMode) return;
        const t = e.target as HTMLElement | null;
        if (t?.closest?.('button, input, textarea, select, [contenteditable="true"], .bndz-wave-editor')) return;
        e.preventDefault();
        handleClose();
      } else if (e.code === 'ArrowLeft' && hasPrev && !editMode) {
        e.preventDefault();
        onIndexChange(safeIndex - 1);
      } else if (e.code === 'ArrowRight' && hasNext && !editMode) {
        e.preventDefault();
        onIndexChange(safeIndex + 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, handleClose, onIndexChange, safeIndex, hasPrev, hasNext, editMode]);

  const runVerb = (verb: string) => {
    if (!current?.path) return;
    import('../../lib/ipcBridge').then(({ IPC }) => {
      IPC.executeContextMenuVerb(toWindowsPath(current.path), verb);
    });
  };

  const windowsPath = current?.path ? toWindowsPath(current.path) : '';

  const copyPath = () => {
    if (!windowsPath) return;
    // Native clipboard via shell IPC — navigator.clipboard often fails in WebView2.
    import('../../lib/ipcBridge').then(({ IPC }) => {
      IPC.shellExecute('copyPath', windowsPath);
    });
  };

  const kindLabel = indexedKind
    ? indexedKind.charAt(0).toUpperCase() + indexedKind.slice(1)
    : isDir ? 'Folder' : isImage ? 'Image' : isVideo ? 'Video' : isAudio ? 'Audio' : isPdf ? 'PDF' : isArchive ? 'Archive' : isModel ? '3D' : isFont ? 'Font' : isDocx ? 'Word' : ext ? ext.toUpperCase() : 'File';

  const renderPreview = () => {
    if (editMode && isImage) {
      return (
        <Suspense fallback={<div className="flex items-center justify-center p-8 text-gray-500"><Icons8Icon id="loading" size={20} spin /></div>}>
          {imageEditMode === 'quick' ? (
            <ImageMicroEditor path={current.path} title={current.entity.name} />
          ) : (
            <BndzPhotoStudio
              path={current.path}
              title={current.entity.name}
              onRequestClose={() => setEditMode(false)}
            />
          )}
        </Suspense>
      );
    }
    if (editMode && isAudio) {
      return (
        <Suspense fallback={<div className="flex items-center justify-center p-8 text-gray-500"><Icons8Icon id="loading" size={20} spin /></div>}>
          <AudioWaveformEditor path={current.path} title={current.entity.name} />
        </Suspense>
      );
    }
    if (isImage) return <ImageZoomPreview src={virtualUrl} alt={current.entity.name} filePath={current.path} />;
    if (isVideo || isAudio) {
      return (
        <MediaPreviewPlayer
          ref={mediaPlayerRef}
          type={isVideo ? 'video' : 'audio'}
          src={virtualUrl}
          filePath={current.path}
          extension={ext}
          title={current.entity.name}
          autoplay={isVideo}
          preferBlob={isAudio}
        />
      );
    }
    if (isPdf) return <PdfPreviewPanel url={virtualUrl} title={current.entity.name} />;
    if (isDocx) {
      return (
        <Suspense fallback={<div className="flex items-center justify-center p-8 text-gray-500"><Icons8Icon id="loading" size={24} spin /></div>}>
          <DocxPreviewPanel url={virtualUrl} title={current.entity.name} />
        </Suspense>
      );
    }
    if (isArchive) return <ArchivePreviewPanel path={current.path} format={ext} />;
    if (isModel) {
      if (!probeWebGL()) {
        return (
          <div className="flex flex-col items-center justify-center gap-3 text-[#9ca3af] p-8">
            <PreviewHeroIcon path={current.path} isDir={false} size={72} extension={ext} />
            <span className="text-[12px]">WebGL unavailable for 3D preview</span>
          </div>
        );
      }
      const canShow = isGpuNativeModelExt(ext) || isRageConvertModelExt(ext);
      if (!canShow) {
        return (
          <div className="flex flex-col items-center justify-center gap-3 text-[#9ca3af] p-8">
            <PreviewHeroIcon path={current.path} isDir={false} size={72} extension={ext} />
            <span className="text-[12px]">{ext.toUpperCase()} is a 3D/RAGE asset — open externally for full tooling</span>
          </div>
        );
      }
      if (modelPreview.loading) {
        return (
          <div className="flex items-center justify-center gap-2 p-8 text-gray-500">
            <Icons8Icon id="loading" size={20} spin />
            <span className="text-[12px]">Preparing {ext.toUpperCase()} mesh…</span>
          </div>
        );
      }
      if (modelPreview.error || !modelPreview.url) {
        return (
          <div className="flex flex-col items-center justify-center gap-3 text-[#9ca3af] p-8">
            <PreviewHeroIcon path={current.path} isDir={false} size={72} extension={ext} />
            <span className="text-[12px]">{modelPreview.error || '3D preview unavailable'}</span>
          </div>
        );
      }
      return (
        <div className="relative w-full h-full min-h-0">
          <Suspense fallback={<div className="flex items-center justify-center p-8 text-gray-500"><Icons8Icon id="loading" size={24} spin /></div>}>
            <GpuModelViewport src={modelPreview.url} title={current.entity.name} badge={modelPreview.badge} />
          </Suspense>
          {(modelPreview.vertices || modelPreview.triangles) ? (
            <div className="pointer-events-none absolute right-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white/80">
              {modelPreview.vertices?.toLocaleString()} verts · {modelPreview.triangles?.toLocaleString()} tris
            </div>
          ) : null}
        </div>
      );
    }
    if (isFont && virtualUrl) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center gap-6 p-8 text-[#e8e8e8]">
          <style>{`@font-face{font-family:'${fontFamilyName}';src:url('${virtualUrl}');font-display:swap;}`}</style>
          <div className="text-[11px] uppercase tracking-[0.14em] text-white/45">Font preview</div>
          <div style={{ fontFamily: `'${fontFamilyName}', sans-serif` }} className="text-[42px] leading-tight text-center max-w-[90%]">
            The quick brown fox jumps over the lazy dog
          </div>
          <div style={{ fontFamily: `'${fontFamilyName}', sans-serif` }} className="text-[22px] text-white/70 text-center">
            0123456789 · ABCDEFGHIJKLMNOPQRSTUVWXYZ
          </div>
          <div className="text-[12px] text-white/40">{current.entity.name}</div>
        </div>
      );
    }
    if (contentLoading) {
      return (
        <div className="flex items-center justify-center gap-2 p-8 text-gray-500">
          <Icons8Icon id="loading" size={20} spin />
          <span className="text-[12px]">Loading preview…</span>
        </div>
      );
    }
    if (isMarkdown && fileContent != null) {
      return <div className="w-full h-full overflow-auto p-3"><MarkdownPreviewPanel content={fileContent} /></div>;
    }
    if ((isEditableText || isHtml) && fileContent != null) {
      return (
        <TextPreviewEditor
          path={current.path}
          fileName={current.entity.name}
          extension={ext}
          initialContent={fileContent}
          displayTabsAsSpaces
        />
      );
    }
    if (isDir) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 text-[#9ca3af] p-8">
          <PreviewHeroIcon path={current.path} isDir={isDir} size={72} extension={ext} />
          <button
            type="button"
            className="bndz-preview-action-btn px-3 py-1.5"
            onClick={() => { onNavigate?.(current.path); handleClose(); }}
          >
            Open folder
          </button>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center gap-3 text-[#9ca3af] p-8">
        <PreviewHeroIcon path={current.path} isDir={isDir} size={72} extension={ext} />
        <span className="text-[12px]">No inline preview for this type</span>
        <button type="button" className="bndz-preview-action-btn px-3 py-1.5" onClick={() => runVerb('open')}>
          Open with default app
        </button>
      </div>
    );
  };

  return (
    <AnimatePresence>
      {open && current && (
        <motion.div
          className="bndz-quick-preview-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          onMouseDown={e => { if (e.target === e.currentTarget) handleClose(); }}
        >
          <motion.div
            className={[
              'bndz-quick-preview-panel',
              (isVideo || isAudio || isImage) ? 'bndz-quick-preview-panel--media' : '',
              editMode ? 'bndz-quick-preview-panel--edit' : '',
              editMode && isImage && imageEditMode === 'studio' ? 'bndz-quick-preview-panel--photo-studio' : '',
              config.useWholeScreen ? 'bndz-quick-preview-panel--fullscreen' : '',
              config.fitPopupToScreen ? 'bndz-quick-preview-panel--fit-screen' : '',
              config.fitPopupWidthOnly || config.fitWidthOnly ? 'bndz-quick-preview-panel--fit-width' : '',
              config.withBorder === false ? 'bndz-quick-preview-panel--no-border' : '',
            ].filter(Boolean).join(' ')}
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1, x: panelOffset.x, y: panelOffset.y }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.12 }}
            onMouseDown={e => e.stopPropagation()}
            style={config.useWholeScreen
              ? { width: '100vw', height: '100vh', maxWidth: '100vw', maxHeight: '100vh', borderRadius: 0 }
              : config.fitPopupToScreen
                ? {
                    width: (config.fitPopupWidthOnly || config.fitWidthOnly) ? undefined : 'min(96vw, 1400px)',
                    maxWidth: '96vw',
                    maxHeight: '94vh',
                    height: (config.fitPopupWidthOnly || config.fitWidthOnly) ? undefined : 'min(94vh, 900px)',
                  }
                : undefined}
          >
            <div
              className="bndz-quick-preview-toolbar"
              onPointerDown={(e) => {
                if (!config.enableBlowUpsOnFileIconsAsWell && !config.rememberRelativePosition) return;
                if ((e.target as HTMLElement).closest('button, a, input')) return;
                dragRef.current = {
                  startX: e.clientX,
                  startY: e.clientY,
                  origX: panelOffset.x,
                  origY: panelOffset.y,
                };
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                const d = dragRef.current;
                if (!d) return;
                persistOffset({
                  x: d.origX + (e.clientX - d.startX),
                  y: d.origY + (e.clientY - d.startY),
                });
              }}
              onPointerUp={() => { dragRef.current = null; }}
              onPointerCancel={() => { dragRef.current = null; }}
            >
              <div className="bndz-quick-preview-toolbar-cluster">
                <button type="button" className="bndz-quick-preview-nav" disabled={!hasPrev} onClick={() => onIndexChange(safeIndex - 1)} title="Previous (←)">
                  <Icons8Icon id="chevron_left" size={15} />
                </button>
                <button type="button" className="bndz-quick-preview-nav" disabled={!hasNext} onClick={() => onIndexChange(safeIndex + 1)} title="Next (→)">
                  <Icons8Icon id="chevron_right" size={15} />
                </button>
                {items.length > 1 && (
                  <span className="bndz-quick-preview-count bndz-mono">{index + 1} / {items.length}</span>
                )}
                <span className="bndz-quick-preview-hint">Space / Esc to close</span>
              </div>
              <div className="bndz-quick-preview-toolbar-cluster">
                {canEditMedia && (
                  <button
                    type="button"
                    className={`bndz-quick-preview-edit ${editMode ? 'bndz-quick-preview-edit--active' : ''}`}
                    onClick={() => {
                      if (!editMode && isAudio) mediaPlayerRef.current?.stashPlayback();
                      if (!editMode && isImage) setImageEditMode('studio');
                      setEditMode(v => !v);
                    }}
                    title={editMode ? 'Back to preview' : isImage ? 'Open Photo Studio' : 'Edit — audio tools'}
                  >
                    <Icons8Icon id="pencil_ui" size={14} />
                    {editMode ? 'Preview' : isImage ? 'Studio' : 'Edit'}
                  </button>
                )}
                {editMode && isImage && (
                  <button
                    type="button"
                    className={`bndz-quick-preview-edit ${imageEditMode === 'quick' ? 'bndz-quick-preview-edit--active' : ''}`}
                    onClick={() => setImageEditMode(m => (m === 'studio' ? 'quick' : 'studio'))}
                    title={imageEditMode === 'studio' ? 'Switch to quick adjust' : 'Switch to Photo Studio'}
                  >
                    <Icons8Icon id={imageEditMode === 'studio' ? 'filter_ui' : 'picture_ui'} size={14} />
                    {imageEditMode === 'studio' ? 'Quick' : 'Studio'}
                  </button>
                )}
                <button
                  type="button"
                  className="bndz-quick-preview-nav"
                  title="Open with default app"
                  onClick={() => runVerb(isDir ? 'open' : 'open')}
                >
                  <Icons8Icon id="external_link" size={14} />
                </button>
                <button type="button" className="bndz-quick-preview-nav bndz-quick-preview-nav--close" onClick={handleClose} title="Close (Esc)">
                  <CloseGlyph size={14} />
                </button>
              </div>
            </div>

            {!(editMode && isImage && imageEditMode === 'studio') && (
              <PreviewMetadataStrip
                name={current.entity.name}
                path={windowsPath}
                size={displaySize}
                modified={displayModified}
                kindLabel={kindLabel}
                isDirectory={isDir}
                facts={curatedPreviewFacts(extMeta)}
                onReveal={() => runVerb('reveal')}
              />
            )}

            <div className="bndz-quick-preview-stage">
              {renderPreview()}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
