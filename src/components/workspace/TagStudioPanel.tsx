import React, { useCallback, useEffect, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { IPC } from '../../lib/ipcBridge';

type Props = {
  path: string | null;
  paths?: string[];
  onAddTag: (path: string, tag: string) => void;
  onRemoveTag: (path: string, tag: string) => void;
  onBatchAddTag?: (paths: string[], tag: string) => void;
  compact?: boolean;
};

export default function TagStudioPanel({
  path,
  paths = [],
  onAddTag,
  onRemoveTag,
  onBatchAddTag,
  compact = false,
}: Props) {
  const [tags, setTags] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [label, setLabel] = useState('');
  const multi = paths.length > 1;

  useEffect(() => {
    if (!path || !IPC.isNative || multi) {
      setTags([]);
      setLabel('');
      return;
    }
    let active = true;
    void IPC.getTagSidecar(path).then(sc => {
      if (!active) return;
      setTags(sc?.tags?.filter(Boolean) ?? []);
      setLabel(sc?.label || '');
    });
    return () => { active = false; };
  }, [path, multi]);

  useEffect(() => {
    if (!IPC.isNative) return;
    let active = true;
    void IPC.getTagsConfig().then(cfg => {
      if (!active) return;
      const names = (cfg ?? []).map((t: { name?: string; label?: string }) => t.label || t.name).filter(Boolean) as string[];
      setSuggestions(names);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  const commit = useCallback(() => {
    const t = draft.trim();
    if (!t) return;
    setDraft('');
    if (multi && onBatchAddTag) {
      onBatchAddTag(paths, t);
      return;
    }
    if (!path) return;
    setTags(prev => (prev.includes(t) ? prev : [...prev, t]));
    onAddTag(path, t);
  }, [draft, multi, onBatchAddTag, paths, path, onAddTag]);

  const filtered = suggestions.filter(
    s => s.toLowerCase().includes(draft.toLowerCase()) && !tags.includes(s),
  ).slice(0, 8);

  if (!path && !multi) {
    return (
      <div className={`bndz-tagstudio${compact ? ' bndz-tagstudio--compact' : ''}`}>
        <p className="bndz-tagstudio-empty">Select items to edit tags.</p>
      </div>
    );
  }

  return (
    <div className={`bndz-tagstudio${compact ? ' bndz-tagstudio--compact' : ''}`}>
      {!compact && label ? <span className="bndz-tagstudio-label">{label}</span> : null}
      <div className="bndz-tagstudio-chips" role="list">
        {tags.map(tag => (
          <button
            key={tag}
            type="button"
            className="bndz-tagstudio-chip"
            role="listitem"
            title={`Remove ${tag}`}
            onClick={() => {
              if (!path) return;
              setTags(prev => prev.filter(x => x !== tag));
              onRemoveTag(path, tag);
            }}
          >
            <span className="bndz-tagstudio-dot" aria-hidden />
            <Icons8Icon id="tag" size={10} />
            {tag}
          </button>
        ))}
      </div>
      <div className="bndz-tagstudio-input-row">
        <input
          className="bndz-tagstudio-input"
          value={draft}
          placeholder={multi ? `Tag ${paths.length} items…` : 'Add tag…'}
          aria-label="Tag name"
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            if (e.key === 'Escape') setDraft('');
          }}
        />
        <button type="button" className="bndz-ws-chip shrink-0" onClick={commit}>+</button>
      </div>
      {draft && filtered.length > 0 && (
        <ul className="bndz-tagstudio-suggest" role="listbox">
          {filtered.map(s => (
            <li key={s}>
              <button
                type="button"
                role="option"
                className="bndz-tagstudio-suggest-item"
                onClick={() => { setDraft(s); }}
                onDoubleClick={() => { setDraft(s); commit(); }}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
