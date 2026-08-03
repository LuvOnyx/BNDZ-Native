import { IPC } from '../ipcBridge';
import { toWindowsPath } from '../pathUtils';
import { isWorkIntentId, type WorkIntentId } from './packs';

/**
 * Read folder Work Intent contract: `.bndz-intent` JSON in the folder root.
 * Shape: `{ "intent": "archive" }` or plain text intent id.
 */
export async function readFolderIntentContract(panePath: string): Promise<WorkIntentId | null> {
  if (!panePath || panePath === '/' || panePath.startsWith('/bndz') || panePath.startsWith('/shell:')) {
    return null;
  }
  if (!IPC.isNative) return null;

  const win = toWindowsPath(panePath);
  if (!win || win.length < 3) return null;
  const contractPath = win.replace(/[/\\]+$/, '') + '\\.bndz-intent';

  try {
    const r = await IPC.readTextFile(contractPath, 4096);
    if (r.error || !r.content) return null;
    const raw = r.content.trim();
    if (!raw) return null;

    if (raw.startsWith('{')) {
      try {
        const parsed = JSON.parse(raw) as { intent?: string; workIntent?: string };
        const id = parsed.intent || parsed.workIntent;
        if (isWorkIntentId(id)) return id;
      } catch {
        return null;
      }
      return null;
    }

    const line = raw.split(/\r?\n/)[0]?.trim().toLowerCase();
    if (isWorkIntentId(line)) return line;
  } catch {
    return null;
  }
  return null;
}
