import React from 'react';
import { Database, Loader2 } from 'lucide-react';
import { toWindowsPath } from '../lib/pathUtils';

type Props = {
  filesIndexed: number;
  currentPath?: string;
  root?: string;
  error?: string;
};

/** Status-bar chip for background BNDZ search index builds. */
export default function IndexProgressChip({ filesIndexed, currentPath, root, error }: Props) {
  const file = currentPath ? toWindowsPath(currentPath).split(/[/\\]/).pop() : '';
  const rootLabel = root ? toWindowsPath(root).split(/[/\\]/).pop() : '';

  return (
    <span
      className="bndz-glass-chip inline-flex items-center gap-2 ml-2 pl-2.5 pr-2 py-0.5 max-w-[min(420px,45vw)]"
      title={error || currentPath || root || 'Indexing files'}
      role="status"
    >
      <Database size={12} className="text-sky-300/90 shrink-0" />
      {error ? (
        <span className="truncate text-[10px] text-red-300/90 font-medium">Index failed · {error}</span>
      ) : (
        <span className="truncate text-[10px] text-sky-100/90 font-medium">
          Indexing <span className="text-sky-300/80">{filesIndexed.toLocaleString()}</span>
          {file ? <span className="text-white/40 ml-1">· {file}</span> : null}
          {rootLabel && !file ? <span className="text-white/40 ml-1">· {rootLabel}</span> : null}
        </span>
      )}
      {!error && <Loader2 size={10} className="text-sky-300/80 animate-spin shrink-0" />}
    </span>
  );
}
