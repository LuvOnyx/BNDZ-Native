import React from 'react';
import {
  FolderOpen, Pencil, Printer, Share2, Scissors, Copy, ClipboardPaste, Trash2,
  FileEdit, Settings, Star, Sparkles, Archive, Monitor, PlayCircle, RefreshCw,
  FileText, Folder, Type, ChevronRight, HardDrive, Terminal, Package, Download,
  Link2, ExternalLink, FolderPlus, FilePlus, Eye, Layers, Music, Film, Lock,
} from 'lucide-react';

const VERB_MAP: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  open: FolderOpen,
  edit: Pencil,
  print: Printer,
  share: Share2,
  cut: Scissors,
  copy: Copy,
  paste: ClipboardPaste,
  delete: Trash2,
  trash: Trash2,
  rename: FileEdit,
  properties: Settings,
  settings: Settings,
  openas: PlayCircle,
  openwith: PlayCircle,
  star: Star,
  sparkles: Sparkles,
  archive: Archive,
  monitor: Monitor,
  refresh: RefreshCw,
  filetext: FileText,
  folder: Folder,
  type: Type,
  terminal: Terminal,
  harddrive: HardDrive,
  package: Package,
  download: Download,
  link: Link2,
  link2: Link2,
  symlink: Link2,
  hardlink: Link2,
  junction: Link2,
  external: ExternalLink,
  folderplus: FolderPlus,
  fileplus: FilePlus,
  newfolder: FolderPlus,
  newfile: FilePlus,
  eye: Eye,
  layers: Layers,
  music: Music,
  film: Film,
  lock: Lock,
  compress: Archive,
  extract: Download,
  explore: FolderOpen,
  openexplorer: FolderOpen,
  openterminal: Terminal,
  copypath: Copy,
  zip: Package,
  '7z': Package,
  rar: Package,
};

const COLOR_MAP: Record<string, string> = {
  delete: 'text-red-400',
  trash: 'text-red-400',
  cut: 'text-amber-400',
  copy: 'text-sky-400',
  copypath: 'text-sky-400',
  paste: 'text-emerald-400',
  open: 'text-blue-400',
  properties: 'text-gray-400',
  settings: 'text-gray-400',
  sparkles: 'text-yellow-400',
  archive: 'text-amber-400',
  compress: 'text-amber-400',
  extract: 'text-emerald-400',
  download: 'text-emerald-400',
  link: 'text-sky-400',
  symlink: 'text-sky-400',
  hardlink: 'text-purple-400',
  junction: 'text-purple-400',
  terminal: 'text-gray-300',
  package: 'text-orange-400',
  folder: 'text-[#dcb67a]',
  newfolder: 'text-[#dcb67a]',
};

export function ContextMenuIcon({ verb, icon, size = 14, className = '' }: {
  verb?: string;
  icon?: string;
  size?: number;
  className?: string;
}) {
  const key = (verb || icon || '').toLowerCase().replace(/\s+/g, '');
  const Icon = VERB_MAP[key] || VERB_MAP[(icon || '').toLowerCase()] || FileText;
  const colorClass = COLOR_MAP[key] || COLOR_MAP[(icon || '').toLowerCase()] || 'text-gray-300';
  return <Icon size={size} className={`shrink-0 ${colorClass} ${className}`} />;
}

export { ChevronRight };
