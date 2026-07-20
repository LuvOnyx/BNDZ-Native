import React, { useEffect, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { IPC } from '../../lib/ipcBridge';
import { toWindowsPath } from '../../lib/pathUtils';

type Props = {
  title: string;
  hint?: string;
  onIndexed?: () => void;
};

export default function BndzIndexEmptyState({ title, hint, onIndexed }: Props) {
  const [indexing, setIndexing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [filesIndexed, setFilesIndexed] = useState(0);
  const [currentFile, setCurrentFile] = useState<string | null>(null);

  useEffect(() => {
    if (!IPC.isNative) return;
    return IPC.onIndexProgress(p => {
      setFilesIndexed(p.filesIndexed);
      setCurrentFile(p.currentPath || null);
      if (p.done) {
        setIndexing(false);
        onIndexed?.();
      } else {
        setIndexing(true);
      }
    });
  }, [onIndexed]);

  const runIndex = async () => {
    if (!IPC.isNative) {
      setMessage('Indexing requires the native BNDZ app.');
      return;
    }
    setIndexing(true);
    setMessage(null);
    setFilesIndexed(0);
    setCurrentFile(null);
    try {
      const res = await IPC.reindexBndzDefaults();
      setMessage(res.ok ? 'Indexing started — files will appear as the cache builds.' : (res.error || 'Indexing failed.'));
      if (!res.ok) setIndexing(false);
    } catch (err: any) {
      setMessage(err?.message || 'Indexing failed.');
      setIndexing(false);
    }
  };

  return (
    <div className="bndz-smart-empty flex flex-col items-center justify-center h-full min-h-[240px] gap-3 px-8 text-center">
      <div className="bndz-smart-empty-mark" aria-hidden>
        <Icons8Icon id="database_ui" size={22} />
      </div>
      <div className="space-y-1.5 max-w-md">
        <h3 className="text-[13px] font-semibold text-[#e4e6ea]">{title}</h3>
        {hint && <p className="text-[11px] text-[#8b919a] leading-relaxed">{hint}</p>}
      </div>
      <button
        type="button"
        onClick={() => void runIndex()}
        disabled={indexing}
        className="bndz-smart-empty-cta mt-1 flex items-center gap-2 px-4 py-2 text-[12px] font-medium text-white disabled:opacity-50"
      >
        {indexing ? <Icons8Icon id="loading" size={14} spin /> : <Icons8Icon id="database_ui" size={14} />}
        Build search index
      </button>
      {indexing && (
        <div className="text-[10px] text-[#99c9f0]/90 max-w-sm">
          {filesIndexed > 0 && <span>{filesIndexed.toLocaleString()} indexed</span>}
          {currentFile && (
            <span className="block text-[#6b7280] truncate max-w-xs mt-0.5">
              {toWindowsPath(currentFile).split(/[/\\]/).pop()}
            </span>
          )}
        </div>
      )}
      {message && !indexing && <span className="text-[10px] text-[#99c9f0]/90 max-w-sm">{message}</span>}
      <span className="text-[10px] text-[#555a62]">Or right-click any folder → Index folder for search</span>
    </div>
  );
}
