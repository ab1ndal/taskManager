import type { Tables } from "@/test/supabase-fake";
import { createFakeSupabase } from "@/test/supabase-fake";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const OTHER_WORKSPACE = "22222222-2222-4222-8222-222222222222";
const ITEM = "33333333-3333-4333-8333-333333333333";
const OTHER_ITEM = "44444444-4444-4444-8444-444444444444";

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

  it("preserves an estimate on an edit and clears its flag with its date", async () => {
    const { editItem } = await import("./actions");
    const input = { itemId: ITEM, name: "Bananas", category: "produce" as const,
      quantity: 3, expiresOn: "2026-09-13", expiryIsEstimate: true };
    expect((await editItem(input)).ok).toBe(true);
    expect(fake.tables.grocery_items?.[0].expiry_is_estimate).toBe(true);
    expect((await editItem({ ...input, expiresOn: null })).ok).toBe(true);
    expect(fake.tables.grocery_items?.[0]).toMatchObject({ expires_on: null, expiry_is_estimate: false });
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
          { id: OTHER_ITEM, workspace_id: OTHER_WORKSPACE, name: "Secret", category: "pantry",
            in_stock: true, needed: false, quantity: null, expires_on: null,
            expiry_is_estimate: false, times_added: 1 },
        ],
      }),
    });
    const { setNeeded } = await import("./actions");
    const result = await setNeeded({ itemId: OTHER_ITEM, needed: true });

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

  // Regression: migration 028 fixed grocery_upsert so a null incoming quantity/date on the
  // conflict branch preserves what is already tracked instead of wiping it. The fake used to
  // model 027's pre-fix behaviour (`?? null`), which would silently reintroduce the data-loss bug
  // in every test written against it.
  //
  // Quantity is preserved because addGroceryItem sends it as null when the caller omits it, but
  // the re-add still carries a *freshly computed* expiry — the category's shelf life applied
  // against today — so that half of the assertion has to be pinned to a frozen clock rather than
  // a literal, or it rots the moment today's date moves on.
  it("re-adding an in-stock item with no quantity or date preserves what was already tracked", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-06T18:00:00Z"));
    try {
      const { addGroceryItem } = await import("./actions");
      await addGroceryItem({ workspaceId: WORKSPACE, name: "Bananas", category: "produce", target: "stock" });

      const row = fake.tables.grocery_items?.find((r) => r.name === "Bananas");
      expect(row).toMatchObject({ quantity: 3, expires_on: "2026-09-13", expiry_is_estimate: true });
    } finally {
      jest.useRealTimers();
    }
  });

  // Regression: assertNoNameCollision used to rethrow any non-23505 error as a plain Error before
  // assertNoRpcError ever ran, so an authored RPC message (migration 026's
  // "member % is not in workspace %") collapsed to the generic message instead of reaching the
  // caller. The fake's failOn hook is wired to the grocery RPC dispatcher to prove the fix.
  it("surfaces an authored RPC failure instead of the generic message", async () => {
    fake = createFakeSupabase({
      tables: seed(),
      failOn: (table, op) =>
        table === "grocery_items" && op === "insert"
          ? { message: "member m1 is not in workspace w1" }
          : null,
    });
    const { addGroceryItem } = await import("./actions");
    const result = await addGroceryItem({
      workspaceId: WORKSPACE, name: "Paneer", category: "dairy", target: "stock",
    });

    expect(result).toEqual({
      ok: false,
      error: "member m1 is not in workspace w1",
      fieldErrors: {},
    });
  });

  // forgetItem is the one destructive path with no recovery — a refactor that dropped its
  // assertItemMember call would otherwise go green.
  it("refuses to forget an item in another workspace, reading the workspace from the row", async () => {
    fake = createFakeSupabase({
      tables: seed({
        grocery_items: [
          { id: OTHER_ITEM, workspace_id: OTHER_WORKSPACE, name: "Secret", category: "pantry",
            in_stock: true, needed: false, quantity: null, expires_on: null,
            expiry_is_estimate: false, times_added: 1 },
        ],
      }),
    });
    const { forgetItem } = await import("./actions");
    const result = await forgetItem({ itemId: OTHER_ITEM });

    expect(result).toEqual({ ok: false, error: expect.stringContaining("Forbidden") });
    expect(fake.tables.grocery_items).toHaveLength(1);
  });

  it("refuses to edit an item in another workspace, reading the workspace from the row", async () => {
    fake = createFakeSupabase({
      tables: seed({
        grocery_items: [
          { id: OTHER_ITEM, workspace_id: OTHER_WORKSPACE, name: "Secret", category: "pantry",
            in_stock: true, needed: false, quantity: null, expires_on: null,
            expiry_is_estimate: false, times_added: 1 },
        ],
      }),
    });
    const { editItem } = await import("./actions");
    const result = await editItem({
      itemId: OTHER_ITEM, name: "Renamed", category: "pantry", expiresOn: null, quantity: null,
    });

    expect(result).toEqual({ ok: false, error: expect.stringContaining("Forbidden") });
    expect(fake.tables.grocery_items?.[0].name).toBe("Secret");
  });
});
