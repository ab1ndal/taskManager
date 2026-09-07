import type { Tables } from "@/test/supabase-fake";
import { createFakeSupabase } from "@/test/supabase-fake";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const OTHER_WORKSPACE = "22222222-2222-4222-8222-222222222222";
const ITEM = "33333333-3333-4333-8333-333333333333";

let fake: ReturnType<typeof createFakeSupabase>;

jest.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fake }));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => fake }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

function seed(extra: Tables = {}): Tables {
  return {
    workspace_members: [
      { id: "member-1", workspace_id: WORKSPACE, auth_user_id: "auth-user-1" },
      { id: "member-9", workspace_id: OTHER_WORKSPACE, auth_user_id: "auth-user-9" },
    ],
    grocery_items: [
      {
        id: ITEM,
        workspace_id: WORKSPACE,
        name: "Bananas",
        category: "produce",
        in_stock: true,
        needed: false,
        quantity: 3,
        expires_on: "2026-09-13",
        expiry_is_estimate: true,
        times_added: 1,
      },
    ],
    ...extra,
  };
}

describe("grocery actions", () => {
  beforeEach(() => {
    jest.resetModules();
    fake = createFakeSupabase({ tables: seed() });
  });

  it("adds an item with the category shelf life when no expiry is given", async () => {
    const { addGroceryItem } = await import("./actions");
    const result = await addGroceryItem({
      workspaceId: WORKSPACE,
      name: "Spinach",
      category: "produce",
      target: "stock",
    });

    expect(result.ok).toBe(true);
    const added = (fake.tables.grocery_items ?? []).find((r) => r.name === "Spinach");
    expect(added?.expires_on).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    expect(added?.expiry_is_estimate).toBe(true);
  });

  it("does not estimate an expiry for a category without a shelf life", async () => {
    const { addGroceryItem } = await import("./actions");
    await addGroceryItem({
      workspaceId: WORKSPACE, name: "Rice", category: "pantry", target: "stock",
    });

    const added = (fake.tables.grocery_items ?? []).find((r) => r.name === "Rice");
    expect(added?.expires_on).toBeNull();
    expect(added?.expiry_is_estimate).toBe(false);
  });

  it("adds to the shopping list without an expiry", async () => {
    const { addGroceryItem } = await import("./actions");
    await addGroceryItem({
      workspaceId: WORKSPACE, name: "Coriander", category: "produce", target: "list",
    });

    const added = (fake.tables.grocery_items ?? []).find((r) => r.name === "Coriander");
    expect(added).toMatchObject({ in_stock: false, needed: true, expires_on: null });
  });

  it("refuses a workspace the user does not belong to", async () => {
    const { addGroceryItem } = await import("./actions");
    const result = await addGroceryItem({
      workspaceId: OTHER_WORKSPACE, name: "Soap", category: "household", target: "list",
    });

    expect(result).toEqual({ ok: false, error: expect.stringContaining("Forbidden") });
    expect(fake.tables.grocery_items).toHaveLength(1);
  });

  it("refuses an item in another workspace, reading the workspace from the row", async () => {
    fake = createFakeSupabase({
      tables: seed({
        grocery_items: [
          { id: "44444444-4444-4444-8444-444444444444", workspace_id: OTHER_WORKSPACE, name: "Secret", category: "pantry",
            in_stock: true, needed: false, quantity: null, expires_on: null,
            expiry_is_estimate: false, times_added: 1 },
        ],
      }),
    });
    const { setNeeded } = await import("./actions");
    const result = await setNeeded({ itemId: "44444444-4444-4444-8444-444444444444", needed: true });

    expect(result).toEqual({ ok: false, error: expect.stringContaining("Forbidden") });
    expect(fake.tables.grocery_items?.[0].needed).toBe(false);
  });

  it("finishing clears quantity and expiry and keeps it on the list", async () => {
    const { finishItem } = await import("./actions");
    const result = await finishItem({ itemId: ITEM, keepOnList: true });

    expect(result.ok).toBe(true);
    expect(fake.tables.grocery_items?.[0]).toMatchObject({
      in_stock: false, needed: true, quantity: null, expires_on: null, expiry_is_estimate: false,
    });
  });

  it("finishing without keeping it archives the row rather than deleting it", async () => {
    const { finishItem } = await import("./actions");
    await finishItem({ itemId: ITEM, keepOnList: false });

    expect(fake.tables.grocery_items).toHaveLength(1);
    expect(fake.tables.grocery_items?.[0]).toMatchObject({ in_stock: false, needed: false });
  });

  it("stepping down to zero finishes the item instead of storing zero", async () => {
    const { adjustQuantity } = await import("./actions");
    await adjustQuantity({ itemId: ITEM, delta: -1 });
    await adjustQuantity({ itemId: ITEM, delta: -1 });
    expect(fake.tables.grocery_items?.[0].quantity).toBe(1);

    await adjustQuantity({ itemId: ITEM, delta: -1 });
    expect(fake.tables.grocery_items?.[0]).toMatchObject({
      in_stock: false, needed: true, quantity: null,
    });
  });

  it("marking bought returns it to the pantry with an estimated expiry", async () => {
    fake.tables.grocery_items![0] = {
      ...fake.tables.grocery_items![0], in_stock: false, needed: true,
      quantity: null, expires_on: null, expiry_is_estimate: false,
    };
    const { markBought } = await import("./actions");
    await markBought({ itemId: ITEM });

    expect(fake.tables.grocery_items?.[0]).toMatchObject({
      in_stock: true, needed: false, expiry_is_estimate: true,
    });
  });

  it("forgetting deletes the row", async () => {
    const { forgetItem } = await import("./actions");
    await forgetItem({ itemId: ITEM });
    expect(fake.tables.grocery_items).toHaveLength(0);
  });

  // Regression: assertNoNameCollision takes `{ error }`, not a bare error. Passing the error
  // directly destructured null on every success, throwing *after* the write had committed — so a
  // successful add reported failure, skipped revalidation, and invited a retry that bumped
  // times_added again.
  it("reports success on a write that had no error", async () => {
    const { addGroceryItem } = await import("./actions");
    const result = await addGroceryItem({
      workspaceId: WORKSPACE, name: "Paneer", category: "dairy", target: "stock",
    });

    expect(result).toEqual({ ok: true, itemId: expect.any(String) });
  });

  it("turns a duplicate name into a field error rather than a generic failure", async () => {
    fake = createFakeSupabase({
      tables: seed(),
      failOn: (table, op) =>
        table === "grocery_items" && op === "update"
          ? { message: "duplicate key value violates unique constraint", code: "23505" }
          : null,
    });
    const { editItem } = await import("./actions");
    const result = await editItem({
      itemId: ITEM, name: "Milk", category: "dairy", expiresOn: null, quantity: null,
    });

    expect(result).toMatchObject({
      ok: false,
      fieldErrors: { name: [expect.stringContaining("already have an item")] },
    });
  });

  it("rejects invalid input before touching the database", async () => {
    const { addGroceryItem } = await import("./actions");
    const result = await addGroceryItem({
      workspaceId: WORKSPACE, name: "   ", category: "produce", target: "list",
    });

    expect(result.ok).toBe(false);
    expect(fake.tables.grocery_items).toHaveLength(1);
  });
});
