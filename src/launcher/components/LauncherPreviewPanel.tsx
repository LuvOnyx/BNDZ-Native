import React, { useEffect, useMemo, useState } from 'react';
import type { LauncherCommand } from '../types';
import LauncherCommandIcon from './LauncherCommandIcon';
import { getFilePreviewMeta, openBndzPath } from '../bridge/flowBridge';
import type { FilePreviewMeta } from '../bridge/flowBridge';
import {
  launcherStreamUrl,
  resolvePreviewForCommand,
  type PreviewKind,
} from '../utils/launcherPreview';

function TextFilePreview({ path, fallback }: { path: string | null; fallback: string }) {
  const [text, setText] = useState(fallback);
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    fetch(launcherStreamUrl(path))
      .then(r => r.ok ? r.text() : fallback)
      .then(t => { if (!cancelled) setText(t.length > 32000 ? `${t.slice(0, 32000)}\n…` : t); })
      .catch(() => { if (!cancelled) setText(fallback); });
    return () => { cancelled = true; };
  }, [path, fallback]);
  return (
    <pre className="launcher-preview-text custom-scrollbar text-[11px] leading-relaxed whitespace-pre-wrap break-all text-[var(--text-secondary)] p-3 max-h-[240px] overflow-y-auto">
      {text}
    </pre>
  );
}

type Props = {
  command: LauncherCommand | null;
  onExecute: (command: LauncherCommand, opts?: { openInBndz?: boolean }) => void;
  onOpenManager?: (command: LauncherCommand) => void;
};

