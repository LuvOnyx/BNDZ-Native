import { IPC } from './ipcBridge';

/** Push Mesh Drop ICE/TURN settings from app config to the native host. */
export function syncMeshDropConfig(config: {
  meshDropStunServers?: string;
  meshDropLanDiscovery?: boolean;
  meshDropTurnUrl?: string;
  meshDropTurnUsername?: string;
  meshDropTurnCredential?: string;
}): void {
  if (!IPC.isNative) return;
  IPC.meshDropSetConfig({
    stunServers: config.meshDropStunServers,
    lanDiscovery: config.meshDropLanDiscovery !== false,
    turnUrl: config.meshDropTurnUrl,
    turnUsername: config.meshDropTurnUsername,
    turnCredential: config.meshDropTurnCredential,
  });
}
