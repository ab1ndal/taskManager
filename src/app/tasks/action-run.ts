import { ValidationError } from "./schemas";
import type { Recurrence } from "./schemas";
import { ForbiddenError, UnauthorizedError } from "@/lib/auth";
import { GENERIC_ERROR } from "./action-result";
import type { ActionResult } from "./action-result";
import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * Runs an action body and converts a thrown failure into `{ ok: false, error }`.
 *
 * Validation and authorization messages are meant for the person who triggered the action, so they
 * are passed through. Anything else — a database error, a bug — is logged with the action name and
 * replaced with a generic message, because those carry schema detail the client has no business
 * seeing.
 */
export async function run<T extends object>(
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
export function assertNoError(
  step: string,
  { error }: { error: { message: string } | null }
): void {
  if (error) throw new Error(`${step}: ${error.message}`);
}

/**
 * Writes a task's schedule.
 *
 * The write goes through `upsert_task_recurrence` rather than a plain insert because `firstRunAt`
 * is a wall-clock string with no offset: casting it to timestamptz uses the session timezone, which
 * is UTC for these connections, and the same string would land eight hours out. The RPC does the
 * cast with timezone set to Pacific. See migration 013.
 *
 * Lives here, not in `recurring-actions.ts`, because that module has `"use server"` at the top —
 * every export of a `"use server"` module becomes an addressable action endpoint the moment the
 * module is reachable from a client boundary, with or without a caller who imports it that way
 * today. This function does no `requireUser`/`assertTaskAssignee` and is not wrapped in `run`; it
 * is only safe to call server-to-server, from another action that has already done both. Both
 * `actions.ts` and `recurring-actions.ts` call it that way.
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
