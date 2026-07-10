/** XYplorer-style title bar template tokens. */
export function renderTitleBarTemplate(
  template: string,
  vars: {
    path?: string;
    app?: string;
    ver?: string;
    ini?: string;
    selection?: string;
  },
): string {
  const map: Record<string, string> = {
    path: vars.path ?? '',
    app: vars.app ?? 'BNDZ',
    ver: vars.ver ?? '',
    ini: vars.ini ?? '',
    selection: vars.selection ?? '',
    '<path>': vars.path ?? '',
    '<app>': vars.app ?? 'BNDZ',
    '<ver>': vars.ver ?? '',
    '<ini>': vars.ini ?? '',
    '<selection>': vars.selection ?? '',
  };

  return template
    .replace(/<([^>]+)>/g, (_, raw: string) => map[raw.trim().toLowerCase()] ?? map[raw.trim()] ?? '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
