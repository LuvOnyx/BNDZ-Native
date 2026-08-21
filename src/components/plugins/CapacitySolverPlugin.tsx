import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  PluginTabStrip,
  PluginTab,
} from './PluginPanelPrimitives';

export const CapacitySolverPluginDef = {
  id: 'capacity-solver',
  name: 'Capacity Solver',
  icon: 'hard_drive_ui',
  description: 'What-if capacity planner with scrubbers, projected outcomes, and budget governor.',
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
  selected: boolean;
};

type Projection = {
  currentFreeBytes: number;
  projectedFreeBytes: number;
  totalBytes: number;
  totalReclaimable: number;
  projectedFreePct: number;
  meetsTarget: boolean;
  targetFreeBytes: number;
  actions: PlanAction[];
};

type Scrubbers = {
  keepHotDays: number;
  recencyDays: number;
  minFileSizeMb: number;
  includeDuplicates: boolean;
  includeGhostOffload: boolean;
  includeArchive: boolean;
  includeEmptyDirs: boolean;
};

type BudgetPolicy = {
  volumeRoot: string;
  enforcement: 'off' | 'soft' | 'hard';
  softLimitGb: string;
  hardLimitGb: string;
  enabled: boolean;
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

function classifyAction(id: string, actuator: string): string {
  if (/ghost/i.test(actuator) || /ghost/i.test(id)) return 'ghostlink';
  if (/dup|find/i.test(actuator) || /dup/i.test(id)) return 'find';
  if (/archive/i.test(actuator) || /archive/i.test(id)) return 'archive';
  if (/empty|delete|fileop|cleanup|storage/i.test(actuator) || /empty|delete/i.test(id)) return 'cleanup';
  return 'cleanup';
}

function normalizeProjection(raw: Record<string, unknown>): Projection {
  const actionsRaw = (Array.isArray(raw.actions ?? raw.Actions) ? (raw.actions ?? raw.Actions) as any[] : []);
  const actions = actionsRaw.map((a: any, i: number): PlanAction => {
    const actuator = String(a.actuator ?? a.Actuator ?? '');
    const id = String(a.id ?? a.Id ?? `act_${i}`);
    const kind = classifyAction(id, actuator);
    return {
      id,
      kind,
      label: String(a.title ?? a.Title ?? a.label ?? a.Label ?? 'Action'),
      description: String(a.detail ?? a.Detail ?? a.description ?? a.Description ?? ''),
      estimatedBytes: Number(a.estimatedBytes ?? a.EstimatedBytes ?? 0),
      targetPlugin: PLUGIN_HINTS[kind],
      selected: a.selected !== false && a.Selected !== false,
    };
  });
  return {
    currentFreeBytes: Number(raw.currentFreeBytes ?? raw.CurrentFreeBytes ?? 0),
    projectedFreeBytes: Number(raw.projectedFreeBytes ?? raw.ProjectedFreeBytes ?? 0),
    totalBytes: Number(raw.totalBytes ?? raw.TotalBytes ?? 0),
    totalReclaimable: Number(raw.totalReclaimable ?? raw.TotalReclaimable ?? 0),
    projectedFreePct: Number(raw.projectedFreePct ?? raw.ProjectedFreePct ?? 0),
    meetsTarget: !!(raw.meetsTarget ?? raw.MeetsTarget),
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

const DEFAULT_SCRUBBERS: Scrubbers = {
  keepHotDays: 90,
  recencyDays: 30,
  minFileSizeMb: 10,
  includeDuplicates: true,
  includeGhostOffload: true,
  includeArchive: true,
  includeEmptyDirs: true,
};

function volumeRootFromPath(winPath: string): string {
  const m = winPath.match(/^([A-Za-z]:)\\/);
  return m ? `${m[1].toUpperCase()}\\` : winPath;
}

function ScrubberRow({
  label,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (n: number) => void;
}) {
  return (
    <label className="bndz-capacity-scrubber">
      <div className="bndz-capacity-scrubber-head">
        <span>{label}</span>
        <span className="bndz-capacity-scrubber-value">{value}{unit}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="bndz-capacity-range"
      />
    </label>
  );
}

function ToggleChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`bndz-capacity-toggle${active ? ' is-on' : ''}`}
    >
      {children}
    </button>
  );
}

