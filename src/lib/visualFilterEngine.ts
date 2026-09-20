import type { VisualFilter } from '../data/configContext';

/**
 * Default Visual Filter rules seeded when the user has no saved rules.
 * Updated values are appended by ID so existing rules are never overwritten.
 */
export const DEFAULT_VISUAL_FILTERS: VisualFilter[] = [
  {
    id: 'seed-symlinks',
    isActive: true,
    name: 'Symlinks / Junctions',
    matchType: 'attribute',
    matchValue: 'reparse',
    textColor: '#f472b6', // magenta-pink
  },
  {
    id: 'seed-system',
    isActive: true,
    name: 'System files / folders',
    matchType: 'attribute',
    matchValue: 'system',
    textColor: '#3b5bdb', // dark blue
  },
  {
    id: 'seed-empty-dir',
    isActive: true,
    name: 'Empty folders',
    matchType: 'emptyDir',
    matchValue: '',
    textColor: '#9ca3af', // grey
  },
  {
    id: 'seed-modified-today',
    isActive: true,
    name: 'Just modified (today)',
    matchType: 'event',
    matchValue: 'modifiedToday',
    textColor: '#4ade80', // green
  },
];

/**
 * Merge seed rules into an existing rule list, inserting any missing seed IDs at the start.
 * Existing rules (including user edits) are untouched.
 */
export function mergeSeedVisualFilters(existing: VisualFilter[]): VisualFilter[] {
  const existingIds = new Set(existing.map(r => r.id));
  const toAdd = DEFAULT_VISUAL_FILTERS.filter(r => !existingIds.has(r.id));
  if (!toAdd.length) return existing;
  return [...toAdd, ...existing];
}

/** Evaluate visual filter rules against a file list entity. */
export function applyVisualFilters(entity: any, filters?: VisualFilter[]): VisualFilter | null {
  if (!filters?.length) return null;
  const now = Date.now();

  for (const rule of filters) {
    if (!rule.isActive) continue;

    switch (rule.matchType) {
      case 'event':
        if (rule.matchValue === 'modifiedToday') {
          if (entity.modified) {
            const fileTime = new Date(entity.modified);
            if (fileTime.toDateString() === new Date().toDateString()) return rule;
          }
        } else if (rule.matchValue === 'createdWithin24Hours') {
          if (entity.created) {
            const fileTime = new Date(entity.created).getTime();
            if (now - fileTime <= 24 * 60 * 60 * 1000) return rule;
          }
        } else if (rule.matchValue === 'isReadOnly') {
          if (entity.attributes?.includes('readonly')) return rule;
        }
        break;
      case 'extension':
        if (entity.extension && entity.extension.toLowerCase() === rule.matchValue.toLowerCase().replace(/^\./, '')) {
          return rule;
        }
        break;
      case 'regex':
        try {
          if (new RegExp(rule.matchValue, 'i').test(entity.name)) return rule;
        } catch { /* invalid while typing */ }
        break;
      case 'attribute': {
        const want = rule.matchValue.toLowerCase().trim();
        if (!want) break;
        const attrs = ((entity.attributes as string[] | undefined) || []).map(a => a.toLowerCase());
        // Also match entity.linkType for reparse-point classification
        if (want === 'reparse') {
          if (attrs.includes('reparse') || entity.linkType === 'symlink' || entity.linkType === 'junction') return rule;
          break;
        }
        if (!attrs.length) break;
        if (attrs.includes(want) || attrs.some(a => a.includes(want))) return rule;
        break;
      }
      case 'emptyDir':
        // Only match when we positively know the folder is empty.
        // Dir listings always send size=0 for directories (DirListingSharedBuffer),
        // and itemCount is often null until a folder-size scan -- treating that as
        // empty greys every folder Name in the list (see visual filter seed-empty-dir).
        if (entity.type === 'directory') {
          const childCount =
            typeof entity.itemCount === 'number' ? entity.itemCount
            : typeof entity.childCount === 'number' ? entity.childCount
            : null;
          const isEmpty =
            entity.isEmpty === true
            || childCount === 0;
          if (isEmpty) return rule;
        }
        break;
      case 'size':
        if (entity.type !== 'directory' && entity.size != null) {
          const sizeMB = entity.size / (1024 * 1024);
          const val = parseFloat(rule.matchValue.replace(/[^0-9.]/g, ''));
          if (!isNaN(val)) {
            if (rule.matchValue.includes('>') && sizeMB > val) return rule;
            if (rule.matchValue.includes('<') && sizeMB < val) return rule;
          }
        }
        break;
      case 'age':
        if (entity.modified) {
          const daysDiff = (now - new Date(entity.modified).getTime()) / (1000 * 3600 * 24);
          const ageVal = parseFloat(rule.matchValue.replace(/[^0-9.]/g, ''));
          if (!isNaN(ageVal)) {
            if (rule.matchValue.includes('>') && daysDiff > ageVal) return rule;
            if (rule.matchValue.includes('<') && daysDiff < ageVal) return rule;
          }
        }
        break;
    }
  }
  return null;
}

export const FILTER_MATCH_HINTS: Record<VisualFilter['matchType'], string> = {
  extension: 'e.g. pdf or .pdf',
  regex: 'e.g. ^report_',
  attribute: 'readonly, hidden, system, archive, reparse',
  age: 'e.g. >30 or <7 (days)',
  size: 'e.g. >100 or <5 (MB)',
  event: 'modifiedToday | createdWithin24Hours | isReadOnly',
  emptyDir: 'directories with itemCount/childCount === 0 (or isEmpty)',
};
