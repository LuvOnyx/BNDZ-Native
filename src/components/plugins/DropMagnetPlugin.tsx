import React, { useCallback, useEffect, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { IPC } from '../../lib/ipcBridge';
import { pushToast } from '../ToastHost';
import { assertIpcOk, runPluginRefresh } from '../../lib/pluginRefresh';
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
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const ok = await runPluginRefresh('Drop Magnets', async () => {
      const res = await IPC.magnetList();
      return (res.magnets || []).map((m: Record<string, unknown>) => normalizeMagnet(m));
    }, (rows) => {
      setMagnets(rows);
      setLoadError(null);
    });
    if (!ok) setLoadError('Could not load magnets from host.');
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
      assertIpcOk(res, 'Could not save magnet.');
      pushToast({ kind: 'success', title: 'Magnet saved', message: editing.name });
      setEditing(null);
      await refresh();
    } catch (e) {
      pushToast({
        kind: 'error',
        title: 'Save failed',
        message: e instanceof Error ? e.message : String(e),
      });
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
    } catch (e) {
      pushToast({
        kind: 'error',
        title: 'Delete failed',
        message: e instanceof Error ? e.message : String(e),
      });
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
    } catch (e) {
      pushToast({
        kind: 'error',
        title: 'Magnet apply failed',
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <PluginPanelShell
      title="Drop Magnets"
      subtitle="Translucent landing pads for external drops — rename, tag, and route in one release."
      icon="magnet_ui"
      toolbar={(
        <PluginToolbarButton onClick={startNew} icon="plus_ui">
          New magnet
        </PluginToolbarButton>
      )}
    >
      <PluginHeroStrip
        icon={<Icons8Icon id="magnet_ui" size={40} />}
        name="Drop Magnets"
        typeLabel="Landing pads"
        meta={(
          <span className="text-xs text-gray-400">
            Drag from Explorer — magnets appear as pads at the bottom.
          </span>
        )}
        actions={(
          <PluginHeroActionButton onClick={startNew} icon="plus_ui" variant="primary">
            Create magnet
          </PluginHeroActionButton>
        )}
      />

      {loadError && (
        <div className="mx-4 mt-3 mb-1 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {loadError}
          <button
            type="button"
            className="ml-2 underline text-red-200"
            onClick={() => void refresh()}
          >
            Retry
          </button>
        </div>
      )}

      {editing && (
        <div className="px-4 pt-3">
          <PluginCard className="mb-3 space-y-2.5 p-3">
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
        </div>
      )}

      <div className="px-4 py-3 flex-1 min-h-0">
        {!magnets.length && !editing ? (
          <PluginEmptyState
            icon="magnet_ui"
            title="No magnets yet"
            description="Create a named landing pad to auto-rename, tag, and route dropped files."
          />
        ) : (
          <div className="space-y-2">
            {magnets.map(m => (
              <div
                key={m.id}
                className="bndz-plugin-card bndz-magnet-card group relative overflow-hidden p-3"
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
              </div>
            ))}
          </div>
        )}
      </div>
    </PluginPanelShell>
  );
}
