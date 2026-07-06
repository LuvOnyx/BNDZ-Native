/**
 * Spacedrive SizeView port — d3 pack bubble chart for folder size visualization.
 * Source: spacedrive/packages/interface/src/routes/explorer/views/SizeView/SizeView.tsx
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { RotateCcw } from 'lucide-react';

export type SizeViewItem = {
  name: string;
  type?: string;
  size?: number;
  path?: string;
};

type PackNode = d3.HierarchyCircularNode<{
  name: string;
  value: number;
  item: SizeViewItem;
}>;

type Props = {
  items: SizeViewItem[];
  onNavigate: (path: string) => void;
};

const MAX_NODES = 48;
const MIN_BYTES = 4096;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function bubbleColor(item: SizeViewItem): string {
  if (item.type === 'directory') return 'hsl(208, 70%, 42%)';
  const ext = item.name.split('.').pop()?.toLowerCase() || '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return 'hsl(280, 45%, 38%)';
  if (['mp4', 'mov', 'mkv', 'webm'].includes(ext)) return 'hsl(340, 50%, 38%)';
  if (['mp3', 'wav', 'flac'].includes(ext)) return 'hsl(160, 45%, 36%)';
  if (['pdf', 'doc', 'docx', 'txt', 'md'].includes(ext)) return 'hsl(38, 55%, 40%)';
  return 'hsl(220, 25%, 32%)';
}

export default function SizeView({ items, onNavigate }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [dims, setDims] = useState({ w: 400, h: 280 });
  const [hover, setHover] = useState<SizeViewItem | null>(null);

  const prepared = useMemo(() => {
    const dirs = items.filter(i => i.type === 'directory');
    const pool = dirs.length > 0 ? dirs : items.filter(i => (i.size || 0) >= MIN_BYTES);
    return [...pool]
      .sort((a, b) => (b.size || 0) - (a.size || 0))
      .slice(0, MAX_NODES)
      .map(i => ({ ...i, size: Math.max(i.size || MIN_BYTES, MIN_BYTES) }));
  }, [items]);

  const root = useMemo(() => {
    if (!prepared.length) return null;
    const hierarchy = d3.hierarchy({ name: 'root', children: prepared.map(i => ({ name: i.name, value: i.size!, item: i })) } as any)
      .sum(d => (d as any).value || 0)
      .sort((a, b) => (b.value || 0) - (a.value || 0));
    return d3.pack<typeof prepared[0]>()
      .size([dims.w - 8, dims.h - 8])
      .padding(3)(hierarchy as d3.HierarchyNode<any>) as unknown as PackNode;
  }, [prepared, dims]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setDims({ w: el.clientWidth || 400, h: el.clientHeight || 280 });
    });
    ro.observe(el);
    setDims({ w: el.clientWidth || 400, h: el.clientHeight || 280 });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    if (!svgRef.current || !root?.children) {
      svg.selectAll('*').remove();
      return;
    }

    const g = svg.select<SVGGElement>('g.zoom-layer');
    const layer = g.empty() ? svg.append('g').attr('class', 'zoom-layer') : g;

    const nodes = root.children as PackNode[];
    const circles = layer.selectAll<SVGCircleElement, PackNode>('circle.bubble')
      .data(nodes, d => d.data.item.path || d.data.name);

    circles.exit().remove();

    const enter = circles.enter()
      .append('circle')
      .attr('class', 'bubble')
      .attr('fill', d => bubbleColor(d.data.item))
      .attr('stroke', '#1a1a1a')
      .attr('stroke-width', 1)
      .style('cursor', d => d.data.item.type === 'directory' ? 'pointer' : 'default')
      .on('click', (_, d) => {
        if (d.data.item.type === 'directory' && d.data.item.path) onNavigate(d.data.item.path);
      })
      .on('mouseenter', (_, d) => setHover(d.data.item))
      .on('mouseleave', () => setHover(null));

    enter.merge(circles as any)
      .attr('cx', d => d.x + 4)
      .attr('cy', d => d.y + 4)
      .attr('r', d => d.r);

    const labels = layer.selectAll<SVGTextElement, PackNode>('text.bubble-label')
      .data(nodes.filter(d => d.r > 18), d => d.data.item.path || d.data.name);

    labels.exit().remove();
    labels.enter()
      .append('text')
      .attr('class', 'bubble-label')
      .attr('text-anchor', 'middle')
      .attr('fill', '#e5e7eb')
      .attr('font-size', d => Math.min(11, d.r / 3))
      .attr('pointer-events', 'none')
      .merge(labels as any)
      .attr('x', d => d.x + 4)
      .attr('y', d => d.y + 4)
      .text(d => d.r > 28 ? d.data.name : '');

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 4])
      .on('zoom', ev => layer.attr('transform', ev.transform.toString()));

    svg.call(zoom as any);
  }, [root, onNavigate]);

  const resetZoom = () => {
    if (!svgRef.current) return;
    d3.select(svgRef.current).transition().duration(300).call(
      d3.zoom<SVGSVGElement, unknown>().transform as any,
      d3.zoomIdentity,
    );
  };

  if (!prepared.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-[11px] text-gray-500 gap-1 px-4 text-center">
        <span>No folder sizes available yet.</span>
        <span className="text-[10px] text-gray-600">Wait for size sync, or open a folder with subfolders.</span>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full h-full min-h-[280px] bg-[#1e1e1e] border border-[#3a3a3a]">
      <div className="absolute top-2 right-2 z-10 flex gap-1">
        <button type="button" onClick={resetZoom} className="p-1 bg-[#333] hover:bg-[#444] rounded text-gray-400" title="Reset zoom">
          <RotateCcw size={12} />
        </button>
      </div>
      {hover && (
        <div className="absolute top-2 left-2 z-10 px-2 py-1 bg-[#252525]/95 border border-[#454545] text-[10px] text-gray-200 max-w-[60%] truncate">
          {hover.name} — {formatBytes(hover.size || 0)}
        </div>
      )}
      <svg ref={svgRef} width={dims.w} height={dims.h} className="block" />
    </div>
  );
}
