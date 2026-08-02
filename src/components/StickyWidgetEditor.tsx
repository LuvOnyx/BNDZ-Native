import React, { useEffect, useRef, useState } from 'react';
import { Icons8Icon } from './Icons8Icon';
import { IPC } from '../lib/ipcBridge';
import {
  findSpatialFreeSticky,
  findSpatialSticky,
  updateSpatialFreeStickyText,
  updateSpatialStickyNote,
  type SpatialSticky,
  type CanvasItem,
} from '../lib/spatialCanvasStore';

type Props = {
  stickyId?: string;
};

type WidgetMode =
  | { kind: 'free'; sticky: SpatialSticky; boardName: string }
  | { kind: 'pin'; item: CanvasItem; boardName: string };

/** Desktop sticky widget — prefers free Spatial stickies; falls back to pin captions. */
export default function StickyWidgetEditor({ stickyId }: Props) {
  const [mode, setMode] = useState<WidgetMode | null>(null);
  const [text, setText] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [savedFlash, setSavedFlash] = useState(false);
  const [pinned, setPinned] = useState(true);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const saveTimer = useRef<number | null>(null);
  const paperColor = mode?.kind === 'free' ? (mode.sticky.color || '#f5e6a8') : '#f5e6a8';

  useEffect(() => {
    IPC.setAlwaysOnTop(true);
    return () => IPC.setAlwaysOnTop(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!stickyId) {
        setStatus('missing');
        return;
      }
      try {
        const free = await findSpatialFreeSticky(stickyId);
        if (cancelled) return;
        if (free) {
          setMode({ kind: 'free', sticky: free.sticky, boardName: free.board.name });
          setText(free.sticky.text || '');
          setStatus('ready');
          requestAnimationFrame(() => taRef.current?.focus());
          return;
        }
        const pin = await findSpatialSticky(stickyId);
        if (cancelled) return;
        if (!pin) {
          setStatus('missing');
          return;
        }
        setMode({ kind: 'pin', item: pin.item, boardName: pin.board.name });
        setText(pin.item.note || '');
        setStatus('ready');
        requestAnimationFrame(() => taRef.current?.focus());
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stickyId]);

  const persist = async (next: string) => {
    if (!stickyId || !mode) return;
    const ok = mode.kind === 'free'
      ? await updateSpatialFreeStickyText(stickyId, next)
      : await updateSpatialStickyNote(stickyId, next);
    if (ok) {
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 900);
    }
  };

  const onChange = (value: string) => {
    setText(value);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void persist(value);
    }, 450);
  };

  const onBlur = () => {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    void persist(text);
  };

  const togglePin = () => {
    const next = !pinned;
    setPinned(next);
    IPC.setAlwaysOnTop(next);
  };

  if (status === 'loading') {
    return (
      <div className="bndz-sticky-widget bndz-sticky-widget--loading">
        <div className="bndz-sticky-widget-shimmer" />
        <span>Opening sticky…</span>
      </div>
    );
  }

  if (status === 'missing' || status === 'error') {
    return (
      <div className="bndz-sticky-widget bndz-sticky-widget--empty">
        <Icons8Icon id="notepad" size={28} className="opacity-50" />
        <h2>{status === 'error' ? 'Could not load sticky' : 'Sticky not found'}</h2>
        <p>
          {stickyId
            ? 'This note may have been removed from Spatial Canvas.'
            : 'Pass --sticky-id to edit a Spatial sticky.'}
        </p>
      </div>
    );
  }

  const title = mode?.kind === 'free'
    ? (mode.sticky.text?.trim().slice(0, 28) || 'Sticky note')
    : (mode?.item.name || 'Pin note');
  const boardName = mode?.boardName || '';

  return (
    <div
      className="bndz-sticky-widget"
      style={{ ['--sticky-paper' as string]: paperColor }}
    >
      <div className="bndz-sticky-widget-paper">
        <div className="bndz-sticky-widget-tape" aria-hidden />
        <div className="bndz-sticky-widget-fold" aria-hidden />
        <header className="bndz-sticky-widget-meta">
          <span className="bndz-sticky-widget-pin" title={title}>
            <Icons8Icon id="notepad" size={12} />
            {title}
          </span>
          {boardName && <span className="bndz-sticky-widget-board">{boardName}</span>}
          <button
            type="button"
            className={`bndz-sticky-widget-pin-btn${pinned ? ' is-on' : ''}`}
            title={pinned ? 'Unpin from desktop (allow under other windows)' : 'Pin above other windows'}
            onClick={togglePin}
          >
            <Icons8Icon id={pinned ? 'pin_ui' : 'unlock_ui'} size={11} />
            {pinned ? 'Pinned' : 'Float'}
          </button>
          <span className={`bndz-sticky-widget-save ${savedFlash ? 'is-flash' : ''}`}>
            {savedFlash ? 'Saved' : 'Auto-save'}
          </span>
        </header>
        <textarea
          ref={taRef}
          className="bndz-sticky-widget-input"
          value={text}
          onChange={e => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder="Write a sticky note…"
          spellCheck
        />
      </div>
    </div>
  );
}
