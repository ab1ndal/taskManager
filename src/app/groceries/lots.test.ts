import { deriveLots } from "./lots";
import type { GroceryLot } from "./types";
const lot = (id: string, quantity: number | null, expiresOn: string | null, estimate = false): GroceryLot => ({
  id, itemId: "milk", quantity, expiresOn, expiryIsEstimate: estimate, createdAt: "2026-09-07T12:00:00Z",
});
it("adds repeat purchases and keeps the earliest expiry visible", () => {
  const result = deriveLots([lot("new", 3, "2026-09-20"), lot("old", 2, "2026-09-12", true)]);
  expect(result).toMatchObject({ quantity: 5, expiresOn: "2026-09-12", expiryIsEstimate: true, inStock: true });
  expect(result.lots.map((l) => l.id)).toEqual(["old", "new"]);
});
it("does not claim an exact total when any batch is uncounted", () => {
  expect(deriveLots([lot("a", 2, null), lot("b", null, null)]).quantity).toBeNull();
  expect(deriveLots([lot("a", null, "2026-09-12"), lot("b", 2, "2026-09-12")]).quantity).toBeNull();
});
it("keeps matching and undated purchases separate and sorts undated last", () => {
  const rows = [lot("c", 1, null), lot("a", 2, "2026-09-12"), lot("b", 3, "2026-09-12")];
  expect(deriveLots(rows).lots.map((l) => l.id)).toEqual(["a", "b", "c"]);
  expect(rows[0].id).toBe("c");
});
it("clearing the oldest batch advances expiry and preserves fresh stock", () => {
  expect(deriveLots([lot("fresh", 3, "2026-09-20")])).toMatchObject({ quantity: 3, expiresOn: "2026-09-20", inStock: true });
  expect(deriveLots([])).toMatchObject({ quantity: null, expiresOn: null, expiryIsEstimate: false, inStock: false });
});
