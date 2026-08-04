import React, { useCallback, useEffect, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
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
  PluginSectionTitle,
} from './PluginPanelPrimitives';

export const PolicyPackPluginDef = {
  id: 'policy-packs',
  name: 'Policy Packs',
  icon: 'shield_ui',
  description: 'Shareable folder policies — enforce extensions, size, tags, and deny patterns on drop/move.',
  targetPanel: 'bottom' as const,
  installOnFirstUse: false,
};

type PolicyPackRow = {
  id: string;
  name: string;
  allowedExtensions: string[];
  maxSizeBytes: number;
  requiredTags: string[];
  denyPatterns: string[];
  enforceOnDrop: boolean;
};

function normalizePack(raw: Record<string, unknown>): PolicyPackRow {
  return {
    id: String(raw.id ?? raw.Id ?? ''),
    name: String(raw.name ?? raw.Name ?? 'Pack'),
    allowedExtensions: (Array.isArray(raw.allowedExtensions) ? raw.allowedExtensions : []).map(String),
    maxSizeBytes: Number(raw.maxSizeBytes ?? raw.MaxSizeBytes ?? 0) || 0,
    requiredTags: (Array.isArray(raw.requiredTags) ? raw.requiredTags : []).map(String),
    denyPatterns: (Array.isArray(raw.denyPatterns) ? raw.denyPatterns : []).map(String),
    enforceOnDrop: !!(raw.enforceOnDrop ?? raw.EnforceOnDrop ?? true),
  };
}

function formatBytes(n: number): string {
  if (n <= 0) return 'No limit';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function PolicyPackPlugin({
  currentPath,
  selectedPaths,
}: {
  currentPath?: string;
  selectedPaths?: string[];
}) {
  const [packs, setPacks] = useState<PolicyPackRow[]>([]);
  const [editing, setEditing] = useState<PolicyPackRow | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const res = await IPC.policyPackList();
    if (res.ok && res.packs) setPacks(res.packs.map((p: Record<string, unknown>) => normalizePack(p)));
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const targetFolder = selectedPaths?.[0]
    ? toWindowsPath(selectedPaths[0])
    : currentPath ? toWindowsPath(currentPath) : '';

  const savePack = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      const res = await IPC.policyPackSave(editing as unknown as Record<string, unknown>);
      if (!res.ok) throw new Error(res.error || 'Save failed');
      pushToast({ kind: 'success', title: 'Policy pack saved', message: editing.name });
      setEditing(null);
      await refresh();
    } catch (e) {
      pushToast({ kind: 'error', title: 'Save failed', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const applyToFolder = async (packId: string) => {
    if (!targetFolder) {
      pushToast({ kind: 'warning', title: 'Select a folder', message: 'Choose a folder in the list or tree first.' });
      return;
    }
    setBusy(true);
    try {
      const res = await IPC.policyPackApply(targetFolder, packId);
      if (!res.ok) throw new Error(res.error || 'Apply failed');
      pushToast({ kind: 'success', title: 'Policy applied', message: targetFolder });
    } catch (e) {
      pushToast({ kind: 'error', title: 'Apply failed', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const newPack = () => setEditing({
    id: '',
    name: 'New policy pack',
    allowedExtensions: [],
    maxSizeBytes: 0,
    requiredTags: [],
    denyPatterns: [],
    enforceOnDrop: true,
  });

  return (
    <PluginPanelShell title="Policy Packs" icon="shield_ui">
      <PluginHeroStrip
        icon={<Icons8Icon id="shield_ui" size={40} />}
        name="Folder policy lint"
        typeLabel="Policy packs"
        meta={<span className="text-xs text-gray-400">eslint for directories — enforce on drop/move</span>}
        actions={
          <PluginHeroActionButton icon="add_ui" label="New pack" onClick={newPack} />
        }
      />

      {editing && (
        <PluginCard className="mb-3 p-3 space-y-2 bndz-policy-pack-editor">
          <PluginSectionTitle>Editor</PluginSectionTitle>
          <input
            className="w-full bg-[#1a1a1e] border border-white/10 rounded-md px-2 py-1.5 text-sm"
            value={editing.name}
            onChange={e => setEditing({ ...editing, name: e.target.value })}
            placeholder="Pack name"
          />
          <input
            className="w-full bg-[#1a1a1e] border border-white/10 rounded-md px-2 py-1.5 text-sm"
            value={editing.allowedExtensions.join(', ')}
            onChange={e => setEditing({ ...editing, allowedExtensions: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
            placeholder="Allowed extensions (mp3, wav, png)"
          />
          <input
            className="w-full bg-[#1a1a1e] border border-white/10 rounded-md px-2 py-1.5 text-sm"
            type="number"
            value={editing.maxSizeBytes}
            onChange={e => setEditing({ ...editing, maxSizeBytes: Number(e.target.value) || 0 })}
            placeholder="Max size bytes (0 = unlimited)"
          />
          <input
            className="w-full bg-[#1a1a1e] border border-white/10 rounded-md px-2 py-1.5 text-sm"
            value={editing.requiredTags.join(', ')}
            onChange={e => setEditing({ ...editing, requiredTags: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
            placeholder="Required tags"
          />
          <input
            className="w-full bg-[#1a1a1e] border border-white/10 rounded-md px-2 py-1.5 text-sm"
            value={editing.denyPatterns.join(', ')}
            onChange={e => setEditing({ ...editing, denyPatterns: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
            placeholder="Deny patterns (*.exe, temp_*)"
          />
          <label className="flex items-center gap-2 text-xs text-gray-300">
            <input type="checkbox" checked={editing.enforceOnDrop} onChange={e => setEditing({ ...editing, enforceOnDrop: e.target.checked })} />
            Enforce on drop / move
          </label>
          <div className="flex gap-2">
            <PluginToolbarButton label="Save" onClick={() => void savePack()} disabled={busy} />
            <PluginToolbarButton label="Cancel" onClick={() => setEditing(null)} />
          </div>
        </PluginCard>
      )}

      {packs.length === 0 ? (
        <PluginEmptyState icon="shield_ui" title="No policy packs" description="Create a pack and apply it to project folders." />
      ) : (
        <div className="space-y-2">
          {packs.map(p => (
            <PluginCard key={p.id} className="p-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium text-white flex items-center gap-2">
                  <Icons8Icon id="shield_ui" size={14} />
                  {p.name}
                </div>
                <div className="text-[11px] text-gray-400 mt-1 space-y-0.5">
                  {p.allowedExtensions.length > 0 && <div>Ext: {p.allowedExtensions.join(', ')}</div>}
                  <div>Max: {formatBytes(p.maxSizeBytes)}</div>
                  {p.requiredTags.length > 0 && <div>Tags: {p.requiredTags.join(', ')}</div>}
                  {p.denyPatterns.length > 0 && <div>Deny: {p.denyPatterns.join(', ')}</div>}
                </div>
              </div>
              <div className="flex flex-col gap-1 shrink-0">
                <PluginToolbarButton label="Edit" onClick={() => setEditing(p)} />
                <PluginToolbarButton label="Apply here" onClick={() => void applyToFolder(p.id)} disabled={busy} />
              </div>
            </PluginCard>
          ))}
        </div>
      )}
    </PluginPanelShell>
  );
}
