import React, { useCallback, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { EmblemIcon } from '../EmblemIcon';
import { IPC } from '../../lib/ipcBridge';
import { pushToast } from '../ToastHost';
import { toWindowsPath } from '../../lib/pathUtils';
import PluginPanelShell from './PluginPanelShell';
import {
  PluginToolbarButton,
  PluginCard,
  PluginEmptyState,
  PluginHeroStrip,
  PluginHeroActionButton,
  PluginStatCard,
  PluginSectionTitle,
  PLUGIN_INPUT_CLASS,
} from './PluginPanelPrimitives';

export const CapacitySolverPluginDef = {
  id: 'capacity-solver',
  name: 'Capacity Solver',
  icon: 'hard_drive_ui',
  description: 'Analyze storage and build cleanup plans to free space on any volume.',
  targetPanel: 'bottom' as const,
  installOnFirstUse: false,
};

type PlanAction = {
  id: string;
  kind: string;
  label: string;
  description: string;
  estimatedBytes: number;
  targetPlugin?: string;
};

type Plan = {
  totalBytes: number;
  freeBytes: number;
  deficitBytes: number;
  targetFreeBytes: number;
  actions: PlanAction[];
};

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

const PLUGIN_HINTS: Record<string, string> = {
  ghostlink: 'ghost-link',
  cleanup: 'storage-cleanup',
  find: 'find',
  archive: 'storage-cleanup',
};

function normalizePlan(raw: Record<string, unknown>): Plan {
  const actions = (Array.isArray(raw.actions ?? raw.Actions) ? (raw.actions ?? raw.Actions) as any[] : []).map((a: any, i: number): PlanAction => {
    const actuator = String(a.actuator ?? a.Actuator ?? '');
    const id = String(a.id ?? a.Id ?? `act_${i}`);
    const kindFromActuator =
      /ghost/i.test(actuator) || /ghost/i.test(id) ? 'ghostlink'
        : /dup|find/i.test(actuator) || /dup/i.test(id) ? 'find'
          : /archive/i.test(actuator) || /archive/i.test(id) ? 'archive'
            : /empty|delete|fileop|cleanup|storage/i.test(actuator) || /empty|delete/i.test(id) ? 'cleanup'
              : String(a.kind ?? a.Kind ?? 'cleanup');
    return {
      id,
      kind: kindFromActuator,
      label: String(a.label ?? a.Label ?? a.title ?? a.Title ?? 'Action'),
      description: String(a.description ?? a.Description ?? a.detail ?? a.Detail ?? ''),
      estimatedBytes: Number(a.estimatedBytes ?? a.EstimatedBytes ?? 0),
      targetPlugin: (a.targetPlugin as string | undefined)
        ?? (a.TargetPlugin as string | undefined)
        ?? PLUGIN_HINTS[kindFromActuator],
    };
  });
  return {
    totalBytes: Number(raw.totalBytes ?? raw.TotalBytes ?? 0),
    freeBytes: Number(raw.freeBytes ?? raw.FreeBytes ?? 0),
    deficitBytes: Number(raw.deficitBytes ?? raw.DeficitBytes ?? 0),
    targetFreeBytes: Number(raw.targetFreeBytes ?? raw.TargetFreeBytes ?? 0),
    actions,
  };
}

const ACTION_ICONS: Record<string, string> = {
  cleanup: 'delete',
  ghostlink: 'emblem_symbolic_link',
  archive: 'folder_open_ui',
  move: 'move_ui',
  find: 'search',
  default: 'zap_ui',
};

export default function CapacitySolverPlugin({
  currentPath,
}: {
  selectedPaths?: string[];
  currentPath?: string;
}) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [targetGb, setTargetGb] = useState('10');

  const buildPlan = useCallback(async () => {
    const target = currentPath && currentPath !== '/' ? toWindowsPath(currentPath) : undefined;
    if (!target) {
      pushToast({ kind: 'warning', title: 'Navigate first', message: 'Open a drive or folder to analyze capacity.' });
      return;
    }
    setBusy(true);
    try {
      const targetBytes = Math.max(1, Number(targetGb) || 10) * 1024 ** 3;
      const r = await IPC.capacityBuildPlan(target, targetBytes);
      if (r.error) throw new Error(r.error);
      setPlan(normalizePlan((r.plan || r) as Record<string, unknown>));
    } catch (e) {
      pushToast({ kind: 'error', title: 'Plan failed', message: String(e) });
    } finally {
      setBusy(false);
    }
  }, [currentPath, targetGb]);

  const approveAction = (action: PlanAction) => {
    const pluginId = action.targetPlugin || PLUGIN_HINTS[action.kind];
    if (pluginId) {
      window.dispatchEvent(new CustomEvent('bndz-open-bottom-plugin', { detail: { id: pluginId } }));
      pushToast({ kind: 'info', title: `Opening ${action.label}`, message: `Estimated ${formatBytes(action.estimatedBytes)} recoverable.` });
    } else {
      pushToast({ kind: 'info', title: 'Action noted', message: action.description });
    }
  };

  const freePct = plan && plan.totalBytes > 0
    ? Math.round((plan.freeBytes / plan.totalBytes) * 100)
    : null;

  const potentialRecovery = plan
    ? plan.actions.reduce((sum, a) => sum + a.estimatedBytes, 0)
    : 0;

  return (
    <PluginPanelShell
      title="Capacity Solver"
      icon="hard_drive_ui"
      iconColor="#c48b4a"
      variant="embedded"
      subtitle="Storage planner · smart cleanup recommendations"
    >
      <div className="flex flex-col min-h-0">
        <PluginHeroStrip
          icon={
            <div className="flex items-center justify-center">
              <EmblemIcon id="drive-removable-media" size={48} />
            </div>
          }
          name="Capacity Solver"
          typeLabel="Storage planner"
          meta={
            plan ? (
              <span className="bndz-panel-muted text-xs">
                {formatBytes(plan.freeBytes)} free of {formatBytes(plan.totalBytes)} · {freePct}%
              </span>
            ) : (
              <span className="bndz-panel-muted text-xs">Build a plan to see storage breakdown</span>
            )
          }
          actions={
            <>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={1}
                  className={`${PLUGIN_INPUT_CLASS} !w-16 text-center`}
                  value={targetGb}
                  onChange={e => setTargetGb(e.target.value)}
                  title="Target free space (GB)"
                />
                <span className="text-[10px] text-gray-500 uppercase">GB target</span>
              </div>
              <PluginHeroActionButton
                icon="search_ui"
                variant="primary"
                onClick={() => void buildPlan()}
                disabled={busy}
              >
                Build plan
              </PluginHeroActionButton>
            </>
          }
        />

        <div className="flex-1 min-h-0 overflow-y-auto bndz-scrollbar">
          {!plan ? (
            <div className="p-5">
              <PluginEmptyState
                icon="hard_drive_ui"
                title="No capacity plan yet"
                description="Set your target free space and build a plan. BNDZ will recommend cleanup, ghost-link, and archive actions."
              />
            </div>
          ) : (
            <div className="p-5 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <PluginStatCard
                  label="Free space"
                  value={formatBytes(plan.freeBytes)}
                  sub={`${freePct}% of ${formatBytes(plan.totalBytes)}`}
                  iconId="hard_drive_ui"
                />
                <PluginStatCard
                  label="Deficit"
                  value={plan.deficitBytes > 0 ? formatBytes(plan.deficitBytes) : 'None'}
                  sub={plan.deficitBytes > 0 ? `Need ${formatBytes(plan.deficitBytes)} more` : 'Target met'}
                  iconId="warning"
                />
                <PluginStatCard
                  label="Potential recovery"
                  value={formatBytes(potentialRecovery)}
                  sub={`${plan.actions.length} action${plan.actions.length === 1 ? '' : 's'} suggested`}
                  iconId="zap_ui"
                />
              </div>

              {plan.totalBytes > 0 && (
                <div className="bndz-plugin-card">
                  <PluginSectionTitle icon="piechart_ui">Volume usage</PluginSectionTitle>
                  <div className="mt-2 h-3 rounded-full bg-black/40 overflow-hidden border border-white/[0.06]">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${100 - (freePct ?? 0)}%`,
                        background: (freePct ?? 0) < 10
                          ? 'linear-gradient(90deg, #ef4444 0%, #dc2626 100%)'
                          : (freePct ?? 0) < 25
                            ? 'linear-gradient(90deg, #f59e0b 0%, #d97706 100%)'
                            : 'linear-gradient(90deg, #3b82f6 0%, #2563eb 100%)',
                      }}
                    />
                  </div>
                  <div className="flex justify-between mt-1.5 text-[10px] text-gray-500">
                    <span>{formatBytes(plan.totalBytes - plan.freeBytes)} used</span>
                    <span>{formatBytes(plan.freeBytes)} free</span>
                  </div>
                </div>
              )}

              {plan.actions.length > 0 && (
                <div>
                  <PluginSectionTitle icon="zap_ui">Recommended actions</PluginSectionTitle>
                  <div className="mt-3 space-y-2">
                    {plan.actions.map(action => (
                      <PluginCard key={action.id} className="bndz-capacity-action-card">
                        <div className="flex items-start gap-3">
                          <Icons8Icon
                            id={ACTION_ICONS[action.kind] || ACTION_ICONS.default}
                            size={18}
                            className="text-amber-400/80 shrink-0 mt-0.5"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold text-white">{action.label}</div>
                            <div className="text-[11px] text-gray-400 mt-0.5 leading-snug">{action.description}</div>
                            <div className="text-[10px] text-amber-300/80 mt-1 font-medium">
                              ~{formatBytes(action.estimatedBytes)} recoverable
                            </div>
                          </div>
                          <PluginToolbarButton
                            icon="check"
                            onClick={() => approveAction(action)}
                          >
                            Approve
                          </PluginToolbarButton>
                        </div>
                      </PluginCard>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </PluginPanelShell>
  );
}
