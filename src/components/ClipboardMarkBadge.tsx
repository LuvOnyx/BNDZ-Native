import React from 'react';
import { Icons8Icon } from './Icons8Icon';

type Props = {
  mode: 'copy' | 'cut';
  compact?: boolean;
};

export default function ClipboardMarkBadge({ mode, compact = false }: Props) {
  const isCopy = mode === 'copy';
  return (
    <span
      className={`bndz-clipboard-mark ${isCopy ? 'bndz-clipboard-mark--copy' : 'bndz-clipboard-mark--cut'} ${compact ? 'bndz-clipboard-mark--compact' : ''}`}
      title={isCopy ? 'Copied to clipboard' : 'Cut to clipboard'}
      aria-hidden
    >
      <Icons8Icon id={isCopy ? 'copy' : 'cut'} size={compact ? 9 : 10} />
      {!compact && <span>{isCopy ? 'Copied' : 'Cut'}</span>}
    </span>
  );
}
