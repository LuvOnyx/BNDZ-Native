import React, { useEffect, useState } from 'react';
import { ShellNativeIcon } from '../ShellNativeIcon';
import { IPC } from '../../lib/ipcBridge';
import TagStudioPanel from './TagStudioPanel';
import type { CanvasItem, SpatialSticky } from '../../lib/spatialCanvasStore';
import type { PinIntelligence } from '../../lib/workspace/useSpatialIntelligence';
import { formatPathLeafName, formatUiPath, isRawShellDisplayName } from '../../lib/displayPath';

function pathLooksLikeDir(p: string): boolean {
  const base = p.split(/[/\\]/).pop() || '';
  return !base.includes('.') || p.endsWith('/') || p.endsWith('\\');
}

type Props = {
  items: CanvasItem[];
  stickies?: SpatialSticky[];
  selectedIds: string[];
  snapshotCount?: number;
  boardName?: string;
  intelligence?: PinIntelligence;
  onOpen: (item: CanvasItem) => void;
  onReveal: (item: CanvasItem) => void;
  onCopyPath: (item: CanvasItem) => void;
  onEditNote: (id: string) => void;
  onUpdateNote: (id: string, note: string) => void;
  onAddTag: (path: string, tag: string) => void;
  onRemoveTag: (path: string, tag: string) => void;
  onBatchAddTag?: (paths: string[], tag: string) => void;
  onUpdateStickyText?: (id: string, text: string) => void;
};

function openBottomPlugin(id: string, context?: Record<string, string>) {
  window.dispatchEvent(new CustomEvent('bndz-open-bottom-plugin', { detail: { id, ...context } }));
}

function formatBytesInspector(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)} TB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

