import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { EmblemIcon } from '../EmblemIcon';
import { IPC } from '../../lib/ipcBridge';
import { pushToast } from '../ToastHost';
import { toWindowsPath } from '../../lib/pathUtils';
import { splitUiPath } from '../../lib/displayPath';
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
  PLUGIN_INPUT_CLASS,
} from './PluginPanelPrimitives';

export const GhostLinkPluginDef = {
  id: 'ghost-link',
  name: 'Ghost-Link',
  icon: 'emblem_symbolic_link',
  description: 'Offload inactive files to cold storage while preserving paths via symlinks.',
  targetPanel: 'bottom' as const,
  installOnFirstUse: false,
};

type TabId = 'overview' | 'rules' | 'ghosts';

type Rule = {
  id: string;
  name: string;
  enabled: boolean;
  sourceRoots: string;
  pathGlob: string;
  extensions: string;
  minSizeBytes: number;
  idleDays: number;
  coldStorageRoot: string;
};

type GhostRecord = {
  id: string;
  originalPath: string;
  offloadPath: string;
  bytesSaved: number;
  ruleId: string;
  createdUtc?: string;
};

type Stats = {
  ruleCount: number;
  ghostCount: number;
  bytesReclaimed: number;
};

type ScanProgress = {
  done: number;
  total: number;
  reclaimed: number;
  current: string;
};

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function normalizeRule(raw: Record<string, unknown>): Rule {
  return {
    id: String(raw.id ?? raw.Id ?? `rule_${Date.now()}`),
    name: String(raw.name ?? raw.Name ?? 'Rule'),
    enabled: raw.enabled !== false && raw.Enabled !== false,
    sourceRoots: String(raw.sourceRoots ?? raw.SourceRoots ?? ''),
    pathGlob: String(raw.pathGlob ?? raw.PathGlob ?? '**/*'),
    extensions: String(raw.extensions ?? raw.Extensions ?? ''),
    minSizeBytes: Number(raw.minSizeBytes ?? raw.MinSizeBytes ?? 50 * 1024 * 1024),
    idleDays: Number(raw.idleDays ?? raw.IdleDays ?? 30),
    coldStorageRoot: String(raw.coldStorageRoot ?? raw.ColdStorageRoot ?? ''),
  };
}

function normalizeGhost(raw: Record<string, unknown>): GhostRecord {
  return {
    id: String(raw.id ?? raw.Id ?? ''),
    originalPath: String(raw.originalPath ?? raw.OriginalPath ?? ''),
    offloadPath: String(raw.offloadPath ?? raw.OffloadPath ?? ''),
    bytesSaved: Number(raw.bytesSaved ?? raw.BytesSaved ?? 0),
    ruleId: String(raw.ruleId ?? raw.RuleId ?? ''),
  };
}

function normalizeStats(raw: Record<string, unknown> | null | undefined): Stats {
  if (!raw) return { ruleCount: 0, ghostCount: 0, bytesReclaimed: 0 };
  return {
    ruleCount: Number(raw.ruleCount ?? raw.RuleCount ?? 0),
    ghostCount: Number(raw.ghostCount ?? raw.GhostCount ?? 0),
    bytesReclaimed: Number(raw.bytesReclaimed ?? raw.BytesReclaimed ?? 0),
  };
}

function splitPath(full: string): { leaf: string; parent: string } {
  const { leaf, parent } = splitUiPath(full);
  return { leaf, parent };
}

const PRESETS: Array<{ name: string; description: string; rule: Partial<Rule> }> = [
  {
    name: 'Sample packs',
    description: 'Large audio libraries idle 14+ days',
    rule: { extensions: 'wav,mp3,flac,aiff,ogg', minSizeBytes: 10 * 1024 * 1024, idleDays: 14 },
  },
  {
    name: '808 libraries',
    description: '808-named folders · 30 day idle',
    rule: { extensions: 'wav,mp3', pathGlob: '**/*808*', minSizeBytes: 5 * 1024 * 1024, idleDays: 30 },
  },
  {
    name: 'FiveM backups',
    description: 'Archive backups · 7 day idle',
    rule: { extensions: 'zip,rar,7z', pathGlob: '**/*fivem*', minSizeBytes: 100 * 1024 * 1024, idleDays: 7 },
  },
];

