import { IPC } from './ipcBridge';

const EXPORT_VERSION = 1;

export async function exportSettingsBundle(config: Record<string, unknown>): Promise<void> {
  const payload = {
    format: 'bndz-settings',
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    settings: config,
  };
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bndz-settings-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function importSettingsBundle(
  apply: (settings: Record<string, unknown>) => void,
): Promise<{ ok: boolean; message: string }> {
  try {
    let raw: string;
    if (IPC.isNative) {
      const paths = await IPC.openFileDialog('JSON (*.json)|*.json');
      if (!paths?.length) return { ok: false, message: 'Import cancelled.' };
      const read = await IPC.readTextFile(paths[0], 4 * 1024 * 1024);
      if (read.error || !read.content) return { ok: false, message: read.error || 'Could not read file.' };
      raw = read.content;
    } else {
      raw = await new Promise<string>((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.onchange = () => {
          const file = input.files?.[0];
          if (!file) { reject(new Error('cancelled')); return; }
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? ''));
          reader.onerror = () => reject(reader.error);
          reader.readAsText(file);
        };
        input.click();
      });
    }
    const parsed = JSON.parse(raw) as { format?: string; settings?: Record<string, unknown> };
    const settings = parsed.format === 'bndz-settings' && parsed.settings
      ? parsed.settings
      : (parsed as Record<string, unknown>);
    if (!settings || typeof settings !== 'object') {
      return { ok: false, message: 'Invalid settings file.' };
    }
    apply(settings);
    IPC.saveSettings(settings);
    return { ok: true, message: 'Settings imported successfully.' };
  } catch (e: any) {
    if (String(e?.message) === 'cancelled') return { ok: false, message: 'Import cancelled.' };
    return { ok: false, message: e?.message || 'Import failed.' };
  }
}
