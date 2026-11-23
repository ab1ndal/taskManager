import { LOW_CONFIDENCE_THRESHOLD, rawDictatedItemSchema, toReviewItem } from "./dictate-schema";

function raw(overrides: Partial<Parameters<typeof toReviewItem>[0]> = {}) {
  return {
    name: "Milk",
    quantity: null,
    category: "dairy",
    confidence: 0.9,
    sourceText: "milk",
    expiresOn: null,
    ...overrides,
  };
}

/** A fixed "today" so the past-expiry rule does not depend on when the suite runs. */
const TODAY = "2026-09-27";

function review(item: ReturnType<typeof raw>) {
  return toReviewItem(item, TODAY);
}

describe("rawDictatedItemSchema", () => {
  it("accepts a well-formed model item", () => {
    expect(rawDictatedItemSchema.safeParse(raw()).success).toBe(true);
  });

  it("rejects a confidence outside 0..1", () => {
    expect(rawDictatedItemSchema.safeParse(raw({ confidence: 1.5 })).success).toBe(false);
  });

  it("rejects a non-integer or out-of-range quantity", () => {
    expect(rawDictatedItemSchema.safeParse(raw({ quantity: 2.5 })).success).toBe(false);
    expect(rawDictatedItemSchema.safeParse(raw({ quantity: 1000 })).success).toBe(false);
    expect(rawDictatedItemSchema.safeParse(raw({ quantity: 0 })).success).toBe(false);
  });

  it("rejects an empty name or source fragment", () => {
    expect(rawDictatedItemSchema.safeParse(raw({ name: "" })).success).toBe(false);
    expect(rawDictatedItemSchema.safeParse(raw({ sourceText: "" })).success).toBe(false);
  });

  it("accepts an oversized name or fragment so one long item cannot fail the whole list", () => {
    expect(rawDictatedItemSchema.safeParse(raw({ name: "x".repeat(150) })).success).toBe(true);
    expect(rawDictatedItemSchema.safeParse(raw({ sourceText: "y".repeat(300) })).success).toBe(true);
  });
});

describe("toReviewItem", () => {
  it("keeps a category that matches a known slug", () => {
    expect(review(raw({ category: "produce" })).category).toBe("produce");
  });

  it("falls back to the keyword guess, then pantry, for a category the model invented", () => {
    expect(review(raw({ category: "meat" })).category).toBe("dairy");
    expect(review(raw({ name: "C3s", category: "" })).category).toBe("pantry");
  });

  it("flags a row below the confidence threshold and keeps the raw fragment", () => {
    const item = review(raw({ confidence: LOW_CONFIDENCE_THRESHOLD - 0.01, sourceText: "we're low on olive oil" }));
    expect(item.lowConfidence).toBe(true);
    expect(item.sourceText).toBe("we're low on olive oil");
  });

  it("does not flag a row at or above the confidence threshold", () => {
    expect(review(raw({ confidence: LOW_CONFIDENCE_THRESHOLD })).lowConfidence).toBe(false);
  });

  it("passes quantity through unchanged, including null", () => {
    expect(review(raw({ quantity: 12 })).quantity).toBe(12);
    expect(review(raw({ quantity: null })).quantity).toBe(null);
  });

  it("keeps a spoken expiry date the model resolved", () => {
    expect(review(raw({ expiresOn: "2026-10-02" })).expiresOn).toBe("2026-10-02");
  });

  it("leaves expiry null when none was said, so the category estimate still applies", () => {
    expect(review(raw({ expiresOn: null })).expiresOn).toBe(null);
  });

  it("drops a malformed or out-of-range expiry instead of failing the whole parse", () => {
    expect(review(raw({ expiresOn: "Friday" })).expiresOn).toBe(null);
    expect(review(raw({ expiresOn: "2026-02-30" })).expiresOn).toBe(null);
    expect(review(raw({ expiresOn: "1999-01-01" })).expiresOn).toBe(null);
  });

  it("drops an expiry earlier than today but keeps one that is today", () => {
    expect(review(raw({ expiresOn: "2026-09-26" })).expiresOn).toBe(null);
    expect(review(raw({ expiresOn: TODAY })).expiresOn).toBe(TODAY);
  });

  it("truncates a name to the 100 characters addGroceryItem accepts", () => {
    expect(review(raw({ name: "x".repeat(150) })).name).toBe("x".repeat(100));
    expect(review(raw({ name: "x".repeat(100) })).name).toBe("x".repeat(100));
  });

  it("truncates a source fragment to 200 characters", () => {
    expect(review(raw({ sourceText: "y".repeat(300) })).sourceText).toBe("y".repeat(200));
  });

  it("does not leave half of a surrogate pair at the cut", () => {
    const name = "x".repeat(99) + "🥭";
    const cut = review(raw({ name })).name;
    expect(cut).toBe("x".repeat(99));
    expect(cut.length).toBeLessThanOrEqual(100);
  });
});
