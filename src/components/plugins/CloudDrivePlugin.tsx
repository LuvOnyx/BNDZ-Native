import CloudDrivePanel from '../cloud/CloudDrivePanel';

export const CloudDrivePluginDef = {
  id: 'cloud-drive',
  name: 'Cloud Drive',
  icon: 'cloud_drive',
  description: 'Remote-control a private microVM disk — Fly BYO, or a sealed image on a drive you pick.',
  targetPanel: 'bottom' as const,
  installOnFirstUse: false,
};

export default function CloudDrivePlugin() {
  return <CloudDrivePanel variant="plugin" />;
}
