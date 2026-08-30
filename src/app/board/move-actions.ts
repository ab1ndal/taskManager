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
    if (!task) {
      // Same "not found" condition the RPC itself would raise for this task id (see rpc-errors.ts) —
      // routed the same way here, rather than a bare Error, so a stale UI pointing at a just-deleted
      // task gets the same specific message whichever of the two checks happens to catch it.
      const message = `task ${taskId} not found`;
      const known = knownRpcFailure(message);
      if (!known) throw new Error(message);
      throw new ValidationError({}, known);
    }
    if (task.parent_task_id) {
      throw new ForbiddenError(`task ${taskId} is a subtask and has no board column`);
    }

    const { data: target, error: targetError } = await admin
      .from("board_columns")
      .select("is_done")
      .eq("id", columnId)
      .maybeSingle();

    assertNoError("load target column", { error: targetError });
    if (!target) {
      const message = `board column ${columnId} not found`;
      const known = knownRpcFailure(message);
      if (!known) throw new Error(message);
      throw new ValidationError({}, known);
    }

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
 *
 * The cursor is the pair (completed_at, id), not completed_at alone: two tasks can share a
 * completed_at (bulk completion, the recurrence cron), and ordering by completed_at only with a
 * plain "<" comparison would drop whichever one lands just below the page boundary — the next
 * cursor IS that shared value, and "<" excludes everything at it. The database is asked for
 * completed_at <= before (a superset), and the exact composite "strictly after (before, beforeId)"
 * comparison is done here in TypeScript rather than as a PostgREST `.or(...)` expression: same
 * result, and it spares the fake an or-expression parser. `beforeId` is optional because Task 10
 * has not wired the client to send it yet — until then, a page boundary that happens to land inside
 * a tie can (rarely) still drop a row, same as before this fix, but no worse.
 *
 * A tie cluster larger than one page would take more than one round trip to fully traverse (each
 * page returns at most DONE_PAGE_SIZE of the tied rows before the cursor advances past them) —
 * acceptable, and worth writing down rather than discovering.
 */
export async function loadOlderDone(
  input: LoadOlderDoneInput
): Promise<ActionResult<{ tasks: DoneTask[]; hasMore: boolean }>> {
  return run("loadOlderDone", async () => {
    const { user } = await requireUser();
    const { workspaceIds, before, beforeId } = parseInput(loadOlderDoneSchema, input);

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
      .lte("completed_at", before);

    assertNoError("load older completed tasks", { error: rowError });

    // Total order over the fetched rows: completed_at desc, id desc as the tie-break — the same
    // pair the cursor is made of, so the ordering and the cursor comparison below agree.
    const ordered = [...(rows ?? [])].sort((a, b) => {
      const aAt = a.completed_at as string;
      const bAt = b.completed_at as string;
      if (aAt !== bAt) return aAt < bAt ? 1 : -1;
      const aId = a.id as string;
      const bId = b.id as string;
      return aId < bId ? 1 : aId > bId ? -1 : 0;
    });

    const isStrictlyAfterCursor = (r: { completed_at: unknown; id: unknown }) => {
      const completedAt = r.completed_at as string;
      if (completedAt !== before) return true; // the query already required <= before
      if (beforeId === undefined) return false; // no prior page to break the tie against
      return (r.id as string) < beforeId;
    };

    const page = ordered.filter(isStrictlyAfterCursor);
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
