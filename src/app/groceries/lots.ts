import type { GroceryLot } from "./types";

export function deriveLots(input: readonly GroceryLot[]) {
  const lots = [...input].sort((a, b) =>
    (a.expiresOn ?? "9999").localeCompare(b.expiresOn ?? "9999") ||
    a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  return {
    lots,
    inStock: lots.length > 0,
    quantity: lots.length > 0 && lots.every((lot) => lot.quantity !== null)
      ? lots.reduce((total, lot) => total + lot.quantity!, 0) : null,
    expiresOn: lots[0]?.expiresOn ?? null,
    expiryIsEstimate: lots[0]?.expiryIsEstimate ?? false,
  };
}
