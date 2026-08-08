import { IPC } from './ipcBridge';
import { getWorkspaceLeftoverBehavior } from './settingsBehavior';

/** Push Mesh Drop ICE/TURN settings from app config to the native host. */
export function syncMeshDropConfig(config: {
  meshDropStunServers?: string;
  meshDropLanDiscovery?: boolean;
  meshDropTurnUrl?: string;
  meshDropTurnUsername?: string;
  meshDropTurnCredential?: string;
  meshAutoConnectOnBrowse?: boolean;
}): void {
  if (!IPC.isNative) return;
  const ws = getWorkspaceLeftoverBehavior(config as any);
  IPC.meshDropSetConfig({
    stunServers: config.meshDropStunServers,
    lanDiscovery: config.meshDropLanDiscovery !== false,
    turnUrl: config.meshDropTurnUrl,
    turnUsername: config.meshDropTurnUsername,
    turnCredential: config.meshDropTurnCredential,
  });
  // Prefer explicit meshAutoConnectOnBrowse; fall back to workspace leftover pack.
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.meshAutoConnect =
      (config.meshAutoConnectOnBrowse ?? ws.meshAutoConnectOnBrowse) !== false ? 'true' : 'false';
  }
}
