import type { AutomationGraph } from '../automationStore';
import { NODE_DEFS, isTriggerType, FOLDER_FIELD_KEYS, type AutomationNodeType } from './automationNodeDefs';
import { formatUiPath } from '../displayPath';

export type LintIssue = {
  id: string;
  severity: 'error' | 'warn';
  nodeId?: string;
  message: string;
};

const TERMINAL_TYPES = new Set<AutomationNodeType>([
  'log', 'notifyToast', 'recycleBin', 'delay', 'moveTo', 'copyTo', 'rsyncDeploy', 'runShell',
  'compressArchive', 'extractArchive', 'syncFolders', 'generateThumbnail', 'stopAbort',
  'ghostLinkTo', 'stageToRam', 'script', 'healthGate', 'sandboxCheckpoint', 'capacityApprove', 'branchCreate',
]);

/** Fields that must be non-empty for the given block type. */
const REQUIRED_FIELDS: Partial<Record<AutomationNodeType, string[]>> = {
  watchFolder: ['path'],
  copyTo: ['dest'],
  moveTo: ['dest'],
  rsyncDeploy: ['remote'],
  ghostLinkTo: ['coldStorageRoot'],
  compressArchive: ['dest'],
  extractArchive: ['dest'],
  syncFolders: ['dest'],
  generateThumbnail: ['dest'],
  applyTag: ['tag'],
  filterTag: ['tag'],
  filterContent: ['pattern'],
  runShell: ['command'],
  script: ['code'],
  sandboxCheckpoint: ['sessionId'],
  branchCreate: ['sourcePath', 'branchName'],
  onSchedule: ['intervalMinutes'],
  stopAbort: ['message'],
  batchCounter: ['limit'],
};

