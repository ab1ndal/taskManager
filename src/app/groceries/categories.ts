import { APP_TIME_ZONE } from "@/app/tasks/recurrence-time";

/**
 * The grocery categories, and how long each kind of thing tends to last.
 *
 * `shelfLifeDays` is the estimate used when an item enters the pantry without a printed date —
 * produce and bread carry no label, and an undated row sorts last, which is backwards for the
 * fastest-spoiling thing in the kitchen. `null` means "this does not meaningfully expire", and
 * those items simply have no date.
 *
 * The slug list is duplicated in the `grocery_items_category` check constraint (migration 026).
 * The two must change together — the same arrangement `TAB20_SLUGS` has with
 * `board_columns_color_valid`, recorded in docs/db.md.
 *
 * There is deliberately no meat or seafood category: both users are vegetarian.
 */
export const GROCERY_CATEGORIES = [
  { slug: "produce", label: "Produce", position: 1, shelfLifeDays: 7 },
  { slug: "dairy", label: "Dairy & eggs", position: 2, shelfLifeDays: 10 },
  { slug: "baked", label: "Baked", position: 3, shelfLifeDays: 4 },
  { slug: "frozen", label: "Frozen", position: 4, shelfLifeDays: 180 },
  { slug: "pantry", label: "Pantry & dry goods", position: 5, shelfLifeDays: null },
  { slug: "spices", label: "Spices & condiments", position: 6, shelfLifeDays: null },
  { slug: "beverages", label: "Beverages", position: 7, shelfLifeDays: null },
  { slug: "snacks", label: "Snacks", position: 8, shelfLifeDays: null },
  { slug: "household", label: "Household", position: 9, shelfLifeDays: null },
] as const;

export type CategorySlug = (typeof GROCERY_CATEGORIES)[number]["slug"];

export const CATEGORY_SLUGS: readonly CategorySlug[] = GROCERY_CATEGORIES.map((c) => c.slug);

const bySlug = new Map(GROCERY_CATEGORIES.map((c) => [c.slug as string, c]));

/** Narrows a plain string (e.g. a `<select>`'s `event.target.value`) to `CategorySlug`. */
export function isCategorySlug(slug: string): slug is CategorySlug {
  return bySlug.has(slug);
}

export function categoryLabel(slug: string): string {
  return bySlug.get(slug)?.label ?? slug;
}

/** Sort position for the shopping view, which walks a store roughly in aisle order. */
export function categoryPosition(slug: string): number {
  return bySlug.get(slug)?.position ?? Number.MAX_SAFE_INTEGER;
}

/**
 * Today's calendar date in the app's timezone, as `YYYY-MM-DD`.
 *
 * `toISOString().slice(0, 10)` is a UTC date and is a day ahead for the whole Pacific evening, so
 * every expiry comparison and prefill would be off by one after 5pm. `en-CA` formats as
 * `YYYY-MM-DD`, which is the shape `date` columns and `<input type="date">` both want.
 */
export function localToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Calendar arithmetic on a bare `YYYY-MM-DD` string.
 *
 * Done in UTC deliberately: these are calendar dates with no clock time, so adding 7 days must
 * always land on the same weekday-shifted date regardless of a DST transition in between. Doing it
 * with local `Date` mutation would shift by an hour across a boundary and can roll the date.
 */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * 86_400_000);
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(shifted.getUTCDate()).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${mm}-${dd}`;
}

/** The prefilled expiry for a category, or null when that category does not expire. */
export function estimatedExpiry(slug: string, now: Date = new Date()): string | null {
  const shelfLife = bySlug.get(slug)?.shelfLifeDays ?? null;
  return shelfLife === null ? null : addDays(localToday(now), shelfLife);
}

/** How many days a category's item is assumed to keep, or null when it does not meaningfully expire. */
export function shelfLifeDays(slug: string): number | null {
  return bySlug.get(slug)?.shelfLifeDays ?? null;
}