function RuleEditor({
  rule,
  onChange,
  onSave,
  onDelete,
  onBrowseSource,
  onBrowseCold,
}: {
  rule: Rule;
  onChange: (next: Rule) => void;
  onSave: () => void;
  onDelete: () => void;
  onBrowseSource: () => void;
  onBrowseCold: () => void;
}) {
  const patch = (p: Partial<Rule>) => onChange({ ...rule, ...p });
  const rootsMissing = !rule.sourceRoots.trim();
  const coldMissing = !rule.coldStorageRoot.trim();

  return (
    <PluginCard className="bndz-ghostlink-rule-card">
      <div className="flex items-start gap-3 mb-3">
        <label className="flex items-center gap-2 shrink-0 pt-1 cursor-pointer">
          <input
            type="checkbox"
            className="accent-violet-500"
            checked={rule.enabled}
            onChange={e => patch({ enabled: e.target.checked })}
            onBlur={onSave}
          />
          <span className="text-[10px] font-semibold uppercase tracking-wide text-violet-300/80">
            {rule.enabled ? 'Active' : 'Paused'}
          </span>
        </label>
        <input
          className={`${PLUGIN_INPUT_CLASS} flex-1 font-semibold`}
          value={rule.name}
          onChange={e => patch({ name: e.target.value })}
          onBlur={onSave}
          placeholder="Rule name"
        />
        <PluginToolbarButton icon="delete" onClick={onDelete} title="Delete rule">
          Delete
        </PluginToolbarButton>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div>
          <label className="bndz-plugin-field-label block mb-1">Source roots</label>
          <div className="flex gap-1.5">
            <input
              className={`${PLUGIN_INPUT_CLASS} flex-1 bndz-mono text-[11px]`}
              value={rule.sourceRoots}
              onChange={e => patch({ sourceRoots: e.target.value })}
              onBlur={onSave}
              placeholder="D:\Samples;D:\Projects"
            />
            <PluginToolbarButton icon="folder_open_ui" onClick={onBrowseSource} title="Add source folder">
              Browse
            </PluginToolbarButton>
          </div>
          {rootsMissing && <p className="text-[10px] text-amber-400/80 mt-1">Required — semicolon-separated folders to watch.</p>}
        </div>

        <div>
          <label className="bndz-plugin-field-label block mb-1">Cold storage vault</label>
          <div className="flex gap-1.5">
            <input
              className={`${PLUGIN_INPUT_CLASS} flex-1 bndz-mono text-[11px]`}
              value={rule.coldStorageRoot}
              onChange={e => patch({ coldStorageRoot: e.target.value })}
              onBlur={onSave}
              placeholder="E:\ColdVault"
            />
            <PluginToolbarButton icon="folder_open_ui" onClick={onBrowseCold} title="Pick cold storage folder">
              Browse
            </PluginToolbarButton>
          </div>
          {coldMissing && <p className="text-[10px] text-amber-400/80 mt-1">Required — offloaded bytes land here; originals become symlinks.</p>}
        </div>

        <div>
          <label className="bndz-plugin-field-label block mb-1">Path glob</label>
          <input
            className={`${PLUGIN_INPUT_CLASS} bndz-mono text-[11px]`}
            value={rule.pathGlob}
            onChange={e => patch({ pathGlob: e.target.value })}
            onBlur={onSave}
            placeholder="**/*"
          />
        </div>

        <div>
          <label className="bndz-plugin-field-label block mb-1">Extensions</label>
          <input
            className={`${PLUGIN_INPUT_CLASS} bndz-mono text-[11px]`}
            value={rule.extensions}
            onChange={e => patch({ extensions: e.target.value })}
            onBlur={onSave}
            placeholder="wav,mp3,zip (empty = all)"
          />
        </div>

        <div>
          <label className="bndz-plugin-field-label block mb-1">Min size (MB)</label>
          <input
            type="number"
            min={1}
            className={PLUGIN_INPUT_CLASS}
            value={Math.round(rule.minSizeBytes / (1024 * 1024))}
            onChange={e => patch({ minSizeBytes: Math.max(1, Number(e.target.value) || 1) * 1024 * 1024 })}
            onBlur={onSave}
          />
        </div>

        <div>
          <label className="bndz-plugin-field-label block mb-1">Idle days</label>
          <input
            type="number"
            min={1}
            className={PLUGIN_INPUT_CLASS}
            value={rule.idleDays}
            onChange={e => patch({ idleDays: Math.max(1, Number(e.target.value) || 1) })}
            onBlur={onSave}
          />
        </div>
      </div>
    </PluginCard>
  );
}

