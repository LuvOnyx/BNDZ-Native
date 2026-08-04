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
const PROMPT_EVENT = 'bndz-native-prompt-request';

export type NativePromptOptions = {
  title: string;
  message?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

type NativePromptRequest = NativePromptOptions & {
  resolve: (value: string | null) => void;
};

export function requestNativeConfirm(options: NativeConfirmOptions): Promise<boolean> {
  return new Promise(resolve => {
    window.dispatchEvent(new CustomEvent<NativeConfirmRequest>(CONFIRM_EVENT, {
      detail: { ...options, resolve },
    }));
  });
}

export function requestNativePrompt(options: NativePromptOptions): Promise<string | null> {
  return new Promise(resolve => {
    window.dispatchEvent(new CustomEvent<NativePromptRequest>(PROMPT_EVENT, {
      detail: { ...options, resolve },
    }));
  });
}

export function showNativeAlert(message: string, title = 'BNDZ', kind: 'error' | 'warning' | 'info' = 'warning') {
  import('../components/ToastHost').then(({ pushToast }) => {
    pushToast({ title, message, kind });
  });
}

export function subscribeNativeAlert(handler: (detail: { title?: string; message: string }) => void): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<{ title?: string; message: string }>).detail;
    if (detail) handler(detail);
  };
  window.addEventListener('bndz-native-alert', listener);
  return () => window.removeEventListener('bndz-native-alert', listener);
}

export function subscribeNativeConfirm(handler: (request: NativeConfirmRequest) => void): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<NativeConfirmRequest>).detail;
    if (detail) handler(detail);
  };
  window.addEventListener(CONFIRM_EVENT, listener);
  return () => window.removeEventListener(CONFIRM_EVENT, listener);
}

export function subscribeNativePrompt(handler: (request: NativePromptRequest) => void): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<NativePromptRequest>).detail;
    if (detail) handler(detail);
  };
  window.addEventListener(PROMPT_EVENT, listener);
  return () => window.removeEventListener(PROMPT_EVENT, listener);
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
