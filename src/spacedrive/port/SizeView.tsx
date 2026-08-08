/**
 * Spacedrive SizeView port — d3 pack bubble chart for folder size visualization.
 * Craft adapted to BNDZ glass/squircle FM language (not a raw vendor dump).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { Icons8Icon } from '../../components/Icons8Icon';

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
  onScanFolderSizes?: () => void;
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
  if (item.type === 'directory') return '#1a78c8';
  const ext = item.name.split('.').pop()?.toLowerCase() || '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'heic', 'avif'].includes(ext)) return '#6b3fa0';
  if (['mp4', 'mov', 'mkv', 'webm', 'avi'].includes(ext)) return '#9a3358';
  if (['mp3', 'wav', 'flac', 'aac', 'ogg'].includes(ext)) return '#1f7a62';
  if (['pdf', 'doc', 'docx', 'txt', 'md'].includes(ext)) return '#8a6a28';
  return '#3a4558';
}

export default function SizeView({ items, onNavigate, onScanFolderSizes }: Props) {
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
      .size([dims.w - 16, dims.h - 16])
      .padding(5)(hierarchy as d3.HierarchyNode<any>) as unknown as PackNode;
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
      .attr('stroke', 'rgba(255,255,255,0.14)')
      .attr('stroke-width', 1.25)
      .style('filter', 'drop-shadow(0 4px 10px rgba(0,0,0,0.35))')
      .style('cursor', d => d.data.item.type === 'directory' ? 'pointer' : 'default')
      .on('click', (_, d) => {
        if (d.data.item.type === 'directory' && d.data.item.path) onNavigate(d.data.item.path);
      })
      .on('mouseenter', (_, d) => setHover(d.data.item))
      .on('mouseleave', () => setHover(null));

    enter.merge(circles as any)
      .attr('cx', d => d.x + 8)
      .attr('cy', d => d.y + 8)
      .attr('r', d => d.r);

    const labels = layer.selectAll<SVGTextElement, PackNode>('text.bubble-label')
      .data(nodes.filter(d => d.r > 20), d => d.data.item.path || d.data.name);

    labels.exit().remove();
    labels.enter()
      .append('text')
      .attr('class', 'bubble-label')
      .attr('text-anchor', 'middle')
      .attr('fill', 'rgba(245,249,255,0.95)')
      .attr('font-size', d => Math.min(12, Math.max(9, d.r / 3.2)))
      .attr('font-weight', 560)
      .attr('pointer-events', 'none')
      .style('paint-order', 'stroke')
      .attr('stroke', 'rgba(0,0,0,0.45)')
      .attr('stroke-width', 2.5)
      .merge(labels as any)
      .attr('x', d => d.x + 8)
      .attr('y', d => d.y + 8)
      .text(d => (d.r > 30 ? d.data.name : ''));

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
      <div className="bndz-sizemap-empty">
        <span className="bndz-sizemap-empty-title">No folder sizes available yet</span>
        {onScanFolderSizes && (
          <button type="button" onClick={onScanFolderSizes} className="bndz-sizemap-scan-btn">
            Scan folder sizes
          </button>
        )}
        <span className="bndz-sizemap-empty-hint">Or wait for automatic size sync on navigation.</span>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="bndz-sizemap bndz-sizemap--bubbles">
      <div className="bndz-sizemap-toolbar">
        <button type="button" onClick={resetZoom} className="bndz-sizemap-tool-btn" title="Reset zoom">
          <Icons8Icon id="reset_ui" size={12} />
        </button>
      </div>
      {hover && (
        <div className="bndz-sizemap-hoverchip">
          <span className="bndz-sizemap-hoverchip-name">{hover.name}</span>
          <span className="bndz-sizemap-hoverchip-size">{formatBytes(hover.size || 0)}</span>
        </div>
      )}
      <svg ref={svgRef} width={dims.w} height={dims.h} className="block" />
    </div>
  );
}
