"use server";

import { revalidatePath } from "next/cache";

import { assertWorkspaceMember, memberIdsForUser, requireUser } from "@/lib/auth";
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
  finishItemSchema,
  forgetItemSchema,
  markBoughtSchema,
  setNeededSchema,
  type AddGroceryItemInput,
  type AdjustQuantityInput,
  type EditItemInput,
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
  const memberIds = await memberIdsForUser(authUserId);
  if (memberIds.length === 0) return null;

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

    // An item entering the pantry with no printed date gets the category's shelf life, flagged as
    // an estimate. Undated rows sort last, which is wrong for produce — the whole reason the
    // estimate exists. `expiresOn: null` means the caller explicitly wants no date.
    const estimate = target === "stock" && expiresOn === undefined;
    const resolvedExpiry = estimate ? estimatedExpiry(category) : (expiresOn ?? null);

    const admin = createAdminClient();
    const { data, error } = await admin.rpc("grocery_upsert", {
      p_workspace: workspaceId,
      p_name: name,
      p_category: category,
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
    const { itemId, expiresOn } = parseInput(markBoughtSchema, input);
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

export async function editItem(input: EditItemInput): Promise<ActionResult<{ itemId: string }>> {
  return run("editItem", async () => {
    const { user } = await requireUser();
    const { itemId, name, category, expiresOn, quantity } = parseInput(editItemSchema, input);
    await assertItemMember(itemId, user.id);

    // Editing the descriptive columns is a plain update: none of them are part of a transition, so
    // there is no multi-column invariant for an RPC to protect. The constraints still apply.
    const admin = createAdminClient();
    const { error } = await admin
      .from("grocery_items")
      .update({
        name,
        category,
        expires_on: expiresOn,
        expiry_is_estimate: false,
        quantity,
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
