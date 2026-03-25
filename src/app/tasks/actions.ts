"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function completeTask(taskId: string) {
  const supabase = await createClient();
  await supabase
    .from("tasks")
    .update({ completed_at: new Date().toISOString() })
    .eq("id", taskId);
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
    .insert({ title, due_at: dueAt ?? null, workspace_id: workspaceId })
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
  subtasks: { title: string; dueAt?: string }[];
}): Promise<{ subtaskErrors: number }> {
  const supabase = await createClient();

  const { data: parent, error: parentError } = await supabase
    .from("tasks")
    .insert({
      title,
      description: description ?? null,
      due_at: dueAt ?? null,
      workspace_id: workspaceId,
    })
    .select()
    .single();

  if (parentError || !parent) throw new Error(parentError?.message ?? "Failed to create task");

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
      task_id: parent.id,
      member_id: memberId,
      member_sort_key: sortKey,
    });
  }

  let subtaskErrors = 0;
  for (const sub of subtasks) {
    const { data: subtask, error: subError } = await supabase
      .from("tasks")
      .insert({
        title: sub.title,
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
        task_id: subtask.id,
        member_id: memberId,
        member_sort_key: sortKey,
      });
    }
  }

  revalidatePath("/tasks");
  return { subtaskErrors };
}
