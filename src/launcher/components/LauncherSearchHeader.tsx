import React from 'react';

type Props = {
  value: string;
  placeholder: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
};

/** Simplified from SuperCmd LauncherSearchHeader.tsx */
export default function LauncherSearchHeader({ value, placeholder, inputRef, onChange, onKeyDown }: Props) {
  return (
    <div className="px-3 pt-3 pb-1 border-b border-[var(--footer-border)]">
      <div className="flex items-center gap-2">
        <img src="bndz-mark.png" alt="" className="w-6 h-6 rounded-md shrink-0 opacity-90" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        <input
          ref={inputRef}
          className="bndz-search-input"
          value={value}
          placeholder={placeholder}
          onChange={e => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoComplete="off"
        />
      </div>
    </div>
  );
}
