"use server";

import { revalidatePath } from "next/cache";

import { ForbiddenError, memberIdsForUser, requireUser, assertTaskAssignee, assertWorkspaceMember } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ActionResult } from "@/app/tasks/action-result";
import { assertNoError, run } from "@/app/tasks/action-run";
import { completeTask, reopenTask } from "@/app/tasks/actions";
import { parseInput, ValidationError } from "@/app/tasks/schemas";
import { knownRpcFailure } from "./rpc-errors";
import {
  loadOlderDoneSchema,
  moveTaskToColumnSchema,
  type LoadOlderDoneInput,
  type MoveTaskToColumnInput,
} from "./schemas";

/** One page of already-completed tasks, for the done column's "show older" footer. */
export type DoneTask = {
  id: string;
  title: string;
  dueAt: string | null;
  completedAt: string;
  workspaceId: string;
  boardColumnId: string;
  memberSortKey: number;
};

const DONE_PAGE_SIZE = 50;

/**
 * Applies a drop: the shared column, the dragger's own position, and — when a terminal column is
 * involved — completion.
 *
 * Completion is not stored twice. A completed task renders in the terminal column regardless of its
 * board_column_id, so dropping into that column has to actually complete the task, and dragging out
 * has to reopen it, or the board and the list view would disagree about what is done. Both paths
 * delegate to the existing actions rather than writing completed_at here, so the subtask cascade
 * documented in docs/product.md keeps applying.
 *
 * Ordering: the RPC (column + position) runs first, and completeTask/reopenTask run after it
 * succeeds. If the RPC fails, nothing has moved and neither pairing half runs, so the two stay
 * consistent by never having started. If the RPC succeeds but the follow-up completeTask/reopenTask
 * call then fails, the task is left with its column moved but completion not (yet) flipped to
 * match — a genuine inconsistency between board and list view until the user retries the drop or
 * toggles completion by hand. That gap is not closed here: closing it needs either one transaction
 * spanning the RPC and the completed_at write (a second RPC), or a reconciliation read on next
 * render, and either is a larger change than this task's brief calls for. Flagged for follow-up
 * rather than silently accepted.
 */
export async function moveTaskToColumn(input: MoveTaskToColumnInput): Promise<ActionResult> {
  return run("moveTaskToColumn", async () => {
    const { user } = await requireUser();
    const { taskId, columnId, memberId, prevKey, nextKey } = parseInput(moveTaskToColumnSchema, input);

    // member_sort_key is per-user priority: a caller may only reposition their own list.
    const ownMemberIds = await memberIdsForUser(user.id);
    if (!ownMemberIds.includes(memberId)) {
      throw new ForbiddenError(`member ${memberId} does not belong to the current user`);
    }

    await assertTaskAssignee(taskId, user.id);

    const admin = createAdminClient();

    const { data: task, error: taskError } = await admin
      .from("tasks")
      .select("completed_at, parent_task_id, board_column_id")
      .eq("id", taskId)
      .maybeSingle();

    assertNoError("load task", { error: taskError });
    if (!task) throw new Error(`task ${taskId} not found`);
    if (task.parent_task_id) {
      throw new ForbiddenError(`task ${taskId} is a subtask and has no board column`);
    }

    const { data: target, error: targetError } = await admin
      .from("board_columns")
      .select("is_done")
      .eq("id", columnId)
      .maybeSingle();

    assertNoError("load target column", { error: targetError });
    if (!target) throw new Error(`board column ${columnId} not found`);

    const { error: moveError } = await admin.rpc("move_task_to_column", {
      p_task_id: taskId,
      p_column_id: columnId,
      p_member_id: memberId,
      p_prev_key: prevKey,
      p_next_key: nextKey,
    });

    if (moveError) {
      // The RPC's own guards — not assigned to the task, column or member outside the workspace, a
      // subtask with no column — are conditions the user needs to see and act on, not a bug to hide
      // behind a generic message. But an unrecognised Postgres error must not be forwarded either:
      // that is exactly the schema detail action-run.ts's generic path exists to hide.
      const known = knownRpcFailure(moveError.message);
      if (!known) throw new Error(`move task to column: ${moveError.message}`);
      throw new ValidationError({}, known);
    }

    const wasCompleted = task.completed_at !== null;
    const targetIsDone = target.is_done === true;

    if (targetIsDone && !wasCompleted) {
      const result = await completeTask(taskId);
      if (!result.ok) throw new Error(`complete task: ${result.error}`);
    } else if (!targetIsDone && wasCompleted) {
      const result = await reopenTask(taskId);
      if (!result.ok) throw new Error(`reopen task: ${result.error}`);
    }

    revalidatePath("/board");
    revalidatePath("/tasks");
    return {};
  });
}

/**
 * The next page of older completed tasks for the done column.
 *
 * Keyset pagination on completed_at rather than an offset: reopening a task while the list is open
 * shifts every later row, so an offset would silently skip a task. A cursor cannot.
 */
export async function loadOlderDone(
  input: LoadOlderDoneInput
): Promise<ActionResult<{ tasks: DoneTask[]; hasMore: boolean }>> {
  return run("loadOlderDone", async () => {
    const { user } = await requireUser();
    const { workspaceIds, before } = parseInput(loadOlderDoneSchema, input);

    for (const workspaceId of workspaceIds) {
      await assertWorkspaceMember(workspaceId, user.id);
    }

    const admin = createAdminClient();
    const ownMemberIds = await memberIdsForUser(user.id);

    // Visibility is assignment, so the caller's own assignment rows are the starting point.
    const { data: assignments, error: assignmentError } = await admin
      .from("task_assignments")
      .select("task_id, member_sort_key")
      .in("member_id", ownMemberIds);

    assertNoError("load assignments", { error: assignmentError });

    const keyByTaskId = new Map<string, number>();
    (assignments ?? []).forEach((a) =>
      keyByTaskId.set(a.task_id as string, a.member_sort_key as number)
    );

    if (keyByTaskId.size === 0) return { tasks: [], hasMore: false };

    const { data: rows, error: rowError } = await admin
      .from("tasks")
      .select("id, title, due_at, completed_at, workspace_id, board_column_id")
      .in("id", [...keyByTaskId.keys()])
      .in("workspace_id", workspaceIds)
      .is("parent_task_id", null)
      .not("completed_at", "is", null)
      .lt("completed_at", before)
      .order("completed_at", { ascending: false })
      .limit(DONE_PAGE_SIZE + 1);

    assertNoError("load older completed tasks", { error: rowError });

    const page = rows ?? [];
    const hasMore = page.length > DONE_PAGE_SIZE;

    const tasks: DoneTask[] = page.slice(0, DONE_PAGE_SIZE).map((r) => ({
      id: r.id as string,
      title: r.title as string,
      dueAt: (r.due_at as string | null) ?? null,
      completedAt: r.completed_at as string,
      workspaceId: r.workspace_id as string,
      boardColumnId: r.board_column_id as string,
      memberSortKey: keyByTaskId.get(r.id as string) ?? 0,
    }));

    return { tasks, hasMore };
  });
}
