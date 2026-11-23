import { GENERIC_ERROR } from "@/app/tasks/action-result";
import { ExternalServiceError } from "@/app/tasks/action-run";

/**
 * Failure handling shared by the two OpenAI calls behind grocery dictation (transcribe-actions.ts,
 * dictate-actions.ts).
 *
 * When the household's key expired, both calls showed "Something went wrong" and logged one bare
 * line, so nobody could tell a dead key from a bug. Each failure the person can act on now maps to
 * an `ExternalServiceError` with an honest message and a searchable `code`.
 *
 * Deliberately free of the AI SDK: transcription is plain `fetch` (tasks/lessons.md L23), so the
 * SDK's own error types are unwrapped in dictate-actions.ts, the one caller that uses it.
 *
 * Lives outside the `"use server"` action files because those may only export async functions
 * (tasks/lessons.md L27).
 */

/** Long enough for a two-minute recording or a long list; short of Vercel's function limit. */
export const OPENAI_TIMEOUT_MS = 30_000;

export const DICTATION_UNAVAILABLE = "Dictation is unavailable right now — type items instead.";
export const DICTATION_BUSY = "Dictation is busy — try again in a minute.";
export const DICTATION_TIMED_OUT = "That took too long — try again.";

/**
 * The configured key, or an `openai_key_missing` failure. An empty string counts as missing:
 * Vercel's Sensitive variables pull as empty strings (tasks/lessons.md).
 */
export function requireOpenAiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ExternalServiceError({
      code: "openai_key_missing",
      userMessage: DICTATION_UNAVAILABLE,
      detail: "OPENAI_API_KEY is not set",
    });
  }
  return apiKey;
}

/**
 * Maps an OpenAI HTTP error response to the failure `run` reports.
 *
 * Only OpenAI's machine-readable `type`/`code` from the body reach the log: its `message` echoes
 * part of the API key on a 401, so it is never included.
 */
export function openAiHttpError(step: string, status: number, responseBody: string | undefined, cause?: unknown) {
  const reason = openAiErrorReason(responseBody);
  const detail = `OpenAI ${step} failed: ${status}${reason ? ` ${reason.type ?? "-"}/${reason.code ?? "-"}` : ""}`;
  const fail = (code: string, userMessage: string) =>
    new ExternalServiceError({ code, userMessage, detail, status, cause });

  if (status === 401 || status === 403) return fail("openai_auth", DICTATION_UNAVAILABLE);
  // OpenAI answers an exhausted billing quota with 429 too; "try again in a minute" would be a lie.
  if (status === 429 && reason?.code === "insufficient_quota") return fail("openai_quota", DICTATION_UNAVAILABLE);
  if (status === 429) return fail("openai_rate_limit", DICTATION_BUSY);
  return fail("openai_http_error", GENERIC_ERROR);
}

/**
 * Maps a thrown OpenAI-call failure to an `openai_timeout` failure if it was our own timeout firing.
 * Anything else is returned unchanged and reaches `run`'s generic path.
 *
 * `AbortSignal.timeout` aborts with a DOMException named TimeoutError, which `fetch` rejects with
 * and the AI SDK rethrows as is (its retry loop never retries an abort). The SDK's retry backoff
 * rejects with a plain AbortError instead when the timeout fires mid-wait, so the `signal` that
 * fired is the deciding fact, with the error name covering a reject before the signal settles.
 */
export function mapOpenAiTimeout(step: string, error: unknown, signal: AbortSignal): unknown {
  // Already classified (a 401 read just before the deadline, say): keep the real reason.
  if (error instanceof ExternalServiceError) return error;
  // A DOMException is not always `instanceof Error` (it depends on the realm), so check both, as
  // the SDK's own `isAbortError` does.
  const namedTimeout = (error instanceof Error || error instanceof DOMException) && error.name === "TimeoutError";
  if (signal.aborted || namedTimeout) {
    return new ExternalServiceError({
      code: "openai_timeout",
      userMessage: DICTATION_TIMED_OUT,
      detail: `OpenAI ${step} timed out after ${OPENAI_TIMEOUT_MS}ms`,
      cause: error,
    });
  }
  return error;
}

/** OpenAI's error body is `{ error: { message, type, code } }`; anything else has no reason. */
function openAiErrorReason(responseBody: string | undefined): { type?: string; code?: string } | null {
  if (!responseBody) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseBody);
  } catch {
    // A proxy's HTML error page, not OpenAI's JSON — the status alone is the diagnosis.
    return null;
  }
  const error = (parsed as { error?: unknown } | null)?.error;
  if (typeof error !== "object" || error === null) return null;
  const { type, code } = error as { type?: unknown; code?: unknown };
  return {
    type: typeof type === "string" ? type : undefined,
    code: typeof code === "string" ? code : undefined,
  };
}
