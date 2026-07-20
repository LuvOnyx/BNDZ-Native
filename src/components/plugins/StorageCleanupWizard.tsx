import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Icons8Icon } from '../Icons8Icon';
import { CloseGlyph } from '../ChromeGlyphs';
import { IPC } from '../../lib/ipcBridge';
import {
  PluginToolbarButton,
  PluginSectionTitle,
  PluginCard,
  PluginFieldLabel,
  PLUGIN_SELECT_CLASS,
} from './PluginPanelPrimitives';
import {
  ORGANIZE_BUCKETS,
  buildDuplicateCleanupPreview,
  buildOrganizePlan,
  formatStorageSize,
  groupOrganizePlanByBucket,
  panePathFromWin,
  winPathFromPane,
  type DupKeepRule,
  type DuplicateCleanupPreview,
  type OrganizePlanEntry,
} from '../../lib/storageOrganize';

export type StorageWizardMode = 'organize' | 'cleanup';

type WizardStep = 'folder' | 'analyze' | 'preview' | 'done';

export interface StorageCleanupWizardProps {
  mode: StorageWizardMode;
  initialFolderPanePath?: string;
  onClose: () => void;
  onComplete?: () => void;
}

const STEPS: WizardStep[] = ['folder', 'analyze', 'preview', 'done'];

function stepLabel(step: WizardStep, mode: StorageWizardMode): string {
  switch (step) {
    case 'folder': return 'Select folder';
    case 'analyze': return mode === 'organize' ? 'Build plan' : 'Scan duplicates';
    case 'preview': return 'Review & confirm';
    case 'done': return 'Complete';
  }
}

