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
    <div className="flex flex-col items-center justify-center h-full min-h-[220px] text-gray-500 gap-3 px-6 text-center">
      <Icons8Icon id="database_ui" size={32} className="opacity-40 text-sky-400" />
      <span className="text-[13px] text-gray-300 font-medium">{title}</span>
      {hint && <span className="text-[11px] text-gray-500 max-w-md">{hint}</span>}
      <button
        type="button"
        onClick={() => void runIndex()}
        disabled={indexing}
        className="mt-1 flex items-center gap-2 px-4 py-2 text-[12px] bg-[#094771] hover:bg-[#0a5a8c] text-white disabled:opacity-50"
      >
        {indexing ? <Icons8Icon id="loading" size={14} spin /> : <Icons8Icon id="database_ui" size={14} />}
        Build search index
      </button>
      {indexing && (
        <div className="text-[10px] text-sky-300/90 max-w-sm">
          {filesIndexed > 0 && <span>{filesIndexed.toLocaleString()} indexed</span>}
          {currentFile && (
            <span className="block text-gray-500 truncate max-w-xs">
              {toWindowsPath(currentFile).split(/[/\\]/).pop()}
            </span>
          )}
        </div>
      )}
      {message && !indexing && <span className="text-[10px] text-sky-300/90 max-w-sm">{message}</span>}
      <span className="text-[10px] text-gray-600">Or right-click any folder → Index folder for search</span>
    </div>
  );
}
