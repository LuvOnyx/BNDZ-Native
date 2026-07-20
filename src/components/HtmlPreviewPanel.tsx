import React, { useEffect, useRef, useState } from 'react';
import { toWindowsPath, toVirtualStreamUrl } from '../lib/pathUtils';
import { htmlPreviewBaseUrl, prepareHtmlForPreview } from '../lib/htmlPreview';

type Props = {
  path: string;
  title?: string;
};

/**
 * Renders local HTML in an iframe with a base href so relative assets resolve
 * through bndz-stream. Uses a blob URL to avoid WebView2 iframe quirks.
 *
 * Scripts are intentionally not enabled — many local HTML files ship incomplete
 * jQuery/helpers (e.g. updateSelectors) that throw into the WebView console.
 * Layout/CSS/images still load; use Open for full interactive pages.
 */
export default function HtmlPreviewPanel({ path, title }: Props) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const blobRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    const revoke = () => {
      if (blobRef.current) {
        URL.revokeObjectURL(blobRef.current);
        blobRef.current = null;
      }
      setBlobUrl(null);
    };

    (async () => {
      try {
        const winPath = toWindowsPath(path);
        let html = '';
        const { IPC } = await import('../lib/ipcBridge');
        if (IPC.isNative) {
          const result = await IPC.readTextFile(winPath);
          if (result.error) throw new Error(result.error);
          html = result.content ?? '';
        } else {
          const response = await fetch(toVirtualStreamUrl(path));
          if (!response.ok) throw new Error('Failed to load HTML file.');
          html = await response.text();
        }
        if (!active) return;
        if (!html.trim()) throw new Error('HTML file is empty.');

        const prepared = prepareHtmlForPreview(html, htmlPreviewBaseUrl(path));
        const blob = new Blob([prepared], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        blobRef.current = url;
        setBlobUrl(url);
      } catch (err: any) {
        if (active) {
          setError(err?.message || 'Failed to load HTML preview.');
          setBlobUrl(null);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
      revoke();
    };
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
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
        <p className="text-xs text-red-400 font-mono border border-red-500/20 bg-red-500/5 rounded px-3 py-2 max-w-full break-words">
          {error}
        </p>
        <p className="text-[10px] text-gray-500">Try Source view or open in your default browser.</p>
      </div>
    );
  }

  return (
    <iframe
      src={blobUrl ?? undefined}
      sandbox="allow-same-origin allow-forms allow-popups"
      className="bndz-html-preview-frame w-full flex-1 min-h-0 border-0 bg-white"
      title={title || 'HTML preview'}
    />
  );
}