export function lintAutomationGraph(graph: AutomationGraph): LintIssue[] {
  const issues: LintIssue[] = [];
  const nodeIds = new Set(graph.nodes.map(n => n.id));
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();

  graph.nodes.forEach(n => {
    incoming.set(n.id, 0);
    outgoing.set(n.id, 0);
  });

  graph.edges.forEach(e => {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) {
      issues.push({
        id: `orphan_edge_${e.id}`,
        severity: 'error',
        message: 'Edge references a missing node',
      });
      return;
    }
    incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1);
    outgoing.set(e.source, (outgoing.get(e.source) ?? 0) + 1);
  });

  // Cycle detection (directed)
  const adj = new Map<string, string[]>();
  graph.nodes.forEach(n => adj.set(n.id, []));
  graph.edges.forEach(e => {
    if (nodeIds.has(e.source) && nodeIds.has(e.target)) {
      adj.get(e.source)!.push(e.target);
    }
  });
  const cycleVisit = new Map<string, 0 | 1 | 2>();
  const cycleHit = new Set<string>();
  const dfsCycle = (id: string): boolean => {
    const st = cycleVisit.get(id) ?? 0;
    if (st === 1) { cycleHit.add(id); return true; }
    if (st === 2) return false;
    cycleVisit.set(id, 1);
    let found = false;
    for (const next of adj.get(id) || []) {
      if (dfsCycle(next)) found = true;
    }
    cycleVisit.set(id, 2);
    return found;
  };
  graph.nodes.forEach(n => dfsCycle(n.id));
  if (cycleHit.size) {
    issues.push({
      id: 'graph_cycle',
      severity: 'error',
      nodeId: [...cycleHit][0],
      message: 'Pipeline contains a cycle — loops are not supported',
    });
  }

  graph.nodes.forEach(n => {
    const def = NODE_DEFS[n.type];
    if (!def) {
      issues.push({ id: `unknown_${n.id}`, severity: 'error', nodeId: n.id, message: `Unknown block type: ${n.type}` });
      return;
    }

    const req = REQUIRED_FIELDS[n.type];
    if (req) {
      for (const key of req) {
        const field = def.fields.find(f => f.key === key);
        const val = String(n.data[key] ?? '').trim();
        if (!val) {
          issues.push({
            id: `${key}_${n.id}`,
            severity: 'error',
            nodeId: n.id,
            message: `${def.label}: ${field?.label || key} is required`,
          });
        }
      }
    }

    if (n.type === 'onSchedule') {
      const mins = Number(String(n.data.intervalMinutes ?? '').trim());
      if (String(n.data.intervalMinutes ?? '').trim() && (!Number.isFinite(mins) || mins < 1)) {
        issues.push({
          id: `interval_${n.id}`,
          severity: 'error',
          nodeId: n.id,
          message: 'On schedule: interval must be at least 1 minute',
        });
      }
    }

    if (n.type === 'stageToRam') {
      const sizeRaw = String(n.data.sizeBudgetMb ?? '').trim();
      if (sizeRaw) {
        const nMb = Number(sizeRaw.replace(/[MmBb]/g, ''));
        if (!Number.isFinite(nMb) || nMb < 256) {
          issues.push({
            id: `ram_size_${n.id}`,
            severity: 'warn',
            nodeId: n.id,
            message: 'Stage to RAM: size budget should be ≥ 256 MB',
          });
        }
      }
    }

    if (n.type === 'filterExtension' || n.type === 'filterArchive') {
      const ext = String(n.data.extensions ?? '').trim();
      if (ext && !/^[\w.*,;\s.-]+$/i.test(ext)) {
        issues.push({
          id: `ext_${n.id}`,
          severity: 'warn',
          nodeId: n.id,
          message: `${def.label}: extensions look invalid (use comma-separated, e.g. zip,tar.gz)`,
        });
      }
    }

    if (n.type === 'branch') {
      const trueOut = graph.edges.some(e => e.source === n.id && e.sourceHandle === 'true');
      const falseOut = graph.edges.some(e => e.source === n.id && e.sourceHandle === 'false');
      if (!trueOut && !falseOut) {
        issues.push({
          id: `branch_unwired_${n.id}`,
          severity: 'warn',
          nodeId: n.id,
          message: 'Branch has no true/false outputs connected',
        });
      } else if (!trueOut || !falseOut) {
        issues.push({
          id: `branch_partial_${n.id}`,
          severity: 'warn',
          nodeId: n.id,
          message: `Branch missing ${!trueOut ? 'yes' : 'no'} output wire`,
        });
      }
    }

    const inc = incoming.get(n.id) ?? 0;
    const out = outgoing.get(n.id) ?? 0;
    if (!isTriggerType(n.type) && inc === 0) {
      issues.push({
        id: `disconnected_${n.id}`,
        severity: 'warn',
        nodeId: n.id,
        message: `${def.label}: no incoming connection`,
      });
    }
    if (out === 0 && !TERMINAL_TYPES.has(n.type) && n.type !== 'branch') {
      issues.push({
        id: `dead_end_${n.id}`,
        severity: 'warn',
        nodeId: n.id,
        message: `${def.label}: no outgoing connection`,
      });
    }
  });

  if (!graph.nodes.some(n => isTriggerType(n.type))) {
    issues.push({
      id: 'no_trigger',
      severity: 'warn',
      message: 'Pipeline has no trigger block',
    });
  }

  if (graph.armed && graph.nodes.some(n => n.type === 'watchFolder' && String(n.data.liveWatch) === 'true')) {
    graph.nodes
      .filter(n => n.type === 'watchFolder' && String(n.data.liveWatch) === 'true' && !String(n.data.path ?? '').trim())
      .forEach(n => {
        issues.push({
          id: `live_path_${n.id}`,
          severity: 'error',
          nodeId: n.id,
          message: 'Live watch requires a folder path',
        });
      });
  }

  // Prefer errors first, then warns; stable by message
  return issues.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
    return a.message.localeCompare(b.message);
  });
}

export function lintErrorCount(issues: LintIssue[]): number {
  return issues.filter(i => i.severity === 'error').length;
}

export type DryRunStep = {
  nodeId: string;
  label: string;
  action: string;
  status: 'pending' | 'ok' | 'skip';
};

export function dryRunGraph(graph: AutomationGraph): DryRunStep[] {
  const order = topologicalOrder(graph);
  const hasCycle = lintAutomationGraph(graph).some(i => i.id === 'graph_cycle');
  return order.map((n, idx) => ({
    nodeId: n.id,
    label: NODE_DEFS[n.type]?.label || n.type,
    action: describeDryRunAction(n),
    status: hasCycle && idx > 0 ? 'skip' as const : 'ok' as const,
  }));
}

