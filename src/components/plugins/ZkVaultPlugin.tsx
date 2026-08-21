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
  PluginSectionTitle,
} from './PluginPanelPrimitives';

export const ZkVaultPluginDef = {
  id: 'zk-vault',
  name: 'ZK Vault',
  icon: 'lock_ui',
  description: 'Encrypt folders at rest; unlock decrypted session mounts inside BNDZ only.',
  targetPanel: 'bottom' as const,
  installOnFirstUse: false,
};

type VaultSession = {
  vaultId: string;
  sourcePath: string;
  mountPath: string;
  mode: string;
  unlockedUtc?: string;
};

export default function ZkVaultPlugin({
  currentPath,
  selectedPaths,
}: {
  currentPath?: string;
  selectedPaths?: string[];
}) {
  const [sessions, setSessions] = useState<VaultSession[]>([]);
  const [vaultCount, setVaultCount] = useState(0);
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'files' | 'container'>('files');
  const [busy, setBusy] = useState(false);

  const folder = selectedPaths?.[0]
    ? toWindowsPath(selectedPaths[0])
    : currentPath ? toWindowsPath(currentPath) : '';

  const refresh = useCallback(async () => {
    await runPluginRefresh('ZK Vault', async () => {
      const res = await IPC.zkVaultStatus();
      assertIpcOk(res, 'Could not load vault status.');
      const st = res.status as { sessions?: VaultSession[]; vaultCount?: number };
      return {
        sessions: Array.isArray(st.sessions) ? st.sessions : [],
        vaultCount: st.vaultCount ?? 0,
      };
    }, ({ sessions: nextSessions, vaultCount: count }) => {
      setSessions(nextSessions);
      setVaultCount(count);
    });
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const createVault = async () => {
    if (!folder) {
      pushToast({ kind: 'warning', title: 'Select a folder', message: 'Pick a folder to encrypt.' });
      return;
    }
    if (!password) {
      pushToast({ kind: 'warning', title: 'Password required', message: 'Enter a vault passphrase.' });
      return;
    }
    setBusy(true);
    try {
      const res = await IPC.zkVaultCreate(folder, password, mode);
      if (!res.ok) throw new Error(res.error || 'Create failed');
      pushToast({ kind: 'success', title: 'Vault created', message: folder });
      setPassword('');
      await refresh();
    } catch (e) {
      pushToast({ kind: 'error', title: 'Vault create failed', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const unlockVault = async () => {
    if (!folder) {
      pushToast({ kind: 'warning', title: 'Select vault folder', message: 'Pick the folder containing .bndzvault marker.' });
      return;
    }
    if (!password) {
      pushToast({ kind: 'warning', title: 'Password required', message: 'Enter vault passphrase.' });
      return;
    }
    setBusy(true);
    try {
      const res = await IPC.zkVaultUnlock(folder, password);
      if (!res.ok) throw new Error(res.error || 'Unlock failed');
      const mount = (res.session as VaultSession)?.mountPath;
      pushToast({ kind: 'success', title: 'Vault unlocked', message: mount || 'Session mount ready' });
      setPassword('');
      await refresh();
    } catch (e) {
      pushToast({ kind: 'error', title: 'Unlock failed', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const lockVault = async (vaultId: string) => {
    setBusy(true);
    try {
      await IPC.zkVaultLock(vaultId);
      await refresh();
      pushToast({ kind: 'info', title: 'Vault locked', message: 'Session mount removed.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <PluginPanelShell title="ZK Vault" icon="lock_ui">
      <PluginHeroStrip
        icon={<Icons8Icon id="lock_ui" size={40} />}
        name="Zero-knowledge vault"
        typeLabel="Encrypt at rest"
        meta={<span className="text-xs text-gray-400">{vaultCount} vault(s) · {sessions.length} session(s)</span>}
      />

      <PluginCard className="p-3 mb-3 space-y-2">
        <PluginSectionTitle>Target folder</PluginSectionTitle>
        <div className="text-xs text-gray-400 bndz-mono truncate">{folder ? formatUiPath(folder) : '— select a folder —'}</div>
        <input
          type="password"
          className="w-full bg-[#1a1a1e] border border-white/10 rounded-md px-2 py-1.5 text-sm"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Vault passphrase"
        />
        <div className="flex gap-2 text-xs">
          <label className="flex items-center gap-1 text-gray-300">
            <input type="radio" checked={mode === 'files'} onChange={() => setMode('files')} />
            Encrypt files
          </label>
          <label className="flex items-center gap-1 text-gray-300">
            <input type="radio" checked={mode === 'container'} onChange={() => setMode('container')} />
            Container mode
          </label>
        </div>
        <div className="flex gap-2">
          <PluginToolbarButton label="Create vault" onClick={() => void createVault()} disabled={busy} />
          <PluginToolbarButton label="Unlock vault" onClick={() => void unlockVault()} disabled={busy} />
        </div>
      </PluginCard>

      {sessions.length === 0 ? (
        <PluginEmptyState icon="lock_ui" title="No active sessions" description="Unlock a vault to browse decrypted files in a temp mount." />
      ) : (
        <div className="space-y-2">
          {sessions.map(s => (
            <PluginCard key={s.vaultId} className="p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm text-white flex items-center gap-2">
                    <Icons8Icon id="folder_ui" size={14} />
                    <span className="truncate">{formatUiPath(s.sourcePath)}</span>
                  </div>
                  <div className="text-[11px] text-sky-300/80 mt-1 bndz-mono truncate">Mount: {formatUiPath(s.mountPath)}</div>
                </div>
                <PluginToolbarButton label="Lock" onClick={() => void lockVault(s.vaultId)} disabled={busy} />
              </div>
            </PluginCard>
          ))}
        </div>
      )}
    </PluginPanelShell>
  );
}
