import { categoryPosition } from "./categories";

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
export function sortPantry(items: readonly SortableItem[], mode: SortMode): SortableItem[] {
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

/**
 * Shopping order: category position, then name.
 *
 * The shopping view holds no expiry data — `grocery_finish` clears the date on the way out of the
 * pantry — so the pantry's sort control is deliberately not offered here. Category position
 * approximates walking a store aisle by aisle.
 */
export function sortShopping(items: readonly SortableItem[]): SortableItem[] {
  return [...items].sort((a, b) => {
    const positions = categoryPosition(a.category) - categoryPosition(b.category);
    return positions !== 0 ? positions : byName(a, b);
  });
}
