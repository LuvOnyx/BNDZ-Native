/** XYplorer-style status bar template tokens (subset wired for v1). */
export function renderStatusBarTemplate(
  template: string,
  vars: {
    items?: number;
    selected?: number;
    path?: string;
    free?: string;
    volumes?: number;
    app?: string;
    ver?: string;
  },
): string {
  const map: Record<string, string> = {
    items: String(vars.items ?? 0),
    selected: String(vars.selected ?? 0),
    path: vars.path ?? '',
    free: vars.free ?? '',
    volumes: String(vars.volumes ?? 0),
    app: vars.app ?? 'BNDZ',
    ver: vars.ver ?? '',
    's:items': String(vars.items ?? 0),
    's:selected': String(vars.selected ?? 0),
    's:path': vars.path ?? '',
    's:free': vars.free ?? '',
    's:dimension': `${vars.items ?? 0} item(s)`,
  };

  return template
    .replace(/<([^>]+)>/g, (_, raw: string) => map[raw.trim().toLowerCase()] ?? '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
