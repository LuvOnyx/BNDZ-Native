import React, { useCallback, useEffect, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { EmblemIcon } from '../EmblemIcon';
import { IPC } from '../../lib/ipcBridge';
import { pushToast } from '../ToastHost';
import { toWindowsPath } from '../../lib/pathUtils';
import PluginPanelShell from './PluginPanelShell';
import {
  PluginToolbarButton,
  PluginTabStrip,
  PluginTab,
  PluginCard,
  PluginEmptyState,
  PluginHeroStrip,
  PluginHeroActionButton,
  PluginStatCard,
  PluginSectionTitle,
} from './PluginPanelPrimitives';

export const LibraryHealthPluginDef = {
  id: 'library-health',
  name: 'Library Health',
  icon: 'shield_ui',
  description: 'Scan libraries for broken links, naming conflicts, permission issues, and orphans.',
  targetPanel: 'bottom' as const,
  installOnFirstUse: true,
};

type TabId = 'summary' | 'problems' | 'plan';

type Problem = {
  id: string;
  path: string;
  severity: 'critical' | 'warning' | 'info';
  kind: string;
  detail: string;
  fixHint: string;
  fixable: boolean;
};

type Summary = {
  total: number;
  critical: number;
  warning: number;
  info: number;
};

type PlanAction = {
  id: string;
  problemId: string;
  kind: string;
  path: string;
  title: string;
  impact?: string;
  severity: string;
  priority: number;
};

const FIXABLE_KINDS = new Set(['EmptyDir', 'OrphanSidecar', 'BrokenLink', 'MissingTarget']);

const KIND_META: Record<string, { icon: string; label: string; color: string }> = {
  EmptyDir:       { icon: 'folder_ui',      label: 'Empty folder',    color: 'text-sky-400' },
  OrphanSidecar:  { icon: 'link_broken',     label: 'Orphan sidecar',  color: 'text-sky-400' },
  BrokenLink:     { icon: 'link_broken',     label: 'Broken link',     color: 'text-red-400' },
  MissingTarget:  { icon: 'warning',         label: 'Missing target',  color: 'text-amber-400' },
  LongPath:       { icon: 'data_warning',    label: 'Long path',       color: 'text-amber-400' },
  AclDenied:      { icon: 'lock_ui',         label: 'Access denied',   color: 'text-amber-400' },
};

function normalizeProblem(raw: Record<string, unknown>): Problem {
  const rawSeverity = String(raw.severity ?? raw.Severity ?? '').toLowerCase();
  const severity: Problem['severity'] =
    rawSeverity === 'critical' || rawSeverity === 'error' ? 'critical'
      : rawSeverity === 'warning' || rawSeverity === 'warn' ? 'warning'
        : 'info';
  const kind = String(raw.kind ?? raw.Kind ?? 'unknown');
  return {
    id: String(raw.id ?? raw.Id ?? `p_${Math.random().toString(36).slice(2, 9)}`),
    path: String(raw.path ?? raw.Path ?? ''),
    severity,
    kind,
    detail: String(raw.detail ?? raw.Detail ?? raw.message ?? raw.Message ?? ''),
    fixHint: String(raw.fixHint ?? raw.FixHint ?? ''),
    fixable: FIXABLE_KINDS.has(kind),
  };
}

const SEVERITY_STYLES: Record<string, { dot: string; text: string; bg: string; badge: string }> = {
  critical: { dot: 'bg-red-400', text: 'text-red-300', bg: 'bg-red-500/[0.08] border-red-500/20', badge: 'bg-red-500/20 text-red-300 border-red-500/30' },
  warning: { dot: 'bg-amber-400', text: 'text-amber-300', bg: 'bg-amber-500/[0.08] border-amber-500/20', badge: 'bg-amber-500/15 text-amber-300 border-amber-500/25' },
  info: { dot: 'bg-sky-400', text: 'text-sky-300', bg: 'bg-sky-500/[0.06] border-sky-500/15', badge: 'bg-sky-500/15 text-sky-300 border-sky-500/20' },
};

function splitPath(full: string): { leaf: string; parent: string } {
  const normalized = full.replace(/[/\\]+$/, '');
  const parts = normalized.split(/[/\\]/);
  const leaf = parts.pop() || full;
  const parent = parts.join('\\');
  return { leaf, parent };
}

export default function LibraryHealthPlugin({
  currentPath,
}: {
  selectedPaths?: string[];
  currentPath?: string;
}) {
  const [activeTab, setActiveTab] = useState<TabId>('summary');
  const [summary, setSummary] = useState<Summary>({ total: 0, critical: 0, warning: 0, info: 0 });
  const [problems, setProblems] = useState<Problem[]>([]);
  const [busy, setBusy] = useState(false);
  const [fixingId, setFixingId] = useState<string | null>(null);
  const [scanRoot, setScanRoot] = useState<string | null>(null);
  const [filterKind, setFilterKind] = useState<string | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const [planActions, setPlanActions] = useState<PlanAction[]>([]);
  const [goals, setGoals] = useState({
    zeroBrokenLinks: true,
    clearEmptyDirs: true,
    clearOrphanSidecars: true,
    fixAllAuto: false,
  });
  const [approving, setApproving] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([
        IPC.healthGetSummary(),
        IPC.healthListProblems(undefined, 500),
      ]);
      setSummary(s);
      setProblems((p.problems || []).map(x => normalizeProblem(x as Record<string, unknown>)));
    } catch (e) {
      pushToast({ kind: 'error', title: 'Health refresh failed', message: String(e) });
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const runScan = async (root?: string) => {
    const target = root || (currentPath && currentPath !== '/' ? toWindowsPath(currentPath) : undefined);
    if (!target) {
      pushToast({ kind: 'warning', title: 'Navigate first', message: 'Open a folder to scan for problems.' });
      return;
    }
    setBusy(true);
    setScanRoot(target);
    try {
      const r = await IPC.healthScan(target);
      if (r.error) throw new Error(r.error);
      pushToast({
        kind: 'success',
        title: 'Health scan complete',
        message: `Found ${r.problemCount ?? 0} problem(s).`,
      });
      await refresh();
      if ((r.problemCount ?? 0) > 0) setActiveTab('problems');
    } catch (e) {
      pushToast({ kind: 'error', title: 'Scan failed', message: String(e) });
    } finally {
      setBusy(false);
      setScanRoot(null);
    }
  };

  const clearProblems = async (rootPrefix?: string) => {
    setBusy(true);
    try {
      await IPC.healthClear(rootPrefix);
      pushToast({ kind: 'success', title: 'Cleared', message: 'Problem list emptied.' });
      await refresh();
    } catch (e) {
      pushToast({ kind: 'error', title: 'Clear failed', message: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const fixProblem = async (problem: Problem) => {
    setFixingId(problem.id);
    try {
      const r = await IPC.healthFixProblem(problem.id);
      if (r.ok) {
        pushToast({ kind: 'success', title: 'Fixed', message: r.action || `Resolved ${problem.kind}.` });
        await refresh();
      } else {
        pushToast({ kind: 'error', title: 'Fix failed', message: r.error || 'Unknown error.' });
      }
    } catch (e) {
      pushToast({ kind: 'error', title: 'Fix failed', message: String(e) });
    } finally {
      setFixingId(null);
    }
  };

  const buildPlan = async () => {
    setBusy(true);
    try {
      const plan = await IPC.healthBuildRepairPlan(goals);
      const actions = (plan.actions || plan.Actions || []) as Record<string, unknown>[];
      setPlanId(String(plan.id ?? plan.Id ?? ''));
      setPlanActions(actions.map(a => ({
        id: String(a.id ?? a.Id ?? ''),
        problemId: String(a.problemId ?? a.ProblemId ?? ''),
        kind: String(a.kind ?? a.Kind ?? ''),
        path: String(a.path ?? a.Path ?? ''),
        title: String(a.title ?? a.Title ?? ''),
        impact: String(a.impact ?? a.Impact ?? ''),
        severity: String(a.severity ?? a.Severity ?? 'info'),
        priority: Number(a.priority ?? a.Priority ?? 0),
      })));
      setActiveTab('plan');
      pushToast({
        kind: 'success',
        title: 'Repair plan ready',
        message: `${actions.length} ordered fix action(s).`,
      });
    } catch (e) {
      pushToast({ kind: 'error', title: 'Plan failed', message: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const approvePlan = async () => {
    if (!planId) return;
    setApproving(true);
    try {
      const r = await IPC.healthApprovePlan(planId, planActions.map(a => a.id));
      if (r.ok) {
        pushToast({
          kind: 'success',
          title: 'Plan approved',
          message: `Fixed ${r.fixedCount ?? planActions.length} problem(s).`,
        });
        setPlanActions([]);
        setPlanId(null);
        await refresh();
        setActiveTab('problems');
      } else {
        pushToast({
          kind: 'warning',
          title: 'Partial approve',
          message: r.error || `Fixed ${r.fixedCount ?? 0}, failed ${r.failedCount ?? 0}.`,
        });
        await refresh();
      }
    } catch (e) {
      pushToast({ kind: 'error', title: 'Approve failed', message: String(e) });
    } finally {
      setApproving(false);
    }
  };

  const revealPath = (winPath: string) => {
    if (!winPath) return;
    window.dispatchEvent(new CustomEvent('bndz-navigate', {
      detail: { path: winPath.replace(/^([A-Za-z]):\\/, '/$1/').replace(/\\/g, '/') },
    }));
  };

  const filteredProblems = filterKind
    ? problems.filter(p => p.kind === filterKind)
    : problems;

  const kindCounts = problems.reduce<Record<string, number>>((acc, p) => {
    acc[p.kind] = (acc[p.kind] ?? 0) + 1;
    return acc;
  }, {});

  const tabs: { id: TabId; label: string; icon: string; badge?: number }[] = [
    { id: 'summary', label: 'Summary', icon: 'piechart_ui' },
    { id: 'problems', label: 'Problems', icon: 'warning', badge: summary.total },
    { id: 'plan', label: 'Plan', icon: 'task_due', badge: planActions.length || undefined },
  ];

  return (
    <PluginPanelShell
      title="Library Health"
      icon="shield_ui"
      iconColor="#f59e0b"
      variant="embedded"
      subtitle="Integrity scanner · broken links · naming conflicts"
      toolbar={
        <PluginTabStrip className="!border-0 !min-h-0 bg-black/20 rounded-md p-0.5 gap-0.5">
          {tabs.map(t => (
            <PluginTab key={t.id} active={activeTab === t.id} onClick={() => setActiveTab(t.id)}>
              <span className="inline-flex items-center gap-1">
                <Icons8Icon id={t.icon} size={11} />
                {t.label}
                {t.badge != null && t.badge > 0 && (
                  <span className="bndz-ghostlink-tab-badge">{t.badge}</span>
                )}
              </span>
            </PluginTab>
          ))}
        </PluginTabStrip>
      }
    >
      <div className="flex flex-col min-h-0">
        <PluginHeroStrip
          icon={
            <div className="flex items-center justify-center">
              <EmblemIcon id="emblem-warning" size={48} />
            </div>
          }
          name="Library Health"
          typeLabel="Integrity scanner"
          meta={
            <span className="bndz-panel-muted text-xs">
              {summary.total} issue{summary.total === 1 ? '' : 's'}
              {summary.critical > 0 && <span className="text-red-400 ml-1">{summary.critical} critical</span>}
              {summary.warning > 0 && <span className="text-amber-400 ml-1">{summary.warning} warning</span>}
              {summary.info > 0 && <span className="text-sky-400 ml-1">{summary.info} info</span>}
            </span>
          }
          actions={
            <>
              <PluginHeroActionButton
                icon="search_ui"
                variant="primary"
                onClick={() => void runScan()}
                disabled={busy}
              >
                Scan folder
              </PluginHeroActionButton>
              <PluginHeroActionButton
                icon="task_due"
                onClick={() => void buildPlan()}
                disabled={busy || summary.total === 0}
              >
                Build plan
              </PluginHeroActionButton>
              <PluginHeroActionButton
                icon="delete"
                onClick={() => void clearProblems()}
                disabled={busy || summary.total === 0}
              >
                Clear all
              </PluginHeroActionButton>
              <PluginHeroActionButton icon="reset_ui" onClick={() => void refresh()} disabled={busy}>
                Refresh
              </PluginHeroActionButton>
            </>
          }
        />

        {busy && scanRoot && (
          <div className="shrink-0 px-5 py-2 border-b border-white/[0.06] bg-amber-500/[0.06]">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300">
                Scanning…
              </span>
              <span className="text-[10px] text-gray-500 truncate">{scanRoot}</span>
            </div>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto bndz-scrollbar">
          {activeTab === 'summary' && (
            <div className="p-5 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <PluginStatCard label="Total issues" value={String(summary.total)} iconId="warning" />
                <PluginStatCard label="Critical" value={String(summary.critical)} sub="Broken links · data loss" iconId="emblem_important" />
                <PluginStatCard label="Warnings" value={String(summary.warning)} sub="Permissions · conflicts" iconId="data_warning" />
                <PluginStatCard label="Info" value={String(summary.info)} sub="Naming · orphans" iconId="data_information" />
              </div>

              {/* Kind breakdown with clickable badges */}
              {Object.keys(kindCounts).length > 0 && (
                <PluginCard>
                  <PluginSectionTitle icon="piechart_ui">Problem breakdown</PluginSectionTitle>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {Object.entries(kindCounts)
                      .sort(([, a], [, b]) => b - a)
                      .map(([kind, count]) => {
                        const meta = KIND_META[kind];
                        const isActive = filterKind === kind;
                        return (
                          <button
                            key={kind}
                            className={`
                              inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium
                              border transition-all cursor-pointer
                              ${isActive
                                ? 'bg-white/10 border-white/20 text-white shadow-[0_0_8px_rgba(255,255,255,0.08)]'
                                : 'bg-black/20 border-white/[0.06] text-gray-400 hover:bg-white/[0.04] hover:border-white/10'}
                            `}
                            onClick={() => { setFilterKind(isActive ? null : kind); setActiveTab('problems'); }}
                          >
                            <Icons8Icon id={meta?.icon ?? 'warning'} size={12} className={meta?.color ?? 'text-gray-400'} />
                            <span>{meta?.label ?? kind}</span>
                            <span className="font-mono text-[10px] text-gray-500 ml-0.5">{count}</span>
                          </button>
                        );
                      })}
                  </div>
                </PluginCard>
              )}

              <PluginCard>
                <PluginSectionTitle icon="shield_ui">About Library Health</PluginSectionTitle>
                <ul className="mt-3 space-y-1.5 text-xs text-gray-400 leading-relaxed list-disc list-inside">
                  <li>Detects broken symlinks, dangling shortcuts, and missing targets.</li>
                  <li>Flags naming conflicts that may cause issues across operating systems.</li>
                  <li>Identifies permission mismatches and locked files.</li>
                  <li>Reports orphaned sidecar files and empty directories.</li>
                </ul>
              </PluginCard>
            </div>
          )}

          {activeTab === 'problems' && (
            <div className="p-5 space-y-2">
              {/* Active filter indicator */}
              {filterKind && (
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[10px] text-gray-500">Filtering:</span>
                  <button
                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white/[0.06] border border-white/10 text-[10px] text-gray-300 hover:bg-white/10"
                    onClick={() => setFilterKind(null)}
                  >
                    <Icons8Icon id={KIND_META[filterKind]?.icon ?? 'warning'} size={10} className={KIND_META[filterKind]?.color ?? ''} />
                    {KIND_META[filterKind]?.label ?? filterKind}
                    <Icons8Icon id="close_ui" size={8} className="text-gray-500 ml-1" />
                  </button>
                  <span className="text-[10px] text-gray-600">{filteredProblems.length} result{filteredProblems.length === 1 ? '' : 's'}</span>
                </div>
              )}

              {filteredProblems.length === 0 ? (
                <PluginEmptyState
                  icon="shield_ui"
                  title={filterKind ? `No ${KIND_META[filterKind]?.label ?? filterKind} problems` : 'No problems found'}
                  description={filterKind ? 'Try clearing the filter or scanning another folder.' : 'Scan a folder to check for broken links, naming conflicts, and integrity issues.'}
                />
              ) : (
                filteredProblems.map(p => {
                  const sev = SEVERITY_STYLES[p.severity] || SEVERITY_STYLES.info;
                  const kindMeta = KIND_META[p.kind];
                  const { leaf, parent } = splitPath(p.path);
                  const isFixing = fixingId === p.id;
                  return (
                    <div key={p.id} className={`bndz-plugin-card flex items-start gap-3 border ${sev.bg}`}>
                      <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${sev.dot}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          {/* Severity badge */}
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border ${sev.badge}`}>
                            {p.severity}
                          </span>
                          {/* Kind badge */}
                          {kindMeta && (
                            <span className={`inline-flex items-center gap-1 text-[10px] ${kindMeta.color}`}>
                              <Icons8Icon id={kindMeta.icon} size={10} />
                              {kindMeta.label}
                            </span>
                          )}
                          {!kindMeta && <span className="text-[10px] text-gray-500">{p.kind}</span>}
                        </div>
                        <div className="text-xs text-white mt-0.5">{p.detail}</div>
                        {p.fixHint && (
                          <div className="text-[10px] text-gray-500 mt-0.5 italic">{p.fixHint}</div>
                        )}
                        <div className="bndz-mono text-[10px] text-gray-500 truncate mt-0.5" title={p.path}>
                          {parent && <span>{parent}\</span>}{leaf}
                        </div>
                      </div>
                      <div className="flex flex-col gap-1 shrink-0">
                        <PluginToolbarButton icon="folder_open_ui" onClick={() => revealPath(p.path)} title="Reveal in pane">
                          Open
                        </PluginToolbarButton>
                        {p.fixable && (
                          <PluginToolbarButton
                            icon="check"
                            onClick={() => void fixProblem(p)}
                            disabled={isFixing || busy}
                            title={`Auto-fix: ${p.fixHint || p.kind}`}
                          >
                            {isFixing ? 'Fixing…' : 'Fix'}
                          </PluginToolbarButton>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {activeTab === 'plan' && (
            <div className="p-5 space-y-4">
              <PluginCard>
                <PluginSectionTitle icon="task_due">Repair goals</PluginSectionTitle>
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-gray-300">
                  {([
                    ['zeroBrokenLinks', 'Zero broken links'],
                    ['clearEmptyDirs', 'Clear empty folders'],
                    ['clearOrphanSidecars', 'Clear orphan sidecars'],
                    ['fixAllAuto', 'Include all auto-fixable'],
                  ] as const).map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={goals[key]}
                        onChange={e => setGoals(g => ({ ...g, [key]: e.target.checked }))}
                        className="rounded border-white/20"
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <PluginHeroActionButton icon="task_due" variant="primary" onClick={() => void buildPlan()} disabled={busy}>
                    Rebuild plan
                  </PluginHeroActionButton>
                  <PluginHeroActionButton
                    icon="check"
                    onClick={() => void approvePlan()}
                    disabled={!planId || planActions.length === 0 || approving}
                  >
                    {approving ? 'Approving…' : `Approve (${planActions.length})`}
                  </PluginHeroActionButton>
                </div>
              </PluginCard>

              {planActions.length === 0 ? (
                <PluginEmptyState
                  icon="task_due"
                  title="No repair plan yet"
                  description="Scan first, then Build plan to rank auto-fix actions before Approve."
                />
              ) : (
                <div className="space-y-2">
                  {planActions.map((a, i) => (
                    <div
                      key={a.id}
                      className="flex items-start gap-3 rounded-xl border border-white/[0.08] bg-black/25 px-3 py-2.5"
                    >
                      <span className="bndz-mono text-[10px] text-amber-300/80 w-5 shrink-0">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-white font-medium truncate">{a.title}</div>
                        {a.impact && <div className="text-[10px] text-gray-500 mt-0.5">{a.impact}</div>}
                        <div className="bndz-mono text-[10px] text-gray-500 truncate mt-0.5">{a.path}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </PluginPanelShell>
  );
}
