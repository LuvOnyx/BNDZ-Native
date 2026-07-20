import React, { useEffect, useState } from 'react';
import { BndzNativeDialog } from './BndzNativeDialog';
import { NativeDialogCheckbox } from './native/NativeDialogShell';

export type XCloseAction = 'ask' | 'tray' | 'quit';

interface QuitConfirmDialogProps {
  open: boolean;
  source?: string;
  onCancel: () => void;
  onQuit: (remember: boolean) => void;
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
  const [rememberChoice, setRememberChoice] = useState(true);

  useEffect(() => {
    if (!open) return;
    setMinimizeToTray(false);
    setRememberChoice(true);
  }, [open, source]);

  const fromTray = source === 'tray';
  const fromMenu = source === 'menu';
  const fromUiClose = source === 'x';
  const quitting = fromTray || fromMenu;

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
          ? 'Exit completely, or keep BNDZ running in the system tray for quick access.'
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
            if (minimizeToTray) onMinimizeToTray(fromUiClose ? rememberChoice : true);
            else onQuit(fromUiClose ? rememberChoice : false);
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
      {fromUiClose && (
        <NativeDialogCheckbox
          checked={rememberChoice}
          onChange={setRememberChoice}
          className="mt-2"
        >
          Remember this decision
        </NativeDialogCheckbox>
      )}
    </BndzNativeDialog>
  );
}
