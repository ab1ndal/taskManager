import { suggestNames } from "./suggest";
import type { GroceryItem } from "./types";

const item = (name: string, timesAdded: number): GroceryItem => ({
  id: name,
  name,
  category: "pantry",
  inStock: false,
  needed: false,
  quantity: null,
  expiresOn: null,
  expiryIsEstimate: false,
  timesAdded,
  lots: [],
});

const items = [item("Oat milk", 12), item("Oats, rolled", 3), item("Olive oil", 7), item("Rice", 1)];

it("ranks prefix matches by how often they have been added", () => {
  expect(suggestNames(items, "o").map((i) => i.name)).toEqual([
    "Oat milk",
    "Olive oil",
    "Oats, rolled",
  ]);
});

it("is case-insensitive and ignores surrounding space", () => {
  expect(suggestNames(items, "  OAT ").map((i) => i.name)).toEqual(["Oat milk", "Oats, rolled"]);
});

it("matches inside a name too, after prefix matches", () => {
  expect(suggestNames(items, "milk").map((i) => i.name)).toEqual(["Oat milk"]);
});

it("returns nothing for an empty query", () => {
  expect(suggestNames(items, "   ")).toEqual([]);
});

it("caps the list", () => {
  expect(suggestNames(items, "o", 2)).toHaveLength(2);
});
