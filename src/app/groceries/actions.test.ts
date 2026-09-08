import { createFakeSupabase } from "@/test/supabase-fake";
const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ITEM = "33333333-3333-4333-8333-333333333333";
const LOT = "44444444-4444-4444-8444-444444444444";
let fake: ReturnType<typeof createFakeSupabase>;
let rpc: jest.SpyInstance;
jest.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fake }));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => fake }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
import * as actions from "./actions";

beforeEach(() => {
  fake = createFakeSupabase({ tables: {
    workspace_members: [{ id: "member", workspace_id: WORKSPACE, auth_user_id: "auth-user-1" }],
    grocery_items: [{ id: ITEM, workspace_id: WORKSPACE, name: "Milk", category: "dairy" }],
    grocery_lots: [{ id: LOT, item_id: ITEM, quantity: 2, expires_on: "2026-09-12" }],
  } });
  // SQL semantics are exercised by supabase/tests/grocery_lots.sql, not a second JS database.
  rpc = jest.spyOn(fake, "rpc").mockResolvedValue({ data: { id: ITEM }, error: null });
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-09-07T18:00:00Z"));
});
afterEach(() => jest.useRealTimers());

it("records a counted purchase with an explicit expiry", async () => {
  expect((await actions.markBought({ itemId: ITEM, quantity: 3, expiresOn: "2026-09-20" })).ok).toBe(true);
  expect(rpc).toHaveBeenCalledWith("grocery_mark_bought", {
    p_id: ITEM, p_quantity: 3, p_expires_on: "2026-09-20", p_estimate: false,
  });
});
it("distinguishes an omitted expiry from explicitly undated stock", async () => {
  await actions.markBought({ itemId: ITEM });
  expect(rpc).toHaveBeenLastCalledWith("grocery_mark_bought", {
    p_id: ITEM, p_quantity: null, p_expires_on: "2026-09-17", p_estimate: true,
  });
  await actions.markBought({ itemId: ITEM, expiresOn: null });
  expect(rpc).toHaveBeenLastCalledWith("grocery_mark_bought", {
    p_id: ITEM, p_quantity: null, p_expires_on: null, p_estimate: false,
  });
});
it("uses the stored category when estimating a typed repeat purchase", async () => {
  await actions.addGroceryItem({ workspaceId: WORKSPACE, name: " milk ", target: "stock" });
  expect(rpc).toHaveBeenCalledWith("grocery_upsert", expect.objectContaining({
    p_category: null, p_expires_on: "2026-09-17", p_estimate: true,
  }));
});
it("shopping additions never change category or stock details", async () => {
  await actions.addGroceryItem({ workspaceId: WORKSPACE, name: "Milk", target: "list",
    category: "produce", quantity: 5, expiresOn: "2026-09-20" });
  expect(rpc).toHaveBeenCalledWith("grocery_upsert", expect.objectContaining({
    p_category: null, p_quantity: null, p_expires_on: null, p_estimate: false,
  }));
});
it("adds explicit undated stock without estimating", async () => {
  await actions.addGroceryItem({ workspaceId: WORKSPACE, name: "Milk", target: "stock", quantity: 2, expiresOn: null });
  expect(rpc).toHaveBeenCalledWith("grocery_upsert", expect.objectContaining({ p_quantity: 2, p_expires_on: null, p_estimate: false }));
});
it("edits only product fields and preserves category when omitted", async () => {
  await actions.editItem({ itemId: ITEM, name: "Oat milk" });
  expect(fake.tables.grocery_items![0]).toMatchObject({ name: "Oat milk", category: "dairy" });
  expect(fake.tables.grocery_lots![0]).toMatchObject({ quantity: 2, expires_on: "2026-09-12" });
});
it("extends only the chosen batch date", async () => {
  await actions.extendLot({ lotId: LOT, expiresOn: "2026-09-20" });
  expect(rpc).toHaveBeenCalledWith("grocery_lot_extend", { p_lot: LOT, p_expires_on: "2026-09-20", p_estimate: true });
});
it("edits or clears one batch's count and expiry", async () => {
  await actions.editLot({ lotId: LOT, quantity: null, expiresOn: null, expiryIsEstimate: true });
  expect(rpc).toHaveBeenCalledWith("grocery_lot_edit", { p_lot: LOT, p_quantity: null, p_expires_on: null, p_estimate: false });
});
it("forwards discard, finish, step, need and forget intentions", async () => {
  await actions.discardLot({ lotId: LOT, keepOnList: true });
  expect(rpc).toHaveBeenLastCalledWith("grocery_lot_discard", { p_lot: LOT, p_keep_on_list: true });
  await actions.finishItem({ itemId: ITEM, keepOnList: false });
  expect(rpc).toHaveBeenLastCalledWith("grocery_finish", { p_id: ITEM, p_keep_on_list: false });
  await actions.adjustQuantity({ itemId: ITEM, delta: -2 });
  expect(rpc).toHaveBeenLastCalledWith("grocery_adjust_quantity", { p_id: ITEM, p_delta: -2 });
  await actions.setNeeded({ itemId: ITEM, needed: true });
  expect(rpc).toHaveBeenLastCalledWith("grocery_set_needed", { p_id: ITEM, p_needed: true });
  await actions.forgetItem({ itemId: ITEM });
  expect(rpc).toHaveBeenLastCalledWith("grocery_forget", { p_id: ITEM });
});
it.each(["edit", "extend", "discard"])("refuses to %s a batch in another workspace", async (operation) => {
  fake.tables.grocery_items![0].workspace_id = OTHER;
  const result = operation === "edit" ? await actions.editLot({ lotId: LOT, quantity: 1, expiresOn: null })
    : operation === "extend" ? await actions.extendLot({ lotId: LOT, expiresOn: "2026-09-20" })
    : await actions.discardLot({ lotId: LOT, keepOnList: true });
  expect(result).toMatchObject({ ok: false, error: expect.stringContaining("Forbidden") });
  expect(rpc).not.toHaveBeenCalled();
});
it("rejects unauthorized item and workspace writes", async () => {
  fake.tables.grocery_items![0].workspace_id = OTHER;
  for (const result of [
    await actions.markBought({ itemId: ITEM }),
    await actions.setNeeded({ itemId: ITEM, needed: true }),
    await actions.forgetItem({ itemId: ITEM }),
    await actions.editItem({ itemId: ITEM, name: "Renamed" }),
    await actions.addGroceryItem({ workspaceId: OTHER, name: "Milk", target: "list" }),
  ]) expect(result).toMatchObject({ ok: false, error: expect.stringContaining("Forbidden") });
  expect(rpc).not.toHaveBeenCalled();
});
it("rejects malformed batch input without writing", async () => {
  expect((await actions.editLot({ lotId: LOT, quantity: 0, expiresOn: null })).ok).toBe(false);
  expect((await actions.extendLot({ lotId: "invalid", expiresOn: "2026-09-20" })).ok).toBe(false);
  expect(rpc).not.toHaveBeenCalled();
});
it("surfaces authored RPC failures", async () => {
  rpc.mockResolvedValue({ data: null, error: { message: "grocery lot not found" } });
  expect(await actions.discardLot({ lotId: LOT, keepOnList: true })).toMatchObject({ ok: false, error: "grocery lot not found" });
});
it("reports a name collision as a field error", async () => {
  rpc.mockResolvedValue({ data: null, error: { code: "23505", message: "duplicate" } });
  expect(await actions.addGroceryItem({ workspaceId: WORKSPACE, name: "Milk", target: "list" }))
    .toMatchObject({ ok: false, fieldErrors: { name: [expect.stringContaining("already have an item")] } });
});
