# Phase 07 — Recurring Tasks: Verification Record

Written 2026-07-29, Task 10, from `.superpowers/sdd/2026-07-28-recurring-tasks/progress.md` (the
accurate task-by-task ledger) and the Task 2/3 reports it summarizes. Production status: **SHIPPED
2026-07-30** — see section 8. Sections 1-7 were written before the deploy and describe dev only
(`task-manager-dev`, `mcdpiuiayfljzvnhtqto`) unless stated otherwise.

## 1. Migration state

Every SQL verification before Task 9 ran inside `begin; … rollback;` — dry-runs only, nothing left
applied. Dev was migrated for real for the first time in Task 9: `supabase db push` applied 010,
011, 012 and 013 (dev had been sitting at 009). Confirmed here again, re-run for this task:

```
$ supabase migration list --linked
   Local | Remote | Time (UTC)
  -------|--------|------------
   001   | 001    | 001
   ...
   012   | 012    | 012
   013   | 013    | 013
```

Local project link resolves to `mcdpiuiayfljzvnhtqto` (`.env.local`:
`NEXT_PUBLIC_SUPABASE_URL=https://mcdpiuiayfljzvnhtqto.supabase.co`) — this is `task-manager-dev`,
not production. 001-013 applied on both local and remote columns. Migration 014 was added later, by
the final review's fix wave, and applied to dev the same way; dev is at 014.

Production was untouched at the time this section was written. It has since been deployed — see
section 8, which also corrects an assumption made here about production's migration state.

## 2. Cron job

Re-confirmed 2026-07-29 against dev via the session pooler:

```
$ psql "postgresql://postgres.mcdpiuiayfljzvnhtqto@aws-0-us-east-2.pooler.supabase.com:5432/postgres" \
  -c "select jobname, schedule, active, command from cron.job where jobname = 'run-due-recurrences';"

       jobname       |   schedule   | active |               command
---------------------+--------------+--------+-------------------------------------
 run-due-recurrences | */15 * * * * | t      | select public.run_due_recurrences()
```

One row, live, `*/15 * * * *`, active. `select current_database()` on the same connection returned
`postgres` against the dev host — confirmed against dev, not production.

## 3. SQL verification checks (012 and 013), all against `task-manager-dev`

