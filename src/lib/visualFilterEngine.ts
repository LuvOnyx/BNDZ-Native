import type { VisualFilter } from '../data/configContext';

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
        if (!want || !entity.attributes?.length) break;
        const attrs = (entity.attributes as string[]).map(a => a.toLowerCase());
        if (attrs.includes(want) || attrs.some(a => a.includes(want))) return rule;
        break;
      }
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
  attribute: 'readonly, hidden, system, archive',
  age: 'e.g. >30 or <7 (days)',
  size: 'e.g. >100 or <5 (MB)',
  event: 'modifiedToday | createdWithin24Hours | isReadOnly',
};
