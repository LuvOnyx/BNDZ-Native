import { IPC } from './ipcBridge';
import { flushBndzMeta, readBndzMeta, writeBndzMetaDebounced } from './bndzMetaStore';
import type { AutomationNodeType } from './workspace/automationNodeDefs';

export type { AutomationNodeType } from './workspace/automationNodeDefs';

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
  sourceHandle?: string;
};

export type AutomationViewport = { x: number; y: number; zoom: number };

export type AutomationGraph = {
  id: string;
  name: string;
  nodes: AutomationNode[];
  edges: AutomationEdge[];
  viewport?: AutomationViewport;
  armed?: boolean;
  updatedAt: number;
};

export type AutomationLibrary = {
  activeId: string;
  pipelines: AutomationGraph[];
  updatedAt: number;
};

const GRAPH_META_KEY = 'automation_graph_v1';
const LIBRARY_META_KEY = 'automation_library_v1';

let cache: AutomationGraph | null = null;
let libraryCache: AutomationLibrary | null = null;

export function defaultAutomationViewport(): AutomationViewport {
  return { x: 0, y: 0, zoom: 0.9 };
}

export function defaultAutomationGraph(id = 'default', name = 'File pipeline'): AutomationGraph {
  return {
    id,
    name,
    nodes: [],
    edges: [],
    viewport: defaultAutomationViewport(),
    armed: false,
    updatedAt: Date.now(),
  };
}

