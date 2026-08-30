import { TAB20_SLUGS, DEFAULT_BOARD_COLUMNS, isTab20Slug } from "./colors";

describe("tab20 palette", () => {
  it("has exactly 20 unique slugs", () => {
    expect(TAB20_SLUGS).toHaveLength(20);
    expect(new Set(TAB20_SLUGS).size).toBe(20);
  });

  it("names every slug in the tab20-<hue> form the CSS tokens use", () => {
    for (const slug of TAB20_SLUGS) {
      expect(slug).toMatch(/^tab20-[a-z]+(-light)?$/);
    }
  });

  it("recognises its own slugs and rejects anything else", () => {
    expect(isTab20Slug("tab20-blue")).toBe(true);
    expect(isTab20Slug("#1f77b4")).toBe(false);
    expect(isTab20Slug("tab20-chartreuse")).toBe(false);
  });

  it("ships the five default columns, exactly one of them terminal", () => {
    expect(DEFAULT_BOARD_COLUMNS.map((c) => c.name)).toEqual([
      "Not Started",
      "In Progress",
      "Blocked",
      "Follow-up",
      "Completed",
    ]);
    expect(DEFAULT_BOARD_COLUMNS.filter((c) => c.isDone)).toHaveLength(1);
    expect(DEFAULT_BOARD_COLUMNS.at(-1)?.isDone).toBe(true);
  });

  it("gives every default column a valid slug", () => {
    for (const column of DEFAULT_BOARD_COLUMNS) {
      expect(isTab20Slug(column.color)).toBe(true);
    }
  });
});