function describeDryRunAction(n: AutomationGraph['nodes'][number]): string {
  const d = n.data;
  const pathLabel = (raw: unknown) => {
    const s = String(raw || '').trim();
    return s ? formatUiPath(s) : '';
  };
  switch (n.type) {
    case 'watchFolder': {
      const live = String(d.liveWatch) === 'true';
      const p = pathLabel(d.path) || '(unset)';
      return live ? `Live watch ${p}` : `Scan ${p}`;
    }
    case 'manualRun': return 'Manual trigger';
    case 'onSchedule': return `Schedule every ${d.intervalMinutes || '60'} min`;
    case 'onStartup': return 'Run on BNDZ startup';
    case 'indexChanged': return `Index changed${d.root ? ` · ${pathLabel(d.root)}` : ''}`;
    case 'spatialPin': return `Spatial pin (${String(d.paths || '').split('\n').filter(Boolean).length} paths)`;
    case 'filterExtension': return `Filter ext: ${d.extensions || '*'}`;
    case 'filterArchive': return `Archives: ${d.extensions || 'default'}`;
    case 'filterSize': return `Size ${d.minSize || '0'} – ${d.maxSize || '∞'}`;
    case 'filterAge': return `${d.mode || 'olderThan'} ${d.days || '7'} days`;
    case 'filterTag': return `Tag: ${d.tag || '(unset)'}`;
    case 'filterContent': return `Grep: ${d.pattern || '(unset)'}`;
    case 'duplicatesOnly': return `Duplicates ≥ ${d.minSize || '1KB'}`;
    case 'copyTo': return `Copy → ${pathLabel(d.dest) || '(unset)'}`;
    case 'moveTo': return `Move → ${pathLabel(d.dest) || '(unset)'}`;
    case 'rsyncDeploy': return `Deploy → ${d.remote || '(unset)'}`;
    case 'ghostLinkTo': return `Ghost-Link → ${pathLabel(d.coldStorageRoot) || '(unset)'}`;
    case 'stageToRam': {
      const zoneId = String(d.zoneId || '').trim();
      if (zoneId) return `Stage → zone ${zoneId}`;
      return `Stage → ${d.zoneName || 'Automation Staging'} (${d.sizeBudgetMb || '4096'} MB)`;
    }
    case 'recycleBin': return 'Send to Recycle Bin';
    case 'compressArchive': return `Compress → ${pathLabel(d.dest) || '(unset)'}`;
    case 'extractArchive': return `Extract → ${pathLabel(d.dest) || '(unset)'}`;
    case 'syncFolders': return `Sync → ${pathLabel(d.dest) || '(unset)'}`;
    case 'generateThumbnail': return `Thumbnails → ${pathLabel(d.dest) || '(unset)'}`;
    case 'applyTag': return `Tag "${d.tag || '(unset)'}"`;
    case 'notifyToast': return `Toast: ${d.title || 'BNDZ'}`;
    case 'runShell': return `Shell: ${d.command || '(unset)'}`;
    case 'script': return `C# Script (${String(d.code || '').length} chars)`;
    case 'healthGate': return `Health gate: max ${d.maxErrors || '0'} errors`;
    case 'sandboxCheckpoint': return `Sandbox checkpoint: ${d.label || 'auto'}`;
    case 'capacityApprove': return `Capacity ≥ ${d.requiredMb || '512'} MB on ${d.drive || 'auto'}`;
    case 'branchCreate': return `Branch "${d.branchName || '(unset)'}" from ${pathLabel(d.sourcePath) || '(unset)'}`;
    case 'branch': return `Branch: ${d.condition || 'anyFiles'}`;
    case 'delay': return `Wait ${d.seconds || '1'}s`;
    case 'stopAbort': return `Abort: ${d.message || 'stop'}`;
    case 'batchCounter': return `First ${d.limit || '50'} files`;
    case 'log': return `Log: ${d.message || 'checkpoint'}`;
    default: return 'Pass through';
  }
}

function topologicalOrder(graph: AutomationGraph) {
  const nodes = [...graph.nodes];
  const triggers = nodes.filter(n => isTriggerType(n.type));
  const visited = new Set<string>();
  const out: typeof nodes = [];
  const walk = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    const node = nodes.find(n => n.id === id);
    if (node) out.push(node);
    graph.edges.filter(e => e.source === id).forEach(e => walk(e.target));
  };
  if (triggers.length) triggers.forEach(t => walk(t.id));
  nodes.forEach(n => { if (!visited.has(n.id)) out.push(n); });
  return out;
}

export { FOLDER_FIELD_KEYS };
