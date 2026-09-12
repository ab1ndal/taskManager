import { z } from "zod";

import { isCategorySlug, type CategorySlug } from "./categories";

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

/** One item as the model returns it: not yet trusted to be a real category or a bounded number. */
export const rawDictatedItemSchema = z.object({
  name: z.string().trim().min(1).max(100),
  quantity: z.number().int().positive().max(999).nullable(),
  /** The model's best guess at a category label — free text, mapped to a slug afterward. */
  category: z.string(),
  /** How sure the model is this item and quantity were actually said, 0 (guess) to 1 (certain). */
  confidence: z.number().min(0).max(1),
  /** The transcript fragment this item came from, shown alongside a low-confidence flag. */
  sourceText: z.string().trim().min(1).max(200),
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
};

/**
 * Maps one raw model item onto the review-row shape.
 *
 * A category the model invents that isn't one of `CATEGORY_SLUGS` falls back to "pantry" — the
 * same fallback the rest of the pantry already uses for an unclassified product (categories.ts
 * `estimatedExpiry`, add-row.tsx's untouched selector) — rather than inventing a new category or
 * rejecting the row outright.
 */
export function toReviewItem(raw: RawDictatedItem): ReviewGroceryItem {
  return {
    name: raw.name,
    quantity: raw.quantity,
    category: isCategorySlug(raw.category) ? raw.category : "pantry",
    confidence: raw.confidence,
    lowConfidence: raw.confidence < LOW_CONFIDENCE_THRESHOLD,
    sourceText: raw.sourceText,
  };
}
