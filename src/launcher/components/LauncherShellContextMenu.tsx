import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { hideLauncher, openBndzFileManager, openLauncherSettings } from '../bridge/flowBridge';

type Props = {
  x: number;
  y: number;
  onClose: () => void;
};

const ITEMS = [
  { id: 'settings', label: 'BNDZ Launcher Settings…' },
  { id: 'filemanager', label: 'Open BNDZ File Manager' },
  { id: 'hide', label: 'Hide Launcher' },
] as const;

export default function LauncherShellContextMenu({ x, y, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const run = (id: string) => {
    switch (id) {
      case 'settings':
        openLauncherSettings();
        break;
      case 'filemanager':
        openBndzFileManager();
        break;
      case 'hide':
        hideLauncher();
        break;
    }
    onClose();
  };

  return createPortal(
    <div
      ref={ref}
      className="launcher-shell-menu"
      style={{ left: x, top: y }}
      role="menu"
      onContextMenu={e => e.preventDefault()}
    >
      {ITEMS.map(item => (
        <button key={item.id} type="button" className="launcher-shell-menu-item" role="menuitem" onClick={() => run(item.id)}>
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
