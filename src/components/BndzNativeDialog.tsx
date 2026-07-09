import React from 'react';
import { NativeDialogShell } from './native/NativeDialogShell';

export type NativeDialogTone = 'info' | 'warning' | 'destructive' | 'conflict';

export type NativeDialogButton = {
  label: string;
  style?: 'primary' | 'secondary' | 'destructive';
  onClick?: () => void;
};

export type BndzNativeDialogProps = {
  open: boolean;
  title: string;
  subtitle?: string;
  message?: React.ReactNode;
  tone?: NativeDialogTone;
  iconId?: string;
  children?: React.ReactNode;
  buttons: NativeDialogButton[];
  onClose?: () => void;
  showCloseButton?: boolean;
  zIndexClass?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
};

export function BndzNativeDialog({
  open,
  title,
  subtitle,
  message,
  tone = 'info',
  iconId,
  children,
  buttons,
  onClose,
  showCloseButton = true,
  zIndexClass = 'z-[500]',
  size = 'md',
}: BndzNativeDialogProps) {
  return (
    <NativeDialogShell
      open={open}
      title={title}
      subtitle={subtitle}
      tone={tone}
      iconId={iconId}
      onClose={onClose}
      showCloseButton={showCloseButton}
      zIndexClass={zIndexClass}
      size={size}
      footerButtons={buttons}
      maxHeightClass="max-h-[90vh]"
      bodyClassName={!message && !children ? 'hidden' : ''}
    >
      {message && (
        <p className="text-[13px] bndz-native-dialog-muted leading-relaxed whitespace-pre-wrap -mt-1">{message}</p>
      )}
      {children}
    </NativeDialogShell>
  );
}
