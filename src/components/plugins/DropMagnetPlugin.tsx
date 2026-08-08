import React, { useCallback, useEffect, useState } from 'react';
import { EmblemIcon } from '../EmblemIcon';
import { IPC } from '../../lib/ipcBridge';
import { pushToast } from '../ToastHost';
import { toWindowsPath } from '../../lib/pathUtils';
import { formatUiPath } from '../../lib/displayPath';
import PluginPanelShell from './PluginPanelShell';
import {
  PluginToolbarButton,
  PluginCard,
  PluginEmptyState,
  PluginHeroStrip,
  PluginHeroActionButton,
  PluginSectionTitle,
  PLUGIN_INPUT_CLASS,
} from './PluginPanelPrimitives';

export const DropMagnetPluginDef = {
  id: 'drop-magnet',
  name: 'Drop Magnets',
  icon: 'magnet_ui',
  description: 'Named landing pads — drop files to rename, tag, and route in one release.',
  targetPanel: 'bottom' as const,
  installOnFirstUse: false,
};

type MagnetRow = {
  id: string;
  name: string;
  targetPath: string;
  renamePattern: string;
  tags: string[];
  enabled: boolean;
  accentColor?: string;
  sortOrder: number;
};

const PATTERN_HINTS = '{name} {ext} {original} {date} {datetime} {counter}';

function normalizeMagnet(raw: Record<string, unknown>): MagnetRow {
  return {
    id: String(raw.id ?? raw.Id ?? ''),
    name: String(raw.name ?? raw.Name ?? 'Magnet'),
    targetPath: String(raw.targetPath ?? raw.TargetPath ?? ''),
    renamePattern: String(raw.renamePattern ?? raw.RenamePattern ?? '{original}'),
    tags: Array.isArray(raw.tags ?? raw.Tags)
      ? (raw.tags ?? raw.Tags as unknown[]).map(t => String(t))
      : [],
    enabled: raw.enabled !== false && raw.Enabled !== false,
    accentColor: (raw.accentColor ?? raw.AccentColor) as string | undefined,
    sortOrder: Number(raw.sortOrder ?? raw.SortOrder ?? 0) || 0,
  };
}

const ACCENT_PRESETS = ['#38bdf8', '#34d399', '#fbbf24', '#c084fc', '#f472b6', '#60a5fa'];

