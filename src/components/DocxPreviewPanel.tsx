import React, { useEffect, useState } from 'react';
import mammoth from 'mammoth';

interface DocxPreviewPanelProps {
  url: string;
  title?: string;
}

export default function DocxPreviewPanel({ url, title }: DocxPreviewPanelProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setHtml(null);

    fetch(url)
      .then(r => {
        if (!r.ok) throw new Error('Failed to load document');
        return r.arrayBuffer();
      })
      .then(buffer => mammoth.convertToHtml({ arrayBuffer: buffer }))
      .then(result => {
        if (!cancelled) {
          setHtml(result.value);
          setLoading(false);
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(err?.message || 'Failed to preview document');
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [url]);

  if (loading) {
    return <div className="p-4 text-xs text-gray-400 animate-pulse">Loading document…</div>;
  }
  if (error) {
    return <div className="p-4 text-xs text-red-400 border border-red-500/20 bg-red-500/5 m-2 rounded">{error}</div>;
  }

  return (
    <div
      className="w-full h-full overflow-y-auto bndz-scrollbar bndz-preview-stage p-6 prose prose-invert prose-sm max-w-none
        prose-headings:text-gray-100 prose-p:text-gray-300 prose-a:text-[#7eb8e8] prose-table:text-gray-300
        prose-th:border-[#444] prose-td:border-[#333] prose-li:text-gray-300"
      dangerouslySetInnerHTML={{ __html: html ?? '' }}
      aria-label={title || 'Document preview'}
    />
  );
}
