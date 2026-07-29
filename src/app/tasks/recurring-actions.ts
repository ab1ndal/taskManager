"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { requireUser, assertTaskAssignee } from "@/lib/auth";
import { parseInput, setTaskRecurrenceSchema, ValidationError } from "./schemas";
import type { SetTaskRecurrenceInput } from "./schemas";
import type { ActionResult } from "./action-result";
import { run, assertNoError, writeRecurrence } from "./action-run";

export async function setTaskRecurrence(
  input: SetTaskRecurrenceInput
): Promise<ActionResult> {
  return run("setTaskRecurrence", async () => {
    const { user } = await requireUser();
    const { taskId, ...recurrence } = parseInput(setTaskRecurrenceSchema, input);
    await assertTaskAssignee(taskId, user.id);

    const admin = createAdminClient();

    const { data: task, error: taskError } = await admin
      .from("tasks")
      .select("parent_task_id")
      .eq("id", taskId)
      .single();

    assertNoError("load task", { error: taskError });

    // A rule is read back by root task id only (page.tsx's Query 3c), so one attached to a subtask
    // would be invisible in the UI while `run_due_recurrences` still reset that subtask on every
    // tick — an invisible, uncontrollable schedule. Same boundary `addSubtask` enforces against
    // nesting a subtask under a subtask (actions.ts), just the mirror case.
    if (task?.parent_task_id) {
      const message = "A subtask cannot have its own repeat schedule";
      throw new ValidationError({ taskId: [message] }, message);
    }

    await writeRecurrence(admin, taskId, recurrence);

    revalidatePath("/tasks");
    return {};
  });
}
