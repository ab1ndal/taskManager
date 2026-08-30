"use server";

import { revalidatePath } from "next/cache";

import { assertWorkspaceMember, memberIdsForUser, requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ActionResult } from "@/app/tasks/action-result";
import { assertNoError, run } from "@/app/tasks/action-run";
import { parseInput, ValidationError } from "@/app/tasks/schemas";
import { knownRpcFailure } from "./rpc-errors";
import {
  createBoardColumnSchema,
  deleteBoardColumnSchema,
  listTasksInColumnSchema,
  renameBoardColumnSchema,
  reorderBoardColumnSchema,
  setBoardColumnColorSchema,
  type CreateBoardColumnInput,
  type DeleteBoardColumnInput,
  type ListTasksInColumnInput,
  type RenameBoardColumnInput,
  type ReorderBoardColumnInput,
  type SetBoardColumnColorInput,
} from "./schemas";

export type ColumnTask = { id: string; title: string; completedAt: string | null };

/**
 * Columns are shared, so authorization is workspace membership rather than task assignment: any
 * member may edit any column of their workspace. The column id arrives from the network, so the
 * workspace it belongs to is read here rather than trusted from the caller.
 */
async function assertColumnMember(
  columnId: string,
  authUserId: string
): Promise<{ workspaceId: string }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("board_columns")
    .select("workspace_id")
    .eq("id", columnId)
    .maybeSingle();

  assertNoError("load board column", { error });
  if (!data) throw new Error(`board column ${columnId} not found`);

  const workspaceId = data.workspace_id as string;
  await assertWorkspaceMember(workspaceId, authUserId);

  return { workspaceId };
}

export async function createBoardColumn(
  input: CreateBoardColumnInput
): Promise<ActionResult<{ columnId: string }>> {
  return run("createBoardColumn", async () => {
    const { user } = await requireUser();
    const { workspaceId, name, color } = parseInput(createBoardColumnSchema, input);
    await assertWorkspaceMember(workspaceId, user.id);

    const admin = createAdminClient();

    // Sparse positions, the same convention member_sort_key uses: a new column lands a full step
    // past the last one so reordering later only ever needs a midpoint.
    const { data: last, error: lastError } = await admin
      .from("board_columns")
      .select("position")
      .eq("workspace_id", workspaceId)
      .order("position", { ascending: false })
      .limit(1);

    assertNoError("load last column position", { error: lastError });

    const position = ((last?.[0]?.position as number | undefined) ?? 0) + 1000;
    const columnId = crypto.randomUUID();

    assertNoError(
      "create board column",
      await admin
        .from("board_columns")
        .insert({ id: columnId, workspace_id: workspaceId, name, color, position, is_done: false })
    );

    revalidatePath("/board");
    revalidatePath("/settings");
    return { columnId };
  });
}

/**
 * Renaming is in place: it touches the column row only. No task's board_column_id changes, so a
 * rename can never move a card — which is what makes it safe to do on blur without confirmation.
 */
export async function renameBoardColumn(input: RenameBoardColumnInput): Promise<ActionResult> {
  return run("renameBoardColumn", async () => {
    const { user } = await requireUser();
    const { columnId, name } = parseInput(renameBoardColumnSchema, input);
    await assertColumnMember(columnId, user.id);

    const admin = createAdminClient();
    const { error } = await admin.from("board_columns").update({ name }).eq("id", columnId);

    if (error) {
      // 23505 is Postgres's unique-violation code; migration 016's board_columns_workspace_name_key
      // is what fires it here. The caller typed a name a sibling column already has (case-
      // insensitively) — a condition they can act on, not a bug, so it surfaces as a field error
      // rather than falling through to action-run's generic message.
      if (error.code === "23505") {
        throw new ValidationError(
          { name: ["That name is already used in this workspace"] },
          "That name is already used in this workspace"
        );
      }
      throw new Error(`rename board column: ${error.message}`);
    }

    revalidatePath("/board");
    revalidatePath("/settings");
    return {};
  });
}

export async function setBoardColumnColor(input: SetBoardColumnColorInput): Promise<ActionResult> {
  return run("setBoardColumnColor", async () => {
    const { user } = await requireUser();
    const { columnId, color } = parseInput(setBoardColumnColorSchema, input);
    await assertColumnMember(columnId, user.id);

    const admin = createAdminClient();
    assertNoError(
      "set board column colour",
      await admin.from("board_columns").update({ color }).eq("id", columnId)
    );

    revalidatePath("/board");
    revalidatePath("/settings");
    return {};
  });
}

