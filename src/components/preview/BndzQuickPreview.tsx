import React, { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Icons8Icon } from '../Icons8Icon';
import { CloseGlyph } from '../ChromeGlyphs';
import { FSEntity } from '../../types';
import { toWindowsPath, toVirtualStreamUrl } from '../../lib/pathUtils';
import { isImageExt, isVideoExt, isAudioExt } from '../../lib/mediaTypes';
import { isTextEditableExt, isCodeExt, isHtmlExt, isMarkdownExt, isDocxExt } from '../../lib/textFileTypes';
import { isArchiveExt } from '../../lib/archiveTypes';
import { IPC } from '../../lib/ipcBridge';
import MediaPreviewPlayer from '../MediaPreviewPlayer';
import ImageZoomPreview from '../ImageZoomPreview';
import PdfPreviewPanel from '../PdfPreviewPanel';
import TextPreviewEditor from '../TextPreviewEditor';
import MarkdownPreviewPanel from '../MarkdownPreviewPanel';
import ArchivePreviewPanel from '../ArchivePreviewPanel';
import PreviewMetadataStrip from './PreviewMetadataStrip';
import { PreviewHeroIcon } from '../PreviewHeroIcon';

const DocxPreviewPanel = lazy(() => import('../DocxPreviewPanel'));

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
};

export default function BndzQuickPreview({ open, items, index, onClose, onIndexChange, onNavigate }: Props) {
  const current = items[index];
  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;
  const [indexedMeta, setIndexedMeta] = useState<Record<string, unknown> | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [contentLoading, setContentLoading] = useState(false);

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
  const isEditableText = isTextRaw || isCode || isMarkdown;
  const virtualUrl = current?.path ? toVirtualStreamUrl(current.path) : '';

  useEffect(() => {
    setFileContent(null);
    if (!open || !current?.path || isDir || isImage || isVideo || isAudio || isPdf || isDocx || isArchive) return;
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
  }, [open, current?.path, isDir, isImage, isVideo, isAudio, isPdf, isDocx, isArchive, isEditableText, isHtml]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const mediaFocused = (e.target as HTMLElement)?.closest?.('video, audio');
      if (e.code === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.code === 'Space' && !e.repeat && !mediaFocused) {
        e.preventDefault();
        onClose();
      } else if (e.code === 'ArrowLeft' && hasPrev) {
        e.preventDefault();
        onIndexChange(index - 1);
      } else if (e.code === 'ArrowRight' && hasNext) {
        e.preventDefault();
        onIndexChange(index + 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, onIndexChange, index, hasPrev, hasNext]);

  const runVerb = (verb: string) => {
    if (!current?.path) return;
    import('../../lib/ipcBridge').then(({ IPC }) => {
      IPC.executeContextMenuVerb(toWindowsPath(current.path), verb);
    });
  };

  const copyPath = () => {
    if (!current?.path) return;
    void navigator.clipboard.writeText(toWindowsPath(current.path));
  };

  const kindLabel = indexedKind
    ? indexedKind.charAt(0).toUpperCase() + indexedKind.slice(1)
    : isDir ? 'Folder' : isImage ? 'Image' : isVideo ? 'Video' : isAudio ? 'Audio' : isPdf ? 'PDF' : isArchive ? 'Archive' : isDocx ? 'Word' : ext ? ext.toUpperCase() : 'File';

  const renderPreview = () => {
    if (isImage) return <ImageZoomPreview src={virtualUrl} alt={current.entity.name} />;
    if (isVideo || isAudio) {
      return (
        <MediaPreviewPlayer
          type={isVideo ? 'video' : 'audio'}
          src={virtualUrl}
          filePath={current.path}
          extension={ext}
          title={current.entity.name}
          autoplay={isVideo}
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
            onClick={() => { onNavigate?.(current.path); onClose(); }}
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
          onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            className="bndz-quick-preview-panel"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.12 }}
            onMouseDown={e => e.stopPropagation()}
          >
            <div className="bndz-quick-preview-toolbar">
              <div className="flex items-center gap-1">
                <button type="button" className="bndz-quick-preview-nav" disabled={!hasPrev} onClick={() => onIndexChange(index - 1)}>
                  <Icons8Icon id="chevron_left" size={16} />
                </button>
                <button type="button" className="bndz-quick-preview-nav" disabled={!hasNext} onClick={() => onIndexChange(index + 1)}>
                  <Icons8Icon id="chevron_right" size={16} />
                </button>
                {items.length > 1 && (
                  <span className="text-[11px] text-[#9ca3af] ml-2">{index + 1} / {items.length}</span>
                )}
              </div>
              <button type="button" className="bndz-quick-preview-nav" onClick={onClose} title="Close (Esc)">
                <CloseGlyph size={16} />
              </button>
            </div>

            <PreviewMetadataStrip
              name={current.entity.name}
              path={current.path}
              size={displaySize}
              modified={displayModified}
              kindLabel={kindLabel}
              isDirectory={isDir}
              onOpen={() => runVerb(isDir ? 'open' : 'open')}
              onReveal={() => runVerb('reveal')}
              onCopyPath={copyPath}
            />

            <div className="bndz-quick-preview-stage">
              {renderPreview()}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
