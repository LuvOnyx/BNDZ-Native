import { IPC } from './ipcBridge';
import type { DropRoute } from './fsPathRouting';
import { localPathsFromSources, meshPanePathsFromSources } from './fsPathRouting';

export type MeshTransferRequest = {
  operationId: string;
  route: DropRoute;
  sourcePaths: string[];
};

export async function executeMeshTransfer(req: MeshTransferRequest): Promise<{ ok: boolean; error?: string }> {
  const { operationId, route, sourcePaths } = req;
  if (!IPC.isNative) return { ok: false, error: 'Native host required' };

  switch (route.kind) {
    case 'mesh-upload': {
      const localPaths = localPathsFromSources(sourcePaths);
      if (!localPaths.length) return { ok: false, error: 'No local files to upload' };
      return IPC.meshTransfer({
        operationId,
        direction: 'upload',
        hostId: route.hostId,
        localPaths,
        remoteDestDir: route.remoteDestDir,
      });
    }
    case 'mesh-download': {
      const meshPaths = meshPanePathsFromSources(sourcePaths);
      if (!meshPaths.length) return { ok: false, error: 'No remote files to download' };
      return IPC.meshTransfer({
        operationId,
        direction: 'download',
        hostId: route.hostId,
        meshPaths,
        localDestDir: route.localDestDir,
      });
    }
    case 'mesh-replicate': {
      const meshPaths = meshPanePathsFromSources(sourcePaths);
      if (!meshPaths.length) return { ok: false, error: 'No remote files to copy' };
      return IPC.meshTransfer({
        operationId,
        direction: 'replicate',
        hostId: route.hostId,
        meshPaths,
        remoteDestDir: route.remoteDestDir,
        move: route.move,
      });
    }
    case 'mesh-relay': {
      const meshPaths = meshPanePathsFromSources(sourcePaths);
      if (!meshPaths.length) return { ok: false, error: 'No remote files to transfer' };
      return IPC.meshTransfer({
        operationId,
        direction: 'relay',
        srcHostId: route.srcHostId,
        destHostId: route.destHostId,
        meshPaths,
        remoteDestDir: route.remoteDestDir,
        move: route.move,
      });
    }
    case 'mesh-drop-send': {
      const paths = (route.paths?.length ? route.paths : localPathsFromSources(sourcePaths)).filter(Boolean);
      if (!paths.length) return { ok: false, error: 'No files for Mesh Drop' };
      window.dispatchEvent(new CustomEvent('bndz-mesh-drop-send', { detail: { paths, operationId } }));
      return { ok: true };
    }
    default:
      return { ok: false, error: 'Not a mesh transfer' };
  }
}

/** Hydrate mesh pane paths to local cache files for OLE drag-out. */
export async function hydrateMeshPathsForDrag(meshPanePaths: string[]): Promise<string[]> {
  if (!IPC.isNative || !meshPanePaths.length) return [];
  const result = await IPC.meshHydratePaths(meshPanePaths);
  return result.paths || [];
}
