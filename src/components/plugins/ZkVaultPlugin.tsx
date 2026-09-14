import React, { useCallback, useEffect, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { IPC } from '../../lib/ipcBridge';
import { pushToast } from '../ToastHost';
import { assertIpcOk, runPluginRefresh } from '../../lib/pluginRefresh';
import { toWindowsPath } from '../../lib/pathUtils';
import { formatUiPath } from '../../lib/displayPath';
import PluginPanelShell from './PluginPanelShell';
import {
  PluginEmptyState,
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
  embedded = false,
}: {
  currentPath?: string;
  selectedPaths?: string[];
  embedded?: boolean;
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

  const browseMount = (mountPath: string) => {
    if (!mountPath) return;
    const pane = mountPath.replace(/^([A-Za-z]):[/\\]/, '/$1/').replace(/\\/g, '/');
    window.dispatchEvent(new CustomEvent('bndz-navigate', { detail: { path: pane } }));
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
      const session = res.session as VaultSession | undefined;
      const mount = session?.mountPath;
      pushToast({ kind: 'success', title: 'Vault unlocked', message: mount || 'Session mount ready' });
      setPassword('');
      await refresh();
      if (mount) browseMount(mount);
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
    <PluginPanelShell title="Vault" icon="lock_ui" variant={embedded ? 'embedded' : 'default'}>
      <div className="bndz-vault-root flex flex-col min-h-0 h-full">
        <div className="bndz-vault-unlock">
          <div className="bndz-vault-unlock-head">
            <Icons8Icon id="lock_ui" size={22} className="opacity-90" />
            <div className="min-w-0">
              <div className="bndz-vault-unlock-title">Encrypted vault</div>
              <div className="bndz-vault-unlock-path" title={folder || undefined}>
                {folder ? formatUiPath(folder) : 'Select a folder in the list'}
              </div>
            </div>
            <span className="bndz-vault-count">{vaultCount} vault · {sessions.length} open</span>
          </div>

          <input
            type="password"
            className="bndz-vault-pass"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Passphrase"
            autoComplete="off"
          />

          <div className="bndz-vault-mode" role="group" aria-label="Vault mode">
            <button
              type="button"
              className={`bndz-vault-seg${mode === 'files' ? ' is-on' : ''}`}
              onClick={() => setMode('files')}
            >
              Encrypt files
            </button>
            <button
              type="button"
              className={`bndz-vault-seg${mode === 'container' ? ' is-on' : ''}`}
              onClick={() => setMode('container')}
            >
              Container
            </button>
          </div>

          <div className="bndz-vault-actions">
            <button type="button" className="bndz-sandbox-btn" disabled={busy} onClick={() => void createVault()}>
              Create
            </button>
            <button type="button" className="bndz-sandbox-btn bndz-sandbox-btn-primary" disabled={busy} onClick={() => void unlockVault()}>
              Unlock
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto bndz-scrollbar px-4 pb-4">
          {sessions.length === 0 ? (
            <PluginEmptyState
              icon="lock_ui"
              title="No open mounts"
              description="Unlock a vault to browse decrypted files in a temporary mount — like an encrypted volume."
            />
          ) : (
            <ul className="bndz-vault-sessions">
              {sessions.map(s => (
                <li key={s.vaultId} className="bndz-vault-session">
                  <div className="min-w-0 flex-1">
                    <div className="bndz-vault-session-src" title={formatUiPath(s.sourcePath)}>
                      <Icons8Icon id="folder_ui" size={13} />
                      <span className="truncate">{formatUiPath(s.sourcePath)}</span>
                    </div>
                    <div className="bndz-vault-session-mount" title={formatUiPath(s.mountPath)}>
                      Mount · {formatUiPath(s.mountPath)}
                    </div>
                    {s.mode ? <div className="bndz-vault-session-mode">{s.mode}</div> : null}
                  </div>
                  <div className="bndz-vault-session-actions">
                    <button
                      type="button"
                      className="bndz-sandbox-btn bndz-sandbox-btn-primary"
                      disabled={busy}
                      onClick={() => browseMount(s.mountPath)}
                      title="Open mount in file list"
                    >
                      Browse
                    </button>
                    <button
                      type="button"
                      className="bndz-sandbox-btn"
                      disabled={busy}
                      onClick={() => void lockVault(s.vaultId)}
                      title="Shred temp session and lock"
                    >
                      Lock
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </PluginPanelShell>
  );
}
