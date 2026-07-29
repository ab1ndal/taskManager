"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { requireUser, assertTaskAssignee } from "@/lib/auth";
import { parseInput, setTaskRecurrenceSchema } from "./schemas";
import type { SetTaskRecurrenceInput } from "./schemas";
import type { ActionResult } from "./action-result";
import { run, writeRecurrence } from "./action-run";

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
