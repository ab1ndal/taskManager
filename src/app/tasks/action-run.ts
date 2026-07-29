import { ValidationError } from "./schemas";
import { ForbiddenError, UnauthorizedError } from "@/lib/auth";
import { GENERIC_ERROR } from "./action-result";
import type { ActionResult } from "./action-result";

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
