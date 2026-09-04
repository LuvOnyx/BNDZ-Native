import React from 'react';
import { Icons8Icon } from './Icons8Icon';

/** Maps context-menu verbs to real Icons8 3D-Fluency asset ids (see toolbarLauncherIcons.ts). */
const VERB_MAP: Record<string, string> = {
  open: 'explorer',
  edit: 'pencil_ui',
  print: 'print_ui',
  share: 'share',
  cut: 'cut',
  copy: 'copy',
  paste: 'paste',
  delete: 'delete',
  trash: 'delete',
  rename: 'pencil_ui',
  properties: 'sys_properties',
  settings: 'config',
  openas: 'explorer',
  openwith: 'explorer',
  star: 'zap_ui',
  sparkles: 'sparkles_ui',
  archive: 'compress',
  monitor: 'dashboard_ui',
  refresh: 'refresh',
  filetext: 'file_ui',
  folder: 'explorer',
  type: 'category_ui',
  terminal: 'terminal',
  harddrive: 'disk_mgmt',
  package: 'zip',
  download: 'download',
  shortcut: 'link',
  link: 'link',
  link2: 'link',
  symlink: 'link',
  hardlink: 'link',
  junction: 'link',
  external: 'external_link',
  folderplus: 'new_folder',
  fileplus: 'new_file',
  newfolder: 'new_folder',
  newfile: 'new_file',
  eye: 'toggle_preview',
  layers: 'dropstack',
  music: 'music_ui',
  film: 'film_ui',
  lock: 'lock_ui',
  compress: 'compress',
  extract: 'extract',
  explore: 'explorer',
  openexplorer: 'explorer',
  openterminal: 'terminal_here',
  copypath: 'copy',
  moveto: 'copy_to',
  zip: 'zip',
  '7z': 'zip',
  rar: 'zip',
  undo: 'undo',
  redo: 'redo',
  check: 'check',
  find: 'search',
  search: 'search',
  parent: 'chevron_up',
  up: 'chevron_up',
  back: 'nav_back',
  forward: 'nav_forward',
  shell: 'explorer',
  new: 'new_folder',
  pin: 'star',
  unpin: 'star',
};

const TINT_MAP: Record<string, string> = {
  delete: 'saturate-150 hue-rotate-0',
  trash: 'saturate-150',
};

export function ContextMenuIcon({ verb, icon, size = 14, className = '' }: {
  verb?: string;
  icon?: string;
  size?: number;
  className?: string;
}) {
  const key = (verb || icon || '').toLowerCase().replace(/\s+/g, '');
  const iconId = VERB_MAP[key] || VERB_MAP[(icon || '').toLowerCase()] || 'file_ui';
  const tint = TINT_MAP[key] || '';
  return <Icons8Icon id={iconId} size={size} className={`shrink-0 ${tint} ${className}`} />;
}
