/** Safe clipboard helpers — WebView2 may leave navigator.clipboard undefined. */

export async function readClipboardText(): Promise<string> {
  try {
    const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (!clip || typeof clip.readText !== 'function') return '';
    return (await clip.readText()) || '';
  } catch {
    return '';
  }
}

export async function writeClipboardText(text: string): Promise<boolean> {
  try {
    const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (!clip || typeof clip.writeText !== 'function') return false;
    await clip.writeText(text);
    return true;
  } catch {
    return false;
  }
}
