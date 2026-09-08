import type { GroceryItem } from "./types";

/**
 * Name suggestions, drawn from the rows the page already loaded.
 *
 * Archived rows are included deliberately: the point is that "oat milk" typed a year ago comes
 * back rather than becoming "Oatmilk", and a re-add resurrects the original row through the unique
 * index. Ranked by times_added, because the thing bought most often is the thing being typed.
 *
 * No endpoint and no round trip — at a few hundred rows for two people, filtering an array the
 * page already has is both simpler and faster than asking the database.
 */
export function suggestNames(
  items: readonly GroceryItem[],
  query: string,
  limit = 6,
): GroceryItem[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];

  const scored = items
    .map((item) => {
      const name = item.name.toLowerCase();
      if (name.startsWith(needle)) return { item, rank: 0 };
      if (name.includes(needle)) return { item, rank: 1 };
      return null;
    })
    .filter((entry): entry is { item: GroceryItem; rank: number } => entry !== null);

  scored.sort(
    (a, b) =>
      a.rank - b.rank ||
      b.item.timesAdded - a.item.timesAdded ||
      a.item.name.localeCompare(b.item.name),
  );

  return scored.slice(0, limit).map((entry) => entry.item);
}
