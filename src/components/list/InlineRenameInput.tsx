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

  useEffect(() => {
    const input = inputRef.current;
    if (input) applyRenameInputSelection(input, entity, config);
  }, [entity?.id, entity?.name, entity?.extension, config.hideExtensionsFromRenameEditBox, config.hideShortcutExtensions, config.excludeFileExtensionFromInitialSelection, config.preselectName]);

  return (
    <div className="flex flex-col gap-0.5 w-[90%]">
    <input
      ref={inputRef}
      type="text"
      className="bndz-inline-rename-input px-1 outline-none w-full"
      value={value}
      onChange={e => onChange(e.target.value)}
      onBlur={() => {
        if (cancelledRef.current) {
          cancelledRef.current = false;
          return;
        }
        onCommit();
      }}
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
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          cancelledRef.current = true;
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
