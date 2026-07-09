import React from 'react';
import { BndzNativeDialog } from '../../components/BndzNativeDialog';

type Props = {
  title: string;
  target?: string;
  message?: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmDeleteDialog({ title, target, message, confirmLabel, onConfirm, onCancel }: Props) {
  return (
    <BndzNativeDialog
      open
      title={title}
      tone="destructive"
      iconId="delete"
      zIndexClass="z-[100000]"
      message={
        <>
          {target ? <div className="truncate mb-2">&ldquo;{target}&rdquo;</div> : null}
          {message}
        </>
      }
      buttons={[
        { label: 'Cancel', onClick: onCancel },
        { label: confirmLabel, style: 'destructive', onClick: onConfirm },
      ]}
      onClose={onCancel}
    />
  );
}
