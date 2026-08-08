/** XYplorer-style title bar template tokens. */

import { withPermanentVariables } from './permanentVariables';

export function renderTitleBarTemplate(
  template: string,
  vars: {
    path?: string;
    app?: string;
    ver?: string;
    ini?: string;
    selection?: string;
  },
  config?: { rememberPermanentVariables?: boolean; permanentVariables?: unknown },
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

  const rendered = template
    .replace(/<([^>]+)>/g, (_, raw: string) => {
      const key = raw.trim();
      if (/^(p|var):/i.test(key)) return `<${key}>`;
      return map[key.toLowerCase()] ?? map[key] ?? '';
    })
    .replace(/\s{2,}/g, ' ')
    .trim();

  return config ? withPermanentVariables(rendered, config) : rendered;
}
