import { GROCERY_CATEGORIES, type CategorySlug } from "./categories";

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

export type GroupedByCategory<T extends SortableItem> = {
  category: CategorySlug;
  items: T[];
};

/**
 * Groups items by category in category order, with items sorted by name within each group.
 * Used for the pantry view when "By name" sort is selected.
 *
 * Only categories with at least one item appear, in `GROCERY_CATEGORIES` order.
 */
export function groupByCategory<T extends SortableItem>(items: readonly T[]): GroupedByCategory<T>[] {
  const byCategory = new Map<string, T[]>();
  for (const item of items) {
    const current = byCategory.get(item.category) ?? [];
    byCategory.set(item.category, [...current, item]);
  }

  for (const group of byCategory.values()) {
    group.sort(byName);
  }

  return GROCERY_CATEGORIES.map((c) => c.slug)
    .filter((slug) => byCategory.has(slug))
    .map((slug) => ({ category: slug, items: byCategory.get(slug)! }));
}
