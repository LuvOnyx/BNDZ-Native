import React from 'react';
import { Icons8Icon } from './Icons8Icon';
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
      className="bndz-status-bar-chip"
      title={error || currentPath || root || 'Indexing files'}
      role="status"
    >
      <Icons8Icon id="database_ui" size={12} className="shrink-0 opacity-80" />
      {error ? (
        <span className="truncate text-red-300/90">Index failed · {error}</span>
      ) : (
        <span className="truncate">
          Indexing {filesIndexed.toLocaleString()}
          {file ? <span className="text-[#888] ml-1">· {file}</span> : null}
          {rootLabel && !file ? <span className="text-[#888] ml-1">· {rootLabel}</span> : null}
        </span>
      )}
      {!error && <Icons8Icon id="loading" size={10} spin className="shrink-0 opacity-70" />}
    </span>
  );
}