export default function CapacitySolverPlugin({
  currentPath,
}: {
  selectedPaths?: string[];
  currentPath?: string;
}) {
  const [tab, setTab] = useState<'whatif' | 'budget'>('whatif');
  const [projection, setProjection] = useState<Projection | null>(null);
  const [busy, setBusy] = useState(false);
  const [approving, setApproving] = useState(false);
  const [targetGb, setTargetGb] = useState('10');
  const [scrubbers, setScrubbers] = useState<Scrubbers>(DEFAULT_SCRUBBERS);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [budget, setBudget] = useState<BudgetPolicy>({
    volumeRoot: '',
    enforcement: 'off',
    softLimitGb: '80',
    hardLimitGb: '95',
    enabled: true,
  });
  const [budgetBusy, setBudgetBusy] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoRanRef = useRef(false);

  const resolveTarget = useCallback(() => {
    if (!currentPath || currentPath === '/') return undefined;
    return toWindowsPath(currentPath);
  }, [currentPath]);

  const runWhatIf = useCallback(async (silent = false) => {
    const target = resolveTarget();
    if (!target) {
      if (!silent) {
        pushToast({ kind: 'warning', title: 'Navigate first', message: 'Open a drive or folder to analyze capacity.' });
      }
      return;
    }
    setBusy(true);
    try {
      const targetBytes = Math.max(1, Number(targetGb) || 10) * 1024 ** 3;
      const r = await IPC.capacityWhatIf(target, scrubbers, targetBytes);
      if (r.error || r.ok === false) throw new Error(r.error || 'What-if failed');
      const proj = normalizeProjection((r.projection || r) as Record<string, unknown>);
      setProjection(proj);
      setSelectedIds(new Set(proj.actions.filter(a => a.selected).map(a => a.id)));
    } catch (e) {
      if (!silent) pushToast({ kind: 'error', title: 'What-if failed', message: String(e) });
    } finally {
      setBusy(false);
    }
  }, [resolveTarget, scrubbers, targetGb]);

  const scheduleWhatIf = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void runWhatIf(true);
    }, 320);
  }, [runWhatIf]);

  useEffect(() => {
    if (autoRanRef.current) return;
    if (!resolveTarget()) return;
    autoRanRef.current = true;
    void runWhatIf(true);
  }, [resolveTarget, runWhatIf]);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const loadBudget = useCallback(async () => {
    const target = resolveTarget();
    if (!target) return;
    const root = volumeRootFromPath(target);
    setBudget(b => ({ ...b, volumeRoot: root }));
    try {
      const r = await IPC.budgetGovernorGetPolicies();
      const policies = Array.isArray(r.policies) ? r.policies : [];
      const match = policies.find((p: any) => {
        const vr = String(p.volumeRoot ?? p.VolumeRoot ?? '').toUpperCase().replace(/\/+$/, '\\');
        return vr.startsWith(root.toUpperCase().slice(0, 2)) || root.toUpperCase().startsWith(vr.slice(0, 2));
      });
      if (match) {
        const soft = Number(match.softLimitBytes ?? match.SoftLimitBytes ?? 0);
        const hard = Number(match.hardLimitBytes ?? match.HardLimitBytes ?? 0);
        const enfRaw = String(match.enforcement ?? match.Enforcement ?? 'off').toLowerCase();
        const enforcement: BudgetPolicy['enforcement'] =
          enfRaw === 'soft' || enfRaw === '1' ? 'soft'
            : enfRaw === 'hard' || enfRaw === '2' ? 'hard'
              : 'off';
        setBudget({
          volumeRoot: root,
          enforcement,
          softLimitGb: soft > 0 ? String(Math.round(soft / 1024 ** 3)) : '80',
          hardLimitGb: hard > 0 ? String(Math.round(hard / 1024 ** 3)) : '95',
          enabled: match.enabled !== false && match.Enabled !== false,
        });
      }
    } catch {
      /* optional */
    }
  }, [resolveTarget]);

  useEffect(() => {
    if (tab === 'budget') void loadBudget();
  }, [tab, loadBudget]);

  const patchScrubber = <K extends keyof Scrubbers>(key: K, value: Scrubbers[K]) => {
    setScrubbers(prev => ({ ...prev, [key]: value }));
    scheduleWhatIf();
  };

  const toggleAction = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const approveSelected = async () => {
    const target = resolveTarget();
    if (!target || selectedIds.size === 0) {
      pushToast({ kind: 'warning', title: 'Nothing selected', message: 'Select at least one action to approve.' });
      return;
    }
    setApproving(true);
    try {
      const r = await IPC.capacityApprove(target, [...selectedIds]);
      if (!r.ok) throw new Error(r.error || 'Approve failed');
      pushToast({
        kind: 'success',
        title: 'Actions dispatched',
        message: `${r.actionsDispatched ?? selectedIds.size} actuator(s) · ~${formatBytes(r.bytesTargeted ?? 0)} targeted`,
      });
      for (const action of projection?.actions ?? []) {
        if (!selectedIds.has(action.id)) continue;
        const pluginId = action.targetPlugin || PLUGIN_HINTS[action.kind];
        if (pluginId) {
          window.dispatchEvent(new CustomEvent('bndz-open-bottom-plugin', { detail: { id: pluginId } }));
          break;
        }
      }
      void runWhatIf(true);
    } catch (e) {
      pushToast({ kind: 'error', title: 'Approve failed', message: String(e) });
    } finally {
      setApproving(false);
    }
  };

  const saveBudget = async () => {
    const target = resolveTarget();
    const root = budget.volumeRoot || (target ? volumeRootFromPath(target) : '');
    if (!root) {
      pushToast({ kind: 'warning', title: 'No volume', message: 'Navigate to a drive first.' });
      return;
    }
    setBudgetBusy(true);
    try {
      const softGb = Math.max(0, Number(budget.softLimitGb) || 0);
      const hardGb = Math.max(0, Number(budget.hardLimitGb) || 0);
      const r = await IPC.budgetGovernorSetPolicy({
        volumeRoot: root,
        enforcement: budget.enforcement,
        softLimitBytes: softGb * 1024 ** 3,
        hardLimitBytes: hardGb * 1024 ** 3,
        enabled: budget.enabled,
      });
      if (!r.ok) throw new Error(r.error || 'Save failed');
      pushToast({
        kind: 'success',
        title: 'Budget saved',
        message: `${root} · ${budget.enforcement === 'off' ? 'governor off' : `${budget.enforcement} quota`}`,
      });
    } catch (e) {
      pushToast({ kind: 'error', title: 'Budget save failed', message: String(e) });
    } finally {
      setBudgetBusy(false);
    }
  };

  const selectedReclaimable = projection
    ? projection.actions.filter(a => selectedIds.has(a.id)).reduce((s, a) => s + a.estimatedBytes, 0)
    : 0;
  const liveProjected = projection
    ? projection.currentFreeBytes + selectedReclaimable
    : 0;
  const livePct = projection && projection.totalBytes > 0
    ? Math.round((liveProjected / projection.totalBytes) * 100)
    : 0;
  const currentPct = projection && projection.totalBytes > 0
    ? Math.round((projection.currentFreeBytes / projection.totalBytes) * 100)
    : null;

  return (
    <PluginPanelShell
      title="Capacity Solver"
      icon="hard_drive_ui"
      iconColor="#c48b4a"
      variant="embedded"
      subtitle="What-if scrubbers · budget governor"
    >
      <div className="flex flex-col min-h-0">
        <PluginHeroStrip
          icon={
            <div className="flex items-center justify-center">
              <EmblemIcon id="drive-removable-media" size={48} />
            </div>
          }
          name="Capacity Solver"
          typeLabel="Storage what-if"
          meta={
            projection ? (
              <span className="bndz-panel-muted text-xs">
                {formatBytes(projection.currentFreeBytes)} free → {formatBytes(liveProjected)} projected · {livePct}%
              </span>
            ) : (
              <span className="bndz-panel-muted text-xs">Scrub keep-hot / recency to project free space</span>
            )
          }
          actions={
            tab === 'whatif' ? (
              <>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={1}
                    className={`${PLUGIN_INPUT_CLASS} !w-16 text-center`}
                    value={targetGb}
                    onChange={e => {
                      setTargetGb(e.target.value);
                      scheduleWhatIf();
                    }}
                    title="Target free space (GB)"
                  />
                  <span className="text-[10px] text-gray-500 uppercase">GB target</span>
                </div>
                <PluginHeroActionButton
                  icon="search_ui"
                  variant="primary"
                  onClick={() => void runWhatIf(false)}
                  disabled={busy}
                >
                  {busy ? 'Projecting…' : 'Project'}
                </PluginHeroActionButton>
              </>
            ) : (
              <PluginHeroActionButton
                icon="check"
                variant="primary"
                onClick={() => void saveBudget()}
                disabled={budgetBusy}
              >
                {budgetBusy ? 'Saving…' : 'Save budget'}
              </PluginHeroActionButton>
            )
          }
        />

        <PluginTabStrip>
          <PluginTab active={tab === 'whatif'} onClick={() => setTab('whatif')}>What-if</PluginTab>
          <PluginTab active={tab === 'budget'} onClick={() => setTab('budget')}>Budget</PluginTab>
        </PluginTabStrip>

        <div className="flex-1 min-h-0 overflow-y-auto bndz-scrollbar">
          {tab === 'budget' ? (
            <div className="p-5 space-y-4">
              <div className="bndz-plugin-card bndz-capacity-budget-card">
                <PluginSectionTitle icon="config">Volume quota</PluginSectionTitle>
                <p className="text-[11px] text-gray-400 mt-1 mb-3 leading-snug">
                  Soft warns on drop/transfer. Hard blocks before the volume fills past your ceiling.
                </p>
                <div className="space-y-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Volume</div>
                    <input
                      className={PLUGIN_INPUT_CLASS}
                      value={budget.volumeRoot}
                      onChange={e => setBudget(b => ({ ...b, volumeRoot: e.target.value }))}
                      placeholder="C:\"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(['off', 'soft', 'hard'] as const).map(mode => (
                      <ToggleChip
                        key={mode}
                        active={budget.enforcement === mode}
                        onClick={() => setBudget(b => ({ ...b, enforcement: mode }))}
                      >
                        {mode === 'off' ? 'Off' : mode === 'soft' ? 'Soft warn' : 'Hard block'}
                      </ToggleChip>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label>
                      <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Soft limit (GB)</div>
                      <input
                        type="number"
                        min={0}
                        className={PLUGIN_INPUT_CLASS}
                        value={budget.softLimitGb}
                        onChange={e => setBudget(b => ({ ...b, softLimitGb: e.target.value }))}
                      />
                    </label>
                    <label>
                      <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Hard limit (GB)</div>
                      <input
                        type="number"
                        min={0}
                        className={PLUGIN_INPUT_CLASS}
                        value={budget.hardLimitGb}
                        onChange={e => setBudget(b => ({ ...b, hardLimitGb: e.target.value }))}
                      />
                    </label>
                  </div>
                </div>
              </div>
            </div>
          ) : !projection ? (
            <div className="p-5 space-y-4">
              <div className="bndz-plugin-card">
                <PluginSectionTitle icon="zap_ui">Scrubbers</PluginSectionTitle>
                <div className="mt-3 space-y-3">
                  <ScrubberRow
                    label="Keep hot"
                    value={scrubbers.keepHotDays}
                    min={7}
                    max={365}
                    unit="d"
                    onChange={n => patchScrubber('keepHotDays', n)}
                  />
                  <ScrubberRow
                    label="Archive older than"
                    value={scrubbers.recencyDays}
                    min={7}
                    max={365}
                    unit="d"
                    onChange={n => patchScrubber('recencyDays', n)}
                  />
                  <ScrubberRow
                    label="Min file size"
                    value={scrubbers.minFileSizeMb}
                    min={1}
                    max={500}
                    unit=" MB"
                    onChange={n => patchScrubber('minFileSizeMb', n)}
                  />
                </div>
              </div>
              <PluginEmptyState
                icon="hard_drive_ui"
                title="No projection yet"
                description="Set scrubbers and Project — live free-space outcome before you Approve."
              />
            </div>
          ) : (
            <div className="p-5 space-y-5">
              <div className="bndz-plugin-card bndz-capacity-scrub-panel">
                <PluginSectionTitle icon="zap_ui">What-if scrubbers</PluginSectionTitle>
                <div className="mt-3 space-y-3">
                  <ScrubberRow
                    label="Keep hot (Ghost offload)"
                    value={scrubbers.keepHotDays}
                    min={7}
                    max={365}
                    unit="d"
                    onChange={n => patchScrubber('keepHotDays', n)}
                  />
                  <ScrubberRow
                    label="Archive older than"
                    value={scrubbers.recencyDays}
                    min={7}
                    max={365}
                    unit="d"
                    onChange={n => patchScrubber('recencyDays', n)}
                  />
                  <ScrubberRow
                    label="Min file size"
                    value={scrubbers.minFileSizeMb}
                    min={1}
                    max={500}
                    unit=" MB"
                    onChange={n => patchScrubber('minFileSizeMb', n)}
                  />
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <ToggleChip
                      active={scrubbers.includeDuplicates}
                      onClick={() => patchScrubber('includeDuplicates', !scrubbers.includeDuplicates)}
                    >
                      Duplicates
                    </ToggleChip>
                    <ToggleChip
                      active={scrubbers.includeGhostOffload}
                      onClick={() => patchScrubber('includeGhostOffload', !scrubbers.includeGhostOffload)}
                    >
                      Ghost offload
                    </ToggleChip>
                    <ToggleChip
                      active={scrubbers.includeArchive}
                      onClick={() => patchScrubber('includeArchive', !scrubbers.includeArchive)}
                    >
                      Archive
                    </ToggleChip>
                    <ToggleChip
                      active={scrubbers.includeEmptyDirs}
                      onClick={() => patchScrubber('includeEmptyDirs', !scrubbers.includeEmptyDirs)}
                    >
                      Empty dirs
                    </ToggleChip>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <PluginStatCard
                  label="Free now"
                  value={formatBytes(projection.currentFreeBytes)}
                  sub={`${currentPct ?? 0}% of ${formatBytes(projection.totalBytes)}`}
                  iconId="hard_drive_ui"
                />
                <PluginStatCard
                  label="Projected free"
                  value={formatBytes(liveProjected)}
                  sub={projection.meetsTarget || liveProjected >= projection.targetFreeBytes
                    ? 'Target met'
                    : `Need ${formatBytes(Math.max(0, projection.targetFreeBytes - liveProjected))} more`}
                  iconId="zap_ui"
                />
                <PluginStatCard
                  label="Selected reclaim"
                  value={formatBytes(selectedReclaimable)}
                  sub={`${selectedIds.size} of ${projection.actions.length} action(s)`}
                  iconId="check"
                />
              </div>

              {projection.totalBytes > 0 && (
                <div className="bndz-plugin-card">
                  <PluginSectionTitle icon="piechart_ui">Projected outcome</PluginSectionTitle>
                  <div className="mt-2 relative h-3.5 rounded-xl bg-black/40 overflow-hidden border border-white/[0.06]">
                    <div
                      className="absolute inset-y-0 left-0 rounded-xl opacity-40 transition-all duration-500"
                      style={{
                        width: `${100 - (currentPct ?? 0)}%`,
                        background: 'linear-gradient(90deg, #64748b 0%, #475569 100%)',
                      }}
                    />
                    <div
                      className="absolute inset-y-0 left-0 rounded-xl transition-all duration-500"
                      style={{
                        width: `${100 - livePct}%`,
                        background: livePct < 10
                          ? 'linear-gradient(90deg, #ef4444 0%, #dc2626 100%)'
                          : livePct < 25
                            ? 'linear-gradient(90deg, #f59e0b 0%, #d97706 100%)'
                            : 'linear-gradient(90deg, #34d399 0%, #059669 100%)',
                      }}
                    />
                  </div>
                  <div className="flex justify-between mt-1.5 text-[10px] text-gray-500">
                    <span>{formatBytes(projection.totalBytes - liveProjected)} used (projected)</span>
                    <span>{formatBytes(liveProjected)} free</span>
                  </div>
                </div>
              )}

              {projection.actions.length > 0 && (
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <PluginSectionTitle icon="zap_ui">Recommended actions</PluginSectionTitle>
                    <PluginToolbarButton
                      icon="check"
                      onClick={() => void approveSelected()}
                      disabled={approving || selectedIds.size === 0}
                    >
                      {approving ? 'Dispatching…' : `Approve (${selectedIds.size})`}
                    </PluginToolbarButton>
                  </div>
                  <div className="mt-3 space-y-2">
                    {projection.actions.map(action => {
                      const on = selectedIds.has(action.id);
                      return (
                        <PluginCard
                          key={action.id}
                          className={`bndz-capacity-action-card${on ? ' is-selected' : ''}`}
                        >
                          <div className="flex items-start gap-3">
                            <button
                              type="button"
                              className={`bndz-capacity-check${on ? ' is-on' : ''}`}
                              onClick={() => toggleAction(action.id)}
                              aria-pressed={on}
                              title={on ? 'Deselect' : 'Select'}
                            >
                              {on && <Icons8Icon id="check" size={12} />}
                            </button>
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
                          </div>
                        </PluginCard>
                      );
                    })}
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
