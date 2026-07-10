import type { ColorFilterRow } from './colorFilterConfig';

export type PreviewFormatRow = { i: string; n: string; c: boolean };

export async function pickNativeFolder(description = 'Select folder'): Promise<string | null> {
  const { IPC } = await import('./ipcBridge');
  if (!IPC.isNative) return null;
  const path = await IPC.openFolderDialog(description);
  return path || null;
}

export function pickHexColor(initial = '#ffffff'): Promise<string | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'color';
    input.value = initial.startsWith('#') ? initial : '#ffffff';
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);
    const cleanup = () => input.remove();
    input.addEventListener('input', () => {
      resolve(input.value);
      cleanup();
    }, { once: true });
    input.addEventListener('blur', () => {
      resolve(null);
      cleanup();
    }, { once: true });
    input.click();
  });
}

export function createPreviewFormatRow(rows: PreviewFormatRow[]): PreviewFormatRow {
  const n = rows.length + 1;
  return { i: String(n), n: `*.ext${n}`, c: true };
}

export function editPreviewFormatRow(rows: PreviewFormatRow[], index: number): PreviewFormatRow[] | null {
  const row = rows[index];
  if (!row) return null;
  const next = window.prompt('Preview format pattern (e.g. *.png):', row.n);
  if (next == null || !next.trim()) return null;
  const copy = [...rows];
  copy[index] = { ...row, n: next.trim() };
  return copy;
}

export function removePreviewFormatRow(rows: PreviewFormatRow[], index: number): PreviewFormatRow[] {
  return rows.filter((_, i) => i !== index);
}

export function editColorFilterExpression(rows: ColorFilterRow[], index: number): ColorFilterRow[] | null {
  const row = rows[index];
  if (!row) return null;
  const next = window.prompt('Color filter expression (e.g. *.jpg;*.png):', row.t);
  if (next == null || !next.trim()) return null;
  const copy = [...rows];
  copy[index] = { ...row, t: next.trim() };
  return copy;
}
