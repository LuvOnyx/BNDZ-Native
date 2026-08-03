/**
 * Automation lint + dry-run unit checks (no native host required).
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

const missingGhost = lintAutomationGraph({
  ...base,
  nodes: [
    ...base.nodes,
    { id: 'g1', type: 'ghostLinkTo', position: { x: 0, y: 100 }, data: {} },
  ],
  edges: [...base.edges, { id: 'e4', source: 'f1', target: 'g1' }],
});
assert(missingGhost.some(i => i.message.includes('Cold storage')), 'ghostLinkTo should require cold storage');

const stageLint = lintAutomationGraph({
  ...base,
  nodes: [
    ...base.nodes,
    { id: 'r1', type: 'stageToRam', position: { x: 0, y: 160 }, data: { sizeBudgetMb: '32' } },
  ],
  edges: [...base.edges, { id: 'e5', source: 'f1', target: 'r1' }],
});
assert(stageLint.some(i => i.id === 'ram_size_r1'), 'stageToRam should warn on tiny budget');

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

const dryRam = dryRunGraph({
  ...base,
  nodes: [
    ...base.nodes,
    { id: 'r1', type: 'stageToRam', position: { x: 0, y: 200 }, data: { zoneName: 'Auto', sizeBudgetMb: '2048' } },
  ],
  edges: [...base.edges, { id: 'e6', source: 'f1', target: 'r1' }],
});
assert(dryRam.some(s => s.action.includes('Stage → Auto')), 'dry run should describe stageToRam');

console.log('automation lint tests passed');
