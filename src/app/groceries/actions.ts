"use server";

import { revalidatePath } from "next/cache";

import { assertWorkspaceMember, requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ActionResult } from "@/app/tasks/action-result";
import { assertNoError, run } from "@/app/tasks/action-run";
import { parseInput, ValidationError } from "@/app/tasks/schemas";
import { estimatedExpiry } from "./categories";
import { knownGroceryRpcFailure } from "./rpc-errors";
import {
  addGroceryItemSchema,
  adjustQuantitySchema,
  editItemSchema,
  editLotSchema, discardLotSchema,
  type EditLotInput, type DiscardLotInput,
  extendLotSchema,
  finishItemSchema,
  forgetItemSchema,
  markBoughtSchema,
  setNeededSchema,
  type AddGroceryItemInput,
  type AdjustQuantityInput,
  type EditItemInput,
  type ExtendLotInput,
  type FinishItemInput,
  type ForgetItemInput,
  type MarkBoughtInput,
  type SetNeededInput,
} from "./schemas";

/**
 * Grocery items are shared by workspace membership rather than assigned per user, so authorization
 * is "are you in this workspace" for every operation — read, write and delete alike. The item id
 * arrives from the network, so the workspace it belongs to is read here rather than trusted from
 * the caller. Same shape as assertColumnMember in src/app/board/actions.ts.
 */
async function assertItemMember(
  itemId: string,
  authUserId: string,
): Promise<{ workspaceId: string; category: string }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("grocery_items")
    .select("workspace_id, category")
    .eq("id", itemId)
    .maybeSingle();

  assertNoError("load grocery item", { error });
  if (!data) throw new Error(`grocery item ${itemId} not found`);

  const workspaceId = data.workspace_id as string;
  await assertWorkspaceMember(workspaceId, authUserId);

  return { workspaceId, category: data.category as string };
}

/** Turns an RPC failure into a user-facing message when we authored it, or rethrows. */
function assertNoRpcError(step: string, { error }: { error: { message: string } | null }): void {
  if (!error) return;
  const known = knownGroceryRpcFailure(error.message);
  if (known) throw new ValidationError({}, known);
  throw new Error(`${step}: ${error.message}`);
}

/**
 * A unique-violation on grocery_items_workspace_name_key means this workspace already has a row
 * for that product — possibly an archived one the user cannot see, which is why the message says
 * where to look rather than just "already used".
 *
 * The 23505 check has to run before anything else can rethrow the error, and the non-23505 branch
 * must still route through assertNoRpcError rather than jumping straight to a generic rethrow — a
 * caller (addGroceryItem) that checks both wants the RPC's own authored messages (e.g. migration
 * 026's "member % is not in workspace %") to reach the user, not collapse to the generic message
 * because this ran first and threw a plain Error.
 */
function assertNoNameCollision(
  step: string,
  { error }: { error: { message: string; code?: string } | null },
): void {
  if (!error) return;
  if (error.code === "23505") {
    throw new ValidationError(
      { name: ["You already have an item with that name — check the other list"] },
      "You already have an item with that name — check the other list",
    );
  }
  assertNoRpcError(step, { error });
}

/** The member row this user holds in the given workspace, for `added_by_member_id`. */
async function memberInWorkspace(
  workspaceId: string,
  authUserId: string,
): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  assertNoError("load member row", { error });
  return (data?.id as string) ?? null;
}

export async function addGroceryItem(
  input: AddGroceryItemInput,
): Promise<ActionResult<{ itemId: string }>> {
  return run("addGroceryItem", async () => {
    const { user } = await requireUser();
    const { workspaceId, name, category, target, quantity, expiresOn } = parseInput(
      addGroceryItemSchema,
      input,
    );
    await assertWorkspaceMember(workspaceId, user.id);

    const admin = createAdminClient();
    const estimate = target === "stock" && expiresOn === undefined;
    let estimateCategory = category;
    if (estimate && estimateCategory === undefined) {
      const { data: products, error } = await admin.from("grocery_items")
        .select("name, category").eq("workspace_id", workspaceId);
      assertNoError("load grocery categories", { error });
      estimateCategory = products?.find((row) =>
        String(row.name).trim().toLowerCase() === name.toLowerCase())?.category;
    }
    const resolvedExpiry = target === "list" ? null : estimate
      ? estimatedExpiry(estimateCategory ?? "pantry") : (expiresOn ?? null);

    const { data, error } = await admin.rpc("grocery_upsert", {
      p_workspace: workspaceId,
      p_name: name,
      // Null, not "pantry": migration 029 reads a null category as "leave the stored one alone".
      // Defaulting here would put back the silent rewrite the add row used to cause.
      p_category: target === "stock" ? category ?? null : null,
      p_target: target,
      p_quantity: target === "stock" ? (quantity ?? null) : null,
      p_expires_on: resolvedExpiry,
      p_estimate: estimate && resolvedExpiry !== null,
      p_member: await memberInWorkspace(workspaceId, user.id),
    });

    assertNoNameCollision("add grocery item", { error });

    revalidatePath("/groceries");
    return { itemId: (data as { id: string }).id };
  });
}

export async function setNeeded(input: SetNeededInput): Promise<ActionResult<{ itemId: string }>> {
  return run("setNeeded", async () => {
    const { user } = await requireUser();
    const { itemId, needed } = parseInput(setNeededSchema, input);
    await assertItemMember(itemId, user.id);

    const admin = createAdminClient();
    const { error } = await admin.rpc("grocery_set_needed", { p_id: itemId, p_needed: needed });
    assertNoRpcError("set needed", { error });

    revalidatePath("/groceries");
    return { itemId };
  });
}

