
export type SortMode = "expiry" | "name";

export type SortableItem = {
  name: string;
  category: string;
  expiresOn: string | null;
};

/** `YYYY-MM-DD` strings compare correctly as strings, which is why no Date is involved here. */
export function isExpired(expiresOn: string | null, today: string): boolean {
  return expiresOn !== null && expiresOn < today;
}

const byName = (a: SortableItem, b: SortableItem) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

/**
 * Pantry order.
 *
 * Expiry mode needs no separate "expired first" rule: an expired date is simply the earliest date,
 * so ascending order puts it on top for free. Undated items go last — no date means nothing is
 * urgent about them — and ties fall back to name so the order never shuffles between renders.
 */
export function sortPantry<T extends SortableItem>(items: readonly T[], mode: SortMode): T[] {
  const sorted = [...items];

  if (mode === "name") return sorted.sort(byName);

  return sorted.sort((a, b) => {
    if (a.expiresOn === null && b.expiresOn === null) return byName(a, b);
    if (a.expiresOn === null) return 1;
    if (b.expiresOn === null) return -1;
    if (a.expiresOn !== b.expiresOn) return a.expiresOn < b.expiresOn ? -1 : 1;
    return byName(a, b);
  });
}

/** Shopping lists are alphabetical, independent of pantry categories. */
export function sortShopping<T extends SortableItem>(items: readonly T[]): T[] {
  return [...items].sort(byName);
}
