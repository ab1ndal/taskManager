/**
 * Given a bucket array with the dragged task already spliced into `toIndex`, returns the
 * member_sort_key of its new neighbors — direct input to reorderTask()'s prevKey/nextKey.
 */
export function computeNeighborKeys(
  bucket: { member_sort_key: number }[],
  toIndex: number
): { prevKey: number | null; nextKey: number | null } {
  const prevKey = toIndex > 0 ? bucket[toIndex - 1].member_sort_key : null;
  const nextKey = toIndex < bucket.length - 1 ? bucket[toIndex + 1].member_sort_key : null;
  return { prevKey, nextKey };
}