function defaultLibrary(): AutomationLibrary {
  const graph = defaultAutomationGraph();
  return {
    activeId: graph.id,
    pipelines: [graph],
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
  const base = defaultAutomationGraph(parsed.id || 'default', parsed.name || 'File pipeline');
  const hasPersistedGraph = Array.isArray(parsed.nodes) || Array.isArray(parsed.edges);
  return {
    ...base,
    ...parsed,
    nodes: Array.isArray(parsed.nodes) ? parsed.nodes : (hasPersistedGraph ? [] : base.nodes),
    edges: Array.isArray(parsed.edges) ? parsed.edges : (hasPersistedGraph ? [] : base.edges),
    viewport: parseViewport(parsed.viewport),
    armed: parsed.armed === true,
    updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
  };
}

function parseLibrary(parsed: Partial<AutomationLibrary>): AutomationLibrary {
  const base = defaultLibrary();
  const pipelines = Array.isArray(parsed.pipelines)
    ? parsed.pipelines.map(p => parseAutomationGraph(p))
    : base.pipelines;
  const activeId = typeof parsed.activeId === 'string' && pipelines.some(p => p.id === parsed.activeId)
    ? parsed.activeId
    : pipelines[0]?.id || base.activeId;
  return {
    activeId,
    pipelines,
    updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
  };
}

export function invalidateAutomationCache(): void {
  cache = null;
  libraryCache = null;
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

export function hydrateAutomationLibraryFromJson(json: string): AutomationLibrary | null {
  try {
    const lib = parseLibrary(JSON.parse(json) as Partial<AutomationLibrary>);
    libraryCache = lib;
    const active = lib.pipelines.find(p => p.id === lib.activeId) || lib.pipelines[0];
    if (active) cache = active;
    return lib;
  } catch {
    return null;
  }
}

async function migrateLegacyGraphIfNeeded(): Promise<AutomationLibrary | null> {
  try {
    const legacy = await readBndzMeta(GRAPH_META_KEY);
    if (!legacy) return null;
    const graph = parseAutomationGraph(JSON.parse(legacy) as Partial<AutomationGraph>);
    const lib: AutomationLibrary = {
      activeId: graph.id,
      pipelines: [graph],
      updatedAt: Date.now(),
    };
    libraryCache = lib;
    cache = graph;
    if (IPC.isNative) await flushBndzMeta(LIBRARY_META_KEY, JSON.stringify(lib));
    return lib;
  } catch {
    return null;
  }
}

export async function loadAutomationLibrary(options?: { force?: boolean }): Promise<AutomationLibrary> {
  if (libraryCache && !options?.force) return libraryCache;
  try {
    const raw = await readBndzMeta(LIBRARY_META_KEY);
    if (raw) {
      libraryCache = parseLibrary(JSON.parse(raw) as Partial<AutomationLibrary>);
      const active = libraryCache.pipelines.find(p => p.id === libraryCache!.activeId) || libraryCache.pipelines[0];
      if (active) cache = active;
      return libraryCache;
    }
  } catch { /* migrate */ }
  const migrated = await migrateLegacyGraphIfNeeded();
  if (migrated) return migrated;
  libraryCache = defaultLibrary();
  cache = libraryCache.pipelines[0];
  return libraryCache;
}

export async function loadAutomationGraph(options?: { force?: boolean }): Promise<AutomationGraph> {
  const lib = await loadAutomationLibrary(options);
  const active = lib.pipelines.find(p => p.id === lib.activeId) || lib.pipelines[0];
  cache = active;
  return active;
}

export async function saveAutomationLibrary(lib: AutomationLibrary): Promise<boolean> {
  const next: AutomationLibrary = { ...lib, updatedAt: Date.now() };
  libraryCache = next;
  const active = next.pipelines.find(p => p.id === next.activeId);
  if (active) cache = active;
  if (!IPC.isNative) return true;
  return flushBndzMeta(LIBRARY_META_KEY, JSON.stringify(next));
}

export async function saveAutomationGraph(graph: AutomationGraph, delayMs = 1200): Promise<boolean> {
  const next = { ...graph, updatedAt: Date.now() };
  cache = next;
  const lib = await loadAutomationLibrary();
  const idx = lib.pipelines.findIndex(p => p.id === next.id);
  const pipelines = [...lib.pipelines];
  if (idx >= 0) pipelines[idx] = next;
  else pipelines.push(next);
  const updatedLib: AutomationLibrary = {
    ...lib,
    activeId: next.id,
    pipelines,
    updatedAt: Date.now(),
  };
  libraryCache = updatedLib;
  if (!IPC.isNative) return true;
  await writeBndzMetaDebounced(LIBRARY_META_KEY, JSON.stringify(updatedLib), delayMs);
  await writeBndzMetaDebounced(GRAPH_META_KEY, JSON.stringify(next), delayMs);
  return true;
}

export async function resetAutomationGraphPersisted(): Promise<AutomationGraph> {
  const empty = defaultAutomationGraph();
  cache = empty;
  libraryCache = defaultLibrary();
  try { localStorage.removeItem(`bndz_meta_${GRAPH_META_KEY}`); } catch { /* */ }
  try { localStorage.removeItem(`bndz_meta_${LIBRARY_META_KEY}`); } catch { /* */ }
  if (IPC.isNative) {
    await flushBndzMeta(LIBRARY_META_KEY, JSON.stringify(libraryCache));
    await flushBndzMeta(GRAPH_META_KEY, JSON.stringify(empty));
  }
  return empty;
}

export async function saveAutomationGraphNow(graph: AutomationGraph): Promise<boolean> {
  const next = { ...graph, updatedAt: Date.now() };
  cache = next;
  const lib = await loadAutomationLibrary();
  const idx = lib.pipelines.findIndex(p => p.id === next.id);
  const pipelines = [...lib.pipelines];
  if (idx >= 0) pipelines[idx] = next;
  else pipelines.push(next);
  const updatedLib: AutomationLibrary = {
    ...lib,
    activeId: next.id,
    pipelines,
    updatedAt: Date.now(),
  };
  libraryCache = updatedLib;
  if (!IPC.isNative) return true;
  await flushBndzMeta(LIBRARY_META_KEY, JSON.stringify(updatedLib));
  await flushBndzMeta(GRAPH_META_KEY, JSON.stringify(next));
  return true;
}

export function createPipeline(name: string): AutomationGraph {
  const id = `pipe_${Date.now()}`;
  return defaultAutomationGraph(id, name);
}

export function stableAutomationJson(graph: AutomationGraph): string {
  const { updatedAt: _u, ...rest } = graph;
  return JSON.stringify(rest);
}

export type AutomationLiveStatus = {
  watchers: Array<{
    path: string;
    pipelineName: string;
    live: boolean;
    lastTriggeredAt?: number;
    lastError?: string;
  }>;
  schedules: Array<{
    nodeId: string;
    pipelineName: string;
    intervalMinutes: number;
    active: boolean;
    lastTriggeredAt?: number;
    lastError?: string;
  }>;
};

export async function runAutomationGraph(graph: AutomationGraph): Promise<{ ok: boolean; log: string[]; error?: string }> {
  if (!IPC.isNative) return { ok: false, log: [], error: 'Native host required.' };
  return IPC.runAutomationGraph(graph);
}

export async function syncAutomationLive(graph: AutomationGraph): Promise<AutomationLiveStatus | null> {
  if (!IPC.isNative) return null;
  return IPC.syncAutomationLive(graph);
}

/**
 * Rehydrate all armed pipelines at host boot so watchers / schedules / onStartup
 * work without opening the Automation view first.
 */
let bootRestorePromise: Promise<number> | null = null;
export async function restoreArmedAutomationsOnBoot(): Promise<number> {
  if (!IPC.isNative) return 0;
  if (bootRestorePromise) return bootRestorePromise;
  bootRestorePromise = (async () => {
    try {
      const lib = await loadAutomationLibrary({ force: true });
      const armed = lib.pipelines.filter(p => p.armed);
      for (const graph of armed) {
        await syncAutomationLive(graph);
      }
      return armed.length;
    } catch {
      return 0;
    }
  })();
  return bootRestorePromise;
}

export async function getAutomationLiveStatus(): Promise<AutomationLiveStatus | null> {
  if (!IPC.isNative) return null;
  return IPC.getAutomationLiveStatus();
}

export type AutomationRunRecord = {
  id: string;
  pipelineId: string;
  pipelineName: string;
  startedAt: number;
  ok: boolean;
  log: string[];
  error?: string;
};

const RUN_HISTORY_KEY = 'automation_run_history_v1';
const RUN_HISTORY_MAX = 40;

export function loadAutomationRunHistory(limit = RUN_HISTORY_MAX): AutomationRunRecord[] {
  try {
    const raw = localStorage.getItem(RUN_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AutomationRunRecord[];
    return Array.isArray(parsed) ? parsed.slice(0, limit) : [];
  } catch {
    return [];
  }
}

export function appendAutomationRunRecord(
  record: Omit<AutomationRunRecord, 'id'>,
): AutomationRunRecord[] {
  const entry: AutomationRunRecord = {
    ...record,
    id: `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  };
  const next = [entry, ...loadAutomationRunHistory(RUN_HISTORY_MAX - 1)];
  try { localStorage.setItem(RUN_HISTORY_KEY, JSON.stringify(next)); } catch { /* */ }
  return next;
}

function remapGraphIds(graph: AutomationGraph, newId: string, newName: string): AutomationGraph {
  const idMap = new Map<string, string>();
  graph.nodes.forEach((n, i) => {
    idMap.set(n.id, `n_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 5)}`);
  });
  return {
    ...graph,
    id: newId,
    name: newName,
    armed: false,
    updatedAt: Date.now(),
    nodes: graph.nodes.map(n => ({
      ...n,
      id: idMap.get(n.id) || n.id,
    })),
    edges: graph.edges.map((e, i) => ({
      ...e,
      id: `e_${Date.now()}_${i}`,
      source: idMap.get(e.source) || e.source,
      target: idMap.get(e.target) || e.target,
    })),
  };
}

export async function deletePipeline(id: string): Promise<AutomationLibrary | null> {
  const lib = await loadAutomationLibrary();
  if (lib.pipelines.length <= 1) return null;
  const pipelines = lib.pipelines.filter(p => p.id !== id);
  if (pipelines.length === lib.pipelines.length) return null;
  const activeId = lib.activeId === id ? pipelines[0].id : lib.activeId;
  const updatedLib: AutomationLibrary = { activeId, pipelines, updatedAt: Date.now() };
  libraryCache = updatedLib;
  cache = pipelines.find(p => p.id === activeId) || pipelines[0];
  if (IPC.isNative) await flushBndzMeta(LIBRARY_META_KEY, JSON.stringify(updatedLib));
  return updatedLib;
}

export async function duplicatePipeline(id: string): Promise<{ lib: AutomationLibrary; graph: AutomationGraph } | null> {
  const lib = await loadAutomationLibrary();
  const src = lib.pipelines.find(p => p.id === id);
  if (!src) return null;
  const newId = `pipe_${Date.now()}`;
  const graph = remapGraphIds(src, newId, `${src.name} copy`);
  const updatedLib: AutomationLibrary = {
    activeId: newId,
    pipelines: [...lib.pipelines, graph],
    updatedAt: Date.now(),
  };
  libraryCache = updatedLib;
  cache = graph;
  if (IPC.isNative) await flushBndzMeta(LIBRARY_META_KEY, JSON.stringify(updatedLib));
  return { lib: updatedLib, graph };
}

export function exportPipelineJson(graph: AutomationGraph): string {
  return JSON.stringify({
    format: 'bndz-automation-pipeline',
    version: 1,
    exportedAt: Date.now(),
    graph: JSON.parse(stableAutomationJson(graph)),
  }, null, 2);
}

export function importPipelineFromJson(raw: string, fallbackName = 'Imported pipeline'): AutomationGraph | null {
  try {
    const parsed = JSON.parse(raw) as { graph?: Partial<AutomationGraph>; format?: string };
    const payload = parsed.graph ?? (parsed as Partial<AutomationGraph>);
    const graph = parseAutomationGraph({
      ...payload,
      id: `pipe_${Date.now()}`,
      name: payload.name || fallbackName,
      armed: false,
    });
    return graph;
  } catch {
    return null;
  }
}

export async function addPipelineToLibrary(graph: AutomationGraph): Promise<AutomationLibrary> {
  const lib = await loadAutomationLibrary();
  const updatedLib: AutomationLibrary = {
    activeId: graph.id,
    pipelines: [...lib.pipelines, graph],
    updatedAt: Date.now(),
  };
  libraryCache = updatedLib;
  cache = graph;
  if (IPC.isNative) await flushBndzMeta(LIBRARY_META_KEY, JSON.stringify(updatedLib));
  return updatedLib;
}
