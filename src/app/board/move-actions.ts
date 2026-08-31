"use server";

import { revalidatePath } from "next/cache";

import { ForbiddenError, memberIdsForUser, requireUser, assertTaskAssignee, assertWorkspaceMember } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ActionResult } from "@/app/tasks/action-result";
import { assertNoError, run } from "@/app/tasks/action-run";
import { completeTask, reopenTask } from "@/app/tasks/actions";
import { toLocalInputValue } from "@/app/tasks/recurrence-time";
import type { RawTask } from "@/app/tasks/bucket-tasks";
import { parseInput, taskIdSchema, ValidationError } from "@/app/tasks/schemas";
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
 * completed_at (bulk completion, the recurrence cron), and a single query ordered by completed_at
 * with a plain "<" comparison would drop whichever tied row lands just below the page boundary —
 * the next cursor IS that shared value, and "<" excludes everything at it.
 *
 * Two bounded queries, not one query plus an allowance: an earlier version of this fix asked for
 * completed_at <= before with a fixed extra allowance of rows to absorb ties, but any fixed
 * allowance has a ceiling — a tie cluster larger than it leaves the rows past the ceiling
 * unreachable by any call, forever, because `before` never advances while the cluster drains. The
 * two-query split below has no ceiling:
 *
 * 1. The tie-drain query — completed_at = before, id < beforeId, ordered id desc, limited to
 *    DONE_PAGE_SIZE + 1 — walks only the rows still owed from the previous page's exact tie, and
 *    only runs when beforeId is present.
 * 2. The older query — completed_at < before, ordered completed_at desc then id desc, limited to
 *    DONE_PAGE_SIZE + 1 — is the rest of history, strictly before the tie.
 *
 * Concatenating (1) then (2) is already the correct total order (every tie-drain row is `before`;
 * every older row is `<before`), so no re-sort is needed, and both predicates are exact — no
 * strictly-after filter is needed either, unlike the allowance-based version. Two queries rather
 * than one `.or(...)` expression: it keeps the fake free of an or-expression parser, and each query
 * is individually bounded regardless of how the other's result set turns out.
 *
 * `beforeId` is optional: the done column's footer can offer "Show older" even when nothing is on
 * screen yet (the initial seven-day window came back empty but older completed tasks exist), and in
 * that case the client has no row to cite — it sends only the synthetic "seven days ago" cutoff as
 * `before`, no `beforeId`. With no cursor id there is nothing to drain a tie against, so only the
 * older query runs — exactly today's first-page behaviour, not a degraded fallback.
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

    const taskIds = [...keyByTaskId.keys()];
    const columns = "id, title, due_at, completed_at, workspace_id, board_column_id";

    let tieRows: Record<string, unknown>[] = [];
    if (beforeId !== undefined) {
      const { data, error } = await admin
        .from("tasks")
        .select(columns)
        .in("id", taskIds)
        .in("workspace_id", workspaceIds)
        .is("parent_task_id", null)
        .eq("completed_at", before)
        .lt("id", beforeId)
        .order("id", { ascending: false })
        .limit(DONE_PAGE_SIZE + 1);

      assertNoError("load tie-drain completed tasks", { error });
      tieRows = data ?? [];
    }

    const { data: olderRows, error: olderError } = await admin
      .from("tasks")
      .select(columns)
      .in("id", taskIds)
      .in("workspace_id", workspaceIds)
      .is("parent_task_id", null)
      .lt("completed_at", before)
      .order("completed_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(DONE_PAGE_SIZE + 1);

    assertNoError("load older completed tasks", { error: olderError });

    // Already in the correct total order (completed_at desc, id desc) without re-sorting: every
    // tie-drain row shares completed_at with `before`, and every older row's completed_at is
    // strictly less, so concatenation cannot misorder them relative to each other.
    const combined = [...tieRows, ...(olderRows ?? [])];
    const hasMore = combined.length > DONE_PAGE_SIZE;
    const page = combined.slice(0, DONE_PAGE_SIZE);

    const tasks: DoneTask[] = page.map((r) => ({
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


/**
 * The full task behind a card, fetched only when one is opened.
 *
 * The board's own query is deliberately thin — title, deadline, workspace, column — because it
 * renders every assigned task at once. The edit modal needs description, members, subtasks and
 * recurrence, which is four more joins per card for data that is read one card at a time. So the
 * board keeps its narrow query and pays for the rest on demand, the same posture `loadOlderDone`
 * takes for the done column's history.
 *
 * Runs on the user-scoped client: RLS decides what comes back, and `assertTaskAssignee` refuses a
 * task the caller cannot see before any of it is read.
 */
export async function loadTaskForEdit(rawTaskId: string): Promise<ActionResult<{ task: RawTask }>> {
  return run("loadTaskForEdit", async () => {
    const { user } = await requireUser();
    const taskId = parseInput(taskIdSchema, rawTaskId);
    await assertTaskAssignee(taskId, user.id);

    const admin = createAdminClient();

    const { data: rows, error: taskError } = await admin
      .from("tasks")
      .select("id, title, description, due_at, completed_at, workspace_id")
      .eq("id", taskId)
      .limit(1);
    assertNoError("load task", { error: taskError });

    const row = rows?.[0];
    if (!row) throw new ForbiddenError("That task no longer exists");

    const workspaceId = row.workspace_id as string;

    const [{ data: workspaceRows }, { data: assignmentRows }, { data: subtaskRows }, { data: ruleRows }] =
      await Promise.all([
        admin.from("workspaces").select("id, name, kind").eq("id", workspaceId).limit(1),
        admin.from("task_assignments").select("member_id, member_sort_key").eq("task_id", taskId),
        admin
          .from("tasks")
          .select("id, title, completed_at, description, due_at")
          .eq("parent_task_id", taskId)
          .order("created_at", { ascending: true }),
        admin
          .from("task_rules")
          .select("frequency, interval_count, next_run_at, default_due_offset_hours, is_active")
          .eq("task_id", taskId)
          .limit(1),
      ]);

    const workspace = workspaceRows?.[0];
    const ownMemberIds = await memberIdsForUser(user.id);
    const assignments = assignmentRows ?? [];
    const mine = assignments.find((a) => ownMemberIds.includes(a.member_id as string));

    // A paused rule still has a row, and still has to reach the modal so re-enabling restores the
    // schedule the user set rather than overwriting it with defaults. Same rule as /tasks: the row
    // carries `recurrence`, `is_active` alone drives `recurring`.
    const rule = ruleRows?.[0];

    const task: RawTask = {
      id: row.id as string,
      title: row.title as string,
      description: (row.description as string | null) ?? null,
      due_at: (row.due_at as string | null) ?? null,
      completed_at: (row.completed_at as string | null) ?? null,
      workspace: {
        id: workspaceId,
        name: (workspace?.name as string | undefined) ?? "Unknown",
        kind: (workspace?.kind as string | undefined) ?? "work",
      },
      member_sort_key: (mine?.member_sort_key as number | undefined) ?? 0,
      assignee_count: assignments.length || 1,
      member_ids: assignments.map((a) => a.member_id as string),
      subtasks: (subtaskRows ?? []).map((sub) => ({
        id: sub.id as string,
        title: sub.title as string,
        completed_at: (sub.completed_at as string | null) ?? null,
        description: (sub.description as string | null) ?? null,
        due_at: (sub.due_at as string | null) ?? null,
      })),
      recurrence: rule
        ? {
            frequency: rule.frequency as "daily" | "weekly" | "monthly",
            intervalCount: rule.interval_count as number,
            firstRunAt: toLocalInputValue(rule.next_run_at as string),
            dueOffsetHours: (rule.default_due_offset_hours as number | null) ?? null,
          }
        : null,
      recurring: Boolean(rule?.is_active),
    };

    return { task };
  });
}
