# Recurring Tasks — Design

**Phase**: 7 (Recurring Tasks)
**Date**: 2026-07-28
**Requirement**: TASK-08 (`docs/product.md` → Recurring Tasks)
**Status**: approved, ready for planning

## Problem

A household chore repeats. "Take trash" on a three-day cycle should leave the list when it is done
and return to the list when the next occurrence comes due, without anyone recreating it.

Today nothing generates tasks. `task_rules` has existed since migration 001 but no code reads or
writes it, and — found during this design — **RLS was never enabled on it**. Migration 002 turns RLS
on for `workspaces`, `workspace_members`, `tasks`, `task_assignments` and `task_updates`;
`task_rules` is absent from that list and has no policies. The table is empty, so nothing is
exposed, but the gap is closed in this phase.

## Model: one task that reactivates

A recurring task is **one permanent task row**. Completing it sets `completed_at`; when the next
occurrence arrives the generator clears `completed_at` and re-dates the task, so the same card
returns to the list. It keeps its identity: drag order (`member_sort_key`), assignees, subtasks and
update history all survive across occurrences.

The recurrence lives until the task is deleted. There is no per-occurrence row.

**Accepted cost**: no per-occurrence history. Nothing records that day 1's trash was taken.
`task_updates` cannot fill the gap — its `member_id` is `not null` and the generator does not know
who completed the task.

**Rejected alternative**: one task row per occurrence, with completed instances accumulating in the
Completed section. It gives real history, but it needs a `scheduled_for` column plus a unique index
to stay idempotent, a new row starts at the bottom of the user's drag order, and it does not match
the requested behaviour of the same card coming back.

## Data model — migration `012_recurring_tasks.sql`

All recurrence state lives in `task_rules`, keyed off the task. **`tasks` gains no columns.**

```sql
alter table tasks drop column rule_id;

alter table task_rules
  drop column title,             -- the task row owns the title
  drop column description,       -- the task row owns the description
  drop column workspace_id,      -- derivable from the task
  add column task_id uuid not null unique references tasks(id) on delete cascade,
  add constraint task_rules_interval_positive check (interval_count > 0),
  drop constraint task_rules_frequency_check,
  add constraint task_rules_frequency_check
      check (frequency in ('daily','weekly','monthly'));

create index task_rules_next_run_idx on task_rules (next_run_at) where is_active;
```

Every dropped column was a second copy of something the task row already holds, and a second copy
is a thing that can drift. What remains is only what the task does not know: `frequency`,
`interval_count`, `next_run_at`, `is_active`, `default_due_offset_hours`.

**The FK reverses.** It was `tasks.rule_id → task_rules`; it becomes
`task_rules.task_id → tasks on delete cascade`. That is the "until deleted" rule expressed in the
schema — delete the task and the recurrence goes with it, leaving no orphan rule pointing at
nothing. `unique` on `task_id` enforces 1:1. There is exactly one FK between the two tables, so no
two directions can disagree.

`check (interval_count > 0)` is not cosmetic: a zero would make the roll-forward loop in the
generator spin forever.

`biweekly` is **dropped from the `frequency` check constraint**. With a free interval count, "every
two weeks" is already `weekly × 2`; keeping `biweekly` means two encodings of one schedule and
nothing deciding which a form emits. `docs/product.md` and `docs/db.md` both list it and are updated
in the same change.

The table is empty and referenced by no application code, so all of this is safe. `supabase/seed.sql`
does reference the dropped columns (`task_rules.title`, `task_rules.frequency` with a `biweekly`
value, and `tasks.rule_id`) and is updated in the same change — otherwise seeding breaks the moment
012 lands.

### RLS

```sql
alter table task_rules enable row level security;
```

Four policies, all `private.is_task_assignee(task_id)` — the helper migration 007 already defines.
A rule is visible exactly when its task is; no new visibility rule, no new helper.

## Generation — same migration

### Interval arithmetic

`private.advance_next_run(from timestamptz, frequency text, interval_count int) → timestamptz`,
immutable SQL:

| frequency | step |
|---|---|
| `daily` | `interval_count` days |
| `weekly` | `interval_count` weeks |
| `monthly` | `interval_count` months |

