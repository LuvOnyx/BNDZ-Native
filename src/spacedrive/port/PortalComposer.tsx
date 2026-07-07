/**
 * Spacebot PortalComposer pattern — chat composer with drag-drop context files.
 * Source: spacebot/interface/src/components/portal/PortalComposer.tsx
 */
import React, { useRef, useState } from 'react';
import { Icons8Icon } from '../../components/Icons8Icon';

type Props = {
  agentName?: string;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
  pendingPaths?: string[];
  onRemovePath?: (index: number) => void;
  onAttachPaths?: (paths: string[]) => void;
  placeholder?: string;
};

export function PortalComposer({
  agentName = 'BNDZ',
  draft,
  onDraftChange,
  onSend,
  disabled,
  pendingPaths = [],
  onRemovePath,
  onAttachPaths,
  placeholder,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    if (e.dataTransfer.types.includes('Files')) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragging(false);
    const raw = e.dataTransfer.getData('application/bndz-paths') || e.dataTransfer.getData('text/plain');
    if (raw && onAttachPaths) {
      const paths = raw.split('\n').map(s => s.trim()).filter(Boolean);
      if (paths.length) onAttachPaths(paths);
    }
  };

  return (
    <div
      className="sd-portal-composer relative border border-[#454545] bg-[#2a2a2a] rounded-sm"
      onDragEnter={handleDragEnter}
      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-sky-900/40 border-2 border-dashed border-sky-400 text-[11px] text-sky-200 pointer-events-none">
          Drop files to attach context
        </div>
      )}

      {pendingPaths.length > 0 && (
        <div className="flex flex-wrap gap-1 px-2 pt-2">
          {pendingPaths.map((p, i) => (
            <span
              key={p}
              className="inline-flex items-center gap-1 max-w-[200px] px-1.5 py-0.5 text-[10px] bg-[#333] text-gray-300 rounded truncate"
              title={p}
            >
              {p.split(/[/\\]/).pop()}
              {onRemovePath && (
                <button type="button" onClick={() => onRemovePath(i)} className="text-gray-500 hover:text-white shrink-0">
                  <Icons8Icon id="close" size={10} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      <form
        className="flex items-end gap-2 p-2"
        onSubmit={e => { e.preventDefault(); onSend(); }}
      >
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="p-2 text-gray-500 hover:text-gray-200 shrink-0"
          title="Attach files"
        >
          <Icons8Icon id="link" size={14} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={e => {
            const files = e.target.files;
            if (!files?.length || !onAttachPaths) return;
            const paths = Array.from(files)
              .map(f => (f as File & { path?: string }).path || f.name)
              .filter(Boolean);
            if (paths.length) onAttachPaths(paths);
            e.target.value = '';
          }}
        />
        <textarea
          value={draft}
          onChange={e => onDraftChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder={placeholder || `Message ${agentName}…`}
          rows={2}
          disabled={disabled}
          className="flex-1 resize-none bg-[#252525] border border-[#454545] px-2 py-1.5 text-[12px] text-gray-100 outline-none focus:border-[#094771] min-h-[40px]"
        />
        <button
          type="submit"
          disabled={disabled || !draft.trim()}
          className="px-3 py-2 bg-[#094771] hover:bg-[#0a5a8c] text-white disabled:opacity-40 flex items-center gap-1 text-[12px] shrink-0"
        >
          {disabled ? <Icons8Icon id="loading" size={13} spin /> : <Icons8Icon id="send" size={13} />}
        </button>
      </form>
    </div>
  );
}

export default PortalComposer;
