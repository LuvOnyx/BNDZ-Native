/**
 * Automation lint + dry-run unit checks (no native host required).
 * Staging/Ghost nodes were removed in Launch Ready A1 — do not assert them here.
 */
import { lintAutomationGraph, dryRunGraph, lintErrorCount } from '../src/lib/workspace/automationLint';
import { defaultAutomationGraph } from '../src/lib/automationStore';
import type { AutomationGraph } from '../src/lib/automationStore';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const base: AutomationGraph = {
  ...defaultAutomationGraph(),
  nodes: [
    { id: 't1', type: 'watchFolder', position: { x: 0, y: 0 }, data: { path: 'C:\\Test', liveWatch: 'true' } },
    { id: 'f1', type: 'filterExtension', position: { x: 200, y: 0 }, data: { extensions: 'zip,tar.gz' } },
    { id: 'b1', type: 'branch', position: { x: 400, y: 0 }, data: { condition: 'anyFiles' } },
    { id: 'l1', type: 'log', position: { x: 600, y: 0 }, data: { message: 'done' } },
  ],
  edges: [
    { id: 'e1', source: 't1', target: 'f1' },
    { id: 'e2', source: 'f1', target: 'b1' },
    { id: 'e3', source: 'b1', target: 'l1', sourceHandle: 'true' },
  ],
  armed: true,
};

const lint = lintAutomationGraph(base);
assert(lintErrorCount(lint) === 0, `unexpected lint errors: ${JSON.stringify(lint)}`);
assert(lint.some(i => i.id === 'branch_partial_b1'), 'partial branch should warn about missing no wire');

const cycle = lintAutomationGraph({
  ...base,
  edges: [
    ...base.edges,
    { id: 'ecycle', source: 'l1', target: 'f1' },
  ],
});
assert(cycle.some(i => i.id === 'graph_cycle'), 'cycle should be an error');

const dry = dryRunGraph(base);
assert(dry.length === 4, `dry run should include 4 steps, got ${dry.length}`);
assert(dry.some(s => s.action.includes('Live watch')), 'dry run should describe live watch');
assert(dry.every(s => s.status === 'ok'), 'acyclic dry-run steps should be ok');

console.log('automation lint tests passed');
