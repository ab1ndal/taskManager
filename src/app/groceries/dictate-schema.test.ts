import { LOW_CONFIDENCE_THRESHOLD, rawDictatedItemSchema, toReviewItem } from "./dictate-schema";

function raw(overrides: Partial<Parameters<typeof toReviewItem>[0]> = {}) {
  return {
    name: "Milk",
    quantity: null,
    category: "dairy",
    confidence: 0.9,
    sourceText: "milk",
    ...overrides,
  };
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
});

describe("toReviewItem", () => {
  it("keeps a category that matches a known slug", () => {
    expect(toReviewItem(raw({ category: "produce" })).category).toBe("produce");
  });

  it("falls back to pantry for a category the model invented", () => {
    expect(toReviewItem(raw({ category: "meat" })).category).toBe("pantry");
    expect(toReviewItem(raw({ category: "" })).category).toBe("pantry");
  });

  it("flags a row below the confidence threshold and keeps the raw fragment", () => {
    const item = toReviewItem(raw({ confidence: LOW_CONFIDENCE_THRESHOLD - 0.01, sourceText: "we're low on olive oil" }));
    expect(item.lowConfidence).toBe(true);
    expect(item.sourceText).toBe("we're low on olive oil");
  });

  it("does not flag a row at or above the confidence threshold", () => {
    expect(toReviewItem(raw({ confidence: LOW_CONFIDENCE_THRESHOLD })).lowConfidence).toBe(false);
  });

  it("passes quantity through unchanged, including null", () => {
    expect(toReviewItem(raw({ quantity: 12 })).quantity).toBe(12);
    expect(toReviewItem(raw({ quantity: null })).quantity).toBe(null);
  });
});