export default function SpatialInspector({
  items,
  stickies = [],
  selectedIds,
  snapshotCount = 0,
  boardName,
  intelligence,
  onOpen,
  onReveal,
  onCopyPath,
  onEditNote,
  onUpdateNote,
  onAddTag,
  onRemoveTag,
  onBatchAddTag,
  onUpdateStickyText,
}: Props) {
  const selected = items.filter(it => selectedIds.includes(it.id));
  const selectedStickies = stickies.filter(s => selectedIds.includes(s.id));
  const primary = selected[0] ?? null;
  const primarySticky = !primary ? (selectedStickies[0] ?? null) : null;
  const [tags, setTags] = useState<string[]>([]);
  const [sidecarLabel, setSidecarLabel] = useState('');
  const [shellMeta, setShellMeta] = useState<{ size?: string; modified?: string } | null>(null);

  useEffect(() => {
    if (!primary?.path || !IPC.isNative) {
      setTags([]);
      setSidecarLabel('');
      setShellMeta(null);
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

  if (!primary && !primarySticky) {
    return (
      <aside className="bndz-spatial-inspector shrink-0">
        <div className="bndz-spatial-inspector-head">
          <span className="bndz-spatial-inspector-title">Constellation</span>
        </div>
        <div className="bndz-spatial-inspector-empty">
          <img src="/Ui/preview-Big Folder.svg" alt="" className="bndz-spatial-inspector-hero" />
          <p>Select a pin or sticky to inspect paths, tags, and notes.</p>
          <div className="bndz-spatial-inspector-board-stats">
            <div><strong>{items.length}</strong> pin{items.length === 1 ? '' : 's'}</div>
            {stickies.length > 0 ? <div><strong>{stickies.length}</strong> sticky{stickies.length === 1 ? '' : 'ies'}</div> : null}
            {boardName ? <div>{boardName}</div> : null}
            {snapshotCount > 0 ? <div>{snapshotCount} snapshot{snapshotCount === 1 ? '' : 's'}</div> : null}
          </div>
          <ul className="bndz-spatial-inspector-tips">
            <li>Click once to select · double-click to open</li>
            <li>Drop files from any pane</li>
            <li>Delete removes pins · not files</li>
            <li>Tags sync with BNDZ sidecars</li>
          </ul>
        </div>
      </aside>
    );
  }

  if (primarySticky) {
    return (
      <aside className="bndz-spatial-inspector shrink-0">
        <div className="bndz-spatial-inspector-head">
          <span className="bndz-spatial-inspector-title">
            {selectedStickies.length > 1 ? `${selectedStickies.length} stickies` : 'Sticky'}
          </span>
        </div>
        <div className="bndz-spatial-inspector-body">
          <label className="bndz-spatial-field">
            <span className="bndz-spatial-field-label">Note</span>
            <textarea
              className="bndz-spatial-field-input"
              rows={6}
              value={primarySticky.text || ''}
              placeholder="Sticky note…"
              onChange={e => onUpdateStickyText?.(primarySticky.id, e.target.value)}
            />
          </label>
          <p className="bndz-spatial-inspector-kbd"><kbd>Del</kbd> remove sticky</p>
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
          <ShellNativeIcon path={primary!.path} isDir={pathLooksLikeDir(primary!.path)} size={48} />
          <div className="min-w-0">
            <div
              className="bndz-spatial-inspector-name"
              title={isRawShellDisplayName(primary!.name) ? formatPathLeafName(primary!.path) : primary!.name}
            >
              {isRawShellDisplayName(primary!.name) ? formatPathLeafName(primary!.path) : primary!.name}
            </div>
            <div className="bndz-spatial-inspector-path" title={formatUiPath(primary!.path)}>
              {formatUiPath(primary!.path)}
            </div>
          </div>
        </div>
        <div className="bndz-spatial-inspector-actions">
          <button type="button" className="bndz-ws-chip" onClick={() => onOpen(primary!)}>Open</button>
          <button type="button" className="bndz-ws-chip" onClick={() => onReveal(primary!)}>Reveal</button>
          <button type="button" className="bndz-ws-chip" onClick={() => onCopyPath(primary!)}>Copy path</button>
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
                value={primary!.note || ''}
                placeholder="Annotation for this pin…"
                onChange={e => onUpdateNote(primary!.id, e.target.value)}
                onFocus={() => onEditNote(primary!.id)}
              />
            </label>
            <div className="bndz-spatial-field">
              <span className="bndz-spatial-field-label">Tags</span>
              <TagStudioPanel
                path={primary!.path}
                onAddTag={(p, t) => { onAddTag(p, t); setTags(prev => (prev.includes(t) ? prev : [...prev, t])); }}
                onRemoveTag={(p, t) => { onRemoveTag(p, t); setTags(prev => prev.filter(x => x !== t)); }}
              />
            </div>
          </>
        )}
        {intelligence && !intelligence.loading && (
          <div className="bndz-spatial-intel-sections">
            {intelligence.health && intelligence.health.total > 0 && (
              <div className="bndz-spatial-intel-section">
                <div className="bndz-spatial-intel-section-head">
                  <span className="bndz-spatial-intel-section-title">Problems</span>
                  <button
                    type="button"
                    className="bndz-spatial-intel-link"
                    onClick={() => openBottomPlugin('library-health', { rootPath: primary!.path })}
                  >
                    Open Health →
                  </button>
                </div>
                <div className="bndz-spatial-intel-row">
                  {intelligence.health.critical > 0 && (
                    <span className="bndz-spatial-intel-stat bndz-spatial-intel-stat--critical">
                      {intelligence.health.critical} critical
                    </span>
                  )}
                  {intelligence.health.warning > 0 && (
                    <span className="bndz-spatial-intel-stat bndz-spatial-intel-stat--warning">
                      {intelligence.health.warning} warning
                    </span>
                  )}
                  {intelligence.health.info > 0 && (
                    <span className="bndz-spatial-intel-stat bndz-spatial-intel-stat--info">
                      {intelligence.health.info} info
                    </span>
                  )}
                </div>
              </div>
            )}
            {intelligence.lineage && (intelligence.lineage.inboundCount > 0 || intelligence.lineage.outboundCount > 0) && (
              <div className="bndz-spatial-intel-section">
                <div className="bndz-spatial-intel-section-head">
                  <span className="bndz-spatial-intel-section-title">Lineage</span>
                  <button
                    type="button"
                    className="bndz-spatial-intel-link"
                    onClick={() => openBottomPlugin('branching-time', { path: primary!.path })}
                  >
                    Open Lineage →
                  </button>
                </div>
                <div className="bndz-spatial-intel-row">
                  <span className="bndz-spatial-intel-stat">{intelligence.lineage.inboundCount} inbound</span>
                  <span className="bndz-spatial-intel-stat">{intelligence.lineage.outboundCount} outbound</span>
                </div>
                {intelligence.lineage.recentOp && (
                  <div className="bndz-spatial-intel-hint">
                    Last: {intelligence.lineage.recentOp}
                    {intelligence.lineage.recentUtc ? ` · ${new Date(intelligence.lineage.recentUtc).toLocaleDateString()}` : ''}
                  </div>
                )}
              </div>
            )}
            {intelligence.capacity && (
              <div className="bndz-spatial-intel-section">
                <div className="bndz-spatial-intel-section-head">
                  <span className="bndz-spatial-intel-section-title">Capacity</span>
                  <button
                    type="button"
                    className="bndz-spatial-intel-link"
                    onClick={() => openBottomPlugin('capacity-solver', { path: primary!.path })}
                  >
                    Open Solver →
                  </button>
                </div>
                <div className="bndz-spatial-intel-capacity-bar">
                  <div
                    className="bndz-spatial-intel-capacity-fill"
                    style={{ width: `${intelligence.capacity.usedPercent}%` }}
                  />
                </div>
                <div className="bndz-spatial-intel-row">
                  <span className="bndz-spatial-intel-stat">{intelligence.capacity.usedPercent}% used</span>
                  <span className="bndz-spatial-intel-stat">{formatBytesInspector(intelligence.capacity.freeBytes)} free</span>
                </div>
                {intelligence.capacity.deficitBytes > 0 && (
                  <div className="bndz-spatial-intel-hint bndz-spatial-intel-hint--warning">
                    Deficit: {formatBytesInspector(intelligence.capacity.deficitBytes)} below target
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        <p className="bndz-spatial-inspector-kbd"><kbd>Del</kbd> unpin · autosave on edit</p>
      </div>
    </aside>
  );
}
