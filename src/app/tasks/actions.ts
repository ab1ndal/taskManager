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
} from "@/lib/auth";
import {
  parseInput,
  taskIdSchema,
  createTaskWithSubtasksSchema,
  updateTaskSchema,
  reorderTaskSchema,
  createTaskUpdateSchema,
  addSubtaskSchema,
  updateSubtaskSchema,
} from "./schemas";
import { ValidationError } from "./schemas";
import type {
  CreateTaskWithSubtasksInput,
  UpdateTaskInput,
  ReorderTaskInput,
  CreateTaskUpdateInput,
  AddSubtaskInput,
  UpdateSubtaskInput,
} from "./schemas";
import type { ActionResult } from "./action-result";
import type { RawTask } from "./bucket-tasks";
import { run, assertNoError, writeRecurrence } from "./action-run";

// Every exported function in this file is a public endpoint. Each one authenticates the caller and
// then authorizes them for the specific row named in its arguments — a disabled button or a
// filtered list is not access control. See tasks/lessons.md L4.
//
// Mutations run on the admin client, so the assertions above them are what enforces access.
//
// 007 IS applied — verified against both projects on 2026-07-28 (private.is_workspace_member and
// friends exist; the ledger lists 007). The comment here previously claimed otherwise. RLS therefore
// already agrees with these checks, and moving these calls to the user-scoped client so it enforces
// too is a live option rather than a blocked one (Task 3).

/**
 * Assign a member to a task with the next sort key, computed and inserted atomically in Postgres.
 * See migration 009 (audit C3) — key computation and insert must share one advisory-lock scope, or
 * concurrent assigns for the same member can both read the same stale max.
 */
async function assignTaskMember(
  admin: ReturnType<typeof createAdminClient>,
  taskId: string,
  memberId: string
): Promise<void> {
  const { error } = await admin.rpc("assign_task_member", {
    p_task_id: taskId,
    p_member_id: memberId,
  });
  if (error) throw new Error(`assign task member: ${error.message}`);
}

/**
 * Inserts a subtask row and assigns it the given members. Shared by `createTaskWithSubtasks`
 * (batch, at parent-creation time) and `addSubtask` (single, on an already-existing task) — both
 * need the identical insert-then-assign shape, just triggered at different times.
 *
 * No `workspace_id`: a subtask's workspace is its root task's, recorded once there. Migration 011
 * makes the column NULL for exactly the rows that have a parent, so writing one here would violate
 * `tasks_workspace_only_on_root`.
 */
