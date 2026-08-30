/**
 * The result shape every task server action returns.
 *
 * Actions used to discard `{ error }` from Supabase and return void, so a failed mutation was
 * indistinguishable from a successful one — the optimistic UI kept the row and the user was never
 * told (audit C1). Returning a result instead of throwing keeps the failure on the happy path: the
 * caller has to look at `ok` to get anything else out of it.
 *
 * Messages in `error` are safe to show: they are either validation or authorization messages, or a
 * generic fallback. Unexpected errors are logged server-side and never forwarded verbatim, since
 * database errors can carry schema details.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type ActionResult<T extends object = {}> =
  | ({ ok: true } & T)
  // `fieldErrors` is optional and additive: every existing caller that only reads `{ ok, error }`
  // compiles and behaves exactly as before. Only `run()` populates it, and only for a
  // `ValidationError` — see action-run.ts.
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export const GENERIC_ERROR = "Something went wrong. Please try again.";
