import { editDistance, searchPantry } from "./search";

const names = (list: { name: string }[]) => list.map((item) => item.name);
const pantry = ["Paneer", "Spinach", "Oat milk", "Tomato", "Atta", "Pasta", "Basmati rice", "Rice flour", "Dahi"]
  .map((name) => ({ name }));

describe("editDistance", () => {
  it("counts an adjacent swap as one edit", () => {
    expect(editDistance("panere", "paneer")).toBe(1);
  });

  it("counts insertions, deletions and substitutions", () => {
    expect(editDistance("tomatoe", "tomato")).toBe(1);
    expect(editDistance("aata", "atta")).toBe(1);
    expect(editDistance("milk", "mint")).toBe(2);
  });
});

describe("searchPantry", () => {
  it("returns everything, in order, for an empty query", () => {
    expect(searchPantry(pantry, "  ")).toEqual({ exact: pantry, similar: [] });
  });

  it("matches a case-insensitive substring anywhere in the name", () => {
    expect(names(searchPantry(pantry, "ACH").exact)).toEqual(["Spinach"]);
    expect(names(searchPantry(pantry, "rice").exact)).toEqual(["Basmati rice", "Rice flour"]);
  });

  it("ignores spaces and hyphens", () => {
    expect(names(searchPantry(pantry, "oatmilk").exact)).toEqual(["Oat milk"]);
    expect(names(searchPantry(pantry, "oat-milk").exact)).toEqual(["Oat milk"]);
  });

  it("puts typo matches in similar, never in exact", () => {
    expect(searchPantry(pantry, "panner")).toEqual({ exact: [], similar: [{ name: "Paneer" }] });
    expect(names(searchPantry(pantry, "tomatoe").similar)).toEqual(["Tomato"]);
    expect(names(searchPantry(pantry, "aata").similar)).toEqual(["Atta"]);
  });

  it("matches a typo in a partly typed word", () => {
    expect(names(searchPantry(pantry, "pann").similar)).toEqual(["Paneer"]);
  });

  it("matches a typo across words", () => {
    expect(names(searchPantry(pantry, "oat mlk").similar)).toEqual(["Oat milk"]);
  });

  it("allows two edits only from eight letters", () => {
    expect(names(searchPantry(pantry, "spinnch").similar)).toEqual(["Spinach"]);
    expect(names(searchPantry(pantry, "spnnch").similar)).toEqual([]);
    expect(names(searchPantry(pantry, "basmatii rce").similar)).toEqual(["Basmati rice"]);
  });

  it("does no fuzzy matching under four letters", () => {
    expect(searchPantry(pantry, "dhi")).toEqual({ exact: [], similar: [] });
  });

  it("does not treat a two-edit word as similar for a short query", () => {
    expect(names(searchPantry(pantry, "atta").similar)).not.toContain("Pasta");
    expect(names(searchPantry(pantry, "dahee").similar)).toEqual([]);
  });

  it("keeps the caller's order within each group", () => {
    const items = [{ name: "Zucchini" }, { name: "Chilli" }, { name: "Chili" }];
    expect(names(searchPantry(items, "chili").exact)).toEqual(["Chili"]);
    expect(names(searchPantry(items, "chili").similar)).toEqual(["Chilli"]);
  });
});
