import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { IPC } from '../lib/ipcBridge';
import { formatUiPath } from '../lib/displayPath';
import { runWebViewPrimaryAction } from '../lib/webViewClick';
import { isNativeShellHostBoot } from '../lib/nativeShellHostBoot';

export type BreadcrumbSeg = { path: string; label: string };

type Props = {
  segments: BreadcrumbSeg[];
  dropTarget: string | null;
  onNavigate: (path: string, opts?: { newTab?: boolean }) => void;
};

/** Rough px width for a segment label + separator — conservative so we keep paths visible. */
function estimateSegWidth(label: string): number {
  return Math.min(220, Math.max(28, label.length * 6.5 + 10)) + 14;
}

function countSegmentsThatFit(segments: BreadcrumbSeg[], availablePx: number): number {
  if (segments.length <= 2 || availablePx < 48) return segments.length;
  let used = 0;
  let fit = 0;
  for (const seg of segments) {
    const next = estimateSegWidth(seg.label);
    if (fit > 0 && used + next > availablePx) break;
    used += next;
    fit += 1;
  }
  return Math.max(2, Math.min(segments.length, fit));
}

async function showBreadcrumbOverflowHostMenu(
  clientX: number,
  clientY: number,
  mid: BreadcrumbSeg[],
  onNavigate: (path: string, opts?: { newTab?: boolean }) => void,
): Promise<boolean> {
  // Classic WPF host only — BNDZShell headless IPC cannot own a reliable popup.
  if (!IPC.isNative || isNativeShellHostBoot() || !mid.length) return false;
  const items = mid.map((seg, i) => ({
    id: `crumb-${i}`,
    label: seg.label || seg.path,
  }));
  const id = await IPC.showHostContextMenu({ clientX, clientY, items });
  if (!id) return true; // Host showed; user cancelled
  const idx = Number(String(id).replace(/^crumb-/, ''));
  if (!Number.isFinite(idx) || idx < 0 || idx >= mid.length) return true;
  onNavigate(mid[idx].path);
  return true;
}

/**
 * Breadcrumb rail — only collapses middle segments when the row is genuinely tight.
 * File drag hover/drop uses pointer + native OLE (see fileDragHover.ts).
 * Overflow "…" uses the host WPF menu when native so it isn't clipped by WebView.
 */
export function BreadcrumbTrail({
  segments,
  dropTarget,
  onNavigate,
}: Props) {
  const railRef = useRef<HTMLDivElement>(null);
  const [maxVisible, setMaxVisible] = useState(segments.length);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [segments]);

  useLayoutEffect(() => {
    const el = railRef.current;
    if (!el) return;

    const sync = () => {
      const width = el.clientWidth;
      if (width < 8) return;
      const fit = countSegmentsThatFit(segments, width);
      setMaxVisible((prev) => (prev === fit ? prev : fit));
    };

    sync();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(sync) : null;
    ro?.observe(el);
    window.addEventListener('resize', sync);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', sync);
    };
  }, [segments]);

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
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          runWebViewPrimaryAction(e, () => onNavigate(seg.path, { newTab: e.ctrlKey || e.metaKey }));
        }}
        onAuxClick={(e) => {
          if (e.button !== 1) return;
          e.preventDefault();
          e.stopPropagation();
          onNavigate(seg.path, { newTab: true });
        }}
        title="Click to navigate · Ctrl/middle-click new tab · Drop to move/copy"
        data-breadcrumb-path={seg.path}
      >
        {seg.label}
      </span>
    </React.Fragment>
  );

  return (
    <div ref={railRef} className="relative flex items-center min-w-0 w-full flex-nowrap overflow-visible">
      {head.map((seg, i) => renderSeg(seg, i > 0))}
      {mid.length > 0 && (
        <>
          <span className="text-gray-500 mx-1 shrink-0">&gt;</span>
          <button
            type="button"
            className="shrink-0 px-1.5 py-0.5 rounded-[8px] text-[11px] font-semibold text-gray-300 hover:bg-[#333] border border-transparent hover:border-[#555]"
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              const { clientX, clientY } = e;
              runWebViewPrimaryAction(e, () => {
                void (async () => {
                  const usedHost = await showBreadcrumbOverflowHostMenu(clientX, clientY, mid, onNavigate);
                  if (!usedHost) setMenuOpen(v => !v);
                  else setMenuOpen(false);
                })();
              });
            }}
            title={`${mid.length} hidden segment(s)`}
          >
            …
          </button>
          {menuOpen && (!IPC.isNative || isNativeShellHostBoot()) && (
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
                  title={formatUiPath(seg.path) || seg.label}
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
