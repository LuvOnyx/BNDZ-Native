import { toVirtualStreamUrl, toWindowsPath } from './pathUtils';

/** Directory local-stream URL so relative assets in HTML resolve correctly. */
export function htmlPreviewBaseUrl(filePath: string): string {
  const win = toWindowsPath(filePath);
  const dir = win.replace(/[\\/][^\\/]+$/, '');
  const base = toVirtualStreamUrl(dir || win);
  return base.endsWith('/') ? base : `${base}/`;
}

/** Inject a base href when missing so linked CSS/JS/images load from the file folder. */
export function prepareHtmlForPreview(html: string, baseHref: string): string {
  if (/<base\s[\s\S]*?href\s*=/i.test(html)) return html;
  const baseTag = `<base href="${baseHref}">`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, `<html$1><head>${baseTag}</head>`);
  }
  return `<!DOCTYPE html><html><head>${baseTag}</head><body>${html}</body></html>`;
}
