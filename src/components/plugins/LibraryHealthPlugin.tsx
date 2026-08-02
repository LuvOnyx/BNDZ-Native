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
  installOnFirstUse: false,
};

type TabId = 'summary' | 'problems';

type Problem = {
  id: string;
  path: string;
  severity: 'critical' | 'warning' | 'info';
  kind: string;
  message: string;
};

type Summary = {
  total: number;
  critical: number;
  warning: number;
  info: number;
};

function normalizeProblem(raw: Record<string, unknown>): Problem {
  const rawSeverity = String(raw.severity ?? raw.Severity ?? '').toLowerCase();
  const severity: Problem['severity'] =
    rawSeverity === 'critical' || rawSeverity === 'error' ? 'critical'
      : rawSeverity === 'warning' || rawSeverity === 'warn' ? 'warning'
        : 'info';
  return {
    id: String(raw.id ?? raw.Id ?? `p_${Math.random().toString(36).slice(2, 9)}`),
    path: String(raw.path ?? raw.Path ?? ''),
    severity,
    kind: String(raw.kind ?? raw.Kind ?? 'unknown'),
    message: String(raw.message ?? raw.Message ?? raw.detail ?? raw.Detail ?? raw.fixHint ?? raw.FixHint ?? ''),
  };
}

const SEVERITY_STYLES: Record<string, { dot: string; text: string; bg: string }> = {
  critical: { dot: 'bg-red-400', text: 'text-red-300', bg: 'bg-red-500/[0.08] border-red-500/20' },
  warning: { dot: 'bg-amber-400', text: 'text-amber-300', bg: 'bg-amber-500/[0.08] border-amber-500/20' },
  info: { dot: 'bg-sky-400', text: 'text-sky-300', bg: 'bg-sky-500/[0.06] border-sky-500/15' },
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
  const [scanRoot, setScanRoot] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [s, p] = await Promise.all([
      IPC.healthGetSummary(),
      IPC.healthListProblems(undefined, 200),
    ]);
    setSummary(s);
    setProblems((p.problems || []).map(x => normalizeProblem(x as Record<string, unknown>)));
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

  const revealPath = (winPath: string) => {
    if (!winPath) return;
    window.dispatchEvent(new CustomEvent('bndz-navigate', {
      detail: { path: winPath.replace(/^([A-Za-z]):\\/, '/$1/').replace(/\\/g, '/') },
    }));
  };

  const tabs: { id: TabId; label: string; icon: string; badge?: number }[] = [
    { id: 'summary', label: 'Summary', icon: 'piechart_ui' },
    { id: 'problems', label: 'Problems', icon: 'warning', badge: summary.total },
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
              {summary.total} issue{summary.total === 1 ? '' : 's'} ·
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
                Scanning {scanRoot}…
              </span>
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
              {problems.length === 0 ? (
                <PluginEmptyState
                  icon="shield_ui"
                  title="No problems found"
                  description="Scan a folder to check for broken links, naming conflicts, and integrity issues."
                />
              ) : (
                problems.map(p => {
                  const sev = SEVERITY_STYLES[p.severity] || SEVERITY_STYLES.info;
                  const { leaf, parent } = splitPath(p.path);
                  return (
                    <div key={p.id} className={`bndz-plugin-card flex items-start gap-3 border ${sev.bg}`}>
                      <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${sev.dot}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-bold uppercase tracking-wider ${sev.text}`}>{p.severity}</span>
                          <span className="text-[10px] text-gray-500">{p.kind}</span>
                        </div>
                        <div className="text-xs text-white mt-0.5">{p.message}</div>
                        <div className="bndz-mono text-[10px] text-gray-500 truncate mt-0.5" title={p.path}>
                          {parent && <span>{parent}\</span>}{leaf}
                        </div>
                      </div>
                      <PluginToolbarButton icon="folder_open_ui" onClick={() => revealPath(p.path)} title="Reveal in pane">
                        Open
                      </PluginToolbarButton>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </PluginPanelShell>
  );
}
