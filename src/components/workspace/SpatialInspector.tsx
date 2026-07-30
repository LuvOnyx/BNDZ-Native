import React, { useEffect, useState } from 'react';
import { ShellNativeIcon } from '../ShellNativeIcon';
import { IPC } from '../../lib/ipcBridge';
import TagStudioPanel from './TagStudioPanel';
import type { CanvasItem } from '../../lib/spatialCanvasStore';

function pathLooksLikeDir(p: string): boolean {
  const base = p.split(/[/\\]/).pop() || '';
  return !base.includes('.') || p.endsWith('/') || p.endsWith('\\');
}

type Props = {
  items: CanvasItem[];
  selectedIds: string[];
  snapshotCount?: number;
  boardName?: string;
  onOpen: (item: CanvasItem) => void;
  onReveal: (item: CanvasItem) => void;
  onCopyPath: (item: CanvasItem) => void;
  onEditNote: (id: string) => void;
  onUpdateNote: (id: string, note: string) => void;
  onAddTag: (path: string, tag: string) => void;
  onRemoveTag: (path: string, tag: string) => void;
  onBatchAddTag?: (paths: string[], tag: string) => void;
};

export default function SpatialInspector({
  items,
  selectedIds,
  snapshotCount = 0,
  boardName,
  onOpen,
  onReveal,
  onCopyPath,
  onEditNote,
  onUpdateNote,
  onAddTag,
  onRemoveTag,
  onBatchAddTag,
}: Props) {
  const selected = items.filter(it => selectedIds.includes(it.id));
  const primary = selected[0] ?? null;
  const [tags, setTags] = useState<string[]>([]);
  const [sidecarLabel, setSidecarLabel] = useState('');
  const [shellMeta, setShellMeta] = useState<{ size?: string; modified?: string } | null>(null);

  useEffect(() => {
    if (!primary?.path || !IPC.isNative) {
      setTags([]);
      setSidecarLabel('');
      return;
    }
    let active = true;
    void IPC.getTagSidecar(primary.path).then(sc => {
      if (!active) return;
      setTags(sc?.tags?.filter(Boolean) ?? []);
      setSidecarLabel(sc?.label || '');
    });
    void IPC.getExtendedMetadata(primary.path).then(meta => {
      if (!active || !meta) return;
      setShellMeta({
        size: meta.Size || meta.size,
        modified: meta.Modified || meta.modified,
      });
    }).catch(() => {});
    return () => { active = false; };
  }, [primary?.path, primary?.id]);

  if (!primary) {
    return (
      <aside className="bndz-spatial-inspector shrink-0">
        <div className="bndz-spatial-inspector-head">
          <span className="bndz-spatial-inspector-title">Constellation</span>
        </div>
        <div className="bndz-spatial-inspector-empty">
          <img src="/Ui/preview-Big Folder.svg" alt="" className="bndz-spatial-inspector-hero" />
          <p>Select a pin or marquee cards to inspect paths, tags, and notes.</p>
          <div className="bndz-spatial-inspector-board-stats">
            <div><strong>{items.length}</strong> pin{items.length === 1 ? '' : 's'}</div>
            {boardName ? <div>{boardName}</div> : null}
            {snapshotCount > 0 ? <div>{snapshotCount} snapshot{snapshotCount === 1 ? '' : 's'}</div> : null}
          </div>
          <ul className="bndz-spatial-inspector-tips">
            <li>Drop files from any pane</li>
            <li>Delete removes pins · not files</li>
            <li>Tags sync with BNDZ sidecars</li>
            <li>Ctrl+Shift+A seeds Automation</li>
          </ul>
        </div>
      </aside>
    );
  }

  return (
    <aside className="bndz-spatial-inspector shrink-0">
      <div className="bndz-spatial-inspector-head">
        <span className="bndz-spatial-inspector-title">
          {selected.length > 1 ? `${selected.length} selected` : 'Pin'}
        </span>
        {selected.length === 1 && sidecarLabel ? (
          <span className="bndz-spatial-inspector-chip">{sidecarLabel}</span>
        ) : null}
      </div>
      <div className="bndz-spatial-inspector-body">
        <div className="bndz-spatial-inspector-hero-row">
          <ShellNativeIcon path={primary.path} isDir={pathLooksLikeDir(primary.path)} size={48} />
          <div className="min-w-0">
            <div className="bndz-spatial-inspector-name" title={primary.name}>{primary.name}</div>
            <div className="bndz-spatial-inspector-path" title={primary.path}>{primary.path}</div>
          </div>
        </div>
        <div className="bndz-spatial-inspector-actions">
          <button type="button" className="bndz-ws-chip" onClick={() => onOpen(primary)}>Open</button>
          <button type="button" className="bndz-ws-chip" onClick={() => onReveal(primary)}>Reveal</button>
          <button type="button" className="bndz-ws-chip" onClick={() => onCopyPath(primary)}>Copy path</button>
        </div>
        {shellMeta && selected.length === 1 && (
          <div className="bndz-spatial-inspector-meta">
            {shellMeta.size ? <span>{shellMeta.size}</span> : null}
            {shellMeta.modified ? <span>{shellMeta.modified}</span> : null}
          </div>
        )}
        {selected.length > 1 && (
          <TagStudioPanel
            path={null}
            paths={selected.map(s => s.path)}
            onAddTag={onAddTag}
            onRemoveTag={onRemoveTag}
            onBatchAddTag={onBatchAddTag}
            compact
          />
        )}
        {selected.length === 1 && (
          <>
            <label className="bndz-spatial-field">
              <span className="bndz-spatial-field-label">Note</span>
              <textarea
                className="bndz-spatial-field-input"
                rows={3}
                value={primary.note || ''}
                placeholder="Annotation for this pin…"
                onChange={e => onUpdateNote(primary.id, e.target.value)}
                onFocus={() => onEditNote(primary.id)}
              />
            </label>
            <div className="bndz-spatial-field">
              <span className="bndz-spatial-field-label">Tags</span>
              <TagStudioPanel
                path={primary.path}
                onAddTag={(p, t) => { onAddTag(p, t); setTags(prev => (prev.includes(t) ? prev : [...prev, t])); }}
                onRemoveTag={(p, t) => { onRemoveTag(p, t); setTags(prev => prev.filter(x => x !== t)); }}
              />
            </div>
          </>
        )}
        <p className="bndz-spatial-inspector-kbd"><kbd>Del</kbd> unpin · autosave on edit</p>
      </div>
    </aside>
  );
}