"Every 3 days" is `daily` with `interval_count = 3`.

### The generator

`public.run_due_recurrences()`, `security definer`, `set search_path = ''`,
`set timezone = 'America/Los_Angeles'`.

It lives in `public` with `execute` revoked from `public`, `anon` and `authenticated` and granted
only to `service_role` — the grant posture migration 009 established, so the e2e suite can trigger
generation by RPC. pg_cron runs as superuser and is unaffected.

```
for each rule where is_active and next_run_at <= now()
    order by id for update skip locked:

    v_next := next_run_at
    repeat v_next := advance(v_next) until v_next > now()

    update tasks
       set completed_at = null,
           due_at = <this occurrence> + coalesce(offset_hours, 0)
     where id = rule.task_id

    update task_rules set next_run_at = v_next where id = rule.id
```

**Roll-forward, not backfill.** A rule three days overdue produces one reactivation, not three. The
loop advances by whole intervals from the original anchor, so a weekly rule stays on its weekday
rather than drifting to whenever the catch-up ran.

**Idempotency comes from the loop predicate.** After a run commits, `next_run_at` is in the future,
so a repeat run does not select the rule at all. `for update skip locked` covers the concurrent
case — a second run in flight skips locked rules rather than double-processing them. Nothing is
ever inserted, so "double-create" has no mechanism. This satisfies phase success criterion 2
structurally rather than by a check.

**Never-completed case needs no special handling.** If the task is still open on day 3,
`completed_at` is already null and setting it to null is a no-op.

**Per-rule fault isolation.** The loop body is wrapped in an exception block that `raise warning`s
the rule id and continues, returning the count that succeeded. One malformed rule must not stop
every other household's chores. This is batch-item isolation with a logged failure, not a swallowed
error.

### Timezone

The app is Pacific. `set timezone = 'America/Los_Angeles'` on the function makes day and week
arithmetic resolve in that zone, so a 9am daily rule stays 9am across a DST boundary. Without it the
cron session runs UTC and every spring and fall shift moves every recurring task by an hour.

One place, in the migration, named — that is where the single-timezone assumption is enforced. If
the app ever spans zones the change is a `timezone` column on `task_rules`, passed per rule. Not
built now.

### Scheduling

```sql
create extension if not exists pg_cron;
select cron.schedule('run-due-recurrences', '*/15 * * * *',
                     $$select public.run_due_recurrences()$$);
```

Named job, so re-running the migration updates rather than duplicates it. Fifteen-minute
granularity: a task can reappear up to fifteen minutes after its occurrence.

## Server actions

New file `src/app/tasks/recurring-actions.ts`, following Phase 3 conventions: `{ ok, error }`
results rather than throws, zod validation at the boundary, `src/lib/auth.ts` assertions before any
write, DB errors logged server-side and replaced with a generic message.

**`createTaskWithSubtasks` gains an optional `recurrence` field.** A new recurring task creates task
and rule in one action with one failure mode, so there is no window where the task exists without
the recurrence the user asked for. Extending the existing action beats adding a second call.

**`setTaskRecurrence(taskId, { frequency, intervalCount, firstRunAt, dueOffsetHours, isActive })`** —
upserts the rule from the edit modal, on the unique `task_id`. Toggling Repeats off writes
`is_active = false` rather than deleting, so toggling back on restores the schedule already set.

There is no `clearTaskRecurrence`: deleting the task is what removes a recurrence for good, and the
FK cascade does it.

**Authorization**: caller must be authenticated and an assignee of the specific task named — the
same rule `private.is_task_assignee` enforces in RLS, asserted in the action as well so it holds
whichever client is used.

**Validation** goes in `src/app/tasks/schemas.ts` beside the existing schemas: `frequency` limited to
the DB values, `intervalCount` a positive integer with a sane upper bound, `firstRunAt` required,
`dueOffsetHours` optional and non-negative. The same schema backs the form, so client and server
cannot disagree.

**Reads**: not a left join — a separate query. The tasks page issues its own `select ... from
task_rules where task_id in (...)` (page.tsx, Query 3c) keyed off the task ids the first query
already returned, and the results are merged into each task by `task_id` in application code. A
task carries its recurrence, if any, either way; the mechanism is two queries plus a merge, not a
join in the SQL itself.

