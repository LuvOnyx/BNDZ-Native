import React from 'react';
import { Sparkles, X } from 'lucide-react';

type Props = {
  value: string;
  placeholder: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  compact?: boolean;
  autocompleteSuffix?: string;
  onClear?: () => void;
  onAskAi?: () => void;
  onFocusInput?: () => void;
  showAskAi?: boolean;
  inlineFields?: Array<{ key: string; label: string; placeholder?: string; value: string; onChange: (v: string) => void }>;
};

/** Search header with ghost autocomplete, clear button, Ask AI, and optional inline args. */
export default function LauncherSearchHeader({
  value,
  placeholder,
  inputRef,
  onChange,
  onKeyDown,
  compact = false,
  autocompleteSuffix = '',
  onClear,
  onAskAi,
  onFocusInput,
  showAskAi = false,
  inlineFields = [],
}: Props) {
  return (
    <div className={`px-3 ${compact ? 'py-2' : 'pt-3 pb-1'} ${compact ? '' : 'border-b border-[var(--footer-border)]'} shrink-0`}>
      <div className="relative flex items-center gap-2 min-w-0">
        {!compact && (
          <img src="bndz-mark.png" alt="" className="w-6 h-6 rounded-md shrink-0 opacity-90" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        )}
        <div className="relative min-w-0 flex-1">
          {autocompleteSuffix && value ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 flex items-center min-w-0 w-full text-[1.05rem] font-medium tracking-[0.004em] whitespace-pre overflow-hidden"
            >
              <span className="invisible">{value}</span>
              <span className="text-[color:var(--text-subtle)]">{autocompleteSuffix}</span>
            </div>
          ) : null}
          <input
            ref={inputRef}
            className={`bndz-search-input relative z-[1] ${compact ? 'text-[0.95rem]' : ''}`}
            value={value}
            placeholder={placeholder}
            onChange={e => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={onFocusInput}
            spellCheck={false}
            autoComplete="off"
            autoFocus
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {showAskAi && value.trim() && onAskAi ? (
            <button
              type="button"
              onClick={onAskAi}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-[var(--launcher-chip-border)] bg-[var(--launcher-chip-bg)] hover:bg-[var(--command-item-hover-bg)] transition-colors group"
            >
              <Sparkles className="w-3 h-3 text-[var(--text-subtle)] group-hover:text-purple-400 transition-colors" />
              <span className="text-[0.6875rem] text-[var(--text-subtle)] group-hover:text-[var(--text-muted)] transition-colors">Ask AI</span>
              <kbd className="bndz-kbd">Tab</kbd>
            </button>
          ) : null}
          {value && onClear ? (
            <button
              type="button"
              onClick={onClear}
              className="text-[var(--text-subtle)] hover:text-[var(--text-muted)] transition-colors"
              aria-label="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          ) : null}
        </div>
      </div>
      {inlineFields.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2 pt-2 border-t border-[var(--footer-border)]/60">
          {inlineFields.map(field => (
            <label key={field.key} className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
              <span className="shrink-0 uppercase tracking-wide text-[10px]">{field.label}</span>
              <input
                className="bg-[var(--surface-elevated)] border border-[var(--border-subtle)] rounded px-2 py-0.5 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] min-w-[80px]"
                value={field.value}
                placeholder={field.placeholder}
                onChange={e => field.onChange(e.target.value)}
                onKeyDown={onKeyDown}
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
