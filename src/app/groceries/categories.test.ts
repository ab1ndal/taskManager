import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CATEGORY_SLUGS,
  addDays,
  categoryLabel,
  estimatedExpiry,
  formatDay,
  formatExpiry,
  localToday,
  shelfLifeDays,
} from "./categories";

describe("categories", () => {
  it("has thirteen slugs and no meat or seafood", () => {
    expect(CATEGORY_SLUGS).toHaveLength(13);
    expect(CATEGORY_SLUGS).toContain("produce");
    expect(CATEGORY_SLUGS.join(" ")).not.toMatch(/meat|seafood|fish/);
  });

  it("labels a slug", () => {
    expect(categoryLabel("dairy")).toBe("Dairy, eggs & tofu");
  });
});

describe("database constraint", () => {
  const migrations = join(__dirname, "../../../supabase/migrations");

  // The slug list lives twice: here and in the grocery_items_category check constraint. A slug added
  // in one place only either fails every insert of it or never appears in the picker.
  it("matches the latest grocery_items_category check constraint", () => {
    const latest = readdirSync(migrations).sort()
      .map((file) => readFileSync(join(migrations, file), "utf8"))
      .filter((sql) => /constraint grocery_items_category\s+check/.test(sql))
      .at(-1);
    const list = latest?.match(/constraint grocery_items_category\s+check\s*\(category in \(([^)]*)\)/)?.[1];
    const slugs = [...(list ?? "").matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    expect(slugs.sort()).toEqual([...CATEGORY_SLUGS].sort());
  });

  it("recategorises existing items only into slugs the constraint allows", () => {
    const sql = readFileSync(join(migrations, "033_grocery_recategorize_existing.sql"), "utf8");
    const targets = [...sql.matchAll(/\('[^']+', '([a-z]+)'\)/g)].map((m) => m[1]);
    expect(targets.length).toBeGreaterThan(50);
    for (const slug of targets) expect(CATEGORY_SLUGS).toContain(slug);
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

describe("shelfLifeDays", () => {
  it("returns the shelf life for a category that expires", () => {
    expect(shelfLifeDays("dairy")).toBe(10);
  });

  it("returns null for a category that does not expire", () => {
    expect(shelfLifeDays("pantry")).toBeNull();
  });
});

describe("formatExpiry", () => {
  const today = "2026-09-27";

  it("names the next two days", () => {
    expect(formatExpiry("2026-09-27", today)).toBe("today");
    expect(formatExpiry("2026-09-28", today)).toBe("tomorrow");
  });

  it("counts days within the coming week", () => {
    expect(formatExpiry("2026-09-30", today)).toBe("3 days left");
    expect(formatExpiry("2026-10-03", today)).toBe("6 days left");
  });

  it("falls back to a short date a week or more out", () => {
    expect(formatExpiry("2026-10-04", today)).toBe("Oct 4");
  });

  it("adds the year only when it differs from today's", () => {
    expect(formatExpiry("2027-02-24", today)).toBe("Feb 24, 2027");
  });

  it("dates a past expiry rather than counting backwards", () => {
    expect(formatExpiry("2026-09-25", today)).toBe("Sep 25");
  });
});

describe("formatDay", () => {
  it("formats a timestamp as a short Pacific calendar date", () => {
    // 01:30Z on the 28th is still the 27th in Pacific time.
    expect(formatDay("2026-09-28T01:30:00Z", "2026-09-27")).toBe("Sep 27");
    expect(formatDay("2025-12-31T20:00:00Z", "2026-09-27")).toBe("Dec 31, 2025");
  });
});
