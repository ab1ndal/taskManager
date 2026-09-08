import { addGroceryItemSchema, adjustQuantitySchema, editLotSchema } from "./schemas";

const workspaceId = "11111111-1111-4111-8111-111111111111";

describe("addGroceryItemSchema", () => {
  it("accepts a minimal item and trims the name", () => {
    const parsed = addGroceryItemSchema.parse({
      workspaceId,
      name: "  Oat milk ",
      category: "dairy",
      target: "list",
    });
    expect(parsed.name).toBe("Oat milk");
  });

  it("rejects a whitespace-only name", () => {
    expect(addGroceryItemSchema.safeParse({
      workspaceId, name: "   ", category: "dairy", target: "list",
    }).success).toBe(false);
  });

  it("rejects an unknown category", () => {
    expect(addGroceryItemSchema.safeParse({
      workspaceId, name: "Chicken", category: "meat", target: "list",
    }).success).toBe(false);
  });

  it("rejects a quantity of zero", () => {
    expect(addGroceryItemSchema.safeParse({
      workspaceId, name: "Eggs", category: "dairy", target: "stock", quantity: 0,
    }).success).toBe(false);
  });

  it("rejects an expiry that is not a calendar date", () => {
    expect(addGroceryItemSchema.safeParse({
      workspaceId, name: "Milk", category: "dairy", target: "stock",
      expiresOn: "2026-09-12T00:00:00Z",
    }).success).toBe(false);
  });
});

describe("adjustQuantitySchema", () => {
  it("accepts -1 and 1", () => {
    expect(adjustQuantitySchema.safeParse({ itemId: workspaceId, delta: -1 }).success).toBe(true);
    expect(adjustQuantitySchema.safeParse({ itemId: workspaceId, delta: 1 }).success).toBe(true);
  });

  it("rejects a delta of zero", () => {
    expect(adjustQuantitySchema.safeParse({ itemId: workspaceId, delta: 0 }).success).toBe(false);
  });
});

describe("editLotSchema", () => {
  it("allows clearing the expiry with null", () => {
    const parsed = editLotSchema.parse({
      lotId: workspaceId, expiresOn: null, quantity: null,
    });
    expect(parsed.expiresOn).toBeNull();
  });
});
