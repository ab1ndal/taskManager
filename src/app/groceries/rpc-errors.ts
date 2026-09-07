/**
 * The grocery RPC failures the caller is meant to see.
 *
 * Same reasoning as src/app/board/rpc-errors.ts: messages we wrote ourselves in migration 027 are
 * user-facing conditions and pass through, while anything else is an unexpected failure that goes
 * back through the generic path and is logged server-side. Forwarding Postgres's own text would
 * leak constraint names, casts and permission detail.
 *
 * Every fragment below was checked against 026/027 directly rather than remembered.
 */
const KNOWN_GROCERY_RPC_FAILURES = [
  // "grocery item % not found" — every RPC that takes an id (027)
  "not found",
  // grocery_adjust_quantity, when the row has no count to step (027)
  "has no quantity to adjust",
  // private.assert_grocery_member_workspace (026)
  "is not in workspace",
  // Removed: "p_target must be stock or list" — this names an internal function parameter.
  // A user can never cause an invalid target; only a caller bug can. Belongs in the server log,
  // not shown to the user, so falls through to the generic message.
] as const;

/** The message to show the user, or null when this is not a condition we authored. */
export function knownGroceryRpcFailure(message: string): string | null {
  return KNOWN_GROCERY_RPC_FAILURES.some((fragment) => message.includes(fragment))
    ? message
    : null;
}