export default function StorageCleanupWizard({
  mode,
  initialFolderPanePath,
  onClose,
  onComplete,
}: StorageCleanupWizardProps) {
  const [step, setStep] = useState<WizardStep>('folder');
  const [folderWin, setFolderWin] = useState('');
  const [folderPane, setFolderPane] = useState(initialFolderPanePath || '');
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const [resultMessage, setResultMessage] = useState('');
  const [resultOk, setResultOk] = useState(false);

  // Organize state
  const [organizePlan, setOrganizePlan] = useState<OrganizePlanEntry[]>([]);

  // Cleanup state
  const [dupKeepRule, setDupKeepRule] = useState<DupKeepRule>('first');
  const [dupRecursive, setDupRecursive] = useState(true);
  const [dupMinKb, setDupMinKb] = useState(4);
  const [dupProgress, setDupProgress] = useState<{ percent: number; currentPath: string } | null>(null);
  const [dupPreview, setDupPreview] = useState<DuplicateCleanupPreview[]>([]);

  useEffect(() => {
    if (initialFolderPanePath && !folderWin) {
      const win = winPathFromPane(initialFolderPanePath);
      if (win) {
        setFolderPane(initialFolderPanePath);
        setFolderWin(win);
      }
    }
  }, [initialFolderPanePath, folderWin]);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    if (IPC.isNative && mode === 'cleanup') {
      unsub = IPC.onDuplicateScanProgress(p => setDupProgress({ percent: p.percent, currentPath: p.currentPath }));
    }
    return () => unsub?.();
  }, [mode]);

  const stepIndex = STEPS.indexOf(step);

  const setFolderFromWin = useCallback((win: string) => {
    const trimmed = win.trim();
    setFolderWin(trimmed);
    setFolderPane(trimmed ? panePathFromWin(trimmed) : '');
  }, []);

  const pickFolder = async () => {
    const desc = mode === 'organize'
      ? 'Select the folder to organize'
      : 'Select the folder to scan for duplicates';
    const picked = await IPC.openFolderDialog(desc);
    if (picked) setFolderFromWin(picked);
  };

  const useCurrentFolder = () => {
    if (initialFolderPanePath) {
      const win = winPathFromPane(initialFolderPanePath);
      if (win) setFolderFromWin(win);
    }
  };

  const runAnalyze = async () => {
    if (!folderWin) {
      setAnalyzeError('Choose a folder first.');
      return;
    }
    setAnalyzing(true);
    setAnalyzeError(null);
    setStep('analyze');

    try {
      if (mode === 'organize') {
        const entries = await IPC.getDirContents(folderPane || panePathFromWin(folderWin));
        const plan = buildOrganizePlan(folderWin, entries, folderPane);
        if (!plan.length) {
          setAnalyzeError('No loose files to organize in this folder (only subfolders or empty).');
          setStep('folder');
          return;
        }
        setOrganizePlan(plan);
        setStep('preview');
      } else {
        setDupProgress({ percent: 0, currentPath: '' });
        const result = await IPC.scanDuplicates(folderWin, dupRecursive, dupMinKb * 1024);
        if (result.error) throw new Error(result.error);
        const groups = result.groups || [];
        if (!groups.length) {
          setAnalyzeError('No duplicate files found in this folder.');
          setStep('folder');
          return;
        }
        setDupPreview(buildDuplicateCleanupPreview(groups, dupKeepRule));
        setStep('preview');
      }
    } catch (err: unknown) {
      setAnalyzeError(err instanceof Error ? err.message : 'Analysis failed.');
      setStep('folder');
    } finally {
      setAnalyzing(false);
      setDupProgress(null);
    }
  };

  const organizeByBucket = useMemo(() => groupOrganizePlanByBucket(organizePlan), [organizePlan]);

  const totalReclaimable = useMemo(
    () => dupPreview.reduce((s, g) => s + g.reclaimable, 0),
    [dupPreview],
  );

  const totalDeleteCount = useMemo(
    () => dupPreview.reduce((s, g) => s + g.deletePaths.length, 0),
    [dupPreview],
  );

  const executeOrganize = async () => {
    if (!organizePlan.length) return;
    setExecuting(true);
    let moved = 0;
    try {
      const mkdirDone = new Set<string>();
      for (const entry of organizePlan) {
        const destDir = entry.dest.replace(/\\[^\\]+$/, '');
        if (!mkdirDone.has(destDir.toLowerCase())) {
          await IPC.executeFsOperation(`org-mkdir-${destDir}`, 'create-dir', destDir, '');
          mkdirDone.add(destDir.toLowerCase());
        }
        await IPC.executeFsOperation(`org-move-${entry.name}-${moved}`, 'move', entry.file, entry.dest);
        moved++;
      }
      setResultOk(true);
      setResultMessage(`Organized ${moved} file(s) into category subfolders.`);
      setStep('done');
    } catch (err: unknown) {
      setResultOk(false);
      setResultMessage(err instanceof Error ? err.message : 'Organize failed.');
      setStep('done');
    } finally {
      setExecuting(false);
    }
  };

  const executeCleanup = async () => {
    if (!dupPreview.length) return;
    setExecuting(true);
    let deleted = 0;
    try {
      for (const group of dupPreview) {
        for (const p of group.deletePaths) {
          await IPC.executeFsOperation(`dup-del-${deleted}`, 'delete', p, '');
          deleted++;
        }
      }
      setResultOk(true);
      setResultMessage(`Removed ${deleted} duplicate file(s). Reclaimed ~${formatStorageSize(totalReclaimable)}.`);
      setStep('done');
    } catch (err: unknown) {
      setResultOk(false);
      setResultMessage(err instanceof Error ? err.message : 'Cleanup failed.');
      setStep('done');
    } finally {
      setExecuting(false);
    }
  };

  const handleConfirm = () => {
    if (mode === 'organize') void executeOrganize();
    else void executeCleanup();
  };

  const title = mode === 'organize' ? 'Smart Organize Wizard' : 'Storage Cleanup Wizard';
  const accent = mode === 'organize' ? '#34d399' : '#0078d4';
  const headerIconId = mode === 'organize' ? 'folder_plus_ui' : 'copy';

  return (
    <div
      className="absolute inset-0 z-20 flex flex-col bndz-plugin-tier bg-[var(--bndz-surface-panel,#0c0e14)] text-slate-300"
      data-testid="storage-cleanup-wizard"
    >
      {/* Header */}
      <div className="bndz-plugin-toolbar shrink-0 px-5 py-4 border-b border-white/[0.06] flex items-center gap-4">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border border-white/[0.06]"
          style={{ background: `${accent}18`, borderColor: `${accent}40` }}
        >
          <Icons8Icon id={headerIconId} size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-white tracking-tight">{title}</h2>
          <p className="text-xs bndz-panel-muted mt-0.5">
            {stepLabel(step, mode)} · Step {Math.min(stepIndex + 1, 3)} of 3
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={executing || analyzing}
          className="p-2 rounded-lg text-gray-500 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40"
          aria-label="Close wizard"
        >
          <CloseGlyph size={16} />
        </button>
      </div>

      {/* Step indicator */}
      <div className="shrink-0 px-5 py-3 flex items-center gap-2 border-b border-white/[0.06]">
        {(['folder', 'analyze', 'preview'] as const).map((s, i) => {
          const active = step === s || (step === 'done' && s === 'preview');
          const done = stepIndex > i || step === 'done';
          return (
            <React.Fragment key={s}>
              {i > 0 && <Icons8Icon id="chevron_right" size={12} className="text-slate-600 shrink-0" />}
              <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium ${
                active ? 'bg-white/10 text-white' : done ? 'text-emerald-500/80' : 'bndz-panel-muted'
              }`}>
                {done && !active ? <Icons8Icon id="check" size={11} /> : <span className="w-4 text-center">{i + 1}</span>}
                {stepLabel(s, mode)}
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto bndz-scrollbar p-5">
        <AnimatePresence mode="wait">
          {step === 'folder' && (
            <motion.div key="folder" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="max-w-xl mx-auto space-y-4">
              <PluginCard>
                <PluginSectionTitle icon="pin_ui">Target folder</PluginSectionTitle>
                <div className="rounded-md border border-white/[0.06] bg-black/40 px-4 py-3 bndz-mono text-xs text-gray-300 min-h-[44px] flex items-center break-all">
                  {folderWin || <span className="bndz-panel-muted italic">No folder selected</span>}
                </div>
                <div className="flex flex-wrap gap-2 mt-4">
                  <PluginToolbarButton icon="folder_open_ui" onClick={() => void pickFolder()}>Browse…</PluginToolbarButton>
                  {initialFolderPanePath && (
                    <PluginToolbarButton onClick={useCurrentFolder}>Use current folder</PluginToolbarButton>
                  )}
                </div>
              </PluginCard>

              {mode === 'cleanup' && (
                <PluginCard className="border-violet-500/20 bg-violet-950/10 space-y-3">
                  <PluginSectionTitle>Scan options</PluginSectionTitle>
                  <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                    <input type="checkbox" checked={dupRecursive} onChange={e => setDupRecursive(e.target.checked)} className="accent-violet-500 rounded" />
                    Include subfolders
                  </label>
                  <div>
                    <PluginFieldLabel>Minimum file size</PluginFieldLabel>
                    <select value={dupMinKb} onChange={e => setDupMinKb(Number(e.target.value))} className={PLUGIN_SELECT_CLASS}>
                      {[1, 4, 16, 64, 256, 1024].map(k => <option key={k} value={k}>{k} KB</option>)}
                    </select>
                  </div>
                  <div>
                    <PluginFieldLabel>Keep rule</PluginFieldLabel>
                    <select value={dupKeepRule} onChange={e => setDupKeepRule(e.target.value as DupKeepRule)} className={PLUGIN_SELECT_CLASS}>
                      <option value="first">First in group</option>
                      <option value="newest">Newest path</option>
                      <option value="oldest">Oldest path</option>
                      <option value="shortest">Shortest path</option>
                    </select>
                  </div>
                </PluginCard>
              )}

              {mode === 'organize' && (
                <PluginCard className="border-emerald-500/20 bg-emerald-950/10">
                  <PluginSectionTitle>Categories</PluginSectionTitle>
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {Object.entries(ORGANIZE_BUCKETS).concat([['Other', { re: /$/, color: '#6b7280', icon: 'folder_open_ui' }]]).map(([bucket, cfg]) => (
                      <span key={bucket} className="bndz-plugin-kind-pill border border-white/[0.06] inline-flex items-center gap-1.5" style={{ color: cfg.color, background: `${cfg.color}12` }}>
                        <Icons8Icon id={cfg.icon} size={12} />
                        {bucket}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs bndz-panel-muted">Only loose files in the selected folder are moved. Subfolders are not modified.</p>
                </PluginCard>
              )}

              {analyzeError && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 px-4 py-3 text-[12px] text-amber-300">
                  {analyzeError}
                </div>
              )}
            </motion.div>
          )}

          {step === 'analyze' && (
            <motion.div key="analyze" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center justify-center py-20 gap-4">
              <Icons8Icon id="loading" size={36} spin />
              <p className="text-[13px] text-gray-400">
                {mode === 'organize' ? 'Building organization plan…' : 'Scanning for duplicate files…'}
              </p>
              {dupProgress && (
                <div className="bndz-plugin-card w-full max-w-md border border-violet-500/25 p-4">
                  <div className="flex justify-between text-[11px] mb-2">
                    <span className="text-violet-300">{dupProgress.percent}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-black/40 overflow-hidden border border-white/[0.06]">
                    <div className="h-full bg-[#0078d4] transition-all" style={{ width: `${dupProgress.percent}%` }} />
                  </div>
                  <div className="text-[10px] text-gray-600 font-mono truncate mt-2">{dupProgress.currentPath}</div>
                </div>
              )}
            </motion.div>
          )}

          {step === 'preview' && mode === 'organize' && (
            <motion.div key="preview-org" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4 max-w-3xl mx-auto">
              <PluginCard className="border-emerald-500/25 bg-emerald-950/15 !px-5 !py-4 flex items-center justify-between">
                <div>
                  <div className="text-[13px] font-bold text-emerald-200">{organizePlan.length} files will be organized</div>
                  <div className="text-[11px] text-gray-500 mt-1 font-mono truncate max-w-md">{folderWin}</div>
                </div>
                <Icons8Icon id="sparkles_ui" size={20} className="text-emerald-500/50" />
              </PluginCard>
              {Object.entries(organizeByBucket).sort((a, b) => b[1].length - a[1].length).map(([bucket, entries]) => {
                const cfg = ORGANIZE_BUCKETS[bucket];
                const iconId = cfg?.icon || 'folder_open_ui';
                return (
                  <PluginCard key={bucket} className="!p-0 overflow-hidden border border-white/[0.06]">
                    <div className="px-4 py-2.5 border-b border-white/[0.06] flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider" style={{ color: cfg?.color || '#9ca3af' }}>
                      <Icons8Icon id={iconId} size={13} />
                      {bucket}
                      <span className="ml-auto text-gray-600 font-mono normal-case">{entries.length} files → {bucket}/</span>
                    </div>
                    <div className="max-h-[140px] overflow-y-auto bndz-scrollbar divide-y divide-white/[0.04]">
                      {entries.slice(0, 24).map(e => (
                        <div key={e.file} className="px-4 py-2 flex items-center gap-2 text-[11px]">
                          <span className="text-gray-300 truncate flex-1">{e.name}</span>
                          <Icons8Icon id="arrow_right_ui" size={10} className="text-gray-600 shrink-0" />
                          <span className="text-gray-500 shrink-0">{bucket}\</span>
                        </div>
                      ))}
                      {entries.length > 24 && (
                        <div className="px-4 py-2 text-[10px] text-gray-600">+ {entries.length - 24} more…</div>
                      )}
                    </div>
                  </PluginCard>
                );
              })}
            </motion.div>
          )}

          {step === 'preview' && mode === 'cleanup' && (
            <motion.div key="preview-clean" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4 max-w-3xl mx-auto">
              <PluginCard className="border-[#0078d4]/30 bg-[#094771]/20 !px-5 !py-4 flex items-center justify-between">
                <div>
                  <div className="text-[13px] font-bold text-[#cce4f7]">
                    {totalDeleteCount} duplicate files will be removed
                  </div>
                  <div className="text-[11px] text-emerald-400/90 mt-1">
                    Reclaim ~{formatStorageSize(totalReclaimable)} · {dupPreview.length} groups
                  </div>
                </div>
                <Icons8Icon id="shield_ui" size={20} className="text-[#7eb8e8]/50" />
              </PluginCard>
              <div className="space-y-3 max-h-[360px] overflow-y-auto bndz-scrollbar pr-1">
                {dupPreview.map(group => (
                  <PluginCard key={group.hash} className="border border-white/[0.06] !p-4">
                    <div className="text-[11px] font-semibold text-gray-200 mb-2">
                      {group.paths.length} copies · {formatStorageSize(group.size)} each
                    </div>
                    <div className="text-[10px] text-emerald-400/90 mb-1">Keep: {group.keepPath}</div>
                    {group.deletePaths.map(p => (
                      <div key={p} className="text-[10px] text-rose-400/80 font-mono truncate flex items-center gap-1">
                        <Icons8Icon id="trash_ui" size={9} className="shrink-0" /> {p}
                      </div>
                    ))}
                  </PluginCard>
                ))}
              </div>
            </motion.div>
          )}

          {step === 'done' && (
            <motion.div key="done" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center justify-center py-16 gap-4 max-w-md mx-auto text-center">
              {resultOk ? (
                <Icons8Icon id="check" size={48} className="text-emerald-400" />
              ) : (
                <Icons8Icon id="error_ui" size={48} className="text-amber-400" />
              )}
              <p className={`text-[14px] font-medium ${resultOk ? 'text-emerald-200' : 'text-amber-200'}`}>{resultMessage}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Footer actions */}
      <div className="shrink-0 px-5 py-4 border-t border-white/[0.06] flex items-center justify-between gap-3 bg-black/30">
        <PluginToolbarButton
          icon="chevron_left"
          onClick={() => {
            if (step === 'preview') setStep('folder');
            else onClose();
          }}
          disabled={executing || analyzing}
        >
          {step === 'preview' ? 'Back' : step === 'done' ? 'Close' : 'Cancel'}
        </PluginToolbarButton>

        <div className="flex gap-2">
          {step === 'folder' && (
            <PluginToolbarButton
              icon={analyzing ? 'loading' : 'arrow_right_ui'}
              onClick={() => void runAnalyze()}
              disabled={!folderWin || analyzing}
              active
            >
              Continue
            </PluginToolbarButton>
          )}
          {step === 'preview' && (
            <PluginToolbarButton
              icon={executing ? 'loading' : mode === 'cleanup' ? 'trash_ui' : 'check'}
              onClick={handleConfirm}
              disabled={executing}
              active
            >
              {executing ? 'Working…' : mode === 'cleanup' ? `Delete ${totalDeleteCount} duplicates` : `Organize ${organizePlan.length} files`}
            </PluginToolbarButton>
          )}
          {step === 'done' && resultOk && (
            <PluginToolbarButton active onClick={() => { onComplete?.(); onClose(); }}>Done</PluginToolbarButton>
          )}
        </div>
      </div>
    </div>
  );
}