export async function reorderBoardColumn(input: ReorderBoardColumnInput): Promise<ActionResult> {
  return run("reorderBoardColumn", async () => {
    const { user } = await requireUser();
    const { columnId, prevPosition, nextPosition } = parseInput(reorderBoardColumnSchema, input);
    await assertColumnMember(columnId, user.id);

    // Only column in the list: nothing to order against, so the position stands.
    if (prevPosition === null && nextPosition === null) return {};

    const position =
      prevPosition === null
        ? nextPosition! - 1000
        : nextPosition === null
          ? prevPosition + 1000
          : (prevPosition + nextPosition) / 2;

    const admin = createAdminClient();
    assertNoError(
      "reorder board column",
      await admin.from("board_columns").update({ position }).eq("id", columnId)
    );

    revalidatePath("/board");
    revalidatePath("/settings");
    return {};
  });
}

/**
 * The tasks the delete dialog must offer a destination for, ordered by the caller's own priority so
 * the top of the dialog is the work they care about most.
 */
export async function listTasksInColumn(
  input: ListTasksInColumnInput
): Promise<ActionResult<{ tasks: ColumnTask[] }>> {
  return run("listTasksInColumn", async () => {
    const { user } = await requireUser();
    const { columnId } = parseInput(listTasksInColumnSchema, input);
    await assertColumnMember(columnId, user.id);

    const admin = createAdminClient();
    const { data: taskRows, error: taskError } = await admin
      .from("tasks")
      .select("id, title, completed_at")
      .eq("board_column_id", columnId);

    assertNoError("load column tasks", { error: taskError });

    const rows = taskRows ?? [];
    if (rows.length === 0) return { tasks: [] };

    // Ordering is per user, so it comes from task_assignments rather than from the tasks table. A
    // task the caller is not assigned to has no key for them; it sorts last rather than vanishing,
    // because the deletion still has to account for it.
    const ownMemberIds = await memberIdsForUser(user.id);
    const { data: keyRows, error: keyError } = await admin
      .from("task_assignments")
      .select("task_id, member_sort_key")
      .in("task_id", rows.map((r) => r.id as string))
      .in("member_id", ownMemberIds);

    assertNoError("load column task order", { error: keyError });

    const keyByTaskId = new Map<string, number>();
    (keyRows ?? []).forEach((r) => keyByTaskId.set(r.task_id as string, r.member_sort_key as number));

    const tasks: ColumnTask[] = rows
      .map((r) => ({
        id: r.id as string,
        title: r.title as string,
        completedAt: (r.completed_at as string | null) ?? null,
      }))
      .sort(
        (a, b) =>
          (keyByTaskId.get(a.id) ?? Number.POSITIVE_INFINITY) -
          (keyByTaskId.get(b.id) ?? Number.POSITIVE_INFINITY)
      );

    return { tasks };
  });
}

/**
 * Deletes a column after moving each of its tasks to the destination the user chose for it.
 *
 * The whole operation is one RPC because a column cannot be dropped while tasks still reference it
 * (the FK is `restrict`), and the reassignment must not be visible without the deletion that
 * justified it. The RPC also re-checks that `moves` covers exactly what is in the column right now,
 * which is what makes a stale dialog fail instead of relocating a task nobody chose for.
 */
export async function deleteBoardColumn(input: DeleteBoardColumnInput): Promise<ActionResult> {
  return run("deleteBoardColumn", async () => {
    const { user } = await requireUser();
    const { columnId, moves } = parseInput(deleteBoardColumnSchema, input);
    await assertColumnMember(columnId, user.id);

    const admin = createAdminClient();
    const { error } = await admin.rpc("delete_board_column", {
      p_column_id: columnId,
      p_moves: moves.map((m) => ({ task_id: m.taskId, target_column_id: m.targetColumnId })),
    });

    if (error) {
      // The RPC's own checks (stale move list, bad destination, last non-terminal column) are
      // conditions the caller needs to see and act on, not a bug to hide behind a generic message —
      // `assertNoError` would collapse them to that. But an unrecognised Postgres error (a cast
      // failure, a constraint name, permission text) must not be forwarded either: that is exactly
      // the schema detail action-run.ts's generic path exists to hide.
      const known = knownRpcFailure(error.message);
      if (!known) throw new Error(`delete board column: ${error.message}`);
      throw new ValidationError({}, known);
    }

    revalidatePath("/board");
    revalidatePath("/settings");
    revalidatePath("/tasks");
    return {};
  });
}
