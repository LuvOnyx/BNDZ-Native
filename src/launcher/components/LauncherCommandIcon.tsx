import React, { useState } from 'react';
import type { LauncherCommand } from '../types';

type Props = {
  command: LauncherCommand;
  size?: number;
  className?: string;
};

/** Launcher result icon with glyph fallback when file/icon URL fails to load. */
export default function LauncherCommandIcon({ command, size = 20, className = '' }: Props) {
  const [failed, setFailed] = useState(false);
  const glyph = command.iconGlyph || (command.category === 'app' ? '📱' : '⌘');

  if (!command.iconUrl || failed) {
    return (
      <span className={`inline-flex items-center justify-center shrink-0 ${className}`} style={{ width: size, height: size, fontSize: Math.max(12, size - 6) }}>
        {glyph}
      </span>
    );
  }

  return (
    <img
      src={command.iconUrl}
      alt=""
      className={`object-contain shrink-0 ${className}`}
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
}
