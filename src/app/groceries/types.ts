import type { CategorySlug } from "./categories";

/**
 * The grocery row shape, shared across the add row, the suggestion ranking, and the page.
 *
 * It lives here rather than in `groceries-client.tsx` because the add row and the suggestion
 * ranking are leaf modules that client component depends on — putting the type there would make
 * this module import its own consumer.
 */
export type GroceryItem = {
  id: string;
  name: string;
  category: CategorySlug;
  inStock: boolean;
  needed: boolean;
  quantity: number | null;
  expiresOn: string | null;
  expiryIsEstimate: boolean;
  timesAdded: number;
};
