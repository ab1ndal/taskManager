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
