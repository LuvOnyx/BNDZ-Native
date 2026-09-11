import { pushToast } from '../components/ToastHost';

/**
 * Standard plugin IPC refresh — surfaces failures instead of silent empty states.
 */
export async function runPluginRefresh<T>(
  pluginLabel: string,
  fetcher: () => Promise<T>,
  onSuccess: (data: T) => void,
): Promise<boolean> {
  try {
    const data = await fetcher();
    onSuccess(data);
    return true;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    pushToast({ kind: 'error', title: `${pluginLabel} unavailable`, message });
    return false;
  }
}

/** Interpret common IPC `{ ok, error }` envelopes. */
export function assertIpcOk(
  res: { ok?: boolean; error?: string } | null | undefined,
  fallback = 'Host request failed',
): void {
  if (!res?.ok) throw new Error(res?.error || fallback);
}
