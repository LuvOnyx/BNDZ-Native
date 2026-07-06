export type TagDef = { id?: string; name?: string; label?: string; color?: string };

/** Canonical storage key for a tag definition. */
export function resolveTagKey(tag: TagDef | string): string {
  if (typeof tag === 'string') return tag.trim();
  const raw = tag.name || tag.label || tag.id || '';
  return raw.trim();
}

export function slugTagKey(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, '-');
}

export function tagKeysMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

export function entityHasTag(entityTags: string[] | undefined, tagKey: string): boolean {
  if (!tagKey || !entityTags?.length) return false;
  return entityTags.some(t => tagKeysMatch(t, tagKey));
}

export function findTagMeta(tagKey: string, catalog: TagDef[]): TagDef | undefined {
  return catalog.find(t =>
    tagKeysMatch(resolveTagKey(t), tagKey)
    || (t.label && tagKeysMatch(t.label, tagKey)),
  );
}

export function tagChipId(tag: TagDef): string {
  const key = resolveTagKey(tag);
  return key || slugTagKey(tag.label || 'tag');
}
