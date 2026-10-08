/**
 * `list.filter(selectedIdFilter(ids))` == `list.filter(x => ids.includes(x.id))`, but with one Set
 * built up front. The includes() form is O(rows x selected): Ctrl+A then Copy/Delete in a 20k-file
 * folder was ~400M comparisons.
 */
export function selectedIdFilter(ids: readonly unknown[]): (x: any) => boolean {
  const set = new Set(ids);
  return (x: any) => set.has(x?.id);
}
