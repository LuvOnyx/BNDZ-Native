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
  /** Optional lead line under title (alert) or sheet intro — omit generic app name subtitles */
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
  variant?: 'alert' | 'sheet';
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
  showCloseButton = false,
  zIndexClass = 'z-[500]',
  size = 'md',
  variant = 'alert',
}: BndzNativeDialogProps) {
  const hasBody = !!(message || children);
  const isSheet = variant === 'sheet';

  return (
    <NativeDialogShell
      open={open}
      title={title}
      subtitle={isSheet ? subtitle : undefined}
      tone={tone}
      iconId={iconId}
      onClose={onClose}
      showCloseButton={showCloseButton}
      zIndexClass={zIndexClass}
      size={size}
      variant={variant}
      footerButtons={buttons}
      maxHeightClass="max-h-[90vh]"
      bodyClassName={hasBody ? '' : 'hidden'}
    >
      {!isSheet && subtitle && (
        <p className="bndz-native-alert-lead">{subtitle}</p>
      )}
      {message && (
        <p className="bndz-native-alert-message">{message}</p>
      )}
      {children}
    </NativeDialogShell>
  );
}