## UI

### Reconciling the two modals

`new-task-modal.tsx` (414 lines) and `edit-task-modal.tsx` (795 lines) duplicate roughly 90 lines
verbatim — title, details with dictation, due date, workspace select, Assign-to fieldset — differing
only by `new-task-` / `edit-task-` id prefixes, plus the `getInitialMembers` / `handleWorkspaceChange`
/ `toggleMember` helpers behind them. Adding Repeats to both would make that two more copies.

They are not otherwise the same component. Edit is not new-plus-updates:

| | New task | Edit task |
|---|---|---|
| Subtasks | staged in a local array, sent with the parent | persisted rows, each with its own server action, inline edit, toggle, delete-confirm |
| Submit | one `createTaskWithSubtasks` call | per-section actions, plus the `isMove` workspace-move warning |
| Optimistic | insert then roll back on failure | nothing optimistic to roll back |
| Updates | — | fetched on open, optimistic append |

Same form, different lifecycle. So the shared part is extracted and the two shells stay.

**`src/app/tasks/task-fields.tsx`** — new `<TaskFields>`, fully controlled, holding no state of its
own. Props: `idPrefix`, value+onChange pairs for title, description, dueAt, workspaceId and
memberIds, the `workspaces` list, `disabled`, the shared `dictation` controller, and `recurrence` +
`onRecurrenceChange`. One `workspaceNote?: ReactNode` slot lets the edit modal render its move
warning under the workspace select without that edit-only concern leaking into the shared component.
`getInitialMembers` and `toggleMember` move in with it.

Expected shape after the change:

```
src/app/tasks/
  task-fields.tsx      NEW  ~180   title, details, due, workspace,
                                   assignees, Repeats
  new-task-modal.tsx   414 → ~320  staged subtasks, one submit, optimistic
  edit-task-modal.tsx  795 → ~700  updates, persisted subtasks, move warning
```

Both existing test suites (539 and 758 lines) must stay green through the extraction — that is the
regression signal for the refactor.

**Rejected**: a single `TaskModal` with a `mode` prop. It matches the "new task is just a task with
no updates" intuition, but the two lifecycles differ in subtasks, submit and optimistic handling, so
the merged file lands near 1,000 lines with mode branches through the middle, and both test suites
have to be rewritten against it.

### The Repeats section

Inside `TaskFields`, so it is written once and appears in both modals:

```
↻ Repeats            [ off | on ]
  Every  [ 3 ]  [ days ▾ ]        days / weeks / months
  Starting  [ 2026-07-30 09:00 ]  datetime-local, Pacific
  Due       [ 0 ] hours after     optional
```

First run is `datetime-local`, not `date` — the existing due-date fields are date-only, but 9am
versus midnight is the whole point of a chore schedule.

**Repeat badge** on recurring task cards: lucide `Repeat` at `ICON_SECONDARY` / `ICON_STROKE`,
matching the Phase 6.5 icon convention. Driven by the `task_rules` query above.

### Retrofit: three states on one checkbox

A rule is one of three states — no rule, paused (`is_active = false`), active — but the UI has one
toggle. That toggle cannot be driven by `recurrence`'s nullness alone: the read is deliberately
unfiltered on `is_active` (a paused rule still has to reach the edit modal with its stored cadence,
or re-enabling it would overwrite that cadence with fresh defaults), so `recurrence` is non-null in
both the paused and active cases and null only when no rule exists at all. That collapses two of the
three states onto the same value.

The fix actually shipped splits the checkbox's own state from the schedule's stored values:
`recurrenceEnabled` (on/off, i.e. what the checkbox shows and what becomes `is_active` on write) is
held apart from `recurrence` (the draft/stored schedule fields). Turning the checkbox off never
clears `recurrence` — that is what lets re-enabling it restore the same cadence instead of
`TaskFields` seeding new defaults over a value that was wiped. `task-fields.tsx`'s
`handleToggleRecurrence` only seeds defaults the first time the checkbox goes on and `recurrence` is
still null (a task that never had a rule); every other transition leaves `recurrence` as the user or
the loaded task left it.