All runs below happened inside `begin; … rollback;` except where noted (Task 9's real `db push`).
The migration files were applied verbatim from the plan; the checks were not.

### Migration 012 (`task_rules` reshape + RLS) — Task 2

**Pre-migration run** (expected fail, and did):

| Check | Result |
|---|---|
| `rule_id_dropped` | false |
| `denormalized_columns_dropped` | false |
| `task_id_not_null` / `cascades_on_delete` | false / (null, column doesn't exist yet) |
| `biweekly_removed` / `interval_guarded` | false / false |
| `rls_enabled` | **true** — deviation from the brief's expected `false` |
| `four_policies` | false |

**What turned out not to be true:** the brief expected `rls_enabled = false` pre-migration.
On dev it was already `true`, with zero policies — RLS had been flipped on `task_rules` by hand
outside migration history at some point (no migration before 012 touches that table). With RLS on
and no policies, the table was actually already default-deny, the reverse of what 012's own
migration comment claimed ("reachable through PostgREST by any signed-in user"). The comment was
corrected in fix round 1 (see below); the migration itself needed no change, since `enable row
level security` on an already-enabled table is a no-op.

Bare `rls_enabled` also could not discriminate before/after (`true` in both runs), so it was
replaced with `rls_secured` (`relrowsecurity AND exists(any policy)`) during the fix round —
`false` pre-migration, `true` only once both the bit and real policies exist.

**Post-migration dry-run** (migration applied, then rolled back): all original 6 booleans `true`.
After fix round 1 added three more assertions (`rls_secured`, `all_scoped_to_authenticated` +
`all_four_commands_covered`, `next_run_idx_exists`), the pre-migration run showed all of them
correctly `false` and the post-migration run showed all 9 booleans `true`. Final line `ROLLBACK` in
every run — nothing left applied on dev at the end of Task 2.

### Migration 013 (recurrence generator + cron) — Task 3

**Pre-012 run** (test file expects "function does not exist"; dev didn't even have the `task_id`
column yet since 012 was still unapplied): failed differently than predicted —
`ERROR: column "task_id" of relation "task_rules" does not exist` — because 012 had been rolled
back in Task 2, exactly as expected for that point in the plan.

**Chained 012+013 dry-run, round 1 (before fixes):** 12 of 13 assertions `true`. The one failure,
`anchor_kept` (check 3), was root-caused to the test fixture, not the generator: the fixture wrote
"9am" via a raw `date_trunc/interval` `UPDATE`, which resolves in the session's timezone (UTC), so
it actually wrote 9am UTC = 2am Pacific. `advance_next_run` (which does carry
`set timezone = 'America/Los_Angeles'`) then correctly preserved that 2am Pacific wall-clock hour —
correct behavior given what it was actually handed. `rolled_past_now` and `only_one_period_ahead`
both passed, confirming the roll-forward arithmetic itself was sound; only the hour-of-day
assertion, tied to a mis-anchored fixture, failed. This diagnosis was independently confirmed by
the reviewer.

**Fixes dispatched from review** (see section 4 for the defects themselves): after fix round 1,
`anchor_kept` passes (fixture wrapped in `set local timezone = 'America/Los_Angeles'`), plus new
checks 3b (due_at is recent, not backlogged), 11 (`upsert_task_recurrence` resolves Pacific
correctly from a UTC session — the highest-risk untested claim in the whole migration), 12
(`on conflict` path), and 13 (both RPCs stay locked to `service_role`). Fix round 2 found that
round 1's fix for check 11 was itself compromised — wrapping the whole test file in
`set local timezone = 'America/Los_Angeles'` meant the session was already Pacific by the time
check 11 ran, so it would have passed even with `upsert_task_recurrence`'s own `set timezone`
clause deleted, which is the exact thing it exists to catch. Fixed by scoping check 11 to its own
`set local timezone = 'UTC'` sub-block. Final re-verification: all 18 assertions across both
rounds `true` (13 original + 3b/11/12/13 added), RLS check (non-assignee sees nothing, assignee
sees their own rule) both `true`, grant-lockdown assertions `true`. Every transaction ended in
`ROLLBACK`; a separate read-only post-check confirmed no function, extension artifact, or column
was left behind after either round.

## 4. Defects the review loop caught that the plan itself introduced

These are the reusable findings — the plan's own SQL and TypeScript, transcribed faithfully,
contained real bugs that only a review pass (not the green test suite) surfaced:

1. **Infinite loop in the roll-forward generator.** `advance_next_run`'s original `case … end` (as
   a `sql immutable` function, no `else`) returned `NULL` for an unrecognized `p_frequency`.
   `run_due_recurrences`'s roll-forward loop does `exit when v_next > now()`; comparing `NULL >
   now()` is neither true nor false, so the loop would spin forever holding the row's `for update`
   lock, and because nothing was ever raised, the surrounding `exception when others` handler had
   nothing to catch. Fixed by rewriting the function as `plpgsql` with an explicit
   `if p_frequency not in (...) then raise exception` guard, which now routes into the existing
   per-rule exception handler.
2. **`due_at` anchored to the oldest missed occurrence, not the most recent.** The original logic
   fired the reactivated task at the rule's pre-roll `next_run_at` — however many intervals stale —
   contradicting the migration's own "one reactivation, never a backlog" design. Human decision
   2026-07-28: use the most recent missed occurrence, so a 9-day outage on a 3-day rule returns the
   task due today, not 9 days overdue. Fixed by tracking `v_fired` separately from `v_next` inside
   the roll-forward loop.
3. **False claim in migration 012's own header comment.** It asserted `task_rules` was "reachable
   through PostgREST by any signed-in user" pre-migration. On dev, RLS was already enabled (with
   zero policies), meaning the table was actually default-deny, not exposed — the opposite of the
   comment's claim. The comment was corrected to state only what was evidenced, without altering the
   migration's actual (correct) behavior.
4. **A test that could not fail.** `anchor_kept`'s fix (wrapping the whole 013 test file in
   `set local timezone = 'America/Los_Angeles'`) accidentally defeated the newly-added check 11,
   which exists specifically to prove `upsert_task_recurrence` resolves local-time strings as
   Pacific regardless of the session's own timezone. With the session already Pacific, check 11
   would have passed even if that function's `set timezone` clause were deleted. Fixed by scoping
   check 11 to its own UTC sub-transaction.
5. **`z.iso.datetime({local:true})` accepted a `Z` suffix.** Verified empirically by the reviewer:
   an API caller sending `"...T09:00Z"` meaning UTC would silently be treated as 09:00 Pacific — an
   8-hour error with no validation failure. Fixed by switching to an anchored regex that rejects any
   offset/Z suffix.
6. **`writeRecurrence` exported from a `"use server"` module.** Any export from a `"use server"`
   file becomes a callable, unauthenticated server action endpoint the moment anything imports it —
   including, as planned, a future client component. Moved to a plain module before that import
   landed.
7. **Ghost-row failure mode on a rule write failure.** No transaction spanned the task insert and
   the rule write. On rule failure, the client would roll back its optimistic UI row while the task
   itself persisted in the database, silently reappearing on the next load with no explanation.
   Decision: match the existing `subtaskErrors` pattern — keep the task, return `recurrenceFailed`,
   surface it to the user. Not a silent hard failure, but also not atomic; documented as the
   accepted shape.
8. **Inert error toast behind an open `<dialog>`.** A modal-close relocation made the
   `updateTask` error toast unreachable while the dialog was still open via `showModal()` — the
   exact `<dialog>` inertness lesson (`tasks/lessons.md` L11) recurring in the same phase that
   quotes it. Zero toast assertions existed in `edit-task-modal.test.tsx`, which is why a fully
   green suite missed it. Fixed by keeping the inline-error branch open when a schedule write is
   pending and only closing synchronously when nothing was scheduled.
9. **Paused recurrences losing their schedule.** `is_active = true` filtered a paused rule out of
   both the `recurring` flag and the `recurrence` payload, so reloading a paused task showed
   "Repeats: off" with no remembered cadence — re-enabling it upserted a fresh daily default over
   whatever schedule had actually been saved, directly contradicting the code's own comment. Fixed
   by splitting the concerns: the badge is driven by `is_active`, the modal prefill by the stored
   row regardless of its active state.

## 5. Two pre-existing e2e harness bugs, exposed only when 011 was finally applied (Task 9)

Both existed in the harness before this phase and were invisible until migration 011 (subtask
workspace scoping) was applied to dev for the first time:

- `seed()` set `workspace_id` on subtask inserts, which migration 011's
  `tasks_workspace_only_on_root` constraint rejects — subtasks are not supposed to carry their own
  `workspace_id`.
- `cleanupUiWrites()` filtered subtask deletion by `workspace_id`, which subtasks don't carry, so
  it silently deleted nothing and leaked rows into (and rotted) the iPhone screenshot baselines.

Both fixed in Task 9. The reviewer searched the app code for any other path assuming subtasks carry
`workspace_id` — none found; existing app paths either omit it or are root-task-only.

## 6. e2e results (Task 9, against `task-manager-dev`)

`e2e/recurring.spec.ts`: 12/12 passing across chromium, webkit, firefox and the iPhone profile.
Full suite: 207 passed, 38 skipped, 0 failed.

**Screenshot-baseline date rot.** A visual-inspection finding (not caught by the green run):
regenerated baselines embedded the generation date in a date-relative seed task, so the due date
shown (07/27 → 07/29 between the old and new baseline) rotted the screenshot suite within 24 hours
— it had been silently date-broken since 07/27. Fixed by masking the `input[type="date"]` element
in the existing `volatile()` helper rather than loosening the pixel-diff threshold. 8 PNGs changed
(4 more than the first masking pass), because the subtask-row date inputs had never been masked
before; verified as expected, not over-broad.

## 7. Jest

294 tests passed as of Task 2 (before recurrence UI landed); 349 tests passed by the end of Task 8,
all green throughout the phase at every task boundary.

## 8. Production status

**SHIPPED 2026-07-30.** Merged to `main` as `cdae388` (PR #5, rebase merge — the branch's commits
were replayed onto `main` with new SHAs). `deploy-migrations.yml` run `30501921797` applied
migrations 012, 013 and 014 to production (`xamdgvxziobpptcfymug`) at 00:11 UTC and succeeded.

Two things that record corrects:

- **Production was already at migration 011, not 009.** The 009 figure asserted earlier in this
  phase was inferred from `task-manager-dev`'s state rather than observed — dev happened to be two
  migrations behind. Only 012-014 were pending on production. Do not infer one project's migration
  state from the other's.
- **`task_rules` was empty on production.** This was never verifiable before the merge (no
  production credentials exist in the development environment), and the risk was accepted knowingly.
  Migration 012's `add column task_id uuid not null` completing is itself the proof — it could not
  have succeeded against a non-empty table. 07-FOLLOWUPS.md F4 is closed on that evidence.

`cron.job` registration on production is not independently verified, for the same
credentials reason, but `cron.schedule('run-due-recurrences', ...)` runs inside migration 013, which
applied successfully — the migration would have failed otherwise.
