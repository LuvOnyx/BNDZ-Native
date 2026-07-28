import { IPC } from './ipcBridge';
import { flushBndzMeta, readBndzMeta, writeBndzMetaDebounced } from './bndzMetaStore';

export type AutomationNodeType =
  | 'watchFolder'
  | 'filterExtension'
  | 'filterArchive'
  | 'copyTo'
  | 'moveTo'
  | 'rsyncDeploy'
  | 'log';

export type AutomationNode = {
  id: string;
  type: AutomationNodeType;
  position: { x: number; y: number };
  data: Record<string, string | number | boolean>;
};

export type AutomationEdge = {
  id: string;
  source: string;
  target: string;
};

export type AutomationViewport = { x: number; y: number; zoom: number };

export type AutomationGraph = {
  id: string;
  name: string;
  nodes: AutomationNode[];
  edges: AutomationEdge[];
  viewport?: AutomationViewport;
  updatedAt: number;
};

const META_KEY = 'automation_graph_v1';

let cache: AutomationGraph | null = null;

export function defaultAutomationViewport(): AutomationViewport {
  return { x: 0, y: 0, zoom: 0.9 };
}

export function defaultAutomationGraph(): AutomationGraph {
  return {
    id: 'default',
    name: 'File pipeline',
    nodes: [],
    edges: [],
    viewport: defaultAutomationViewport(),
    updatedAt: Date.now(),
  };
}

function parseViewport(vp: unknown): AutomationViewport {
  const base = defaultAutomationViewport();
  if (!vp || typeof vp !== 'object') return base;
  const v = vp as Partial<AutomationViewport>;
  return {
    x: typeof v.x === 'number' && Number.isFinite(v.x) ? v.x : base.x,
    y: typeof v.y === 'number' && Number.isFinite(v.y) ? v.y : base.y,
    zoom: typeof v.zoom === 'number' && Number.isFinite(v.zoom) ? v.zoom : base.zoom,
  };
}

function parseAutomationGraph(parsed: Partial<AutomationGraph>): AutomationGraph {
  const base = defaultAutomationGraph();
  const hasPersistedGraph = Array.isArray(parsed.nodes) || Array.isArray(parsed.edges);
  return {
    ...base,
    ...parsed,
    nodes: Array.isArray(parsed.nodes) ? parsed.nodes : (hasPersistedGraph ? [] : base.nodes),
    edges: Array.isArray(parsed.edges) ? parsed.edges : (hasPersistedGraph ? [] : base.edges),
    viewport: parseViewport(parsed.viewport),
    updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
  };
}

export function invalidateAutomationCache(): void {
  cache = null;
}

export function hydrateAutomationFromJson(json: string): AutomationGraph | null {
  try {
    const parsed = JSON.parse(json) as Partial<AutomationGraph>;
    const graph = parseAutomationGraph(parsed);
    cache = graph;
    return graph;
  } catch {
    return null;
  }
}

export async function loadAutomationGraph(options?: { force?: boolean }): Promise<AutomationGraph> {
  if (cache && !options?.force) return cache;
  try {
    const raw = await readBndzMeta(META_KEY);
    if (raw) {
      cache = parseAutomationGraph(JSON.parse(raw) as Partial<AutomationGraph>);
      return cache;
    }
  } catch { /* fresh graph */ }
  cache = defaultAutomationGraph();
  return cache;
}

export async function saveAutomationGraph(graph: AutomationGraph, delayMs = 1200): Promise<boolean> {
  const next = { ...graph, updatedAt: Date.now() };
  cache = next;
  if (!IPC.isNative) return true;
  await writeBndzMetaDebounced(META_KEY, JSON.stringify(next), delayMs);
  return true;
}

export async function saveAutomationGraphNow(graph: AutomationGraph): Promise<boolean> {
  const next = { ...graph, updatedAt: Date.now() };
  cache = next;
  if (!IPC.isNative) return true;
  return flushBndzMeta(META_KEY, JSON.stringify(next));
}

/** Serialize graph for stable autosave compare — excludes volatile timestamps. */
export function stableAutomationJson(graph: AutomationGraph): string {
  const { updatedAt: _u, ...rest } = graph;
  return JSON.stringify(rest);
}

export async function runAutomationGraph(graph: AutomationGraph): Promise<{ ok: boolean; log: string[]; error?: string }> {
  if (!IPC.isNative) return { ok: false, log: [], error: 'Native host required.' };
  return IPC.runAutomationGraph(graph);
}
