import { isExpired, sortPantry, sortShopping } from "./sort";

const item = (name: string, category: string, expiresOn: string | null = null) => ({
  name,
  category,
  expiresOn,
});

describe("sortPantry by expiry", () => {
  it("puts dated items first, soonest first, and undated last", () => {
    const sorted = sortPantry(
      [
        item("Rice", "pantry"),
        item("Milk", "dairy", "2026-09-12"),
        item("Spinach", "produce", "2026-09-07"),
      ],
      "expiry",
    );
    expect(sorted.map((i) => i.name)).toEqual(["Spinach", "Milk", "Rice"]);
  });

  it("breaks a date tie by name", () => {
    const sorted = sortPantry(
      [item("Yogurt", "dairy", "2026-09-10"), item("Apples", "produce", "2026-09-10")],
      "expiry",
    );
    expect(sorted.map((i) => i.name)).toEqual(["Apples", "Yogurt"]);
  });

  it("sorts undated items among themselves by name", () => {
    const sorted = sortPantry([item("Rice", "pantry"), item("Chana", "pantry")], "expiry");
    expect(sorted.map((i) => i.name)).toEqual(["Chana", "Rice"]);
  });
});

describe("sortPantry by name", () => {
  it("is case-insensitive and ignores expiry", () => {
    const sorted = sortPantry(
      [item("banana", "produce", "2026-09-30"), item("Apple", "produce", "2026-09-07")],
      "name",
    );
    expect(sorted.map((i) => i.name)).toEqual(["Apple", "banana"]);
  });
});

describe("sortShopping", () => {
  it("orders alphabetically regardless of category", () => {
    const sorted = sortShopping([
      item("Soap", "household"),
      item("Bread", "baked"),
      item("Spinach", "produce"),
      item("Apples", "produce"),
    ]);
    expect(sorted.map((i) => i.name)).toEqual(["Apples", "Bread", "Soap", "Spinach"]);
  });
});

describe("isExpired", () => {
  it("is true strictly before today", () => {
    expect(isExpired("2026-09-05", "2026-09-06")).toBe(true);
  });

  it("is false on the day itself", () => {
    expect(isExpired("2026-09-06", "2026-09-06")).toBe(false);
  });

  it("is false with no date", () => {
    expect(isExpired(null, "2026-09-06")).toBe(false);
  });
});

it("does not mutate its input", () => {
  const items = [item("B", "pantry"), item("A", "pantry")];
  sortPantry(items, "name");
  expect(items.map((i) => i.name)).toEqual(["B", "A"]);
});