async function insertSubtask(
  admin: ReturnType<typeof createAdminClient>,
  args: {
    parentId: string;
    memberIds: string[];
    title: string;
    description?: string;
    dueAt?: string;
  }
): Promise<string> {
  const subtaskId = crypto.randomUUID();

  assertNoError(
    "create subtask",
    await admin.from("tasks").insert({
      id: subtaskId,
      title: args.title,
      description: args.description ?? null,
      due_at: args.dueAt ? `${args.dueAt}T00:00:00Z` : null,
      parent_task_id: args.parentId,
    })
  );

  for (const memberId of args.memberIds) {
    await assignTaskMember(admin, subtaskId, memberId);
  }

  return subtaskId;
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
      .select("parent_task_id")
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

/**
 * Reopens a completed task. `completeTask` cascades in both directions — completing a parent closes
 * its subtasks, and closing the last open subtask closes the parent — so reopening has to undo the
 * second half: a parent cannot stay complete while one of its subtasks is open again.
 *
 * Reopening a parent deliberately leaves its subtasks completed. They were genuinely done; the work
 * that reopened the parent is new work, and the user adds it as a new subtask.
 */
export async function reopenTask(rawTaskId: string): Promise<ActionResult> {
  return run("reopenTask", async () => {
    const { user } = await requireUser();
    const taskId = parseInput(taskIdSchema, rawTaskId);
    await assertTaskAssignee(taskId, user.id);

    const admin = createAdminClient();

    assertNoError(
      "reopen task",
      await admin.from("tasks").update({ completed_at: null }).eq("id", taskId)
    );

    const { data: task, error: taskError } = await admin
      .from("tasks")
      .select("parent_task_id")
      .eq("id", taskId)
      .single();

    assertNoError("load task", { error: taskError });

    if (task?.parent_task_id) {
      assertNoError(
        "reopen parent task",
        await admin
          .from("tasks")
          .update({ completed_at: null })
          .eq("id", task.parent_task_id)
      );
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
): Promise<ActionResult<{ subtaskErrors: number; recurrenceFailed: boolean }>> {
  return run("createTaskWithSubtasks", async () => {
    const { user } = await requireUser();
    const { title, description, dueAt, workspaceId, memberIds, subtasks, recurrence } = parseInput(
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
      await assignTaskMember(admin, parentId, memberId);
    }

    // A failed rule write is reported rather than thrown, the same as a failed subtask below: there
    // is no transaction spanning the task insert, the assignment RPCs, and this write, so by the
    // time it runs the task and its assignments already exist and are visible to the user.
    // Discarding that work would be worse than the failure it was meant to prevent — the task would
    // simply reappear, unexplained, on the next load. Instead the task is kept and the caller is
    // told the schedule did not save, so it can say so.
    let recurrenceFailed = false;
    if (recurrence) {
      try {
        await writeRecurrence(admin, parentId, recurrence);
      } catch (err) {
        console.error(
          JSON.stringify({
            level: "error",
            action: "createTaskWithSubtasks",
            step: "write recurrence",
            parentId,
            message: err instanceof Error ? err.message : String(err),
          })
        );
        recurrenceFailed = true;
      }
    }

    // A failed subtask is reported rather than thrown: the parent task exists at this point, and
    // discarding it would lose work the user can see. The count travels back to the toaster.
    let subtaskErrors = 0;
    for (const sub of subtasks) {
      try {
        await insertSubtask(admin, {
          parentId,
          memberIds: uniqueMemberIds,
          title: sub.title,
          description: sub.description,
          dueAt: sub.dueAt,
        });
      } catch (err) {
        console.error(
          JSON.stringify({
            level: "error",
            action: "createTaskWithSubtasks",
            step: "create subtask",
            parentId,
            message: err instanceof Error ? err.message : String(err),
          })
        );
        subtaskErrors++;
      }
    }

    revalidatePath("/tasks");
    return { subtaskErrors, recurrenceFailed };
  });
}

export async function updateTask(input: UpdateTaskInput): Promise<ActionResult> {
  return run("updateTask", async () => {
    const { user } = await requireUser();
    const { taskId, title, description, dueAt, memberIds, workspaceId } = parseInput(
      updateTaskSchema,
      input
    );
    await assertTaskAssignee(taskId, user.id);

    const admin = createAdminClient();
    const uniqueNewIds = [...new Set(memberIds)];

    // Reassignment is scoped to the task's own workspace — otherwise a caller could hand the task
    // to a member row belonging to a workspace they have nothing to do with. A move widens that
    // scope to the destination workspace, which the caller must belong to.
    const { data: task, error: taskError } = await admin
      .from("tasks")
      .select("workspace_id, parent_task_id")
      .eq("id", taskId)
      .single();

    if (taskError || !task) throw new Error(taskError?.message ?? "Task not found");

    const isMove = workspaceId !== undefined && workspaceId !== task.workspace_id;
    const targetWorkspaceId = isMove ? workspaceId! : (task.workspace_id as string);

    if (isMove) await assertWorkspaceMember(targetWorkspaceId, user.id);
    await assertMembersInWorkspace(uniqueNewIds, targetWorkspaceId);

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

    // A move rewrites the workspace of the task and every subtask, and rewrites all of their
    // assignments — member ids belong to one workspace, so the old rows cannot survive. Both halves
    // run inside one Postgres function (migration 010): a task sitting in its new workspace while
    // still assigned to the old one's members is visible to the wrong people, and separate
    // PostgREST calls have no way to roll that back.
    if (isMove) {
      if (task.parent_task_id) {
        const message = "A subtask moves with its parent, so it cannot change workspace on its own";
        throw new ValidationError({ workspaceId: [message] }, message);
      }

      const { error: moveError } = await admin.rpc("move_task_workspace", {
        p_task_id: taskId,
        p_workspace_id: targetWorkspaceId,
        p_member_ids: uniqueNewIds,
      });
      if (moveError) throw new Error(`move task workspace: ${moveError.message}`);

      revalidatePath("/tasks");
      return {};
    }

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
      await assignTaskMember(admin, taskId, memberId);
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

export type TaskUpdate = {
  id: string;
  authorName: string;
  createdAt: string;
  updateText: string;
};

export async function getTaskUpdates(rawTaskId: string): Promise<ActionResult<{ updates: TaskUpdate[] }>> {
  return run("getTaskUpdates", async () => {
    const { user } = await requireUser();
    const taskId = parseInput(taskIdSchema, rawTaskId);
    await assertTaskAssignee(taskId, user.id);

    const admin = createAdminClient();

    const { data: rows, error: updatesError } = await admin
      .from("task_updates")
      .select("id, member_id, created_at, update_text")
      .eq("task_id", taskId)
      .order("created_at", { ascending: true });

    assertNoError("load updates", { error: updatesError });

    const sortedRows = rows ?? [];

    const memberIds = [...new Set(sortedRows.map((r) => r.member_id as string))];

    const { data: members, error: membersError } = await admin
      .from("workspace_members")
      .select("id, display_name")
      .in("id", memberIds);

    assertNoError("load update authors", { error: membersError });

    const nameById = new Map((members ?? []).map((m) => [m.id as string, m.display_name as string]));

    const updates: TaskUpdate[] = sortedRows.map((r) => ({
      id: r.id as string,
      authorName: nameById.get(r.member_id as string) ?? "Unknown",
      createdAt: r.created_at as string,
      updateText: r.update_text as string,
    }));

    return { updates };
  });
}

export async function addTaskUpdate(input: CreateTaskUpdateInput): Promise<ActionResult<{ update: TaskUpdate }>> {
  return run("addTaskUpdate", async () => {
    const { user } = await requireUser();
    const { taskId, updateText } = parseInput(createTaskUpdateSchema, input);
    await assertTaskAssignee(taskId, user.id);

    const ownMemberIds = await memberIdsForUser(user.id);
    const admin = createAdminClient();

    // A task belongs to one workspace and auth_user_id is unique within a workspace
    // (workspace_members: unique(workspace_id, auth_user_id)), so at most one of the caller's own
    // member rows can be assigned to this task — this resolves to exactly one author.
    const { data: assignments, error: assignError } = await admin
      .from("task_assignments")
      .select("member_id")
      .eq("task_id", taskId)
      .in("member_id", ownMemberIds);

    assertNoError("resolve update author", { error: assignError });

    const memberId = assignments?.[0]?.member_id as string | undefined;
    if (!memberId) throw new ForbiddenError(`not assigned to task ${taskId}`);

    const createdAt = new Date().toISOString();
    const updateId = crypto.randomUUID();

    assertNoError(
      "add task update",
      await admin.from("task_updates").insert({
        id: updateId,
        task_id: taskId,
        member_id: memberId,
        update_text: updateText,
        created_at: createdAt,
      })
    );

    const { data: member, error: memberError } = await admin
      .from("workspace_members")
      .select("display_name")
      .eq("id", memberId)
      .single();

    assertNoError("load author name", { error: memberError });

    return {
      update: {
        id: updateId,
        authorName: (member?.display_name as string) ?? "Unknown",
        createdAt,
        updateText,
      },
    };
  });
}

export async function addSubtask(
  input: AddSubtaskInput
): Promise<ActionResult<{ subtask: RawTask["subtasks"][number] }>> {
  return run("addSubtask", async () => {
    const { user } = await requireUser();
    const { parentTaskId, title, description, dueAt } = parseInput(addSubtaskSchema, input);
    await assertTaskAssignee(parentTaskId, user.id);

    const admin = createAdminClient();

    const { data: parent, error: parentError } = await admin
      .from("tasks")
      .select("parent_task_id, completed_at")
      .eq("id", parentTaskId)
      .single();

    if (parentError || !parent) throw new Error(parentError?.message ?? "Task not found");

    // A subtask is one level deep (docs/product.md: subtasks are tasks with parent_task_id), and
    // nothing in the schema enforces that — this action is the only way to create one, so it is the
    // boundary that has to. Nesting would also put a workspace two hops from its root.
    if (parent.parent_task_id) {
      const message = "A subtask cannot have subtasks of its own";
      throw new ValidationError({ parentTaskId: [message] }, message);
    }

    // Adding work to a finished task un-finishes it. A completed parent holding an open subtask is
    // a state the completion rules say cannot exist, and it is the ordinary way a done task comes
    // back: the job turned out not to be over.
    if (parent.completed_at) {
      assertNoError(
        "reopen parent for new subtask",
        await admin.from("tasks").update({ completed_at: null }).eq("id", parentTaskId)
      );
    }

    const { data: assignments, error: assignError } = await admin
      .from("task_assignments")
      .select("member_id")
      .eq("task_id", parentTaskId);

    assertNoError("load parent assignments", { error: assignError });
    const memberIds = (assignments ?? []).map((a) => a.member_id as string);

    const subtaskId = await insertSubtask(admin, {
      parentId: parentTaskId,
      memberIds,
      title,
      description,
      dueAt,
    });

    revalidatePath("/tasks");
    return {
      subtask: {
        id: subtaskId,
        title,
        completed_at: null,
        description: description ?? null,
        due_at: dueAt ? `${dueAt}T00:00:00Z` : null,
      },
    };
  });
}

/**
 * Edits a subtask's own three fields. Authorization is the subtask's own assignment row — the same
 * check every other single-task action makes — and assignment is left alone, since a subtask
 * inherits its assignees from the parent at creation.
 */
export async function updateSubtask(input: UpdateSubtaskInput): Promise<ActionResult> {
  return run("updateSubtask", async () => {
    const { user } = await requireUser();
    const { subtaskId, title, description, dueAt } = parseInput(updateSubtaskSchema, input);
    await assertTaskAssignee(subtaskId, user.id);

    const admin = createAdminClient();

    assertNoError(
      "update subtask",
      await admin
        .from("tasks")
        .update({
          title,
          description: description ?? null,
          due_at: dueAt ? `${dueAt}T00:00:00Z` : null,
        })
        .eq("id", subtaskId)
    );

    revalidatePath("/tasks");
    return {};
  });
}
