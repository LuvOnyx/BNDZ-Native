import { IPC } from './ipcBridge';
import { flushBndzMeta, writeBndzMetaDebounced } from './bndzMetaStore';

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

export type AutomationGraph = {
  id: string;
  name: string;
  nodes: AutomationNode[];
  edges: AutomationEdge[];
  updatedAt: number;
};

const META_KEY = 'automation_graph_v1';

let cache: AutomationGraph | null = null;

export function defaultAutomationGraph(): AutomationGraph {
  return {
    id: 'default',
    name: 'File pipeline',
    nodes: [
      { id: 'n1', type: 'watchFolder', position: { x: 80, y: 120 }, data: { path: '' } },
      { id: 'n2', type: 'filterArchive', position: { x: 360, y: 120 }, data: { extensions: 'zip,rar,7z' } },
      { id: 'n3', type: 'rsyncDeploy', position: { x: 640, y: 120 }, data: { target: '', remote: '' } },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n3' },
    ],
    updatedAt: Date.now(),
  };
}

export async function loadAutomationGraph(): Promise<AutomationGraph> {
  if (cache) return cache;
  if (!IPC.isNative) {
    cache = defaultAutomationGraph();
    return cache;
  }
  try {
    const raw = await IPC.getBndzMeta(META_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AutomationGraph;
      cache = { ...defaultAutomationGraph(), ...parsed, nodes: parsed.nodes || [], edges: parsed.edges || [] };
      return cache;
    }
  } catch { /* fresh graph */ }
  cache = defaultAutomationGraph();
  return cache;
}

export async function saveAutomationGraph(graph: AutomationGraph, delayMs = 800): Promise<boolean> {
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

export async function runAutomationGraph(graph: AutomationGraph): Promise<{ ok: boolean; log: string[]; error?: string }> {
  if (!IPC.isNative) return { ok: false, log: [], error: 'Native host required.' };
  return IPC.runAutomationGraph(graph);
}