export async function markBought(
  input: MarkBoughtInput,
): Promise<ActionResult<{ itemId: string }>> {
  return run("markBought", async () => {
    const { user } = await requireUser();
    const { itemId, expiresOn, quantity } = parseInput(markBoughtSchema, input);
    const { category } = await assertItemMember(itemId, user.id);

    // Bought is how nearly everything enters the pantry, so the shelf-life estimate has to apply
    // here too — prefilling only on a manual add would leave the mechanism unused.
    const estimate = expiresOn === undefined;
    const resolvedExpiry = estimate ? estimatedExpiry(category) : (expiresOn ?? null);

    const admin = createAdminClient();
    const { error } = await admin.rpc("grocery_mark_bought", {
      p_id: itemId,
      p_expires_on: resolvedExpiry,
      p_estimate: estimate && resolvedExpiry !== null,
      p_quantity: quantity ?? null,
    });
    assertNoRpcError("mark bought", { error });

    revalidatePath("/groceries");
    return { itemId };
  });
}

export async function finishItem(
  input: FinishItemInput,
): Promise<ActionResult<{ itemId: string }>> {
  return run("finishItem", async () => {
    const { user } = await requireUser();
    const { itemId, keepOnList } = parseInput(finishItemSchema, input);
    await assertItemMember(itemId, user.id);

    const admin = createAdminClient();
    const { error } = await admin.rpc("grocery_finish", {
      p_id: itemId,
      p_keep_on_list: keepOnList,
    });
    assertNoRpcError("finish item", { error });

    revalidatePath("/groceries");
    return { itemId };
  });
}

export async function adjustQuantity(
  input: AdjustQuantityInput,
): Promise<ActionResult<{ itemId: string }>> {
  return run("adjustQuantity", async () => {
    const { user } = await requireUser();
    const { itemId, delta } = parseInput(adjustQuantitySchema, input);
    await assertItemMember(itemId, user.id);

    // The RPC does the arithmetic relative to the committed row and owns the zero crossing, so two
    // phones stepping the same item both land. Reading the count here and writing it back would
    // lose one of them (tasks/lessons.md L10).
    const admin = createAdminClient();
    const { error } = await admin.rpc("grocery_adjust_quantity", { p_id: itemId, p_delta: delta });
    assertNoRpcError("adjust quantity", { error });

    revalidatePath("/groceries");
    return { itemId };
  });
}

async function assertLotMember(lotId: string, authUserId: string): Promise<string> {
  const { data, error } = await createAdminClient().from("grocery_lots")
    .select("item_id").eq("id", lotId).maybeSingle();
  assertNoError("load grocery lot", { error });
  if (!data) throw new Error(`grocery lot ${lotId} not found`);
  const itemId = data.item_id as string;
  await assertItemMember(itemId, authUserId);
  return itemId;
}

export async function extendLot(input: ExtendLotInput): Promise<ActionResult> {
  return run("extendLot", async () => {
    const { user } = await requireUser();
    const { lotId, expiresOn } = parseInput(extendLotSchema, input);
    await assertLotMember(lotId, user.id);
    const { error } = await createAdminClient().rpc("grocery_lot_extend", {
      p_lot: lotId, p_expires_on: expiresOn, p_estimate: true,
    });
    assertNoRpcError("extend batch", { error });
    revalidatePath("/groceries");
    return {};
  });
}

export async function editLot(input: EditLotInput): Promise<ActionResult> {
  return run("editLot", async () => {
    const { user } = await requireUser();
    const { lotId, quantity, expiresOn, expiryIsEstimate } = parseInput(editLotSchema, input);
    await assertLotMember(lotId, user.id);
    const { error } = await createAdminClient().rpc("grocery_lot_edit", {
      p_lot: lotId, p_quantity: quantity, p_expires_on: expiresOn,
      p_estimate: expiresOn !== null && expiryIsEstimate,
    });
    assertNoRpcError("edit batch", { error });
    revalidatePath("/groceries");
    return {};
  });
}

export async function discardLot(input: DiscardLotInput): Promise<ActionResult> {
  return run("discardLot", async () => {
    const { user } = await requireUser();
    const { lotId, keepOnList } = parseInput(discardLotSchema, input);
    await assertLotMember(lotId, user.id);
    const { error } = await createAdminClient().rpc("grocery_lot_discard", {
      p_lot: lotId, p_keep_on_list: keepOnList,
    });
    assertNoRpcError("discard batch", { error });
    revalidatePath("/groceries");
    return {};
  });
}

export async function editItem(input: EditItemInput): Promise<ActionResult<{ itemId: string }>> {
  return run("editItem", async () => {
    const { user } = await requireUser();
    const { itemId, name, category } = parseInput(editItemSchema, input);
    await assertItemMember(itemId, user.id);

    // Editing the descriptive columns is a plain update: none of them are part of a transition, so
    // there is no multi-column invariant for an RPC to protect. The constraints still apply.
    const admin = createAdminClient();
    const { error } = await admin
      .from("grocery_items")
      .update({
        name,
        ...(category !== undefined ? { category } : {}),
      })
      .eq("id", itemId);

    assertNoNameCollision("edit grocery item", { error });

    revalidatePath("/groceries");
    return { itemId };
  });
}

export async function forgetItem(input: ForgetItemInput): Promise<ActionResult> {
  return run("forgetItem", async () => {
    const { user } = await requireUser();
    const { itemId } = parseInput(forgetItemSchema, input);
    await assertItemMember(itemId, user.id);

    const admin = createAdminClient();
    const { error } = await admin.rpc("grocery_forget", { p_id: itemId });
    assertNoRpcError("forget item", { error });

    revalidatePath("/groceries");
    return {};
  });
}
