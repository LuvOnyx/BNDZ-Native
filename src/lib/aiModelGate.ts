import { IPC } from './ipcBridge';

type GateHandler = () => Promise<boolean>;

let gateHandler: GateHandler | null = null;

export function setAiModelGateHandler(handler: GateHandler | null) {
  gateHandler = handler;
}

/** Returns true when the local model is present or the user consented to download. */
export async function ensureAiModelReady(): Promise<boolean> {
  if (!IPC.isNative) return false;
  try {
    const status = await IPC.getAiModelStatus();
    if (status.present) return true;
  } catch {
    return false;
  }
  if (!gateHandler) return false;
  return gateHandler();
}
