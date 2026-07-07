export type TagDef = { id?: string; name?: string; label?: string; color?: string };

/** Stable tag key stored in sidecar + entity.tags (prefer configured id). */
export function tagStorageKey(tag: TagDef | string): string {
  if (typeof tag === 'string') return tag.trim();
  return tag.id || tag.name || (tag.label || '').toLowerCase().replace(/\s+/g, '-');
}

/** @deprecated Use tagStorageKey for writes; kept for read compatibility */
export function resolveTagKey(tag: TagDef | string): string {
  return tagStorageKey(tag);
}

export function slugTagKey(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, '-');
}

export function tagKeysMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  if (al === bl) return true;
  return al.replace(/\s+/g, '-') === bl.replace(/\s+/g, '-');
}

export function entityHasTag(entityTags: string[] | undefined, tagKey: string): boolean {
  if (!tagKey || !entityTags?.length) return false;
  return entityTags.some(t => tagKeysMatch(t, tagKey));
}

export function findTagMeta(tagKey: string, catalog: TagDef[]): TagDef | undefined {
  const k = tagKey.toLowerCase();
  const slug = k.replace(/\s+/g, '-');
  return catalog.find((x) => {
    const id = (x.id || '').toLowerCase();
    const name = (x.name || '').toLowerCase();
    const label = (x.label || '').toLowerCase();
    const labelSlug = label.replace(/\s+/g, '-');
    return x.id === tagKey || x.name === tagKey || x.label === tagKey
      || id === k || name === k || label === k
      || id === slug || name === slug || labelSlug === slug;
  });
}

export function tagChipId(tag: TagDef): string {
  return tagStorageKey(tag) || slugTagKey(tag.label || 'tag');
}
