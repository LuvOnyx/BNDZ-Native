import CloudDrivePanel from '../cloud/CloudDrivePanel';

/** BNDZ Cloud bottom plugin. Its Hub entry (CloudDrivePluginDef) lives in pluginDefs.ts so this file loads on first open. */
export default function CloudDrivePlugin() {
  return <CloudDrivePanel variant="plugin" />;
}
