# Phase 7 — Followups

Raised 2026-07-29, at Phase 7 close. Nothing here blocks the dev-side sign-off; production deploy
shipped 2026-07-30 (see 07-VERIFICATION.md section 8), which closed F4.

Each item states what is true today, why it matters, and what "done" looks like.

---

## Correctness

### F1 — The optimistic-row completion race can surface a raw authorization error — OPEN

`new-task-modal` renders an optimistic row for a task that hasn't been confirmed by the server yet,
and its "Mark complete" control is never disabled while the row is optimistic. A fast user can
click complete on that row before the real insert resolves, which calls `completeTask(tempId)` —
`assertTaskAssignee` then throws because no such row exists yet, and `task-card.tsx` surfaces the
raw `ForbiddenError("not assigned to task <uuid>")` string verbatim as a toast.

Pre-existing, unrelated to recurrence — Phase 7 did not introduce it, but the e2e suite's use of
`page.reload()` around recurrence assertions means this race is now untested where it might
otherwise have been exercised incidentally.

**Done:** two parts — disable "Mark complete" (and any other mutating control) while a row is
optimistic, and never pass raw authorization-error text to a toast; genericize it the way other
action errors already are.

### F2 — Monthly recurrence drifts on month-end anchors — ACCEPTED LIMITATION

`interval '1 month'` moves a Jan 31 anchor to Feb 28, and it stays on the 28th every month after —
Postgres interval arithmetic clamps rather than tracking the original day-of-month. Fixing this
needs a dedicated day-of-month anchor column and different roll-forward logic.

Documented and accepted in the phase 7 spec as an explicit limitation, not a bug to close here.

### F3 — No per-occurrence history — ACCEPTED LIMITATION

A recurring task is one permanent row that reactivates; nothing records that a given occurrence was
completed, when, or by whom. `task_updates.member_id` is `not null`, and the generator that clears
`completed_at` has no member context to attribute the completion to — there is no natural place to
write a per-occurrence record without either loosening that constraint or inventing a system actor.

Accepted in the phase 7 spec. Would need its own occurrence-log table plus a decision on how the
generator (which runs as `service_role` on a schedule, not as any member) attributes a record.

### F4 — Production `task_rules` row count was unverified — CLOSED 2026-07-30, resolved by the deploy

Migration 012 does `alter table task_rules add column task_id uuid not null` plus two `check`
constraints (`interval_count > 0`, the narrowed `frequency` enum) that validate every existing row.
All three abort the migration if `task_rules` is non-empty on production and any row fails to
satisfy them. Dev had zero rows in this table, so this was never actually exercised there.

The count could not be checked ahead of the merge: production is a separate Supabase project and no
credentials for it exist in the development environment — `.env.local` targets `task-manager-dev`
only, and the connection pooler rejects the production tenant with those credentials in every
region. The risk was accepted knowingly, on the basis that a non-empty, non-conforming table fails
the deploy loudly rather than corrupting data.

**Outcome:** run `30501921797` applied 012, 013 and 014 to production successfully at
2026-07-30T00:11 UTC. Migration 012 completing is itself the proof that `task_rules` was empty on
production — the `not null` column add could not have succeeded otherwise. No action remains.

**Correction recorded here because it was asserted wrongly during the phase:** production was
already at migration **011**, not 009. That figure was inferred from dev's state rather than
observed, and dev happened to be two migrations behind. Only 012-014 were pending on production.
Do not infer one project's migration state from the other's.

### F5 — Theoretical live-cron race in e2e test 2 — OPEN, LOW RISK

A sub-second window exists between the test backdating a rule's `next_run_at` into the past and the
test's own call to the reactivation RPC — if the live `run-due-recurrences` cron (running every 15
minutes on dev) happens to fire in that exact window, it could process the row first. Test cleanup
covers the row regardless of which caller processed it, so this has not caused a flake; noted as a
theoretical gap rather than an observed one.

**Done:** either accepted as-is (cleanup already covers both outcomes), or the test pins the rule to
a task/member the cron job's `for update skip locked` query can be shown not to select in the same
window.

---

## Carried from Phase 6.5

The Phase 6.5 followups list (`06.5-FOLLOWUPS.md`) still has open items (F11, F12, F19, F22) that
Phase 7 did not touch and does not change the status of. Not repeated here.
