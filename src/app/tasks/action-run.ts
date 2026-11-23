import { randomUUID } from "node:crypto";

import { ValidationError } from "./schemas";
import type { Recurrence } from "./schemas";
import { ForbiddenError, UnauthorizedError } from "@/lib/auth";
import { GENERIC_ERROR } from "./action-result";
import type { ActionResult } from "./action-result";
import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * A third-party service failed in a way the person can act on ("busy, try again in a minute").
 *
 * `message` is the internal detail and is only logged; `userMessage` is what `run` returns. `code`
 * is a stable machine-readable tag (e.g. `openai_auth`) so the failure can be searched for in the
 * Vercel logs, which a free-text message cannot be reliably. Construct it with nothing the person
 * said or recorded and no credential in `detail`, since `detail` is logged verbatim.
 */
export class ExternalServiceError extends Error {
  readonly code: string;
  readonly userMessage: string;
  readonly status?: number;

  constructor({
    code,
    userMessage,
    detail,
    status,
    cause,
  }: {
    code: string;
    userMessage: string;
    detail: string;
    status?: number;
    cause?: unknown;
  }) {
    super(detail, { cause });
    this.name = "ExternalServiceError";
    this.code = code;
    this.userMessage = userMessage;
    this.status = status;
  }
}

/**
 * Runs an action body and converts a thrown failure into `{ ok: false, error }`.
 *
 * Validation and authorization messages are meant for the person who triggered the action, so they
 * are passed through. Anything else — a database error, a bug — is logged with the action name and
 * replaced with a generic message, because those carry schema detail the client has no business
 * seeing. An `ExternalServiceError` is logged the same way but returns its own safe message.
 *
 * Each logged failure gets a short request id so one occurrence can be told apart from the next in
 * the logs; the original `{ level, action, message }` fields are unchanged for existing searches.
 */
export async function run<T extends object>(
  action: string,
  body: () => Promise<T>
): Promise<ActionResult<T>> {
  try {
    return { ok: true, ...(await body()) };
  } catch (error) {
    if (error instanceof ValidationError) {
      // fieldErrors is `{}` for a hand-thrown ValidationError with no per-field detail (e.g. an
      // authorization-shaped check that still wants the ValidationError message-passthrough
      // behaviour) — forwarding it unconditionally is harmless since callers treat it as optional.
      return { ok: false, error: error.message, fieldErrors: error.fieldErrors };
    }
    if (error instanceof ForbiddenError || error instanceof UnauthorizedError) {
      return { ok: false, error: error.message };
    }

    console.error(
      JSON.stringify({
        level: "error",
        action,
        message: error instanceof Error ? error.message : String(error),
        requestId: randomUUID().slice(0, 8),
        ...errorDetail(error),
      })
    );
    return {
      ok: false,
      error: error instanceof ExternalServiceError ? error.userMessage : GENERIC_ERROR,
    };
  }
}

/** The structured fields a failure carries, if any. Undefined fields drop out of the JSON line. */
function errorDetail(error: unknown) {
  if (!(error instanceof Error)) return {};
  const external = error instanceof ExternalServiceError ? error : null;
  return {
    errorName: error.name,
    code: external?.code,
    status: external?.status,
    pgCode: databaseCode(error.cause),
  };
}

/**
 * The SQLSTATE (or PostgREST `PGRST…`) code of a Supabase error attached as `cause`, which is how
 * `assertNoError` and the pages hand one on.
 */
function databaseCode(cause: unknown): string | undefined {
  if (typeof cause !== "object" || cause === null || !("code" in cause)) return undefined;
  return typeof cause.code === "string" ? cause.code : undefined;
}

/** Throws on a Supabase error so `run` can turn it into a failed result instead of losing it. */
export function assertNoError(
  step: string,
  { error }: { error: { message: string } | null }
): void {
  if (error) throw new Error(`${step}: ${error.message}`, { cause: error });
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
