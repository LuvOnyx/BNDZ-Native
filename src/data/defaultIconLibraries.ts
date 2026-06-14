import type { IconLibrary } from '../components/plugins/IconStudio/IconStudioContext';
import {
  listDeviconLibraryEntries,
  listSkillIconLibraryEntries,
  toIconifyLibraryPath,
} from '../lib/fileTypeIcons';

export const DEFAULT_ICON_LIBRARY_IDS = {
  devicon: 'lib-devicon-starter',
  skillIcons: 'lib-skill-icons-starter',
} as const;

function buildLibrary(id: string, name: string, entries: Array<{ name: string; iconId: string }>): IconLibrary {
  return {
    id,
    name,
    icons: entries.map((e, i) => ({
      id: `${id}-${i}`,
      name: e.name,
      icoStr: toIconifyLibraryPath(e.iconId),
    })),
  };
}

export function buildDefaultIconLibraries(): IconLibrary[] {
  return [
    buildLibrary(DEFAULT_ICON_LIBRARY_IDS.devicon, 'Devicon (Starter)', listDeviconLibraryEntries()),
    buildLibrary(DEFAULT_ICON_LIBRARY_IDS.skillIcons, 'Skill Icons (Starter)', listSkillIconLibraryEntries()),
  ];
}
