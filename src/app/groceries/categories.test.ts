import {
  CATEGORY_SLUGS,
  addDays,
  categoryLabel,
  estimatedExpiry,
  localToday,
} from "./categories";

describe("categories", () => {
  it("has nine slugs and no meat or seafood", () => {
    expect(CATEGORY_SLUGS).toHaveLength(9);
    expect(CATEGORY_SLUGS).toContain("produce");
    expect(CATEGORY_SLUGS.join(" ")).not.toMatch(/meat|seafood|fish/);
  });

  it("labels a slug", () => {
    expect(categoryLabel("dairy")).toBe("Dairy & eggs");
  });
});

describe("localToday", () => {
  // 2026-09-06T01:30:00Z is 2026-09-05 18:30 Pacific. A UTC-based
  // toISOString().slice(0, 10) would answer "2026-09-06" — a day early, every
  // evening. This is the bug the helper exists to prevent.
  it("uses the Pacific calendar date, not UTC", () => {
    expect(localToday(new Date("2026-09-06T01:30:00Z"))).toBe("2026-09-05");
  });

  it("agrees with UTC during Pacific daytime", () => {
    expect(localToday(new Date("2026-09-06T18:00:00Z"))).toBe("2026-09-06");
  });
});

describe("addDays", () => {
  it("adds days without drifting across a DST boundary", () => {
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
  });

  it("rolls over a month end", () => {
    expect(addDays("2026-09-28", 7)).toBe("2026-10-05");
  });
});

describe("estimatedExpiry", () => {
  it("returns a date for a category with a shelf life", () => {
    expect(estimatedExpiry("produce", new Date("2026-09-06T18:00:00Z"))).toBe("2026-09-13");
  });

  it("returns null for a category without one", () => {
    expect(estimatedExpiry("pantry", new Date("2026-09-06T18:00:00Z"))).toBeNull();
  });

  it("bases the estimate on the Pacific date", () => {
    expect(estimatedExpiry("baked", new Date("2026-09-06T01:30:00Z"))).toBe("2026-09-09");
  });
});
