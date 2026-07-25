import React, { useEffect, useMemo, useRef, useState } from 'react';

export type BreadcrumbSeg = { path: string; label: string };

type Props = {
  segments: BreadcrumbSeg[];
  dropTarget: string | null;
  onNavigate: (path: string, opts?: { newTab?: boolean }) => void;
  onDragOverSeg: (e: React.DragEvent, path: string) => void;
  onDragLeaveSeg: (e: React.DragEvent, path: string) => void;
  onDropSeg: (e: React.DragEvent, path: string) => void;
  hasBndzFileDrag: (e: React.DragEvent) => boolean;
};

/**
 * Gold breadcrumb — collapses middle segments into a soft "…" overflow menu
 * instead of silently clipping with overflow-x-hidden.
 */
export function BreadcrumbTrail({
  segments,
  dropTarget,
  onNavigate,
  onDragOverSeg,
  onDragLeaveSeg,
  onDropSeg,
  hasBndzFileDrag,
}: Props) {
  const railRef = useRef<HTMLDivElement>(null);
  const [maxVisible, setMaxVisible] = useState(segments.length);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth;
      // ~88px per crumb average; always keep first + last when collapsing.
      const approx = Math.max(2, Math.floor(width / 92));
      setMaxVisible(Math.min(segments.length, approx));
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [segments.length]);

  const { head, mid, tail } = useMemo(() => {
    if (segments.length <= maxVisible || segments.length <= 2) {
      return { head: segments, mid: [] as BreadcrumbSeg[], tail: [] as BreadcrumbSeg[] };
    }
    const keepTail = 1;
    const keepHead = Math.max(1, maxVisible - keepTail - 1);
    return {
      head: segments.slice(0, keepHead),
      mid: segments.slice(keepHead, segments.length - keepTail),
      tail: segments.slice(segments.length - keepTail),
    };
  }, [segments, maxVisible]);

  const renderSeg = (seg: BreadcrumbSeg, showSep: boolean) => (
    <React.Fragment key={seg.path}>
      {showSep && <span className="text-gray-500 mx-1 shrink-0">&gt;</span>}
      <span
        className={`hover:underline cursor-pointer font-semibold shrink-0 rounded-[var(--bndz-radius-sm)] transition-colors ${dropTarget === seg.path ? 'bg-[#0078d4]/20 ring-1 ring-[#0078d4]/60 px-1 -mx-1' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          onNavigate(seg.path, { newTab: e.ctrlKey || e.metaKey });
        }}
        onAuxClick={(e) => {
          if (e.button !== 1) return;
          e.preventDefault();
          e.stopPropagation();
          onNavigate(seg.path, { newTab: true });
        }}
        onDragOver={(e) => onDragOverSeg(e, seg.path)}
        onDragLeave={(e) => onDragLeaveSeg(e, seg.path)}
        onDrop={(e) => onDropSeg(e, seg.path)}
        title="Click to navigate · Ctrl/middle-click new tab · Drop to move/copy"
        data-breadcrumb-path={seg.path}
      >
        {seg.label}
      </span>
    </React.Fragment>
  );

  return (
    <div ref={railRef} className="relative flex items-center min-w-0 flex-1 overflow-visible">
      {head.map((seg, i) => renderSeg(seg, i > 0))}
      {mid.length > 0 && (
        <>
          <span className="text-gray-500 mx-1 shrink-0">&gt;</span>
          <button
            type="button"
            className="shrink-0 px-1.5 py-0.5 rounded-[8px] text-[11px] font-semibold text-gray-300 hover:bg-[#333] border border-transparent hover:border-[#555]"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(v => !v);
            }}
            title={`${mid.length} hidden segment(s)`}
          >
            …
          </button>
          {menuOpen && (
            <div
              className="absolute top-full left-8 z-[80] mt-1 min-w-[180px] max-w-[320px] py-1 rounded-[10px] border border-[#454545] bg-[#1e1e22]/98 shadow-xl backdrop-blur-sm"
              onMouseLeave={() => setMenuOpen(false)}
            >
              {mid.map(seg => (
                <button
                  key={seg.path}
                  type="button"
                  className="w-full text-left px-3 py-1.5 text-[11px] text-gray-200 hover:bg-[#0078d4]/25 truncate"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(false);
                    onNavigate(seg.path, { newTab: e.ctrlKey || e.metaKey });
                  }}
                  title={seg.path}
                >
                  {seg.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {tail.map(seg => renderSeg(seg, true))}
    </div>
  );
}
