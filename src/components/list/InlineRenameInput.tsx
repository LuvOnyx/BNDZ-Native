import React, { useEffect, useRef } from 'react';
import type { AppConfig } from '../../data/configContext';
import { applyRenameInputSelection } from '../../lib/settingsRuntime';

export function InlineRenameInput({
  value,
  entity,
  config,
  onChange,
  onCommit,
  onCancel,
  showNameLength,
  serialRename,
  onSerialNavigate,
}: {
  value: string;
  entity: any;
  config: AppConfig;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  showNameLength?: boolean;
  serialRename?: boolean;
  onSerialNavigate?: (direction: 'prev' | 'next') => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelledRef = useRef(false);
  /** True while the user is drag-selecting text — blur must not commit mid-highlight. */
  const selectingRef = useRef(false);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (input) applyRenameInputSelection(input, entity, config);
  }, [entity?.id, entity?.name, entity?.extension, config.hideExtensionsFromRenameEditBox, config.hideShortcutExtensions, config.excludeFileExtensionFromInitialSelection, config.preselectName]);

  useEffect(() => () => {
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
  }, []);

  const clearBlurTimer = () => {
    if (blurTimerRef.current) {
      clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
  };

  const scheduleCommitFromBlur = () => {
    clearBlurTimer();
    // Defer: drag-select / WebView focus quirks often fire blur then immediately re-focus.
    blurTimerRef.current = setTimeout(() => {
      blurTimerRef.current = null;
      if (cancelledRef.current) {
        cancelledRef.current = false;
        return;
      }
      if (selectingRef.current) {
        inputRef.current?.focus();
        return;
      }
      if (document.activeElement === inputRef.current) return;
      onCommit();
    }, 0);
  };

  return (
    <div
      className="flex flex-col gap-0.5 w-[90%] bndz-inline-rename"
      data-bndz-inline-rename="1"
      onMouseDown={e => e.stopPropagation()}
      onPointerDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
    >
    <input
      ref={inputRef}
      type="text"
      className="bndz-inline-rename-input px-1 outline-none w-full"
      value={value}
      onChange={e => onChange(e.target.value)}
      onMouseDown={e => {
        e.stopPropagation();
        selectingRef.current = true;
        clearBlurTimer();
      }}
      onPointerDown={e => {
        e.stopPropagation();
        selectingRef.current = true;
        clearBlurTimer();
      }}
      onMouseUp={() => {
        selectingRef.current = false;
      }}
      onPointerUp={() => {
        selectingRef.current = false;
      }}
      onSelect={() => {
        // Keep rename alive while the caret/selection is being adjusted.
        clearBlurTimer();
      }}
      onBlur={scheduleCommitFromBlur}
      onKeyDown={e => {
        if (serialRename && e.key === 'ArrowDown') {
          e.preventDefault();
          onSerialNavigate?.('next');
          return;
        }
        if (serialRename && e.key === 'ArrowUp') {
          e.preventDefault();
          onSerialNavigate?.('prev');
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          clearBlurTimer();
          selectingRef.current = false;
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          cancelledRef.current = true;
          clearBlurTimer();
          selectingRef.current = false;
          onCancel();
        }
      }}
      onClick={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
    />
    {showNameLength && (
      <span className="text-[9px] text-gray-500 tabular-nums">{value.length} characters</span>
    )}
    </div>
  );
}
