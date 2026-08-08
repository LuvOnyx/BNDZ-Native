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

/**
 * Write text to the clipboard. Prefer the browser API when present; otherwise
 * fall back to the host ShellExecute copyPath path (Windows Clipboard.SetText).
 */
export async function writeClipboardText(text: string): Promise<boolean> {
  const value = text ?? '';
  try {
    const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (clip && typeof clip.writeText === 'function') {
      await clip.writeText(value);
      return true;
    }
  } catch {
    /* fall through to host / execCommand */
  }

  try {
    const { IPC } = await import('./ipcBridge');
    if (IPC.isNative) {
      const asPaths = value.includes('\n')
        ? value.split(/\r?\n/).filter(Boolean)
        : value;
      await IPC.shellExecute('copyPath', asPaths);
      return true;
    }
  } catch {
    /* fall through */
  }

  try {
    if (typeof document === 'undefined') return false;
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
