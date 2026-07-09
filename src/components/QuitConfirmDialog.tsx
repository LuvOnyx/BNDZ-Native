import React, { useState } from 'react';
import { BndzNativeDialog } from './BndzNativeDialog';
import { NativeDialogCheckbox } from './native/NativeDialogShell';

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
  const quitting = fromTray || source === 'menu';

  return (
    <BndzNativeDialog
      open={open}
      title={quitting ? 'Quit BNDZ?' : 'Close BNDZ?'}
      tone="warning"
      iconId="warning"
      onClose={onCancel}
      zIndexClass="z-[650]"
      message={
        quitting
          ? 'BNDZ can keep running in the system tray so you can open the launcher and file manager quickly.'
          : 'Close the window, or keep BNDZ in the system tray for quick access.'
      }
      buttons={[
        {
          label: 'Stay open',
          style: 'secondary',
          onClick: onCancel,
        },
        {
          label: quitting ? 'Quit' : 'Close',
          style: 'primary',
          onClick: () => {
            if (minimizeToTray) onMinimizeToTray(true);
            else onQuit();
          },
        },
      ]}
    >
      <NativeDialogCheckbox
        checked={minimizeToTray}
        onChange={setMinimizeToTray}
        className="mt-3"
      >
        Minimize to system tray instead
      </NativeDialogCheckbox>
    </BndzNativeDialog>
  );
}