export default function GhostLinkPlugin({
  selectedPaths,
  currentPath,
}: {
  selectedPaths?: string[];
  currentPath?: string;
}) {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [rules, setRules] = useState<Rule[]>([]);
  const [ghosts, setGhosts] = useState<GhostRecord[]>([]);
  const [stats, setStats] = useState<Stats>({ ruleCount: 0, ghostCount: 0, bytesReclaimed: 0 });
  const [busy, setBusy] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [draftRules, setDraftRules] = useState<Rule[] | null>(null);

  const displayRules = draftRules ?? rules;
  const enabledRules = useMemo(() => displayRules.filter(r => r.enabled && r.coldStorageRoot.trim()), [displayRules]);
  const defaultColdRoot = enabledRules[0]?.coldStorageRoot ?? '';

  const refresh = useCallback(async () => {
    const [r, s] = await Promise.all([IPC.ghostLinkGetRules(), IPC.ghostLinkGetStats()]);
    const nextRules = (Array.isArray(r.rules) ? r.rules : []).map(x => normalizeRule(x as Record<string, unknown>));
    const nextGhosts = (Array.isArray(s.ghosts) ? s.ghosts : []).map(x => normalizeGhost(x as Record<string, unknown>));
    setRules(nextRules);
    setDraftRules(null);
    setGhosts(nextGhosts);
    setStats(normalizeStats(s.stats as Record<string, unknown>));
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const onProgress = (e: Event) => {
      const p = (e as CustomEvent<ScanProgress>).detail;
      if (!p) return;
      setScanProgress(p);
    };
    window.addEventListener('bndz-ghost-link-progress', onProgress);
    return () => window.removeEventListener('bndz-ghost-link-progress', onProgress);
  }, []);

  const saveRules = async (next: Rule[]) => {
    setRules(next);
    setDraftRules(null);
    await IPC.ghostLinkSaveRules(next);
    await refresh();
  };

  const updateRuleAt = (id: string, next: Rule) => {
    setDraftRules(displayRules.map(r => (r.id === id ? next : r)));
  };

  const persistDraft = () => {
    if (draftRules) void saveRules(draftRules);
  };

  const addRule = (partial?: Partial<Rule>) => {
    const paneWin = currentPath && currentPath !== '/' ? toWindowsPath(currentPath) : '';
    const rule: Rule = {
      id: `rule_${Date.now()}`,
      name: partial?.name ?? 'New rule',
      enabled: true,
      sourceRoots: partial?.sourceRoots ?? (paneWin ? paneWin.replace(/\\$/, '') : ''),
      pathGlob: partial?.pathGlob ?? '**/*',
      extensions: partial?.extensions ?? '',
      minSizeBytes: partial?.minSizeBytes ?? 50 * 1024 * 1024,
      idleDays: partial?.idleDays ?? 30,
      coldStorageRoot: partial?.coldStorageRoot ?? '',
    };
    void saveRules([...rules, rule]);
    setActiveTab('rules');
  };

  const deleteRule = (id: string) => {
    void saveRules(rules.filter(r => r.id !== id));
  };

  const appendRootToRule = async (ruleId: string, field: 'sourceRoots' | 'coldStorageRoot') => {
    const picked = await IPC.openFolderDialog(field === 'sourceRoots' ? 'Select source folder to watch' : 'Select cold storage vault');
    if (!picked) return;
    const rule = displayRules.find(r => r.id === ruleId);
    if (!rule) return;
    const nextPath = picked.replace(/\\$/, '');
    const merged = field === 'sourceRoots'
      ? [rule.sourceRoots, nextPath].filter(Boolean).join(';').split(';').map(s => s.trim()).filter(Boolean).join(';')
      : nextPath;
    updateRuleAt(ruleId, { ...rule, [field]: merged });
    const next = displayRules.map(r => (r.id === ruleId ? { ...r, [field]: merged } : r));
    void saveRules(next);
  };

  const runScan = async (ruleId?: string) => {
    if (!enabledRules.length) {
      pushToast({ kind: 'warning', title: 'No active rules', message: 'Enable a rule with source roots and cold storage first.' });
      setActiveTab('rules');
      return;
    }
    setBusy(true);
    setScanProgress({ done: 0, total: 0, reclaimed: 0, current: '' });
    try {
      const r = await IPC.ghostLinkRunScan(ruleId);
      if (r.error) throw new Error(r.error);
      pushToast({
        kind: 'success',
        title: 'Ghost-Link scan complete',
        message: `${r.count ?? 0} file(s) offloaded to cold storage.`,
      });
      await refresh();
      if ((r.count ?? 0) > 0) setActiveTab('ghosts');
    } catch (e) {
      pushToast({ kind: 'error', title: 'Scan failed', message: String(e) });
    } finally {
      setBusy(false);
      setScanProgress(null);
    }
  };

  const offloadSelection = async () => {
    if (!selectedPaths?.length) return;
    if (!defaultColdRoot) {
      pushToast({ kind: 'warning', title: 'Cold storage required', message: 'Set a cold storage path on an enabled rule first.' });
      setActiveTab('rules');
      return;
    }
    setBusy(true);
    try {
      const r = await IPC.ghostLinkOffloadPaths(selectedPaths, defaultColdRoot);
      if (r.error) throw new Error(r.error);
      pushToast({ kind: 'success', title: 'Selection ghosted', message: `Reclaimed ${formatBytes(r.reclaimed ?? 0)} on disk.` });
      await refresh();
      setActiveTab('ghosts');
    } catch (e) {
      pushToast({ kind: 'error', title: 'Offload failed', message: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const restoreGhost = async (path: string) => {
    setBusy(true);
    try {
      const r = await IPC.ghostLinkRestore(path);
      if (r.error) throw new Error(r.error);
      pushToast({ kind: 'success', title: 'Restored', message: 'Original file materialized from cold storage.' });
      await refresh();
    } catch (e) {
      pushToast({ kind: 'error', title: 'Restore failed', message: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const [ghostSel, setGhostSel] = useState<Set<string>>(() => new Set());
  const restoreSelectedGhosts = async () => {
    const paths = [...ghostSel];
    if (!paths.length) return;
    setBusy(true);
    try {
      for (const p of paths) {
        await IPC.ghostLinkRestore(p);
      }
      pushToast({ kind: 'success', title: 'Restored', message: `${paths.length} ghost(s) restored.` });
      setGhostSel(new Set());
      await refresh();
    } catch (e) {
      pushToast({ kind: 'error', title: 'Restore failed', message: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const checkBrokenGhosts = async () => {
    const broken: string[] = [];
    for (const g of ghosts) {
      const cold = (g as any).coldPath || (g as any).targetPath;
      if (!cold) continue;
      try {
        const exists = await IPC.checkPathExists(cold);
        if (!exists) broken.push(g.originalPath);
      } catch { /* ignore */ }
    }
    if (broken.length) {
      pushToast({ kind: 'warning', title: 'Broken ghosts', message: `${broken.length} cold target(s) missing.` });
      setGhostSel(new Set(broken));
    } else {
      pushToast({ kind: 'success', title: 'Health check', message: 'All cold targets present.' });
    }
  };

  const revealPath = (winPath: string) => {
    if (!winPath) return;
    window.dispatchEvent(new CustomEvent('bndz-navigate', { detail: { path: winPath.replace(/^([A-Za-z]):\\/, '/$1/').replace(/\\/g, '/') } }));
  };

  const tabs: { id: TabId; label: string; icon: string; badge?: number }[] = [
    { id: 'overview', label: 'Overview', icon: 'piechart_ui' },
    { id: 'rules', label: 'Rules', icon: 'filter_ui', badge: displayRules.length },
    { id: 'ghosts', label: 'Ghosts', icon: 'emblem_symbolic_link', badge: ghosts.length },
  ];

  const scanPct = scanProgress && scanProgress.total > 0
    ? Math.round((scanProgress.done / scanProgress.total) * 100)
    : busy ? 0 : null;

  return (
    <PluginPanelShell
      title="Ghost-Link"
      icon="emblem_symbolic_link"
      iconColor="#a78bfa"
      variant="embedded"
      subtitle="Symlink offloading · cold storage vault"
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
      <div className="flex flex-col min-h-0 bndz-ghostlink-panel">
        <PluginHeroStrip
          icon={
            <div className="bndz-ghostlink-hero-icon flex items-center justify-center">
              <EmblemIcon id="emblem-symbolic-link" size={48} />
            </div>
          }
          name="Ghost-Link Storage"
          typeLabel="Symlink offloading"
          meta={
            <span className="bndz-panel-muted text-xs">
              {stats.ghostCount} ghost{stats.ghostCount === 1 ? '' : 's'} · {formatBytes(stats.bytesReclaimed)} reclaimed · {enabledRules.length} active rule{enabledRules.length === 1 ? '' : 's'}
            </span>
          }
          actions={
            <>
              <PluginHeroActionButton
                icon="search_ui"
                variant="primary"
                onClick={() => void runScan()}
                disabled={busy || !enabledRules.length}
              >
                Run scan
              </PluginHeroActionButton>
              {selectedPaths?.length ? (
                <PluginHeroActionButton
                  icon="emblem_symbolic_link"
                  onClick={() => void offloadSelection()}
                  disabled={busy || !defaultColdRoot}
                >
                  Ghost selection ({selectedPaths.length})
                </PluginHeroActionButton>
              ) : null}
              <PluginHeroActionButton icon="plus_ui" onClick={() => addRule()} disabled={busy}>
                New rule
              </PluginHeroActionButton>
              <PluginHeroActionButton icon="reset_ui" onClick={() => void refresh()} disabled={busy}>
                Refresh
              </PluginHeroActionButton>
            </>
          }
        />

        {scanPct != null && (
          <div className="bndz-ghostlink-progress shrink-0 px-5 py-2 border-b border-white/[0.06]">
            <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-wide text-violet-200/70 mb-1.5">
              <span>Scanning cold candidates…</span>
              <span>{scanProgress?.done ?? 0}/{scanProgress?.total ?? '…'} · {formatBytes(scanProgress?.reclaimed ?? 0)}</span>
            </div>
            <div className="bndz-ghostlink-progress-track">
              <div className="bndz-ghostlink-progress-fill" style={{ width: `${scanPct}%` }} />
            </div>
            {scanProgress?.current && (
              <p className="bndz-mono text-[10px] text-gray-500 mt-1 truncate" title={scanProgress.current}>
                {scanProgress.current}
              </p>
            )}
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto bndz-scrollbar">
          {activeTab === 'overview' && (
            <div className="p-5 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <PluginStatCard label="Active rules" value={String(enabledRules.length)} sub={`${displayRules.length} total configured`} iconId="filter_ui" />
                <PluginStatCard label="Ghost links" value={String(stats.ghostCount)} sub="Symlinks pointing to cold vault" iconId="emblem_symbolic_link" />
                <PluginStatCard label="Space reclaimed" value={formatBytes(stats.bytesReclaimed)} sub="On original volumes" iconId="storage_cleanup" />
              </div>

              <PluginCard className="bndz-ghostlink-howto">
                <PluginSectionTitle icon="zap_ui">How Ghost-Link works</PluginSectionTitle>
                <ol className="mt-3 space-y-2 text-xs text-gray-400 leading-relaxed list-decimal list-inside">
                  <li>Define rules with <strong className="text-gray-300">source roots</strong>, size/idle filters, and a <strong className="text-gray-300">cold storage vault</strong>.</li>
                  <li>Run a scan — matching files move to the vault; the original path becomes a symlink (ghost link).</li>
                  <li>Apps still open the same path; BNDZ tracks ghosts for one-click restore.</li>
                </ol>
              </PluginCard>

              <div>
                <PluginSectionTitle icon="layers_ui">Quick-start presets</PluginSectionTitle>
                <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                  {PRESETS.map(p => (
                    <button
                      key={p.name}
                      type="button"
                      className="bndz-ghostlink-preset-card text-left"
                      onClick={() => addRule({ name: p.name, ...p.rule })}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Icons8Icon id="plus_ui" size={12} className="text-violet-300" />
                        <span className="text-sm font-semibold text-white">{p.name}</span>
                      </div>
                      <p className="text-[11px] text-gray-500 leading-snug">{p.description}</p>
                    </button>
                  ))}
                </div>
              </div>

              {ghosts.length > 0 && (
                <div>
                  <PluginSectionTitle icon="emblem_symbolic_link" action={
                    <PluginToolbarButton onClick={() => setActiveTab('ghosts')}>View all</PluginToolbarButton>
                  }>
                    Recent ghosts
                  </PluginSectionTitle>
                  <div className="mt-2 space-y-1.5">
                    {ghosts.slice(0, 5).map(g => {
                      const { leaf, parent } = splitPath(g.originalPath);
                      return (
                        <div key={g.id} className="bndz-ghostlink-ghost-row">
                          <EmblemIcon id="emblem-symbolic-link" size={14} />
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-medium text-white truncate">{leaf}</div>
                            <div className="bndz-mono text-[10px] text-gray-500 truncate">{parent}</div>
                          </div>
                          <span className="text-[10px] text-violet-300/80 shrink-0">{formatBytes(g.bytesSaved)}</span>
                          <PluginToolbarButton icon="reset_ui" onClick={() => void restoreGhost(g.originalPath)} disabled={busy}>
                            Restore
                          </PluginToolbarButton>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'rules' && (
            <div className="p-5 space-y-4">
              {displayRules.length === 0 ? (
                <PluginEmptyState
                  icon="emblem_symbolic_link"
                  title="No rules yet"
                  description="Add a preset above or create a custom rule. Each rule needs source folders and a cold storage vault."
                />
              ) : (
                displayRules.map(rule => (
                  <RuleEditor
                    key={rule.id}
                    rule={rule}
                    onChange={next => updateRuleAt(rule.id, next)}
                    onSave={persistDraft}
                    onDelete={() => deleteRule(rule.id)}
                    onBrowseSource={() => void appendRootToRule(rule.id, 'sourceRoots')}
                    onBrowseCold={() => void appendRootToRule(rule.id, 'coldStorageRoot')}
                  />
                ))
              )}
              <div className="flex flex-wrap gap-2 pt-2">
                <PluginToolbarButton icon="plus_ui" onClick={() => addRule()}>Custom rule</PluginToolbarButton>
                {displayRules.some(r => r.enabled) && (
                  <PluginToolbarButton icon="search_ui" onClick={() => void runScan()} disabled={busy}>
                    Scan all enabled
                  </PluginToolbarButton>
                )}
              </div>
            </div>
          )}

          {activeTab === 'ghosts' && (
            <div className="p-5">
              {ghosts.length === 0 ? (
                <PluginEmptyState
                  icon="emblem_symbolic_link"
                  title="No ghost links yet"
                  description="Run a scan or ghost the current selection. Offloaded files appear here with restore controls."
                />
              ) : (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2 mb-2">
                    <PluginToolbarButton icon="check" onClick={() => setGhostSel(new Set(ghosts.map(g => g.originalPath)))}>Select all</PluginToolbarButton>
                    <PluginToolbarButton icon="reset_ui" onClick={() => void restoreSelectedGhosts()} disabled={busy || !ghostSel.size}>
                      Restore selected ({ghostSel.size})
                    </PluginToolbarButton>
                    <PluginToolbarButton icon="warning" onClick={() => void checkBrokenGhosts()} disabled={busy}>
                      Health check
                    </PluginToolbarButton>
                  </div>
                  {ghosts.map(g => {
                    const { leaf, parent } = splitPath(g.originalPath);
                    const cold = splitPath(g.offloadPath);
                    return (
                      <div key={g.id} className="bndz-ghostlink-ghost-row bndz-ghostlink-ghost-row--full">
                        <input
                          type="checkbox"
                          checked={ghostSel.has(g.originalPath)}
                          onChange={() => setGhostSel(prev => {
                            const next = new Set(prev);
                            if (next.has(g.originalPath)) next.delete(g.originalPath);
                            else next.add(g.originalPath);
                            return next;
                          })}
                        />
                        <EmblemIcon id="emblem-symbolic-link" size={16} />
                        <div className="min-w-0 flex-1 grid grid-cols-1 lg:grid-cols-2 gap-2">
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-white truncate">{leaf}</div>
                            <div className="bndz-mono text-[10px] text-gray-500 truncate" title={g.originalPath}>{parent}</div>
                          </div>
                          <div className="min-w-0">
                            <div className="text-[10px] uppercase tracking-wide text-gray-600">Cold vault</div>
                            <div className="bndz-mono text-[10px] text-gray-400 truncate" title={g.offloadPath}>{cold.parent}\{cold.leaf}</div>
                          </div>
                        </div>
                        <span className="text-[10px] font-semibold text-violet-300 shrink-0">{formatBytes(g.bytesSaved)}</span>
                        <div className="flex gap-1 shrink-0">
                          <PluginToolbarButton icon="folder_open_ui" onClick={() => revealPath(g.originalPath)} title="Reveal original path">
                            Reveal
                          </PluginToolbarButton>
                          <PluginToolbarButton icon="reset_ui" onClick={() => void restoreGhost(g.originalPath)} disabled={busy}>
                            Restore
                          </PluginToolbarButton>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </PluginPanelShell>
  );
}
