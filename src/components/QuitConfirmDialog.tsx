import React, { useState } from 'react';
import { BndzNativeDialog } from './BndzNativeDialog';

interface QuitConfirmDialogProps {
  open: boolean;
  source?: string;
  onCancel: () => void;
  onQuit: () => void;
  onMinimizeToTray: (remember: boolean) => void;
}

export default function QuitConfirmDialog({
  open,
  source = 'x',
  onCancel,
  onQuit,
  onMinimizeToTray,
}: QuitConfirmDialogProps) {
  const [minimizeToTray, setMinimizeToTray] = useState(false);

  const fromTray = source === 'tray';

  return (
    <BndzNativeDialog
      open={open}
      title={fromTray ? 'Quit BNDZ?' : 'Close BNDZ?'}
      subtitle="BNDZ"
      tone="warning"
      iconId="close"
      onClose={onCancel}
      zIndexClass="z-[650]"
      message={
        fromTray || source === 'menu'
          ? 'BNDZ can keep running in the system tray with quick access to the launcher and file manager.'
          : 'Are you sure you want to close? BNDZ can stay in the system tray so you can open it again quickly.'
      }
      buttons={[
        {
          label: 'No, stay open',
          style: 'secondary',
          onClick: onCancel,
        },
        {
          label: `Yes, ${fromTray ? 'quit' : 'close'}`,
          style: 'primary',
          onClick: () => {
            if (minimizeToTray) onMinimizeToTray(true);
            else onQuit();
          },
        },
      ]}
    >
      <label className="flex items-center gap-2.5 cursor-pointer select-none -mt-1">
        <input
          type="checkbox"
          className="accent-[var(--accent,#0ea5e9)]"
          checked={minimizeToTray}
          onChange={e => setMinimizeToTray(e.target.checked)}
        />
        <span className="text-[12px] bndz-native-dialog-muted">Minimize to system tray instead</span>
      </label>
    </BndzNativeDialog>
  );
}
