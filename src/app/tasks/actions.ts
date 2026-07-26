"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import {
  requireUser,
  assertTaskAssignee,
  assertWorkspaceMember,
  assertMembersInWorkspace,
  memberIdsForUser,
  ForbiddenError,
  UnauthorizedError,
} from "@/lib/auth";
import {
  parseInput,
  taskIdSchema,
  createTaskWithSubtasksSchema,
  updateTaskSchema,
  reorderTaskSchema,
} from "./schemas";
import { ValidationError } from "./schemas";
import type {
  CreateTaskWithSubtasksInput,
  UpdateTaskInput,
  ReorderTaskInput,
} from "./schemas";
import { GENERIC_ERROR } from "./action-result";
import type { ActionResult } from "./action-result";

// Every exported function in this file is a public endpoint. Each one authenticates the caller and
// then authorizes them for the specific row named in its arguments — a disabled button or a
// filtered list is not access control. See tasks/lessons.md L4.
//
// Mutations still run on the admin client because migration 007 is not yet applied; the assertions
// above them are what enforces access. Once 007 is live these can move to the user-scoped client
// and let RLS enforce as well (Task 3).

/**
 * Runs an action body and converts a thrown failure into `{ ok: false, error }`.
 *
 * Validation and authorization messages are meant for the person who triggered the action, so they
 * are passed through. Anything else — a database error, a bug — is logged with the action name and
 * replaced with a generic message, because those carry schema detail the client has no business
 * seeing.
 */
async function run<T extends object>(
  action: string,
  body: () => Promise<T>
): Promise<ActionResult<T>> {
  try {
    return { ok: true, ...(await body()) };
  } catch (error) {
    if (
      error instanceof ValidationError ||
      error instanceof ForbiddenError ||
      error instanceof UnauthorizedError
    ) {
      return { ok: false, error: error.message };
    }

    console.error(
      JSON.stringify({
        level: "error",
        action,
        message: error instanceof Error ? error.message : String(error),
      })
    );
    return { ok: false, error: GENERIC_ERROR };
  }
}

/** Throws on a Supabase error so `run` can turn it into a failed result instead of losing it. */
function assertNoError(
  step: string,
  { error }: { error: { message: string } | null }
): void {
  if (error) throw new Error(`${step}: ${error.message}`);
}

/** Next sort key for a member, computed atomically in Postgres. See migration 008 (audit C3). */
async function nextSortKey(
  admin: ReturnType<typeof createAdminClient>,
  memberId: string
): Promise<number> {
  const { data, error } = await admin.rpc("next_sort_key", { p_member_id: memberId });
  if (error) throw new Error(`next sort key: ${error.message}`);
  return data as number;
}

export async function completeTask(rawTaskId: string): Promise<ActionResult> {
  return run("completeTask", async () => {
    const { user } = await requireUser();
    const taskId = parseInput(taskIdSchema, rawTaskId);
    await assertTaskAssignee(taskId, user.id);

    const admin = createAdminClient();
    const completedAt = new Date().toISOString();

    assertNoError(
      "complete task",
      await admin.from("tasks").update({ completed_at: completedAt }).eq("id", taskId)
    );

    const { data: task, error: taskError } = await admin
      .from("tasks")
      .select("parent_task_id, rule_id")
      .eq("id", taskId)
      .single();

    assertNoError("load task", { error: taskError });

    // docs/product.md: "A task is completed when the entire task and all its subtasks are marked as
    // complete." Completing a parent therefore completes its open subtasks — the rule has to hold
    // in both directions, or a parent with an open subtask could never be completed at all.
    assertNoError(
      "complete subtasks",
      await admin
        .from("tasks")
        .update({ completed_at: completedAt })
        .eq("parent_task_id", taskId)
        .is("completed_at", null)
    );

    if (task?.parent_task_id) {
      const { count, error: countError } = await admin
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("parent_task_id", task.parent_task_id)
        .is("completed_at", null);

      assertNoError("count open subtasks", { error: countError });

      if (count === 0) {
        assertNoError(
          "complete parent task",
          await admin
            .from("tasks")
            .update({ completed_at: completedAt })
            .eq("id", task.parent_task_id)
        );
      }
    }

    revalidatePath("/tasks");
    return {};
  });
}

export async function deleteTask(rawTaskId: string): Promise<ActionResult> {
  return run("deleteTask", async () => {
    const { user } = await requireUser();
    const taskId = parseInput(taskIdSchema, rawTaskId);
    await assertTaskAssignee(taskId, user.id);

    const admin = createAdminClient();
    assertNoError("delete task", await admin.from("tasks").delete().eq("id", taskId));

    revalidatePath("/tasks");
    return {};
  });
}