function MetaGrid({ fields }: { fields: Record<string, string> }) {
  const entries = Object.entries(fields).filter(([, v]) => v);
  if (!entries.length) return null;
  return (
    <dl className="launcher-preview-meta grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[11px] mt-3">
      {entries.map(([label, value]) => (
        <React.Fragment key={label}>
          <dt className="text-[var(--text-muted)]">{label}</dt>
          <dd className="text-[var(--text-secondary)] truncate" title={value}>{value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

function PreviewBody({
  kind,
  path,
  command,
  meta,
}: {
  kind: PreviewKind;
  path: string | null;
  command: LauncherCommand;
  meta: FilePreviewMeta | null;
}) {
  const streamUrl = path ? launcherStreamUrl(path) : null;

  if (kind === 'image' && streamUrl) {
    return (
      <div className="launcher-preview-media flex items-center justify-center p-2">
        <img src={streamUrl} alt="" className="max-h-[220px] max-w-full object-contain rounded-lg" draggable={false} />
      </div>
    );
  }

  if (kind === 'video' && streamUrl) {
    return (
      <div className="launcher-preview-media p-2">
        <video src={streamUrl} controls className="w-full max-h-[220px] rounded-lg bg-black/40" />
      </div>
    );
  }

  if (kind === 'audio' && streamUrl) {
    return (
      <div className="launcher-preview-media p-4 flex flex-col items-center gap-3">
        <div className="text-4xl opacity-60">🎵</div>
        <audio src={streamUrl} controls className="w-full" />
      </div>
    );
  }

  if (kind === 'pdf' && streamUrl) {
    return (
      <div className="launcher-preview-media h-[240px] p-1">
        <iframe src={streamUrl} title="PDF preview" className="w-full h-full rounded-lg border-0 bg-white/5" />
      </div>
    );
  }

  if (kind === 'folder') {
    return (
      <div className="launcher-preview-placeholder flex flex-col items-center justify-center py-10 text-[var(--text-muted)]">
        <div className="text-5xl mb-2">📁</div>
        <div className="text-[12px]">{meta?.folderItemCount != null ? `${meta.folderItemCount} items` : 'Folder'}</div>
      </div>
    );
  }

  if (kind === 'archive') {
    return (
      <div className="launcher-preview-placeholder flex flex-col items-center justify-center py-10 text-[var(--text-muted)]">
        <div className="text-5xl mb-2">🗜️</div>
        <div className="text-[12px]">
          {meta?.archiveEntryCount != null ? `${meta.archiveEntryCount} entries` : 'Archive'}
        </div>
      </div>
    );
  }

  if (kind === 'app') {
    return (
      <div className="launcher-preview-placeholder flex flex-col items-center justify-center py-10">
        <LauncherCommandIcon command={command} size={64} />
      </div>
    );
  }

  if (kind === 'color' && path) {
    return (
      <div className="launcher-preview-media flex flex-col items-center justify-center py-10 gap-3">
        <div className="w-16 h-16 rounded-xl border border-[var(--footer-border)] bg-gradient-to-br from-pink-500/30 to-violet-500/30" />
        <div className="text-[11px] text-[var(--text-muted)]">Folder color · {path.split(/[/\\]/).pop()}</div>
      </div>
    );
  }

  if (kind === 'text' || kind === 'code') {
    return <TextFilePreview path={path} fallback={command.detail || command.subtitle || 'Text preview'} />;
  }

  return (
    <div className="launcher-preview-placeholder flex flex-col items-center justify-center py-8 text-center px-4">
      <LauncherCommandIcon command={command} size={48} />
      <p className="text-[12px] text-[var(--text-muted)] mt-3 leading-relaxed">
        {command.detail || command.subtitle || 'Run this command from the launcher.'}
      </p>
    </div>
  );
}

export default function LauncherPreviewPanel({ command, onExecute, onOpenManager }: Props) {
  const [meta, setMeta] = useState<FilePreviewMeta | null>(null);
  const preview = useMemo(() => resolvePreviewForCommand(command), [command]);
  const showBndz = !!preview.path || command?.id.startsWith('bndz-openpath-') || command?.category === 'file';

  useEffect(() => {
    let cancelled = false;
    setMeta(null);
    if (!preview.path) return;
    void getFilePreviewMeta(preview.path).then(m => {
      if (!cancelled) setMeta(m);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [preview.path]);

  if (!command) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-6 text-[var(--text-muted)]">
        <div className="text-4xl mb-3 opacity-40">⌘</div>
        <div className="text-[14px] font-medium text-[var(--text-secondary)]">BNDZ Launcher</div>
        <p className="text-[12px] mt-2 leading-relaxed max-w-[280px]">
          Type to search. Select a result to preview files, apps, and snippets here.
        </p>
      </div>
    );
  }

  const metaFields: Record<string, string> = {
    ...(meta?.fields ?? {}),
  };
  if (command.category === 'app') metaFields.Application = command.title;
  if (meta?.contentType) metaFields['Content type'] = meta.contentType;
  else if (preview.kind !== 'none') metaFields['Content type'] = preview.kind;
  if (meta?.sizeLabel) metaFields.Size = meta.sizeLabel;
  if (meta?.modified) metaFields.Modified = meta.modified;
  if (preview.path || command.subtitle) metaFields.Location = preview.path || command.subtitle || '';
  if (meta?.width && meta?.height) metaFields.Dimensions = `${meta.width} × ${meta.height}`;

  const canOpenManager =
    command.id === 'system-search-notes'
    || command.id === 'system-search-snippets'
    || command.id === 'system-search-quicklinks'
    || command.id === 'system-clipboard-manager'
    || command.id === 'system-open-extensions';

  const bndzPath = command.openPath || preview.path || command.subtitle;

  return (
    <div className="h-full flex flex-col min-h-0 launcher-preview-panel">
      <div className="px-4 pt-3 pb-2 border-b border-[var(--footer-border)] shrink-0">
        <div className="flex items-start gap-2">
          <div className="w-8 h-8 rounded-lg bg-[var(--command-item-selected-bg)] flex items-center justify-center shrink-0">
            <LauncherCommandIcon command={command} size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold text-[var(--text-primary)] leading-tight truncate">{command.title}</div>
            {(preview.path || command.subtitle) && (
              <div className="text-[10px] text-[var(--text-muted)] mt-0.5 truncate" title={preview.path || command.subtitle}>
                {preview.path || command.subtitle}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        <PreviewBody kind={preview.kind} path={preview.path} command={command} meta={meta} />
        <div className="px-4 pb-3">
          <MetaGrid fields={metaFields} />
        </div>
      </div>

      <div className="px-4 py-2.5 border-t border-[var(--footer-border)] flex gap-2 shrink-0 flex-wrap bg-black/5">
        <button type="button" className="bndz-btn-primary flex-1 min-w-[72px]" onClick={() => onExecute(command)}>
          Run
        </button>
        {showBndz && bndzPath && (
          <button
            type="button"
            className="bndz-btn-ghost flex-1 min-w-[72px]"
            onClick={() => {
              if (command.id.startsWith('bndz-openpath-')) void onExecute(command, { openInBndz: true });
              else openBndzPath(bndzPath);
            }}
          >
            Open in BNDZ
          </button>
        )}
        {canOpenManager && onOpenManager ? (
          <button type="button" className="bndz-btn-ghost" onClick={() => onOpenManager(command)}>
            Open App
          </button>
        ) : null}
      </div>
    </div>
  );
}
