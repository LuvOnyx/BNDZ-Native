import type { AutomationGraph } from '../automationStore';

export type LintIssue = {
  id: string;
  severity: 'error' | 'warn';
  nodeId?: string;
  message: string;
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

  graph.nodes.forEach(n => {
    const def = n.type;
    if (def === 'watchFolder') {
      const path = String(n.data.path ?? '').trim();
      if (!path) {
        issues.push({
          id: `watch_path_${n.id}`,
          severity: 'error',
          nodeId: n.id,
          message: 'Watch folder needs a path',
        });
      }
    }
    if (def === 'copyTo' || def === 'moveTo') {
      const dest = String(n.data.dest ?? '').trim();
      if (!dest) {
        issues.push({
          id: `dest_${n.id}`,
          severity: 'error',
          nodeId: n.id,
          message: `${def === 'copyTo' ? 'Copy' : 'Move'} block needs a destination`,
        });
      }
    }
    if (def === 'rsyncDeploy') {
      const remote = String(n.data.remote ?? '').trim();
      if (!remote) {
        issues.push({
          id: `remote_${n.id}`,
          severity: 'error',
          nodeId: n.id,
          message: 'Remote deploy needs a target (user@host:/path)',
        });
      }
    }
    const inc = incoming.get(n.id) ?? 0;
    const out = outgoing.get(n.id) ?? 0;
    if (def !== 'watchFolder' && inc === 0) {
      issues.push({
        id: `disconnected_${n.id}`,
        severity: 'warn',
        nodeId: n.id,
        message: 'Node has no incoming connection',
      });
    }
    if (out === 0 && def !== 'log' && def !== 'copyTo' && def !== 'moveTo' && def !== 'rsyncDeploy') {
      issues.push({
        id: `dead_end_${n.id}`,
        severity: 'warn',
        nodeId: n.id,
        message: 'Node has no outgoing connection',
      });
    }
  });

  if (!graph.nodes.some(n => n.type === 'watchFolder')) {
    issues.push({
      id: 'no_trigger',
      severity: 'warn',
      message: 'Pipeline has no watch-folder trigger',
    });
  }

  return issues;
}

export type DryRunStep = {
  nodeId: string;
  label: string;
  action: string;
  status: 'pending' | 'ok' | 'skip';
};

export function dryRunGraph(graph: AutomationGraph): DryRunStep[] {
  const order = topologicalOrder(graph);
  return order.map(n => {
    const label = n.type;
    let action = 'Pass through';
    if (n.type === 'watchFolder') action = `Watch ${n.data.path || '(unset)'}`;
    else if (n.type === 'filterExtension') action = `Filter ext: ${n.data.extensions || '*'}`;
    else if (n.type === 'copyTo') action = `Copy → ${n.data.dest || '(unset)'}`;
    else if (n.type === 'moveTo') action = `Move → ${n.data.dest || '(unset)'}`;
    else if (n.type === 'rsyncDeploy') action = `Rsync → ${n.data.remote || '(unset)'}`;
    else if (n.type === 'log') action = `Log: ${n.data.message || 'checkpoint'}`;
    return {
      nodeId: n.id,
      label,
      action,
      status: 'pending' as const,
    };
  });
}

function topologicalOrder(graph: AutomationGraph) {
  const nodes = [...graph.nodes];
  const triggers = nodes.filter(n => n.type === 'watchFolder');
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
