"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

export async function completeTask(taskId: string) {
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

export async function deleteTask(taskId: string) {
  const supabase = await createClient();
  await supabase.from("tasks").delete().eq("id", taskId);
  revalidatePath("/tasks");
}

export async function createTask({
  title,
  dueAt,
  workspaceId,
  memberIds,
}: {
  title: string;
  dueAt?: string;
  workspaceId: string;
  memberIds: string[];
}) {
  const supabase = await createClient();

  const { data: task, error } = await supabase
    .from("tasks")
    .insert({ title, due_at: dueAt ? `${dueAt}T00:00:00Z` : null, workspace_id: workspaceId })
    .select()
    .single();

  if (error || !task) throw new Error(error?.message ?? "Failed to create task");

  for (const memberId of memberIds) {
    const { data: last } = await supabase
      .from("task_assignments")
      .select("member_sort_key")
      .eq("member_id", memberId)
      .order("member_sort_key", { ascending: false })
      .limit(1)
      .single();

    const sortKey = last ? (last.member_sort_key as number) + 1000 : 1000;

    await supabase.from("task_assignments").insert({
      task_id: task.id,
      member_id: memberId,
      member_sort_key: sortKey,
    });
  }

  revalidatePath("/tasks");
}

export async function createTaskWithSubtasks({
  title,
  description,
  dueAt,
  workspaceId,
  memberIds,
  subtasks,
}: {
  title: string;
  description?: string;
  dueAt?: string;
  workspaceId: string;
  memberIds: string[];
  subtasks: { title: string; dueAt?: string; description?: string }[];
}): Promise<{ subtaskErrors: number }> {
  const supabase = await createClient();
  const admin = createAdminClient();
  const uniqueMemberIds = [...new Set(memberIds)];

  // Use admin client for tasks INSERT — tasks_insert RLS queries workspace_members,
  // triggering the self-referential workspace_members_select policy (42P17 recursion).
  const { data: parent, error: parentError } = await admin
    .from("tasks")
    .insert({
      title,
      description: description ?? null,
      due_at: dueAt ? `${dueAt}T00:00:00Z` : null,
      workspace_id: workspaceId,
    })
    .select()
    .single();

  if (parentError || !parent) throw new Error(parentError?.message ?? "Failed to create task");

  for (const memberId of uniqueMemberIds) {
    // Use admin client for task_assignments — task_assignments_select is also recursive,
    // and task_assignments_insert WITH CHECK queries workspace_members + tasks (42P17).
    const { data: last } = await admin
      .from("task_assignments")
      .select("member_sort_key")
      .eq("member_id", memberId)
      .order("member_sort_key", { ascending: false })
      .limit(1)
      .single();
    const sortKey = last ? (last.member_sort_key as number) + 1000 : 1000;
    await admin.from("task_assignments").insert({
      task_id: parent.id,
      member_id: memberId,
      member_sort_key: sortKey,
    });
  }

  let subtaskErrors = 0;
  for (const sub of subtasks) {
    const { data: subtask, error: subError } = await admin
      .from("tasks")
      .insert({
        title: sub.title,
        description: sub.description ?? null,
        due_at: sub.dueAt ? `${sub.dueAt}T00:00:00Z` : null,
        workspace_id: workspaceId,
        parent_task_id: parent.id,
      })
      .select()
      .single();

    if (subError || !subtask) {
      subtaskErrors++;
      continue;
    }

    for (const memberId of uniqueMemberIds) {
      const { data: last } = await admin
        .from("task_assignments")
        .select("member_sort_key")
        .eq("member_id", memberId)
        .order("member_sort_key", { ascending: false })
        .limit(1)
        .single();
      const sortKey = last ? (last.member_sort_key as number) + 1000 : 1000;
      await admin.from("task_assignments").insert({
        task_id: subtask.id,
        member_id: memberId,
        member_sort_key: sortKey,
      });
    }
  }

  revalidatePath("/tasks");
  return { subtaskErrors };
}

export async function updateTask({
  taskId,
  title,
  description,
  dueAt,
  memberIds,
}: {
  taskId: string;
  title: string;
  description?: string;
  dueAt?: string;
  memberIds: string[];
}) {
  const admin = createAdminClient();

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
  const uniqueNewIds = [...new Set(memberIds)];

  // Remove dropped members
  for (const memberId of currentIds.filter((id) => !uniqueNewIds.includes(id))) {
    await admin.from("task_assignments").delete().eq("task_id", taskId).eq("member_id", memberId);
  }

  // Add new members
  for (const memberId of uniqueNewIds.filter((id) => !currentIds.includes(id))) {
    const { data: last } = await admin
      .from("task_assignments")
      .select("member_sort_key")
      .eq("member_id", memberId)
      .order("member_sort_key", { ascending: false })
      .limit(1)
      .single();
    const sortKey = last ? (last.member_sort_key as number) + 1000 : 1000;
    await admin.from("task_assignments").insert({ task_id: taskId, member_id: memberId, member_sort_key: sortKey });
  }

  revalidatePath("/tasks");
}

export async function reorderTask({
  taskId,
  memberId,
  prevKey,
  nextKey,
}: {
  taskId: string;
  memberId: string;
  prevKey: number | null;
  nextKey: number | null;
}) {
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
