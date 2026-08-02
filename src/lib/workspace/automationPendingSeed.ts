import type { AutomationNodeType } from './automationNodeDefs';
import type { AutomationNode, AutomationEdge } from '../automationStore';
import { toWindowsPath } from '../pathUtils';
import { buildSeedPipelineFromPaths } from './automationTemplates';

export type AutomationPendingSeed = {
  type?: AutomationNodeType;
  fields?: Record<string, string>;
  /** Full starter pipeline (preferred over lone trigger). */
  pipeline?: { nodes: AutomationNode[]; edges: AutomationEdge[]; name: string };
  recipeId?: string;
  navigate?: boolean;
};

let pending: AutomationPendingSeed | null = null;

export function queueAutomationSeed(seed: AutomationPendingSeed): void {
  pending = seed;
}

export function consumeAutomationSeed(): AutomationPendingSeed | null {
  const next = pending;
  pending = null;
  return next;
}

export function peekAutomationSeed(): AutomationPendingSeed | null {
  return pending;
}

export function dispatchAutomationFromPin(paths: string[], options?: { navigate?: boolean; fireLive?: boolean }): void {
  const normalized = [...new Set(paths.map(p => toWindowsPath(p)).filter(Boolean))];
  if (!normalized.length) return;
  const pipeline = buildSeedPipelineFromPaths(normalized);
  const seed: AutomationPendingSeed = {
    type: 'spatialPin',
    fields: { paths: normalized.join('\n') },
    pipeline,
    navigate: options?.navigate ?? true,
  };
  queueAutomationSeed(seed);
  window.dispatchEvent(new CustomEvent('bndz-automation-seed', { detail: seed }));
  // Always notify armed spatialPin pipelines (even when opening the editor).
  if (options?.fireLive !== false) {
    void import('../ipcBridge').then(({ IPC }) => {
      void IPC.fireAutomationSpatialPins(normalized);
    });
  }
  if (seed.navigate) {
    window.dispatchEvent(new CustomEvent('bndz-navigate', { detail: { path: '/bndz/automation' } }));
  }
}