export default function DropMagnetPlugin({
  currentPath,
  selectedPaths,
}: {
  currentPath?: string;
  selectedPaths?: string[];
}) {
  const [magnets, setMagnets] = useState<MagnetRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<MagnetRow | null>(null);

  const refresh = useCallback(async () => {
    const res = await IPC.magnetList();
    setMagnets((res.magnets || []).map((m: Record<string, unknown>) => normalizeMagnet(m)));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const startNew = () => {
    const folder = currentPath && !currentPath.startsWith('/bndz') ? toWindowsPath(currentPath) : '';
    setEditing({
      id: '',
      name: '',
      targetPath: folder,
      renamePattern: '{date}_{name}{ext}',
      tags: [],
      enabled: true,
      accentColor: ACCENT_PRESETS[magnets.length % ACCENT_PRESETS.length],
      sortOrder: magnets.length + 1,
    });
  };

  const saveMagnet = async () => {
    if (!editing) return;
    if (!editing.name.trim() || !editing.targetPath.trim()) {
      pushToast('Name and target folder are required.');
      return;
    }
    setBusy(true);
    try {
      const res = await IPC.magnetSave({
        ...editing,
        tags: editing.tags.filter(Boolean),
      });
      if (!res.ok) {
        pushToast(res.error || 'Could not save magnet.');
        return;
      }
      pushToast({ kind: 'success', title: 'Magnet saved', message: editing.name });
      setEditing(null);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const deleteMagnet = async (id: string) => {
    setBusy(true);
    try {
      await IPC.magnetDelete(id);
      await refresh();
      pushToast('Magnet removed.');
    } finally {
      setBusy(false);
    }
  };

  const testMagnet = async (magnet: MagnetRow) => {
    if (!selectedPaths?.length) {
      pushToast('Select files in the list first, then test a magnet.');
      return;
    }
    setBusy(true);
    try {
      const res = await IPC.magnetApplyDrop(magnet.id, selectedPaths, 'copy');
      if (!res.ok) {
        pushToast(res.error || 'Magnet apply failed.');
        return;
      }
      pushToast({
        kind: 'success',
        title: magnet.name,
        message: `${res.transferred ?? 0} item(s) routed via magnet recipe.`,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <PluginPanelShell
      title="Drop Magnets"
      subtitle="Translucent landing pads for external drops — rename, tag, and route in one release."
      icon={<EmblemIcon id="magnet_ui" size={18} />}
      actions={(
        <PluginToolbarButton onClick={startNew} icon="plus_ui">
          New magnet
        </PluginToolbarButton>
      )}
    >
      <PluginHeroStrip>
        <PluginHeroActionButton onClick={startNew} icon="plus_ui">
          Create magnet
        </PluginHeroActionButton>
        <span className="text-[10px] text-gray-500 ml-2">
          Drag files from Explorer — magnets appear as landing pads at the bottom.
        </span>
      </PluginHeroStrip>

      {editing && (
        <PluginCard className="mb-3 space-y-2.5">
          <PluginSectionTitle icon="edit_ui">Edit magnet</PluginSectionTitle>
          <input
            className={PLUGIN_INPUT_CLASS}
            placeholder="Magnet name"
            value={editing.name}
            onChange={e => setEditing({ ...editing, name: e.target.value })}
          />
          <input
            className={PLUGIN_INPUT_CLASS}
            placeholder="Target folder (C:\…)"
            value={editing.targetPath}
            onChange={e => setEditing({ ...editing, targetPath: e.target.value })}
          />
          <input
            className={PLUGIN_INPUT_CLASS}
            placeholder={`Rename pattern — ${PATTERN_HINTS}`}
            value={editing.renamePattern}
            onChange={e => setEditing({ ...editing, renamePattern: e.target.value })}
          />
          <input
            className={PLUGIN_INPUT_CLASS}
            placeholder="Tags (comma-separated)"
            value={editing.tags.join(', ')}
            onChange={e => setEditing({
              ...editing,
              tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean),
            })}
          />
          <div className="flex flex-wrap gap-1.5">
            {ACCENT_PRESETS.map(color => (
              <button
                key={color}
                type="button"
                className={`w-6 h-6 rounded-md border-2 transition-transform hover:scale-110 ${
                  editing.accentColor === color ? 'border-white' : 'border-transparent'
                }`}
                style={{ background: color }}
                onClick={() => setEditing({ ...editing, accentColor: color })}
                title={color}
              />
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-400">
            <input
              type="checkbox"
              checked={editing.enabled}
              onChange={e => setEditing({ ...editing, enabled: e.target.checked })}
            />
            Enabled — show during external drag
          </label>
          <div className="flex gap-2 pt-1">
            <PluginToolbarButton onClick={() => void saveMagnet()} disabled={busy}>
              Save
            </PluginToolbarButton>
            <PluginToolbarButton onClick={() => setEditing(null)}>
              Cancel
            </PluginToolbarButton>
          </div>
        </PluginCard>
      )}

      {!magnets.length && !editing ? (
        <PluginEmptyState
          icon="magnet_ui"
          title="No magnets yet"
          description="Create a named landing pad to auto-rename, tag, and route dropped files."
          actionLabel="Create magnet"
          onAction={startNew}
        />
      ) : (
        <div className="space-y-2">
          {magnets.map(m => (
            <PluginCard
              key={m.id}
              className="bndz-magnet-card group relative overflow-hidden"
              style={{
                borderColor: `${m.accentColor || '#38bdf8'}33`,
                background: `linear-gradient(135deg, ${m.accentColor || '#38bdf8'}12 0%, transparent 55%)`,
              }}
            >
              <div
                className="absolute inset-y-0 left-0 w-1 rounded-l-lg"
                style={{ background: m.accentColor || '#38bdf8' }}
              />
              <div className="pl-3 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-100 truncate">{m.name}</span>
                    {!m.enabled && (
                      <span className="text-[9px] uppercase tracking-wide text-gray-500 bg-white/5 px-1.5 py-0.5 rounded">
                        off
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-500 truncate mt-0.5">{formatUiPath(m.targetPath)}</p>
                  <p className="text-[10px] text-sky-400/80 font-mono mt-1">{m.renamePattern}</p>
                  {m.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {m.tags.map(t => (
                        <span key={t} className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-amber-200/90">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 gap-1 opacity-80 group-hover:opacity-100">
                  <PluginToolbarButton title="Test on selection" onClick={() => void testMagnet(m)} icon="play_ui" />
                  <PluginToolbarButton title="Edit" onClick={() => setEditing(m)} icon="edit_ui" />
                  <PluginToolbarButton title="Delete" onClick={() => void deleteMagnet(m.id)} icon="trash_ui" />
                </div>
              </div>
            </PluginCard>
          ))}
        </div>
      )}
    </PluginPanelShell>
  );
}
