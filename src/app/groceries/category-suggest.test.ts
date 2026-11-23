import { suggestCategory } from "./category-suggest";

describe("suggestCategory", () => {
  // Names as this household actually typed them (production, 2026-11-22), so the table is tuned
  // against real input rather than tidy examples.
  it.each([
    ["Milk", "dairy"],
    ["Eggs", "dairy"],
    ["tofu", "dairy"],
    ["Cream Cheese", "dairy"],
    ["pepper jack cheese", "dairy"],
    ["Spinach", "produce"],
    ["Onion", "produce"],
    ["Bell Pepper", "produce"],
    ["curry leaves", "produce"],
    ["blueberries", "produce"],
    ["Tomatoes", "produce"],
    ["Toor Daal", "dals"],
    ["Kabuli chana", "dals"],
    ["Kidney beans", "dals"],
    ["green bean", "produce"],
    ["Jowar Aata", "grains"],
    ["Wheat Flour", "grains"],
    ["Corn Flour", "pantry"],
    ["Quaker overnight oats", "grains"],
    ["Methi Seeds", "spices"],
    ["cumin powder", "spices"],
    ["Cocoa Powder", "pantry"],
    ["Baking powder", "pantry"],
    ["tamarind chutney", "condiments"],
    ["rice vinegar", "condiments"],
    ["Lemon Juice", "condiments"],
    ["peanut butter", "condiments"],
    ["Pista", "nuts"],
    ["Medjool date", "nuts"],
    ["shredded coconut", "nuts"],
    ["coconut", "produce"],
    ["Dhana Daal", "snacks"],
    ["roasted chickpea", "snacks"],
    ["Puff Rice", "snacks"],
    ["garlic naan cracker", "snacks"],
    ["Dark Chocolate Coconut Cups", "snacks"],
    ["Chocolate covered espresso beans", "snacks"],
    ["Crispy crêpe", "snacks"],
    ["Choco chips", "pantry"],
    ["Garlic Bread", "baked"],
    ["mini bao bun", "baked"],
    ["Icecream", "frozen"],
    ["Frozen Okra", "frozen"],
    ["vegetable gyoza", "frozen"],
    ["Chick Patties", "frozen"],
    ["mushroom ravioli", "frozen"],
    ["tomato soup", "pantry"],
    ["coconut milk", "pantry"],
    ["Condensed milk", "pantry"],
    ["Japanese curry", "pantry"],
    ["honey ginger tea", "beverages"],
    ["Coke", "beverages"],
    ["Elmer school glue", "household"],
    ["Bedsheet", "household"],
  ])("files %s under %s", (name, category) => {
    expect(suggestCategory(name)).toBe(category);
  });

  it("returns null when nothing matches, leaving the fallback to the caller", () => {
    expect(suggestCategory("C3s")).toBeNull();
    expect(suggestCategory("")).toBeNull();
  });

  it("matches whole words, not substrings", () => {
    // "eggplant" must not be read as egg, nor "peanut" as pea.
    expect(suggestCategory("eggplant")).toBe("produce");
    expect(suggestCategory("peanuts")).toBe("nuts");
  });
});
