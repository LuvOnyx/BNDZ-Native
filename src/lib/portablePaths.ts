/** Portable / MTP shell namespace path helpers */

import { SHELL_CLSID } from './shellPaths';

export const PORTABLE_DEVICES_PATH = '/shell:PortableDevices';

export function isPortableDevicePath(path: string | null | undefined): boolean {
  if (!path) return false;
  const p = path.replace(/\\/g, '/');
  const clsid = SHELL_CLSID.portableDevices.replace(/\\/g, '/');
  return p.startsWith(PORTABLE_DEVICES_PATH)
    || p.includes(clsid)
    || p.includes('usb#')
    || p.toLowerCase().includes('wpd');
}

export function isPortableDeviceReadOnly(
  path: string | null | undefined,
  treatPortableAsReadOnly: boolean,
): boolean {
  return treatPortableAsReadOnly && isPortableDevicePath(path);
}
