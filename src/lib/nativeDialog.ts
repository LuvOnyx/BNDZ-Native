import type { ModalConfig } from '../components/ModalProvider';

export type NativeConfirmOptions = {
  title: string;
  message: string;
  type?: ModalConfig['type'];
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type NativeConfirmRequest = NativeConfirmOptions & {
  resolve: (value: boolean) => void;
};

const CONFIRM_EVENT = 'bndz-native-confirm-request';

export function requestNativeConfirm(options: NativeConfirmOptions): Promise<boolean> {
  return new Promise(resolve => {
    window.dispatchEvent(new CustomEvent<NativeConfirmRequest>(CONFIRM_EVENT, {
      detail: { ...options, resolve },
    }));
  });
}

export function subscribeNativeConfirm(handler: (request: NativeConfirmRequest) => void): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<NativeConfirmRequest>).detail;
    if (detail) handler(detail);
  };
  window.addEventListener(CONFIRM_EVENT, listener);
  return () => window.removeEventListener(CONFIRM_EVENT, listener);
}

export type ElevationPromptOptions = {
  title?: string;
  message?: string;
};

export async function promptElevationIfNeeded(
  result: { success?: boolean; needsElevation?: boolean; message?: string },
  options: ElevationPromptOptions = {},
): Promise<boolean> {
  if (result.success || !result.needsElevation) return !!result.success;

  const title = options.title ?? 'Administrator approval required';
  const message = options.message ?? (
    `${result.message || 'This action needs elevated permissions.'}\n\nRestart BNDZ as administrator?`
  );

  const approved = await requestNativeConfirm({
    title,
    message,
    type: 'warning',
    confirmLabel: 'Restart as administrator',
    cancelLabel: 'Cancel',
  });

  if (!approved) return false;

  const { IPC } = await import('./ipcBridge');
  const relaunch = await IPC.relaunchAsAdmin();
  return relaunch.success;
}
