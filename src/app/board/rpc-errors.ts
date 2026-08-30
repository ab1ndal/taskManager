/**
 * The RPC failure conditions the caller is meant to see.
 *
 * Board writes go through SECURITY DEFINER functions whose guards are user-facing conditions — a
 * stale move list, a destination in the wrong workspace, the last non-terminal column. Collapsing
 * those to a generic message strands the user, and Task 13's delete dialog branches on one of them.
 * But forwarding whatever Postgres said would leak constraint names, casts and permission text,
 * which is precisely what src/app/tasks/action-run.ts refuses to do.
 *
 * So: messages we wrote ourselves in migrations 016-018/020/021 pass through; anything else is an
 * unexpected failure and goes back to the generic path, logged server-side.
 *
 * Every fragment below was checked against those migration files directly (`grep -n "raise
 * exception"`) rather than kept from memory. "not found" is the one worth a second look: it is
 * deliberately broad because the id Postgres interpolates into "task % not found" / "board column %
 * not found" sits in the middle of the string, so a literal substring can only match the fixed part
 * around it. It is safe because Postgres itself phrases a missing-object error as "does not exist",
 * never "not found" — so this fragment matches only our own raises, not Postgres's own wording for
 * the same class of problem.
 */
const KNOWN_RPC_FAILURES = [
  "not found", // "task % not found" / "board column % not found" (016/018/020/021)
  "is a subtask and has no board column", // move_task_to_column (018/020)
  "is not in workspace", // "board column % is not in workspace %" / "member % is not in workspace %" (018/020)
  "is not assigned to task", // "member % is not assigned to task %" (018/020)
  "p_moves must be a json array", // delete_board_column (018/020/021)
  "changed since it was listed", // delete_board_column's coverage check (018/020/021)
  "every destination must be a different column in workspace", // delete_board_column (018/020/021)
  "cannot delete the last non-terminal column of workspace", // delete_board_column's own count guard (018/020/021)
  "would be left with no non-terminal board column", // before-delete trigger backstop (016/017)
] as const;

/** The message to show the user, or null when this is not a condition we authored. */
export function knownRpcFailure(message: string): string | null {
  return KNOWN_RPC_FAILURES.some((fragment) => message.includes(fragment)) ? message : null;
}
