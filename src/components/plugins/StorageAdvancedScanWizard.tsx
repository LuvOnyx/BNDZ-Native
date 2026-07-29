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
import { formatStorageSize } from '../../lib/storageOrganize';
import {
  buildExecutePayload,
  CLEANUP_CATEGORY_PRESETS,
  normalizeScanCategories,
  riskClass,
  riskLabel,
  totalSelectedBytes,
  totalSelectedCount,
  type CleanupScanCategory,
} from '../../lib/storageCleanup';

type WizardStep = 'options' | 'scan' | 'results' | 'done';

export interface StorageAdvancedScanWizardProps {
  onClose: () => void;
  onComplete?: () => void;
}

export default function StorageAdvancedScanWizard({ onClose, onComplete }: StorageAdvancedScanWizardProps) {
  const [step, setStep] = useState<WizardStep>('options');
  const [selectedPresets, setSelectedPresets] = useState<Set<string>>(
    () => new Set(CLEANUP_CATEGORY_PRESETS.filter(p => p.risk === 'safe').map(p => p.id)),
  );
  const [largeMinMb, setLargeMinMb] = useState(100);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<{ percent: number; phase: string; currentPath: string } | null>(null);
  const [categories, setCategories] = useState<CleanupScanCategory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const [resultMsg, setResultMsg] = useState('');
  const [resultOk, setResultOk] = useState(false);

  useEffect(() => {
    if (!IPC.isNative) return;
    const unsub = IPC.onStorageCleanupScanProgress(p => setProgress(p));
    return unsub;
  }, []);

  const togglePreset = (id: string) => {
    setSelectedPresets(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runScan = async () => {
    setScanning(true);
    setError(null);
    setStep('scan');
    setProgress({ percent: 0, phase: 'Starting', currentPath: '' });
    try {
      const result = await IPC.scanStorageCleanup({
        categoryIds: [...selectedPresets],
        largeFileMinBytes: largeMinMb * 1024 * 1024,
        largeFileLimit: 250,
      });
      if (result.error) throw new Error(result.error);
      const cats = normalizeScanCategories(result.categories || []);
      if (!cats.length) {
        setError('Scan complete — nothing matched the selected categories.');
        setStep('options');
        return;
      }
      setCategories(cats);
      setStep('results');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Scan failed');
      setStep('options');
    } finally {
      setScanning(false);
      setProgress(null);
    }
  };

  const selectedBytes = useMemo(() => totalSelectedBytes(categories), [categories]);
  const selectedCount = useMemo(() => totalSelectedCount(categories), [categories]);

  const toggleCategory = useCallback((id: string, on?: boolean) => {
    setCategories(prev => prev.map(c => {
      if (c.id !== id) return c;
      const selected = on ?? !c.selected;
      return {
        ...c,
        selected,
        items: c.items.map(i => ({ ...i, selected })),
      };
    }));
  }, []);

  const toggleItem = useCallback((catId: string, itemId: string) => {
    setCategories(prev => prev.map(c => {
      if (c.id !== catId) return c;
      const items = c.items.map(i => i.id === itemId ? { ...i, selected: !i.selected } : i);
      const anySelected = items.some(i => i.selected);
      return { ...c, items, selected: anySelected };
    }));
  }, []);

  const toggleExpand = (id: string) => {
    setCategories(prev => prev.map(c => c.id === id ? { ...c, expanded: !c.expanded } : c));
  };

  const selectAllSafe = () => {
    setCategories(prev => prev.map(c => ({
      ...c,
      selected: c.risk === 'safe',
      items: c.items.map(i => ({ ...i, selected: c.risk === 'safe' && i.defaultSelected })),
    })));
  };

  const runCleanup = async () => {
    const payload = buildExecutePayload(categories);
    if (!payload.length) return;
    setExecuting(true);
    try {
      const result = await IPC.executeStorageCleanup(payload);
      setResultOk(result.errors.length === 0);
      setResultMsg(
        result.errors.length
          ? `Cleaned ${result.processedCount} item(s), freed ~${formatStorageSize(result.freedBytes)}. ${result.errors.length} error(s).`
          : `Cleaned ${result.processedCount} item(s) · reclaimed ~${formatStorageSize(result.freedBytes)}`,
      );
      setStep('done');
    } catch (err: unknown) {
      setResultOk(false);
      setResultMsg(err instanceof Error ? err.message : 'Cleanup failed');
      setStep('done');
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div className="absolute inset-0 z-20 flex flex-col bndz-plugin-tier bg-[var(--bndz-surface-panel,#0c0e14)] text-slate-300" data-testid="storage-advanced-scan-wizard">
      <div className="bndz-plugin-toolbar shrink-0 px-5 py-4 border-b border-white/[0.06] flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border border-emerald-500/30 bg-emerald-500/10">
          <Icons8Icon id="storage_cleanup" size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-white tracking-tight">Advanced Storage Scan</h2>
          <p className="text-xs bndz-panel-muted mt-0.5">CCleaner-style intelligent cleanup · you choose what gets removed</p>
        </div>
        <button type="button" onClick={onClose} disabled={executing || scanning} className="p-2 rounded-lg text-gray-500 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40" aria-label="Close">
          <CloseGlyph size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto bndz-scrollbar p-5">
        <AnimatePresence mode="wait">
          {step === 'options' && (
            <motion.div key="opts" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="max-w-2xl mx-auto space-y-4">
              <PluginCard>
                <PluginSectionTitle icon="layers_ui">Scan categories</PluginSectionTitle>
                <p className="text-xs bndz-panel-muted mb-3">Select what to analyze. Safe categories are pre-checked; advanced items require your review before delete.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {CLEANUP_CATEGORY_PRESETS.map(p => {
                    const on = selectedPresets.has(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => togglePreset(p.id)}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-left transition-all ${
                          on ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-white/[0.06] bg-black/20 hover:bg-white/[0.04]'
                        }`}
                      >
                        <input type="checkbox" readOnly checked={on} className="accent-emerald-500 rounded pointer-events-none" />
                        <Icons8Icon id={p.icon} size={14} className="shrink-0 opacity-80" />
                        <span className="text-[12px] font-medium text-gray-200 flex-1">{p.label}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded border ${riskClass(p.risk)}`}>{riskLabel(p.risk)}</span>
                      </button>
                    );
                  })}
                </div>
              </PluginCard>
              <PluginCard className="space-y-3">
                <PluginFieldLabel>Large file threshold (indexed + profile scan)</PluginFieldLabel>
                <select value={largeMinMb} onChange={e => setLargeMinMb(Number(e.target.value))} className={PLUGIN_SELECT_CLASS}>
                  {[50, 100, 250, 500, 1024].map(mb => <option key={mb} value={mb}>{mb} MB</option>)}
                </select>
              </PluginCard>
              {error && <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 px-4 py-3 text-[12px] text-amber-300">{error}</div>}
            </motion.div>
          )}

          {step === 'scan' && (
            <motion.div key="scan" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center py-20 gap-4">
              <Icons8Icon id="loading" size={36} spin />
              <p className="text-[13px] text-gray-400">{progress?.phase || 'Scanning…'}</p>
              {progress && (
                <div className="w-full max-w-md bndz-plugin-card border border-emerald-500/25 p-4">
                  <div className="flex justify-between text-[11px] mb-2">
                    <span className="text-emerald-300">{progress.percent}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-black/40 overflow-hidden">
                    <div className="h-full bg-emerald-500 transition-all" style={{ width: `${progress.percent}%` }} />
                  </div>
                  <div className="text-[10px] text-gray-600 font-mono truncate mt-2">{progress.currentPath}</div>
                </div>
              )}
            </motion.div>
          )}

          {step === 'results' && (
            <motion.div key="results" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="max-w-3xl mx-auto space-y-3">
              <PluginCard className="border-emerald-500/25 bg-emerald-950/15 !py-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[13px] font-bold text-emerald-200">Review before cleanup</div>
                  <div className="text-[11px] text-gray-400 mt-1">
                    {selectedCount} item(s) selected · {formatStorageSize(selectedBytes)} reclaimable
                  </div>
                </div>
                <div className="flex gap-2">
                  <PluginToolbarButton onClick={selectAllSafe}>Select safe only</PluginToolbarButton>
                  <PluginToolbarButton onClick={() => setCategories(prev => prev.map(c => ({ ...c, selected: true, items: c.items.map(i => ({ ...i, selected: true })) })))}>Select all</PluginToolbarButton>
                </div>
              </PluginCard>

              {categories.map(cat => (
                <PluginCard key={cat.id} className="!p-0 overflow-hidden">
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.04]">
                    <input
                      type="checkbox"
                      checked={!!cat.selected}
                      onChange={() => toggleCategory(cat.id)}
                      className="accent-emerald-500 rounded"
                    />
                    <button type="button" className="flex-1 flex items-center gap-2 text-left min-w-0" onClick={() => toggleExpand(cat.id)}>
                      {cat.expanded ? <Icons8Icon id="chevron_down" size={12} /> : <Icons8Icon id="chevron_right" size={12} />}
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-semibold text-gray-100">{cat.name}</div>
                        <div className="text-[10px] bndz-panel-muted truncate">{cat.description}</div>
                      </div>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded border shrink-0 ${riskClass(cat.risk)}`}>{riskLabel(cat.risk)}</span>
                      <span className="text-[11px] font-mono text-emerald-400 shrink-0">{formatStorageSize(cat.totalBytes)}</span>
                      <span className="text-[10px] text-gray-600 shrink-0">{cat.itemCount} items</span>
                    </button>
                  </div>
                  {cat.expanded && (
                    <div className="max-h-[200px] overflow-y-auto bndz-scrollbar divide-y divide-white/[0.03]">
                      {cat.items.length === 0 ? (
                        <div className="px-4 py-3 text-[11px] text-gray-500">Category summary — enable checkbox to include in cleanup.</div>
                      ) : cat.items.map(item => (
                        <label key={item.id} className="flex items-center gap-2 px-4 py-2 text-[11px] hover:bg-white/[0.03] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={!!item.selected}
                            onChange={() => toggleItem(cat.id, item.id)}
                            className="accent-emerald-500 rounded shrink-0"
                          />
                          <span className="truncate flex-1 text-gray-300" title={item.path}>{item.name}</span>
                          <span className="font-mono text-gray-500 shrink-0">{formatStorageSize(item.size)}</span>
                        </label>
                      ))}
                      {cat.itemCount > cat.items.length && (
                        <div className="px-4 py-2 text-[10px] text-gray-600">+ {cat.itemCount - cat.items.length} more items in this category</div>
                      )}
                    </div>
                  )}
                </PluginCard>
              ))}
            </motion.div>
          )}

          {step === 'done' && (
            <motion.div key="done" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center justify-center py-16 gap-4 text-center max-w-md mx-auto">
              <Icons8Icon id={resultOk ? 'check' : 'error_ui'} size={48} className={resultOk ? 'text-emerald-400' : 'text-amber-400'} />
              <p className={`text-[14px] font-medium ${resultOk ? 'text-emerald-200' : 'text-amber-200'}`}>{resultMsg}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="shrink-0 px-5 py-4 border-t border-white/[0.06] flex items-center justify-between gap-3 bg-black/30">
        <PluginToolbarButton onClick={() => { if (step === 'results') setStep('options'); else onClose(); }} disabled={executing || scanning}>
          {step === 'results' ? 'Back' : 'Cancel'}
        </PluginToolbarButton>
        <div className="flex gap-2">
          {step === 'options' && (
            <PluginToolbarButton icon={scanning ? 'loading' : 'file_search_ui'} active onClick={() => void runScan()} disabled={scanning || selectedPresets.size === 0}>
              Analyze storage
            </PluginToolbarButton>
          )}
          {step === 'results' && (
            <PluginToolbarButton icon={executing ? 'loading' : 'trash_ui'} active onClick={() => void runCleanup()} disabled={executing || selectedCount === 0}>
              Clean {selectedCount} selected
            </PluginToolbarButton>
          )}
          {step === 'done' && (
            <PluginToolbarButton active onClick={() => { onComplete?.(); onClose(); }}>Done</PluginToolbarButton>
          )}
        </div>
      </div>
    </div>
  );
}
