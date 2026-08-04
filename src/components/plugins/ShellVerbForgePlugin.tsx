import React, { useCallback, useEffect, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { IPC } from '../../lib/ipcBridge';
import { pushToast } from '../ToastHost';
import {
  PluginToolbarButton,
  PluginCard,
  PluginEmptyState,
  PluginFieldLabel,
  PLUGIN_INPUT_CLASS,
  PLUGIN_SELECT_CLASS,
} from './PluginPanelPrimitives';

type VerbEntry = {
  id: string;
  label: string;
  verbKey: string;
  targetClass: string;
  argTemplate: string;
  icon: string;
  deployed: boolean;
};

const TARGET_OPTIONS = [
  { value: '*', label: 'Files & folders' },
  { value: 'Directory', label: 'Folders only' },
  { value: 'Directory\\Background', label: 'Folder background' },
];

const ARG_PRESETS = [
  { value: '--open-path "%1"', label: 'Open path in BNDZ' },
  { value: '--copy-path "%1"', label: 'Copy path (host verb)' },
  { value: '--open-terminal "%1"', label: 'Open terminal here' },
];

function normalizeVerb(raw: Record<string, unknown>): VerbEntry {
  return {
    id: String(raw.id ?? raw.Id ?? ''),
    label: String(raw.label ?? raw.Label ?? ''),
    verbKey: String(raw.verbKey ?? raw.VerbKey ?? ''),
    targetClass: String(raw.targetClass ?? raw.TargetClass ?? '*'),
    argTemplate: String(raw.argTemplate ?? raw.ArgTemplate ?? '--open-path "%1"'),
    icon: String(raw.icon ?? raw.Icon ?? ''),
    deployed: !!(raw.deployed ?? raw.Deployed),
  };
}

/** Explorer verb forge UI — lives inside Shell Menus (not a sibling plugin). */
export function ShellVerbForgePanel() {
  const [verbs, setVerbs] = useState<VerbEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editVerbKey, setEditVerbKey] = useState('');
  const [editTarget, setEditTarget] = useState('*');
  const [editArg, setEditArg] = useState('--open-path "%1"');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await IPC.verbForgeList();
      const list = Array.isArray(res.verbs) ? res.verbs.map((v: Record<string, unknown>) => normalizeVerb(v)) : [];
      setVerbs(list);
      if (list.length && !selectedId) setSelectedId(list[0].id);
    } catch {
      pushToast('Failed to load shell verbs', 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => { void refresh(); }, []);

  const selected = verbs.find(v => v.id === selectedId);

  useEffect(() => {
    if (!selected) return;
    setEditLabel(selected.label);
    setEditVerbKey(selected.verbKey);
    setEditTarget(selected.targetClass);
    setEditArg(selected.argTemplate);
  }, [selected?.id]);

  const saveVerb = async () => {
    setBusy(true);
    try {
      const res = await IPC.verbForgeSave({
        id: selected?.id,
        label: editLabel.trim() || 'BNDZ Verb',
        verbKey: editVerbKey.trim(),
        targetClass: editTarget,
        argTemplate: editArg,
        icon: selected?.icon ?? '',
        deployed: selected?.deployed ?? false,
      });
      if (!res.ok) throw new Error(res.error || 'Save failed');
      const saved = normalizeVerb((res.verb ?? {}) as Record<string, unknown>);
      setSelectedId(saved.id);
      await refresh();
      pushToast('Verb saved', 'success');
    } catch (e: unknown) {
      pushToast(e instanceof Error ? e.message : 'Save failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const deployVerb = async () => {
    if (!selectedId) return;
    setBusy(true);
    try {
      const res = await IPC.verbForgeDeploy(selectedId);
      if (!res.ok) throw new Error(res.message || res.error || 'Deploy failed');
      await refresh();
      pushToast(res.message || 'Deployed to Explorer', 'success');
    } catch (e: unknown) {
      pushToast(e instanceof Error ? e.message : 'Deploy failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const removeVerb = async () => {
    if (!selectedId) return;
    setBusy(true);
    try {
      const res = await IPC.verbForgeRemove(selectedId, true);
      if (!res.ok) throw new Error(res.error || 'Remove failed');
      setSelectedId(null);
      await refresh();
      pushToast('Verb removed', 'success');
    } catch (e: unknown) {
      pushToast(e instanceof Error ? e.message : 'Remove failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const newVerb = () => {
    setSelectedId('new');
    setEditLabel('My BNDZ Action');
    setEditVerbKey('');
    setEditTarget('*');
    setEditArg('--open-path "%1"');
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="shrink-0 flex flex-wrap items-center gap-1.5 px-3 py-2 border-b border-white/[0.06]">
        <PluginToolbarButton icon="add" onClick={newVerb} disabled={busy}>New</PluginToolbarButton>
        <PluginToolbarButton icon="save_ui" onClick={() => void saveVerb()} disabled={busy || !editLabel.trim()}>Save</PluginToolbarButton>
        <PluginToolbarButton icon="cloud_upload_ui" onClick={() => void deployVerb()} disabled={busy || !selectedId || selectedId === 'new'} active={selected?.deployed}>
          Deploy
        </PluginToolbarButton>
        <PluginToolbarButton icon="delete" onClick={() => void removeVerb()} disabled={busy || !selectedId || selectedId === 'new'}>Remove</PluginToolbarButton>
        <PluginToolbarButton icon="refresh_ui" onClick={() => void refresh()} disabled={loading} className="ml-auto">
          Refresh
        </PluginToolbarButton>
      </div>
      <p className="shrink-0 px-3 py-2 text-[11px] text-white/45 leading-relaxed border-b border-white/[0.05]">
        Register HKCU Explorer verbs that launch BNDZ with path arguments — same Deploy surface as Windows Explorer menus, no sibling plugin.
      </p>
      <div className="flex flex-1 min-h-0 gap-3 p-3">
        <div className="w-[38%] min-w-[140px] flex flex-col gap-1 overflow-y-auto bndz-scrollbar">
          {loading && <div className="text-xs text-gray-500 px-2 py-4">Loading verbs…</div>}
          {!loading && verbs.length === 0 && (
            <PluginEmptyState icon="shell_menus" title="No verbs yet" hint="Create a verb and deploy it to Explorer." />
          )}
          {verbs.map(v => (
            <button
              key={v.id}
              type="button"
              onClick={() => setSelectedId(v.id)}
              className={`text-left px-3 py-2 rounded-lg border text-xs transition-colors ${
                selectedId === v.id
                  ? 'border-[#0078d4]/50 bg-[#094771]/30 text-[#cce4f7]'
                  : 'border-white/5 bg-white/[0.02] text-gray-300 hover:bg-white/[0.05]'
              }`}
            >
              <div className="font-semibold truncate">{v.label}</div>
              <div className="text-[10px] text-gray-500 truncate">
                {v.deployed ? '● Deployed' : '○ Not deployed'} · {v.targetClass}
              </div>
            </button>
          ))}
        </div>

        <PluginCard className="flex-1 flex flex-col gap-3 p-4 min-h-0 overflow-y-auto bndz-scrollbar">
          {(selected || selectedId === 'new') ? (
            <>
              <PluginFieldLabel>Menu label</PluginFieldLabel>
              <input className={PLUGIN_INPUT_CLASS} value={editLabel} onChange={e => setEditLabel(e.target.value)} />

              <PluginFieldLabel>Registry verb key (optional)</PluginFieldLabel>
              <input className={PLUGIN_INPUT_CLASS} value={editVerbKey} onChange={e => setEditVerbKey(e.target.value)} placeholder="Auto from label" />

              <PluginFieldLabel>Target surface</PluginFieldLabel>
              <select className={PLUGIN_SELECT_CLASS} value={editTarget} onChange={e => setEditTarget(e.target.value)}>
                {TARGET_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>

              <PluginFieldLabel>BNDZ argument template</PluginFieldLabel>
              <select className={PLUGIN_SELECT_CLASS} value={editArg} onChange={e => setEditArg(e.target.value)}>
                {ARG_PRESETS.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
              <input className={PLUGIN_INPUT_CLASS} value={editArg} onChange={e => setEditArg(e.target.value)} />

              <div className="text-[10px] text-gray-500 mt-2 flex items-start gap-2">
                <Icons8Icon id="info_ui" size={12} className="shrink-0 mt-0.5 opacity-70" />
                <span>
                  Verbs register under HKCU\Software\Classes. Use %1 for the selected item path, %V for folder background.
                  Deploy notifies Explorer via SHChangeNotify.
                </span>
              </div>
            </>
          ) : (
            <PluginEmptyState icon="shell_menus" title="Select or create a verb" />
          )}
        </PluginCard>
      </div>
    </div>
  );
}

/** @deprecated Use Shell Menus → Explorer verbs tab. Kept only for stale install redirects. */
export const ShellVerbForgePluginDef = {
  id: 'shell-verb-forge',
  name: 'Shell Verb Forge',
  icon: 'shell_menus',
  targetPanel: 'bottom' as const,
  installOnFirstUse: false,
};

export default function ShellVerbForgePlugin() {
  return <ShellVerbForgePanel />;
}
