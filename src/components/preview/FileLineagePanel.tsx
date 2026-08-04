import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { IPC } from '../../lib/ipcBridge';
import { toWindowsPath } from '../../lib/pathUtils';

type LineageEdge = {
  id: string;
  kind: string;
  sourcePath: string;
  destPath: string;
  timestampUtc: string;
  label?: string;
};

type ContentNode = {
  hash: string;
  size: number;
  firstSeenUtc: string;
  paths: string[];
};

type ContentDagEdge = {
  id: string;
  parentHash: string;
  childHash: string;
  op: string;
  utc: string;
  fromPath?: string;
  toPath?: string;
};

type DagView = 'timeline' | 'dna';

function normalizeEdge(raw: Record<string, unknown>): LineageEdge {
  return {
    id: String(raw.id ?? raw.Id ?? `e_${Math.random().toString(36).slice(2, 9)}`),
    kind: String(raw.kind ?? raw.Kind ?? raw.op ?? raw.Op ?? 'unknown'),
    sourcePath: String(raw.sourcePath ?? raw.SourcePath ?? raw.fromPath ?? raw.FromPath ?? ''),
    destPath: String(raw.destPath ?? raw.DestPath ?? raw.toPath ?? raw.ToPath ?? ''),
    timestampUtc: String(raw.timestampUtc ?? raw.TimestampUtc ?? raw.utc ?? raw.Utc ?? ''),
    label: (raw.label as string | undefined) ?? (raw.Label as string | undefined) ?? (raw.op as string | undefined) ?? (raw.Op as string | undefined),
  };
}

function normalizeDagNode(raw: Record<string, unknown>): ContentNode {
  return {
    hash: String(raw.hash ?? raw.Hash ?? ''),
    size: Number(raw.size ?? raw.Size ?? 0),
    firstSeenUtc: String(raw.firstSeenUtc ?? raw.FirstSeenUtc ?? ''),
    paths: (Array.isArray(raw.paths) ? raw.paths : Array.isArray(raw.Paths) ? raw.Paths : []).map(String),
  };
}

function normalizeDagEdge(raw: Record<string, unknown>): ContentDagEdge {
  return {
    id: String(raw.id ?? raw.Id ?? ''),
    parentHash: String(raw.parentHash ?? raw.ParentHash ?? ''),
    childHash: String(raw.childHash ?? raw.ChildHash ?? ''),
    op: String(raw.op ?? raw.Op ?? ''),
    utc: String(raw.utc ?? raw.Utc ?? ''),
    fromPath: (raw.fromPath ?? raw.FromPath) as string | undefined,
    toPath: (raw.toPath ?? raw.ToPath) as string | undefined,
  };
}

