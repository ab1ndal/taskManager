import { z } from "zod";

import { isCategorySlug, type CategorySlug } from "./categories";
import { suggestCategory } from "./category-suggest";
import { expiresOn as expiryDate } from "./schemas";

/**
 * Structured extraction contracts for "dictate items" (docs/product.md § Groceries).
 *
 * The LLM sees free text and has no notion of `CategorySlug` or of what a low-confidence parse
 * means to this app, so its raw output is a permissive shape (a free-text category guess, a bare
 * 0–1 confidence) and every raw item is pushed through `toReviewItem` before it reaches the review
 * screen. That is the one seam this module tests without a network call.
 *
 * There is deliberately no `unit` field: `grocery_lots.quantity` (docs/db.md) is a bare integer
 * count with no unit column — "3 milk" means three of whatever container the product already
 * implies — so a parsed "unit" would have nowhere to go. "dozen eggs" resolves to quantity 12 in
 * the prompt, not to quantity 1 unit "dozen".
 */

/** Below this the row is flagged for review, never dropped. */
export const LOW_CONFIDENCE_THRESHOLD = 0.6;

/** `addGroceryItemSchema`'s name limit (schemas.ts); a longer model name is cut to fit. */
const MAX_ITEM_NAME_LENGTH = 100;

/** Enough of the transcript to show why a row was flagged; a longer fragment is cut to fit. */
const MAX_SOURCE_TEXT_LENGTH = 200;

/**
 * One item as the model returns it: not yet trusted to be a real category or a bounded number.
 *
 * `name` and `sourceText` have no maximum here: a schema failure fails the whole list, so one
 * rambling item would lose every other item with it. `toReviewItem` cuts them to length instead.
 */
export const rawDictatedItemSchema = z.object({
  name: z.string().trim().min(1),
  quantity: z.number().int().positive().max(999).nullable(),
  /** The model's best guess at a category label — free text, mapped to a slug afterward. */
  category: z.string(),
  /** How sure the model is this item and quantity were actually said, 0 (guess) to 1 (certain). */
  confidence: z.number().min(0).max(1),
  /** The transcript fragment this item came from, shown alongside a low-confidence flag. */
  sourceText: z.string().trim().min(1),
  /**
   * The expiry the speaker said for this item, as the model resolved it to `YYYY-MM-DD`, or null.
   * A bare string here rather than a date schema: one misresolved date must drop just that date in
   * `toReviewItem`, not fail the whole list's parse.
   */
  expiresOn: z.string().nullable(),
});

export type RawDictatedItem = z.infer<typeof rawDictatedItemSchema>;

export const dictateInputSchema = z.object({
  workspaceId: z.uuid("Expected a UUID"),
  transcript: z
    .string()
    .trim()
    .min(1, "Say or type at least one item")
    .max(2000, "That's too much to parse at once — try a shorter list"),
});

export type DictateInput = z.input<typeof dictateInputSchema>;

/** A parsed item once it has a real category slug and a review-screen confidence flag. */
export type ReviewGroceryItem = {
  name: string;
  quantity: number | null;
  category: CategorySlug;
  confidence: number;
  lowConfidence: boolean;
  sourceText: string;
  /** Null means none was said, and the pantry falls back to the category's shelf-life estimate. */
  expiresOn: string | null;
};

/**
 * Maps one raw model item onto the review-row shape.
 *
 * A category the model invents that isn't one of `CATEGORY_SLUGS` falls back to the keyword guess
 * a typed add would get (category-suggest.ts), then to "pantry" — rather than inventing a new
 * category or rejecting the row outright. An expiry that is not a real date in the range `addGroceryItem`
 * accepts, or that is before `today`, is dropped to null for the same reason: the row survives with
 * the category estimate, and stock is never added already expired. An oversized name or fragment
 * is cut to length rather than dropped; the review screen is where a bad name gets fixed.
 *
 * `today` is a `YYYY-MM-DD` date in the app's timezone (categories.ts `localToday`), passed in so
 * this stays a pure function.
 */
export function toReviewItem(raw: RawDictatedItem, today: string): ReviewGroceryItem {
  const name = truncate(raw.name, MAX_ITEM_NAME_LENGTH);
  const expiryValid =
    expiryDate.safeParse(raw.expiresOn).success && raw.expiresOn !== null && raw.expiresOn >= today;
  return {
    name,
    quantity: raw.quantity,
    category: isCategorySlug(raw.category) ? raw.category : suggestCategory(name) ?? "pantry",
    confidence: raw.confidence,
    lowConfidence: raw.confidence < LOW_CONFIDENCE_THRESHOLD,
    sourceText: truncate(raw.sourceText, MAX_SOURCE_TEXT_LENGTH),
    expiresOn: expiryValid ? raw.expiresOn : null,
  };
}

/**
 * Cuts to at most `max` UTF-16 units — the unit zod's `.max()` counts — without leaving the first
 * half of a surrogate pair (an emoji, say) dangling at the end.
 */
function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max).replace(/[\uD800-\uDBFF]$/, "").trimEnd();
}
