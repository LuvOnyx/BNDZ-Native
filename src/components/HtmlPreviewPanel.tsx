import React, { useEffect, useState } from 'react';
import { resolveLocalReadPath } from '../lib/meshPreviewResolve';
import { htmlPreviewBaseUrl, prepareHtmlForPreview } from '../lib/htmlPreview';

type Props = {
  path: string;
  title?: string;
};

/**
 * Renders local HTML in an iframe with a base href so relative assets resolve
 * through bndz-stream. Uses srcDoc (not blob:) to avoid WebView2 sandbox warnings
 * about blocked script execution in blob frames.
 *
 * Scripts stay disabled — many local HTML files ship incomplete helpers that
 * throw into the WebView console. Use Open for full interactive pages.
 */
export default function HtmlPreviewPanel({ path, title }: Props) {
  const [srcDoc, setSrcDoc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setSrcDoc(null);

    (async () => {
      try {
        const { IPC } = await import('../lib/ipcBridge');
        let html = '';
        let previewBasePath = path;
        if (IPC.isNative) {
          const resolved = await resolveLocalReadPath(path);
          if (resolved.error) throw new Error(resolved.error);
          previewBasePath = resolved.localPath;
          const result = await IPC.readTextFile(resolved.localPath);
          if (result.error) throw new Error(result.error);
          html = result.content ?? '';
        } else {
          const { toVirtualStreamUrl } = await import('../lib/pathUtils');
          const response = await fetch(toVirtualStreamUrl(path));
          if (!response.ok) throw new Error('Failed to load HTML file.');
          html = await response.text();
        }
        if (!active) return;
        if (!html.trim()) throw new Error('HTML file is empty.');

        const prepared = prepareHtmlForPreview(html, htmlPreviewBaseUrl(previewBasePath));
        setSrcDoc(prepared);
      } catch (err: any) {
        if (active) {
          setError(err?.message || 'Failed to load HTML preview.');
          setSrcDoc(null);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => { active = false; };
  }, [path]);

  if (loading) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center text-xs text-gray-400 animate-pulse p-4">
        Loading HTML preview…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center text-xs text-rose-300/90 p-4 text-center">
        {error}
      </div>
    );
  }

  return (
    <iframe
      srcDoc={srcDoc ?? undefined}
      sandbox="allow-same-origin allow-forms allow-popups"
      className="bndz-html-preview-frame w-full flex-1 min-h-0 border-0 bg-white"
      title={title || 'HTML preview'}
    />
  );
}
