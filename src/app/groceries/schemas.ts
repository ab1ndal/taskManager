import { z } from "zod";

import { CATEGORY_SLUGS, type CategorySlug } from "./categories";

/**
 * Input contracts for the grocery server actions.
 *
 * Actions are public endpoints: arguments arrive from the network, so the form's own checks are
 * convenience. These schemas are the boundary, and the client imports the same ones so the two can
 * never disagree. Mirrors src/app/tasks/schemas.ts.
 */

const uuid = z.uuid("Expected a UUID");

const name = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(100, "Name must be 100 characters or fewer");

const category = z.enum(CATEGORY_SLUGS as readonly [CategorySlug, ...CategorySlug[]], {
  message: "Pick one of the listed categories",
});

/** Bare calendar dates only. `date` columns hold no clock time and neither does an estimate. */
const expiresOn = z.iso.date("Expiry must be in YYYY-MM-DD format").refine(
  (value) => value >= "2020-01-01" && value <= "2100-01-01",
  "Expiry must be between 2020-01-01 and 2100-01-01",
);

const quantity = z
  .number()
  .int("Quantity must be a whole number")
  .min(1, "Quantity must be at least 1")
  .max(999, "Quantity must be 999 or fewer");

export const addGroceryItemSchema = z.object({
  workspaceId: uuid,
  name,
  /**
   * Optional, and its absence is meaningful: grocery_upsert reads "no category supplied" as "keep
   * whatever this product is already filed under". The add row only names one when the user has
   * moved the selector or picked a suggestion, so typing an existing item's name can no longer
   * rewrite its category — and with it the shelf-life estimate and the shopping list's aisle
   * order. A brand new row with no category lands on the column default, 'pantry'.
   */
  category: category.optional(),
  /** 'stock' puts it in the pantry, 'list' puts it on the shopping list. */
  target: z.enum(["stock", "list"]),
  quantity: quantity.nullish(),
  expiresOn: expiresOn.nullish(),
});

export const setNeededSchema = z.object({ itemId: uuid, needed: z.boolean() });

export const markBoughtSchema = z.object({
  itemId: uuid,
  /** Omitted means "use the category's shelf life"; null means "no expiry at all". */
  expiresOn: expiresOn.nullish(),
});

/**
 * The "Still good" nudge, and only it. Deliberately narrower than editItemSchema: that schema makes
 * name, category and quantity required, so a button that used it wrote all three back from props
 * that may be up to a foreground-refresh interval stale, reverting the other phone's concurrent
 * edit (tasks/lessons.md L10).
 */
export const extendExpirySchema = z.object({ itemId: uuid, expiresOn });

export const finishItemSchema = z.object({ itemId: uuid, keepOnList: z.boolean() });

export const adjustQuantitySchema = z.object({
  itemId: uuid,
  delta: z
    .number()
    .int("Delta must be a whole number")
    .refine((value) => value !== 0, "Delta must not be zero")
    .refine((value) => Math.abs(value) <= 99, "Delta must be 99 or fewer"),
});

export const editItemSchema = z.object({
  itemId: uuid,
  name,
  category,
  expiresOn: expiresOn.nullable(),
  quantity: quantity.nullable(),
  expiryIsEstimate: z.boolean().optional().default(false),
});

export const forgetItemSchema = z.object({ itemId: uuid });

export type AddGroceryItemInput = z.input<typeof addGroceryItemSchema>;
export type SetNeededInput = z.input<typeof setNeededSchema>;
export type MarkBoughtInput = z.input<typeof markBoughtSchema>;
export type ExtendExpiryInput = z.input<typeof extendExpirySchema>;
export type FinishItemInput = z.input<typeof finishItemSchema>;
export type AdjustQuantityInput = z.input<typeof adjustQuantitySchema>;
export type EditItemInput = z.input<typeof editItemSchema>;
export type ForgetItemInput = z.input<typeof forgetItemSchema>;