export async function createTaskWithSubtasks(
  input: CreateTaskWithSubtasksInput
): Promise<ActionResult<{ subtaskErrors: number }>> {
  return run("createTaskWithSubtasks", async () => {
    const { user } = await requireUser();
    const { title, description, dueAt, workspaceId, memberIds, subtasks } = parseInput(
      createTaskWithSubtasksSchema,
      input
    );
    const uniqueMemberIds = [...new Set(memberIds)];

    await assertWorkspaceMember(workspaceId, user.id);
    await assertMembersInWorkspace(uniqueMemberIds, workspaceId);

    const admin = createAdminClient();

    // Ids are generated here rather than read back via `.insert().select()`. Under migration 007,
    // tasks_select requires an assignment row, which does not exist yet at insert time — so
    // INSERT ... RETURNING would come back empty. See tasks/todo.md.
    const parentId = crypto.randomUUID();

    assertNoError(
      "create task",
      await admin.from("tasks").insert({
        id: parentId,
        title,
        description: description ?? null,
        due_at: dueAt ? `${dueAt}T00:00:00Z` : null,
        workspace_id: workspaceId,
      })
    );

    for (const memberId of uniqueMemberIds) {
      assertNoError(
        "assign task",
        await admin.from("task_assignments").insert({
          task_id: parentId,
          member_id: memberId,
          member_sort_key: await nextSortKey(admin, memberId),
        })
      );
    }

    // A failed subtask is reported rather than thrown: the parent task exists at this point, and
    // discarding it would lose work the user can see. The count travels back to the toaster.
    let subtaskErrors = 0;
    for (const sub of subtasks) {
      const subtaskId = crypto.randomUUID();

      const { error: subError } = await admin.from("tasks").insert({
        id: subtaskId,
        title: sub.title,
        description: sub.description ?? null,
        due_at: sub.dueAt ? `${sub.dueAt}T00:00:00Z` : null,
        workspace_id: workspaceId,
        parent_task_id: parentId,
      });

      if (subError) {
        console.error(
          JSON.stringify({
            level: "error",
            action: "createTaskWithSubtasks",
            step: "create subtask",
            parentId,
            message: subError.message,
          })
        );
        subtaskErrors++;
        continue;
      }

      for (const memberId of uniqueMemberIds) {
        assertNoError(
          "assign subtask",
          await admin.from("task_assignments").insert({
            task_id: subtaskId,
            member_id: memberId,
            member_sort_key: await nextSortKey(admin, memberId),
          })
        );
      }
    }

    revalidatePath("/tasks");
    return { subtaskErrors };
  });
}

export async function updateTask(input: UpdateTaskInput): Promise<ActionResult> {
  return run("updateTask", async () => {
    const { user } = await requireUser();
    const { taskId, title, description, dueAt, memberIds } = parseInput(updateTaskSchema, input);
    await assertTaskAssignee(taskId, user.id);

    const admin = createAdminClient();
    const uniqueNewIds = [...new Set(memberIds)];

    // Reassignment is scoped to the task's own workspace — otherwise a caller could hand the task
    // to a member row belonging to a workspace they have nothing to do with.
    const { data: task, error: taskError } = await admin
      .from("tasks")
      .select("workspace_id")
      .eq("id", taskId)
      .single();

    if (taskError || !task) throw new Error(taskError?.message ?? "Task not found");

    await assertMembersInWorkspace(uniqueNewIds, task.workspace_id as string);

    assertNoError(
      "update task",
      await admin
        .from("tasks")
        .update({
          title,
          description: description ?? null,
          due_at: dueAt ? `${dueAt}T00:00:00Z` : null,
        })
        .eq("id", taskId)
    );

    const { data: currentAssignments, error: assignmentsError } = await admin
      .from("task_assignments")
      .select("member_id")
      .eq("task_id", taskId);

    assertNoError("load assignments", { error: assignmentsError });

    const currentIds = (currentAssignments ?? []).map((a) => a.member_id as string);

    // Remove dropped members
    for (const memberId of currentIds.filter((id) => !uniqueNewIds.includes(id))) {
      assertNoError(
        "unassign task",
        await admin.from("task_assignments").delete().eq("task_id", taskId).eq("member_id", memberId)
      );
    }

    // Add new members
    for (const memberId of uniqueNewIds.filter((id) => !currentIds.includes(id))) {
      assertNoError(
        "assign task",
        await admin.from("task_assignments").insert({
          task_id: taskId,
          member_id: memberId,
          member_sort_key: await nextSortKey(admin, memberId),
        })
      );
    }

    revalidatePath("/tasks");
    return {};
  });
}

export async function reorderTask(input: ReorderTaskInput): Promise<ActionResult> {
  return run("reorderTask", async () => {
    const { user } = await requireUser();
    const { taskId, memberId, prevKey, nextKey } = parseInput(reorderTaskSchema, input);

    // member_sort_key is per-user priority: you may only reorder your own list, not someone else's.
    const ownMemberIds = await memberIdsForUser(user.id);
    if (!ownMemberIds.includes(memberId)) {
      throw new ForbiddenError(`member ${memberId} does not belong to the current user`);
    }

    await assertTaskAssignee(taskId, user.id);

    // Dropped into an empty list: there is nothing to order against, so the key stands.
    if (prevKey === null && nextKey === null) return {};

    let newKey: number;
    if (prevKey === null) newKey = nextKey! - 1000;
    else if (nextKey === null) newKey = prevKey + 1000;
    else newKey = (prevKey + nextKey) / 2;

    const admin = createAdminClient();
    assertNoError(
      "reorder task",
      await admin
        .from("task_assignments")
        .update({ member_sort_key: newKey })
        .eq("task_id", taskId)
        .eq("member_id", memberId)
    );

    revalidatePath("/tasks");
    return {};
  });
}
