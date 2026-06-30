/** Replaces legacy Flow Launcher copy with BNDZ Launcher in UI strings. */
export function rebrandLauncherText(text: string | undefined | null): string {
  if (!text) return '';
  return text
    .replace(/FlowLauncher/gi, 'BNDZ Launcher')
    .replace(/Flow Launcher/gi, 'BNDZ Launcher')
    .replace(/Flow launcher's/gi, "BNDZ Launcher's")
    .replace(/\bfrom Flow\b/gi, 'from BNDZ Launcher')
    .replace(/\bin Flow\b/gi, 'in BNDZ Launcher')
    .replace(/\bvia Flow\b/gi, 'via BNDZ Launcher');
}
