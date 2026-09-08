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
  extendExpirySchema,
  finishItemSchema,
  forgetItemSchema,
  markBoughtSchema,
  setNeededSchema,
  type AddGroceryItemInput,
  type AdjustQuantityInput,
  type EditItemInput,
  type ExtendExpiryInput,
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

    // An item entering the pantry with no printed date gets the category's shelf life, flagged as
    // an estimate. Undated rows sort last, which is wrong for produce — the whole reason the
    // estimate exists. `expiresOn: null` means the caller explicitly wants no date.
    //
    // With no category named there is nothing to look a shelf life up under, and a new row lands on
    // the column default — so 'pantry' is what the estimate would be computed from anyway, and
    // 'pantry' has none. A re-add then sends a null date, which migration 028's conflict branch
    // already reads as "keep the date this row is carrying".
    const estimate = target === "stock" && expiresOn === undefined;
    const resolvedExpiry = estimate
      ? estimatedExpiry(category ?? "pantry")
      : (expiresOn ?? null);

    const admin = createAdminClient();
    const { data, error } = await admin.rpc("grocery_upsert", {
      p_workspace: workspaceId,
      p_name: name,
      // Null, not "pantry": migration 029 reads a null category as "leave the stored one alone".
      // Defaulting here would put back the silent rewrite the add row used to cause.
      p_category: category ?? null,
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

    // "Omitted, so use the shelf life" and "explicitly null, so no expiry" both reduce to a null
    // date, and the RPC used to write it either way — erasing a user-entered date for the five
    // categories with no shelf life. p_set_expiry carries the distinction the action can see: only
    // a caller who named a date, or a shelf life that actually produced one, may touch the column.
    const setExpiry = !estimate || resolvedExpiry !== null;

    const admin = createAdminClient();
    const { error } = await admin.rpc("grocery_mark_bought", {
      p_id: itemId,
      p_expires_on: resolvedExpiry,
      p_estimate: estimate && resolvedExpiry !== null,
      p_set_expiry: setExpiry,
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

/**
 * The "Still good" nudge: push an expired date out and mark it an estimate.
 *
 * Separate from editItem on purpose. editItem's schema makes name, category and quantity required,
 * so routing the nudge through it wrote all three back from props that may be a foreground-refresh
 * interval stale — silently reverting a rename or a count change made on the other phone. That is
 * the lost-update pattern tasks/lessons.md L10 records, and the one grocery_adjust_quantity's
 * `for update` exists to prevent. Dropping quantity from the editItem call would not have worked:
 * the schema types it required-nullable, so omitting it clears the count.
 *
 * The date is always an estimate here — it is computed from the category's shelf life, not asserted
 * by a person — so the flag is not a caller's to choose.
 */
export async function extendExpiry(
  input: ExtendExpiryInput,
): Promise<ActionResult<{ itemId: string }>> {
  return run("extendExpiry", async () => {
    const { user } = await requireUser();
    const { itemId, expiresOn } = parseInput(extendExpirySchema, input);
    await assertItemMember(itemId, user.id);

    const admin = createAdminClient();
    const { error } = await admin.rpc("grocery_extend_expiry", {
      p_id: itemId,
      p_expires_on: expiresOn,
      p_estimate: true,
    });
    assertNoRpcError("extend expiry", { error });

    revalidatePath("/groceries");
    return { itemId };
  });
}

export async function editItem(input: EditItemInput): Promise<ActionResult<{ itemId: string }>> {
  return run("editItem", async () => {
    const { user } = await requireUser();
    const { itemId, name, category, expiresOn, quantity, expiryIsEstimate } = parseInput(editItemSchema, input);
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
        expiry_is_estimate: expiresOn !== null && expiryIsEstimate,
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
