/** Built-in colored folder icons (Assets/ui/folcolor_icons → public/folcolor_icons). */

export type FolderColorId = 'green' | 'blue' | 'red' | 'pink' | 'gray' | 'generic';

export type FolderColorDef = {
  id: FolderColorId;
  label: string;
  /** Web URL served from Vite/public (and packaged Assets/ui). */
  webUrl: string;
  /** Relative filename under Assets/ui/folcolor_icons for native apply. */
  fileName: string;
  /** Accent used in settings UI. */
  swatch: string;
};

export const FOLDER_COLOR_ICONS: FolderColorDef[] = [
  { id: 'green', label: 'Green folder', webUrl: '/folcolor_icons/FolderGreen.ico', fileName: 'FolderGreen.ico', swatch: '#34d399' },
  { id: 'blue', label: 'Blue folder', webUrl: '/folcolor_icons/FolderBlue.ico', fileName: 'FolderBlue.ico', swatch: '#60a5fa' },
  { id: 'red', label: 'Red folder', webUrl: '/folcolor_icons/FolderRed.ico', fileName: 'FolderRed.ico', swatch: '#f87171' },
  { id: 'pink', label: 'Pink folder', webUrl: '/folcolor_icons/FolderPink.ico', fileName: 'FolderPink.ico', swatch: '#f472b6' },
  { id: 'gray', label: 'Gray folder', webUrl: '/folcolor_icons/FolderGray.ico', fileName: 'FolderGray.ico', swatch: '#9ca3af' },
  { id: 'generic', label: 'Generic folder', webUrl: '/folcolor_icons/FolderGeneric.ico', fileName: 'FolderGeneric.ico', swatch: '#fbbf24' },
];

export function folderColorById(id?: string | null): FolderColorDef | undefined {
  if (!id) return undefined;
  return FOLDER_COLOR_ICONS.find(f => f.id === id);
}

export function folderColorWebUrl(id?: string | null): string | undefined {
  return folderColorById(id)?.webUrl;
}

/** Suggested mapping for common color-filter comments / expressions. */
export function suggestFolderColorForFilter(expression: string): FolderColorId | undefined {
  const t = expression.toLowerCase();
  // Recent-change filters use green row chrome only — no auto folder icon.
  if (t.includes('agem:') || t.includes('modified') || t.includes('recent')) return undefined;
  if (t.includes('empty')) return 'gray';
  if (t.includes('encrypted') || t.includes('system')) return 'red';
  if (t.includes('compressed') || t.includes('junction')) return 'blue';
  if (t.includes('exe') || t.includes('dll')) return 'pink';
  return undefined;
}
