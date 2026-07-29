"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { requireUser, assertTaskAssignee } from "@/lib/auth";
import { parseInput, setTaskRecurrenceSchema } from "./schemas";
import type { Recurrence, SetTaskRecurrenceInput } from "./schemas";
import type { ActionResult } from "./action-result";
import { run } from "./action-run";

/**
 * Writes a task's schedule.
 *
 * The write goes through `upsert_task_recurrence` rather than a plain insert because `firstRunAt`
 * is a wall-clock string with no offset: casting it to timestamptz uses the session timezone, which
 * is UTC for these connections, and the same string would land eight hours out. The RPC does the
 * cast with timezone set to Pacific. See migration 013.
 */
export async function writeRecurrence(
  admin: ReturnType<typeof createAdminClient>,
  taskId: string,
  recurrence: Recurrence
): Promise<void> {
  const { error } = await admin.rpc("upsert_task_recurrence", {
    p_task_id: taskId,
    p_frequency: recurrence.frequency,
    p_interval_count: recurrence.intervalCount,
    p_first_run_local: recurrence.firstRunAt,
    p_due_offset_hours: recurrence.dueOffsetHours ?? null,
    p_is_active: recurrence.isActive,
  });

  if (error) throw new Error(`upsert task recurrence: ${error.message}`);
}

export async function setTaskRecurrence(
  input: SetTaskRecurrenceInput
): Promise<ActionResult> {
  return run("setTaskRecurrence", async () => {
    const { user } = await requireUser();
    const { taskId, ...recurrence } = parseInput(setTaskRecurrenceSchema, input);
    await assertTaskAssignee(taskId, user.id);

    await writeRecurrence(createAdminClient(), taskId, recurrence);

    revalidatePath("/tasks");
    return {};
  });
}
