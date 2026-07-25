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
} from "./schemas";
import type {
  CreateTaskWithSubtasksInput,
  UpdateTaskInput,
  ReorderTaskInput,
} from "./schemas";

// Every exported function in this file is a public endpoint. Each one authenticates the caller and
// then authorizes them for the specific row named in its arguments — a disabled button or a
// filtered list is not access control. See tasks/lessons.md L4.
//
// Mutations still run on the admin client because migration 007 is not yet applied; the assertions
// above them are what enforces access. Once 007 is live these can move to the user-scoped client
// and let RLS enforce as well (Task 3).

/** Next-highest sort key for a member, +1000. Racy under concurrency — see audit C3, fixed in Phase 05. */
async function nextSortKey(
  admin: ReturnType<typeof createAdminClient>,
  memberId: string
): Promise<number> {
  const { data: last } = await admin
    .from("task_assignments")
    .select("member_sort_key")
    .eq("member_id", memberId)
    .order("member_sort_key", { ascending: false })
    .limit(1)
    .single();

  return last ? (last.member_sort_key as number) + 1000 : 1000;
}

export async function completeTask(rawTaskId: string) {
  const { user } = await requireUser();
  const taskId = parseInput(taskIdSchema, rawTaskId);
  await assertTaskAssignee(taskId, user.id);

  const admin = createAdminClient();

  await admin
    .from("tasks")
    .update({ completed_at: new Date().toISOString() })
    .eq("id", taskId);

  const { data: task } = await admin
    .from("tasks")
    .select("parent_task_id, rule_id")
    .eq("id", taskId)
    .single();

  if (task?.parent_task_id) {
    const { count } = await admin
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("parent_task_id", task.parent_task_id)
      .is("completed_at", null);

    if (count === 0) {
      await admin
        .from("tasks")
        .update({ completed_at: new Date().toISOString() })
        .eq("id", task.parent_task_id);
    }
  }

  revalidatePath("/tasks");
}

export async function deleteTask(rawTaskId: string) {
  const { user } = await requireUser();
  const taskId = parseInput(taskIdSchema, rawTaskId);
  await assertTaskAssignee(taskId, user.id);

  const admin = createAdminClient();
  await admin.from("tasks").delete().eq("id", taskId);

  revalidatePath("/tasks");
}

export async function createTaskWithSubtasks(
  input: CreateTaskWithSubtasksInput
): Promise<{ subtaskErrors: number }> {
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

  const { error: parentError } = await admin.from("tasks").insert({
    id: parentId,
    title,
    description: description ?? null,
    due_at: dueAt ? `${dueAt}T00:00:00Z` : null,
    workspace_id: workspaceId,
  });

  if (parentError) throw new Error(parentError.message ?? "Failed to create task");

  for (const memberId of uniqueMemberIds) {
    await admin.from("task_assignments").insert({
      task_id: parentId,
      member_id: memberId,
      member_sort_key: await nextSortKey(admin, memberId),
    });
  }

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
      subtaskErrors++;
      continue;
    }

    for (const memberId of uniqueMemberIds) {
      await admin.from("task_assignments").insert({
        task_id: subtaskId,
        member_id: memberId,
        member_sort_key: await nextSortKey(admin, memberId),
      });
    }
  }

  revalidatePath("/tasks");
  return { subtaskErrors };
}

export async function updateTask(input: UpdateTaskInput) {
  const { user } = await requireUser();
  const { taskId, title, description, dueAt, memberIds } = parseInput(updateTaskSchema, input);
  await assertTaskAssignee(taskId, user.id);

  const admin = createAdminClient();
  const uniqueNewIds = [...new Set(memberIds)];

  // Reassignment is scoped to the task's own workspace — otherwise a caller could hand the task to
  // a member row belonging to a workspace they have nothing to do with.
  const { data: task, error: taskError } = await admin
    .from("tasks")
    .select("workspace_id")
    .eq("id", taskId)
    .single();

  if (taskError || !task) throw new Error(taskError?.message ?? "Task not found");

  await assertMembersInWorkspace(uniqueNewIds, task.workspace_id as string);

  await admin
    .from("tasks")
    .update({
      title,
      description: description ?? null,
      due_at: dueAt ? `${dueAt}T00:00:00Z` : null,
    })
    .eq("id", taskId);

  const { data: currentAssignments } = await admin
    .from("task_assignments")
    .select("member_id")
    .eq("task_id", taskId);

  const currentIds = (currentAssignments ?? []).map((a) => a.member_id as string);

  // Remove dropped members
  for (const memberId of currentIds.filter((id) => !uniqueNewIds.includes(id))) {
    await admin.from("task_assignments").delete().eq("task_id", taskId).eq("member_id", memberId);
  }

  // Add new members
  for (const memberId of uniqueNewIds.filter((id) => !currentIds.includes(id))) {
    await admin.from("task_assignments").insert({
      task_id: taskId,
      member_id: memberId,
      member_sort_key: await nextSortKey(admin, memberId),
    });
  }

  revalidatePath("/tasks");
}

export async function reorderTask(input: ReorderTaskInput) {
  const { user } = await requireUser();
  const { taskId, memberId, prevKey, nextKey } = parseInput(reorderTaskSchema, input);

  // member_sort_key is per-user priority: you may only reorder your own list, not someone else's.
  const ownMemberIds = await memberIdsForUser(user.id);
  if (!ownMemberIds.includes(memberId)) {
    throw new ForbiddenError(`member ${memberId} does not belong to the current user`);
  }

  await assertTaskAssignee(taskId, user.id);

  let newKey: number;
  if (prevKey === null && nextKey === null) return;
  if (prevKey === null) newKey = nextKey! - 1000;
  else if (nextKey === null) newKey = prevKey + 1000;
  else newKey = (prevKey + nextKey) / 2;

  const admin = createAdminClient();
  await admin
    .from("task_assignments")
    .update({ member_sort_key: newKey })
    .eq("task_id", taskId)
    .eq("member_id", memberId);

  revalidatePath("/tasks");
}
