/** Payload shape returned when background processing queues work instead of blocking. */
export type QueuedIpcResult = {
  background?: boolean;
  queued?: boolean;
  ok?: boolean;
  success?: boolean;
};

export function isQueuedIpcResult(res: unknown): res is QueuedIpcResult & { background: true } {
  return !!res && typeof res === 'object' && (res as QueuedIpcResult).background === true;
}

/** Run follow-up UI work only when the IPC call completed synchronously (not queued). */
export function whenIpcCompleted<T>(res: T, onComplete: (res: T) => void): void {
  if (!isQueuedIpcResult(res)) onComplete(res);
}