This was not anticipated at plan time — the plan above still describes `recurrence` as the only
prop. It is the most consequential UI decision of the phase and previously lived only in code
comments (`edit-task-modal.tsx`, `task-fields.tsx`), not here.

The Repeats section and the badge are built through the **ui-ux-pro-max** skill against the Phase
6.5 token system rather than styled ad hoc.

## Error handling

- Actions return `{ ok, error }`; DB detail is logged server-side and a generic message goes to the
  client (Phase 3).
- Client validation errors render **inline in the open dialog, never as a toast**. An open
  `<dialog>` makes everything else in the document inert, the toaster included
  (`tasks/lessons.md` L11).
- Generator: per-rule `raise warning` and continue, returning the success count. Cron-level failures
  surface in `cron.job_run_details`.
- A new recurring task rides inside `createTaskWithSubtasks`, so the existing optimistic rollback
  covers it. No separate failure path.

## Verification

### SQL, against `task-manager-dev`, in `BEGIN … ROLLBACK`

There is no local Postgres here, so DB verification runs against the dev project with SQL executed
as the `authenticated` role via `set local request.jwt.claims`.

1. **pg_cron availability — run first, before any other work is started.** If
   `create extension pg_cron` is blocked at the platform level, the scheduler choice is invalid and
   the design changes. This is the riskiest assumption in the phase.
2. Due rule → `completed_at` cleared, `due_at` set, `next_run_at` advanced one interval.
3. Overdue by three intervals → one advance past `now()`, time-of-day anchor unchanged.
4. Immediate second call → no change. Idempotency.
5. `is_active = false` → skipped.
6. Already-active task → no-op, no error.
7. DST: rule anchored 09:00 PT, advanced across the March and November boundaries → still 09:00 PT.
8. RLS: a non-assignee sees zero `task_rules` rows; the assignee sees theirs.
9. `interval_count = 0` rejected by the check constraint.
10. Delete the task → rule row gone by cascade.

### Jest

Recurrence zod schemas and bounds; `TaskFields` rendered under both id prefixes; jest-axe on it
(Phase 4 convention); `setTaskRecurrence` action tests mirroring `actions.test.ts`; both existing
modal suites green through the extraction.

### Playwright e2e

Create a recurring task in the new-task modal and assert the badge appears; round-trip the edit
modal; then complete the task, call `run_due_recurrences()` by RPC with the service-role key, and
assert the task returns to the active list. That RPC path is why the function sits in `public` with
a `service_role`-only grant.

Specs clean their own rows via `cleanupUiWrites()`. Leftovers are invisible to the spec that wrote
them and break every spec that runs later.

### Screenshot baselines

Repeats changes both modals, so the chromium and iPhone baselines are regenerated with
`npx playwright test screenshots --update-snapshots`.

### Deployment

Migration 012 is dry-run against dev inside `BEGIN … ROLLBACK`, then applied through
`.github/workflows/deploy-migrations.yml`. Dev and production are separate Supabase projects at
different migration states; every check states which project it ran against.

## Out of scope

- **Per-occurrence history.** Accepted cost of the one-row model, above.
- **Monthly anchor drift.** `interval '1 month'` moves a Jan-31 rule to Feb-28 and it stays on the
  28th. Fixing it needs a day-of-month anchor column. Unrelated to timezone.
- **Multiple timezones.** Single Pacific constant, in the migration.
- **A dedicated recurring-tasks screen.** Recurrence is a property of a task, reachable from both
  modals; a separate list is a filter on the existing one.
- **Rotating assignees** between household members per occurrence.
- **Backfilling missed occurrences.**

## Success criteria (from ROADMAP.md Phase 7)

1. A rule produces the next instance on schedule — the task reactivates at `next_run_at`, verified
   by SQL checks 2 and 3 and by the e2e RPC test.
2. The generator is idempotent for a repeated `next_run_at` — a retry cannot double-create.
   Satisfied structurally: nothing is inserted, and a committed run leaves `next_run_at` in the
   future so a repeat run does not select the rule. Verified by SQL check 4.