function relativeTime(utc: string): string {
  if (!utc) return '';
  const ms = Date.now() - new Date(utc).getTime();
  if (ms < 0) return 'future';
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function leafName(path: string): string {
  const parts = path.replace(/[/\\]+$/, '').split(/[/\\]/);
  return parts.pop() || path;
}

function shortHash(hash: string): string {
  if (!hash) return '';
  return hash.slice(0, 8);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const EDGE_ICONS: Record<string, string> = {
  copy: 'move_ui',
  move: 'move_ui',
  rename: 'edit_ui',
  create: 'plus_ui',
  delete: 'delete',
  inbound: 'download_ui',
  download_origin: 'download_ui',
  branch_restore: 'available_updates',
};

const OP_COLORS: Record<string, string> = {
  copy: '#38bdf8',
  move: '#a78bfa',
  rename: '#fbbf24',
  create: '#34d399',
  delete: '#f87171',
  inbound: '#2dd4bf',
  download_origin: '#2dd4bf',
  branch_restore: '#60a5fa',
};

interface Props {
  path: string | null;
  onNavigate?: (path: string) => void;
}

export default function FileLineagePanel({ path, onNavigate }: Props) {
  const [edges, setEdges] = useState<LineageEdge[]>([]);
  const [dagNodes, setDagNodes] = useState<ContentNode[]>([]);
  const [dagEdges, setDagEdges] = useState<ContentDagEdge[]>([]);
  const [focusHash, setFocusHash] = useState('');
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<DagView>('timeline');

  useEffect(() => {
    if (!path) { setEdges([]); setDagNodes([]); setDagEdges([]); setFocusHash(''); return; }
    let active = true;
    setLoading(true);

    const winPath = toWindowsPath(path);

    Promise.all([
      IPC.lineageGet(winPath, 10),
      IPC.lineageContentDag(winPath, 4),
    ])
      .then(([lineageRes, dagRes]) => {
        if (!active) return;
        setEdges((lineageRes.edges || []).map(e => normalizeEdge(e as Record<string, unknown>)));
        setDagNodes((dagRes.nodes || []).map(n => normalizeDagNode(n as Record<string, unknown>)));
        setDagEdges((dagRes.edges || []).map(e => normalizeDagEdge(e as Record<string, unknown>)));
        setFocusHash(dagRes.focusHash || '');
      })
      .catch(() => { if (active) { setEdges([]); setDagNodes([]); setDagEdges([]); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [path]);

  const hasDag = dagNodes.length > 0;
  const hasTimeline = edges.length > 0;
  const hasAnything = hasDag || hasTimeline;

  if (!path) return null;

  const revealPath = (winPath: string) => {
    // MOTW HostUrl is not a filesystem path
    if (/^https?:\/\//i.test(winPath) || winPath.startsWith('Internet download')) return;
    const panePath = winPath.replace(/^([A-Za-z]):\\/, '/$1/').replace(/\\/g, '/');
    onNavigate?.(panePath);
  };

  return (
    <div className="border-t border-white/[0.06] px-4 py-3">
      {/* Header */}
      <div className="flex items-center gap-1.5 mb-2">
        <Icons8Icon id="genealogy" size={13} className="opacity-60" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">File Lineage</span>
        {loading && <span className="text-[10px] text-gray-600 ml-auto animate-pulse">hashing…</span>}

        {hasAnything && !loading && (
          <div className="ml-auto flex items-center gap-0.5">
            <ViewToggleBtn active={view === 'timeline'} onClick={() => setView('timeline')} label="Timeline" />
            {hasDag && <ViewToggleBtn active={view === 'dna'} onClick={() => setView('dna')} label="DNA" />}
          </div>
        )}
      </div>

      {!loading && !hasAnything && (
        <p className="text-[11px] text-white/40 leading-relaxed">
          No history yet. Downloads show a Windows origin when Mark of the Web is present; BNDZ copy/move/rename builds the rest.
        </p>
      )}

      {/* Timeline view */}
      {view === 'timeline' && hasTimeline && (
        <TimelineView edges={edges} path={path} revealPath={revealPath} />
      )}

      {/* Content DAG view */}
      {view === 'dna' && hasDag && (
        <ContentDagView
          nodes={dagNodes}
          edges={dagEdges}
          focusHash={focusHash}
          revealPath={revealPath}
        />
      )}

      {/* Empty state when we have DAG but no timeline in timeline view */}
      {view === 'timeline' && !hasTimeline && !loading && hasDag && (
        <div className="text-[10px] text-gray-600 italic py-1">
          No path-based lineage yet. Switch to DNA view to see content identity graph.
        </div>
      )}
    </div>
  );
}

function ViewToggleBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide rounded
        transition-all duration-150
        ${active
          ? 'bg-sky-500/20 text-sky-300 shadow-[inset_0_0_0_1px_rgba(56,189,248,0.3)]'
          : 'text-gray-500 hover:text-gray-400 hover:bg-white/[0.04]'
        }
      `}
    >
      {label}
    </button>
  );
}

function TimelineView({ edges, path, revealPath }: { edges: LineageEdge[]; path: string; revealPath: (p: string) => void }) {
  return (
    <div className="relative pl-3">
      <div className="absolute left-[7px] top-0 bottom-0 w-[1px] bg-white/[0.08]" />
      {edges.map((edge) => {
        const icon = EDGE_ICONS[edge.kind] || 'zap_ui';
        const isInbound = edge.destPath && toWindowsPath(path) === edge.destPath;
        const otherPath = isInbound ? edge.sourcePath : edge.destPath;
        return (
          <div key={edge.id} className="relative flex items-start gap-2.5 pb-2.5 group/lineage">
            <div className="absolute left-[-5px] top-[5px] w-[9px] h-[9px] rounded-full border-2 border-[#1e1e2e] bg-sky-500/60 z-10 group-hover/lineage:bg-sky-400 transition-colors" />
            <div className="flex-1 min-w-0 pl-2">
              <div className="flex items-center gap-1.5">
                <Icons8Icon id={icon} size={11} className="text-gray-500 shrink-0" />
                <span className="text-[10px] font-semibold text-gray-300 uppercase tracking-wide">{edge.kind}</span>
                <span className="text-[10px] text-gray-600 ml-auto shrink-0">{relativeTime(edge.timestampUtc)}</span>
              </div>
              {otherPath && (
                <button
                  type="button"
                  className="bndz-mono text-[10px] text-sky-400/70 hover:text-sky-300 truncate mt-0.5 block text-left max-w-full"
                  onClick={() => revealPath(otherPath)}
                  title={otherPath}
                >
                  {isInbound ? '← ' : '→ '}{leafName(otherPath)}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ContentDagView({ nodes, edges, focusHash, revealPath }: {
  nodes: ContentNode[];
  edges: ContentDagEdge[];
  focusHash: string;
  revealPath: (p: string) => void;
}) {
  const nodeMap = useMemo(() => {
    const m = new Map<string, ContentNode>();
    for (const n of nodes) m.set(n.hash, n);
    return m;
  }, [nodes]);

  const levels = useMemo(() => {
    if (!focusHash || nodes.length === 0) return [];

    const parentOf = new Map<string, string[]>();
    const childOf = new Map<string, string[]>();
    for (const e of edges) {
      if (!parentOf.has(e.childHash)) parentOf.set(e.childHash, []);
      parentOf.get(e.childHash)!.push(e.parentHash);
      if (!childOf.has(e.parentHash)) childOf.set(e.parentHash, []);
      childOf.get(e.parentHash)!.push(e.childHash);
    }

    const ancestors: string[] = [];
    const descendants: string[] = [];

    const visited = new Set<string>();
    const walkUp = (h: string) => {
      for (const p of parentOf.get(h) || []) {
        if (visited.has(p)) continue;
        visited.add(p);
        ancestors.push(p);
        walkUp(p);
      }
    };
    const walkDown = (h: string) => {
      for (const c of childOf.get(h) || []) {
        if (visited.has(c)) continue;
        visited.add(c);
        descendants.push(c);
        walkDown(c);
      }
    };

    visited.add(focusHash);
    walkUp(focusHash);
    walkDown(focusHash);

    return [
      ...ancestors.reverse().map(h => ({ hash: h, relation: 'ancestor' as const })),
      { hash: focusHash, relation: 'focus' as const },
      ...descendants.map(h => ({ hash: h, relation: 'descendant' as const })),
    ];
  }, [nodes, edges, focusHash]);

  const dagEdgeForPair = useCallback((parentH: string, childH: string) => {
    return edges.find(e => e.parentHash === parentH && e.childHash === childH);
  }, [edges]);

  if (levels.length === 0 && nodes.length > 0) {
    const node = nodeMap.get(focusHash) ?? nodes[0];
    return (
      <div className="py-1">
        <DagNodeCard node={node} relation="focus" revealPath={revealPath} />
        {nodes.length > 1 && (
          <div className="text-[9px] text-gray-600 mt-2 italic">
            {nodes.length} content identities recorded • no derivation edges yet
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="py-1 space-y-0">
      {levels.map((level, i) => {
        const node = nodeMap.get(level.hash);
        if (!node) return null;

        const prevLevel = i > 0 ? levels[i - 1] : null;
        const edgeBetween = prevLevel ? dagEdgeForPair(prevLevel.hash, level.hash) : null;

        return (
          <React.Fragment key={level.hash}>
            {edgeBetween && (
              <DagEdgeConnector op={edgeBetween.op} utc={edgeBetween.utc} />
            )}
            {!edgeBetween && i > 0 && (
              <DagEdgeConnector op="" utc="" />
            )}
            <DagNodeCard node={node} relation={level.relation} revealPath={revealPath} />
          </React.Fragment>
        );
      })}
    </div>
  );
}

function DagNodeCard({ node, relation, revealPath }: {
  node: ContentNode;
  relation: 'ancestor' | 'focus' | 'descendant';
  revealPath: (p: string) => void;
}) {
  const borderColor = relation === 'focus'
    ? 'border-sky-500/40 shadow-[0_0_8px_rgba(56,189,248,0.12)]'
    : relation === 'ancestor'
      ? 'border-violet-500/25'
      : 'border-emerald-500/25';

  const hashColor = relation === 'focus' ? 'text-sky-300' : 'text-gray-400';
  const bgGradient = relation === 'focus'
    ? 'bg-gradient-to-br from-sky-500/[0.06] to-transparent'
    : 'bg-white/[0.02]';

  return (
    <div className={`
      relative rounded-md border px-2.5 py-2
      ${borderColor} ${bgGradient}
      transition-all duration-150 hover:border-sky-400/40
    `}>
      {relation === 'focus' && (
        <div className="absolute -left-px top-2 bottom-2 w-[2px] rounded-full bg-sky-400/60" />
      )}

      <div className="flex items-center gap-1.5">
        <DnaHelixIcon size={11} className={relation === 'focus' ? 'text-sky-400' : 'text-gray-600'} />
        <span className={`bndz-mono text-[10px] font-bold ${hashColor}`}>
          {shortHash(node.hash)}
        </span>
        <span className="text-[9px] text-gray-600 ml-auto">
          {formatBytes(node.size)}
        </span>
      </div>

      {node.paths.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {node.paths.slice(0, 3).map((p, i) => (
            <button
              key={i}
              type="button"
              className="bndz-mono text-[9px] text-gray-500 hover:text-sky-300 truncate block text-left max-w-full transition-colors"
              onClick={() => revealPath(p)}
              title={p}
            >
              {leafName(p)}
            </button>
          ))}
          {node.paths.length > 3 && (
            <span className="text-[9px] text-gray-600">+{node.paths.length - 3} more</span>
          )}
        </div>
      )}

      {node.firstSeenUtc && (
        <div className="text-[9px] text-gray-600 mt-1">
          First seen {relativeTime(node.firstSeenUtc)}
        </div>
      )}
    </div>
  );
}

function DagEdgeConnector({ op, utc }: { op: string; utc: string }) {
  const color = OP_COLORS[op] || '#6b7280';

  return (
    <div className="flex items-center justify-center py-1">
      <div className="flex flex-col items-center">
        <div className="w-[1px] h-2" style={{ background: color, opacity: 0.4 }} />
        {op && (
          <div
            className="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider"
            style={{ color, background: `${color}15` }}
          >
            {op}{utc ? ` · ${relativeTime(utc)}` : ''}
          </div>
        )}
        <div className="w-[1px] h-2" style={{ background: color, opacity: 0.4 }} />
        <svg width="7" height="5" viewBox="0 0 7 5" className="opacity-60">
          <path d="M3.5 5L0 0h7z" fill={color} />
        </svg>
      </div>
    </div>
  );
}

function DnaHelixIcon({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <path
        d="M4 2c0 2.5 3 3.5 4 5s4 2.5 4 5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <path
        d="M12 2c0 2.5-3 3.5-4 5s-4 2.5-4 5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <line x1="5" y1="4.5" x2="11" y2="4.5" stroke="currentColor" strokeWidth="0.8" opacity="0.5" />
      <line x1="5" y1="7.5" x2="11" y2="7.5" stroke="currentColor" strokeWidth="0.8" opacity="0.5" />
      <line x1="5" y1="10.5" x2="11" y2="10.5" stroke="currentColor" strokeWidth="0.8" opacity="0.5" />
    </svg>
  );
}
