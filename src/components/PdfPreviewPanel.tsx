import React, { useEffect, useRef, useState } from 'react';
import { Icons8Icon } from './Icons8Icon';
import * as pdfjs from 'pdfjs-dist';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

interface PdfPreviewPanelProps {
  url: string;
  title?: string;
}

export default function PdfPreviewPanel({ url, title }: PdfPreviewPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPdf(null);
    setPage(1);

    const task = pdfjs.getDocument({ url });
    task.promise
      .then(doc => {
        if (cancelled) { void task.destroy(); return; }
        setPdf(doc);
        setTotalPages(doc.numPages);
        setLoading(false);
      })
      .catch(err => {
        if (!cancelled) {
          setError(err?.message || 'Failed to load PDF');
          setLoading(false);
        }
      });

    return () => { cancelled = true; void task.destroy(); };
  }, [url]);

  useEffect(() => {
    if (!pdf || !canvasRef.current) return;
    let cancelled = false;

    pdf.getPage(page).then(pageObj => {
      if (cancelled) return;
      const viewport = pageObj.getViewport({ scale });
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      return pageObj.render({ canvasContext: ctx, viewport, canvas }).promise;
    }).catch(() => {});

    return () => { cancelled = true; };
  }, [pdf, page, scale]);

  if (loading) {
    return <div className="p-4 text-xs text-gray-400 animate-pulse">Loading PDF…</div>;
  }
  if (error) {
    return <div className="p-4 text-xs text-red-400 border border-red-500/20 bg-red-500/5 m-2 rounded">{error}</div>;
  }

  return (
    <div className="w-full h-full flex flex-col bndz-preview-stage min-h-0">
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-white/10 bg-black/20 shrink-0">
        <button type="button" disabled={page <= 1} onClick={() => setPage(p => p - 1)}
          className="p-1 rounded hover:bg-white/10 disabled:opacity-30 text-gray-300">
          <Icons8Icon id="chevron_left" size={14} />
        </button>
        <span className="text-[10px] text-gray-400 font-mono min-w-[60px] text-center">
          {page} / {totalPages}
        </span>
        <button type="button" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
          className="p-1 rounded hover:bg-white/10 disabled:opacity-30 text-gray-300">
          <Icons8Icon id="chevron_right" size={14} />
        </button>
        <div className="flex-1" />
        <button type="button" onClick={() => setScale(s => Math.max(0.5, s - 0.25))}
          className="p-1 rounded hover:bg-white/10 text-gray-300">
          <Icons8Icon id="zoom_out_ui" size={14} />
        </button>
        <span className="text-[10px] text-gray-500 font-mono w-8 text-center">{Math.round(scale * 100)}%</span>
        <button type="button" onClick={() => setScale(s => Math.min(3, s + 0.25))}
          className="p-1 rounded hover:bg-white/10 text-gray-300">
          <Icons8Icon id="zoom_in_ui" size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-auto bndz-scrollbar flex justify-center p-2 bg-[#525252]">
        <canvas ref={canvasRef} className="shadow-lg" aria-label={title || 'PDF preview'} />
      </div>
    </div>
  );
}
