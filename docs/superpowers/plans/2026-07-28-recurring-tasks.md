# Recurring Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A task can repeat on a schedule — completing it removes it from the list, and at the next occurrence the same task row reactivates and comes back.

**Architecture:** A recurring task is one permanent `tasks` row with a 1:1 `task_rules` row holding only the schedule. A pg_cron job runs a `security definer` Postgres function every fifteen minutes that clears `completed_at` and re-dates any task whose rule is due, then rolls `next_run_at` forward by whole intervals. Nothing is ever inserted, so a repeated run cannot double-create. The recurrence UI is a Repeats section inside a new shared `<TaskFields>` component rendered by both the new-task and edit-task modals.

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind (Phase 6.5 semantic tokens), Supabase Postgres + RLS + pg_cron, zod v4, Jest + Testing Library + jest-axe, Playwright.

**Spec:** `docs/superpowers/specs/2026-07-28-recurring-tasks-design.md`

## Global Constraints

- **Timezone is `America/Los_Angeles`**, set as a function attribute on every Postgres function that does date arithmetic or casts a local timestamp. Never rely on the session default.
- **Cron cadence is `*/15 * * * *`**, job name `run-due-recurrences`.
- **`frequency` is exactly `'daily' | 'weekly' | 'monthly'`** after migration 012. `biweekly` is removed — "every two weeks" is `weekly` with `interval_count = 2`.
- **SECURITY DEFINER functions:** `set search_path = ''` is mandatory and every reference inside must be schema-qualified. Pure helpers live in `private`; anything the app or e2e suite must call by RPC lives in `public` with `execute` revoked from `public`, `anon` and `authenticated` and granted only to `service_role` (migration 009's posture).
- **Server actions** return `{ ok, error }` (`ActionResult` from `./action-result`), never throw to the caller. They authenticate with `requireUser()` and authorize the specific row with `assertTaskAssignee()` before any write. Bodies go through the existing `run()` wrapper so DB errors are logged and replaced with `GENERIC_ERROR`.
- **Client-side validation errors render inline in the open dialog, never as a toast.** An open `<dialog>` makes the rest of the document inert, toaster included (`tasks/lessons.md` L11).
- **Icons** come from `lucide-react` at `ICON_PRIMARY` (20) / `ICON_SECONDARY` (16) with `ICON_STROKE` (1.75) from `@/components/icon`.
- **Colors** use the Phase 6.5 CSS custom properties (`var(--color-…)`). No raw palette classes.
- **No local Postgres.** All SQL verification runs against the **dev** project `task-manager-dev` (`mcdpiuiayfljzvnhtqto`) inside `BEGIN … ROLLBACK`. Production (`xamdgvxziobpptcfymug`) is reached only by a deployment. Every check states which project it ran against.
- **New dependencies: none.** Timezone rendering uses `Intl` via `toLocaleString`, not a date library.

---

### Task 1: Confirm pg_cron is available on the dev project

This is the riskiest assumption in the phase and it gates everything else. If `pg_cron` cannot be created, the scheduler design is invalid and the phase goes back to brainstorming rather than forward.

**Files:**
- Create: `supabase/tests/012_pg_cron_probe.sql`

**Interfaces:**
- Consumes: nothing
- Produces: a go/no-go answer for Task 3's `cron.schedule` call

- [ ] **Step 1: Write the probe**

`supabase/tests/012_pg_cron_probe.sql`:

```sql
-- Phase 07 Task 1 — is pg_cron usable on this project?
-- Run against task-manager-dev. Rolls back: proves the extension can be created without leaving it.
begin;

select name, default_version, installed_version
from pg_available_extensions
where name = 'pg_cron';

create extension if not exists pg_cron;

select extname, extversion from pg_extension where extname = 'pg_cron';

-- The scheduler will need this schema to exist and be callable.
select has_schema_privilege(current_user, 'cron', 'usage') as can_use_cron;

rollback;
```

- [ ] **Step 2: Run it against dev**

Run it in the Supabase SQL editor for `task-manager-dev`, or via psql with the dev connection string.

Expected: `pg_available_extensions` returns one row for `pg_cron`; `create extension` succeeds; `pg_extension` shows it; `can_use_cron` is `true`.

- [ ] **Step 3: Handle the failure case**

If `create extension pg_cron` errors with a permission or availability failure, **stop the plan here**. Record the exact error in `.planning/phases/07-recurring-tasks/07-RESEARCH.md`, report it, and re-open the scheduler decision — Vercel Cron against a route handler was the runner-up. Do not proceed to Task 2 on a guess.

- [ ] **Step 4: Commit**

```bash
git add supabase/tests/012_pg_cron_probe.sql
git commit -m "test(db): probe pg_cron availability before building the scheduler"
```

---

### Task 2: Migration 012 — reshape task_rules, enable RLS, drop tasks.rule_id

The schema change and the application reads that reference `tasks.rule_id` must land together: the moment 012 applies, a query naming `rule_id` fails.

**Files:**
- Create: `supabase/migrations/012_recurring_task_rules.sql`
- Create: `supabase/tests/012_recurring_task_rules.sql`
- Modify: `supabase/seed.sql` (task_rules insert, and the T5 task insert that sets `rule_id`)
- Modify: `src/app/tasks/actions.ts:162` (select list)
- Modify: `src/app/tasks/page.tsx:97` and `:158` (select list and the RawTask mapping)
- Modify: `src/app/tasks/bucket-tasks.ts:18` (drop `rule_id` from `RawTask`)
- Modify: `docs/db.md` (task_rules section), `docs/product.md` (Recurring Tasks frequencies)

**Interfaces:**
- Consumes: `private.is_task_assignee(uuid)` from migration 007
- Produces: `task_rules(id, task_id unique, frequency, interval_count, next_run_at, is_active, default_due_offset_hours, created_at)` with RLS on; `tasks` without `rule_id`

- [ ] **Step 1: Write the verification SQL first**

`supabase/tests/012_recurring_task_rules.sql`. This fails before the migration and passes after.

```sql
-- Phase 07 Task 2 — schema shape and RLS for task_rules.
-- Run against task-manager-dev inside this transaction; nothing is kept.
begin;

-- 1. tasks.rule_id is gone
select count(*) = 0 as rule_id_dropped
from information_schema.columns
where table_schema = 'public' and table_name = 'tasks' and column_name = 'rule_id';

-- 2. task_rules holds only scheduling columns
select count(*) = 0 as denormalized_columns_dropped
from information_schema.columns
where table_schema = 'public' and table_name = 'task_rules'
  and column_name in ('title', 'description', 'workspace_id');

-- 3. task_id is unique and cascades
select
  (select count(*) = 1
     from information_schema.columns
    where table_schema = 'public' and table_name = 'task_rules'
      and column_name = 'task_id' and is_nullable = 'NO') as task_id_not_null,
  (select confdeltype = 'c'
     from pg_constraint
    where conname = 'task_rules_task_id_fkey') as cascades_on_delete;

-- 4. frequency no longer accepts biweekly, interval_count must be positive
select
  (select count(*) = 0 from pg_constraint
    where conrelid = 'public.task_rules'::regclass
      and conname = 'task_rules_frequency_check'
      and pg_get_constraintdef(oid) like '%biweekly%') as biweekly_removed,
  (select count(*) = 1 from pg_constraint
    where conrelid = 'public.task_rules'::regclass
      and conname = 'task_rules_interval_positive') as interval_guarded;

-- 5. RLS is enabled with four policies
select relrowsecurity as rls_enabled from pg_class
where oid = 'public.task_rules'::regclass;

select count(*) = 4 as four_policies from pg_policies
where schemaname = 'public' and tablename = 'task_rules';

rollback;
```

- [ ] **Step 2: Run it against dev to verify it fails**

Run: the script above, in the SQL editor for `task-manager-dev`.
Expected: FAIL — `rule_id_dropped` is `false`, `denormalized_columns_dropped` is `false`, `rls_enabled` is `false`, `four_policies` is `false`, and the `task_id` checks error or return no rows because the column does not exist yet.

- [ ] **Step 3: Write the migration**

`supabase/migrations/012_recurring_task_rules.sql`:

```sql
-- Phase 07 Task 2 — make task_rules the schedule for exactly one task, and close the RLS gap.
--
-- task_rules has existed since 001 and was never used, never secured: migration 002 enabled RLS on
-- workspaces, workspace_members, tasks, task_assignments and task_updates, and left task_rules out.
-- With no RLS and no policies the table was reachable through PostgREST by any signed-in user. It
-- is empty, so nothing was exposed, but the gap is closed here.
--
-- MODEL: a recurring task is ONE permanent tasks row. The generator (013) clears completed_at and
-- re-dates it at each occurrence, so the same card comes back with its drag order, assignees,
-- subtasks and update history intact. There is no per-occurrence row.
--
-- The FK reverses. It was tasks.rule_id -> task_rules; it is now task_rules.task_id -> tasks with
-- ON DELETE CASCADE, which is the product rule "it recurs until the task is deleted" expressed in
-- the schema: no orphan rule can outlive its task. `unique` on task_id enforces the 1:1. Exactly
-- one FK joins the two tables, so there is no second direction that can disagree with it.

alter table tasks drop column rule_id;

alter table task_rules
  -- Every one of these was a second copy of something the task row already holds, and a second
  -- copy is a thing that can drift. workspace_id is reachable through task_id.
  drop column title,
  drop column description,
  drop column workspace_id,
  add column task_id uuid not null unique references tasks(id) on delete cascade,
  -- Not cosmetic: interval_count = 0 makes 013's roll-forward loop spin forever.
  add constraint task_rules_interval_positive check (interval_count > 0),
  -- 'biweekly' is 'weekly' with interval_count 2. Two encodings of one schedule means nothing
  -- decides which a form emits.
  drop constraint task_rules_frequency_check,
  add constraint task_rules_frequency_check
      check (frequency in ('daily','weekly','monthly'));

create index task_rules_next_run_idx on task_rules (next_run_at) where is_active;

-- ---------------------------------------------------------------------------
-- RLS — a rule is visible exactly when its task is
-- ---------------------------------------------------------------------------

alter table task_rules enable row level security;

drop policy if exists "task_rules_select" on task_rules;
create policy "task_rules_select" on task_rules
  for select to authenticated
  using ( private.is_task_assignee(task_id) );

drop policy if exists "task_rules_insert" on task_rules;
create policy "task_rules_insert" on task_rules
  for insert to authenticated
  with check ( private.is_task_assignee(task_id) );

drop policy if exists "task_rules_update" on task_rules;
create policy "task_rules_update" on task_rules
  for update to authenticated
  using ( private.is_task_assignee(task_id) )
  with check ( private.is_task_assignee(task_id) );

drop policy if exists "task_rules_delete" on task_rules;
create policy "task_rules_delete" on task_rules
  for delete to authenticated
  using ( private.is_task_assignee(task_id) );
```

- [ ] **Step 4: Dry-run the migration against dev**

Run in the `task-manager-dev` SQL editor:

```sql
begin;
\i supabase/migrations/012_recurring_task_rules.sql
-- then paste the body of supabase/tests/012_recurring_task_rules.sql without its own begin/rollback
rollback;
```

(If using the web SQL editor rather than psql, paste the migration body followed by the test body between one `begin;` and one `rollback;`.)

Expected: every boolean in the verification output is `true`.

- [ ] **Step 5: Fix seed.sql**

`supabase/seed.sql` inserts into `task_rules` with `title` and a `frequency` value, and inserts task T5 with `rule_id`. Both break the moment 012 applies.

Rewrite the task_rules insert so it runs *after* T5 exists and points at it, and drop `rule_id` from the T5 insert:

```sql
-- Task rules (recurring) — one rule per task, keyed by task_id. T5 is the recurring task.
insert into task_rules (
  id,
  task_id,
  frequency,
  interval_count,
  next_run_at,
  is_active,
  default_due_offset_hours
) values (
  'd0000000-0000-0000-0000-000000000001',
  'c0000000-0000-0000-0000-000000000005',   -- T5, the recurring groceries task
  'weekly',
  1,
  now() + interval '7 days',
  true,
  null
);
```

Adjust the two uuids to the ones already in the file, keep the existing comment style, and move the block below the T5 insert so the FK resolves.

- [ ] **Step 6: Drop rule_id from the application reads**

`src/app/tasks/actions.ts:162` — `completeTask` selects `rule_id` and never uses it:

```ts
    const { data: task, error: taskError } = await admin
      .from("tasks")
      .select("parent_task_id")
      .eq("id", taskId)
      .single();
```

`src/app/tasks/page.tsx:97`:

```ts
        .select("id, title, description, due_at, completed_at, parent_task_id, workspace_id")
```

`src/app/tasks/page.tsx:158` — delete the line:

```ts
      rule_id: (t.rule_id as string | null) ?? null,
```

`src/app/tasks/bucket-tasks.ts:18` — delete the line:

```ts
  rule_id?: string | null;
```

Task 8 adds a `recurrence` field in its place; nothing needs `rule_id` in between.

- [ ] **Step 7: Run the suite and typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS. If a test asserts `rule_id` on a fixture task, delete that property — no test should assert a column that no longer exists.

- [ ] **Step 8: Update the docs the change invalidates**

`docs/db.md`, `### task_rules` section — replace the column list and notes:

```
### task_rules

id uuid primary key
task_id uuid not null unique, references tasks(id) on delete cascade

frequency text not null          daily | weekly | monthly
interval_count int not null      > 0
next_run_at timestamptz not null
is_active boolean not null

default_due_offset_hours int nullable
created_at timestamptz not null

Notes
One rule per task, one task per rule. A recurring task is a single permanent tasks row.
A scheduled function clears completed_at and re-dates the task when next_run_at is reached,
then rolls next_run_at forward by whole intervals. Nothing is inserted, so a repeated run
cannot double-create.
Deleting the task deletes the rule. That is how a recurrence is stopped for good.
All schedule arithmetic runs in America/Los_Angeles.
```

In the `## Indexing` section, replace `task_rules.workspace_id, task_rules.next_run_at` with `task_rules.next_run_at (partial, where is_active)`.

`docs/product.md`, `## Recurring Tasks` — replace the frequency list:

```
Supported frequencies:

daily
weekly
monthly

Any interval of these is allowed, so "every 3 days" and "every 2 weeks" are both expressible.

Recurring rules automatically generate task instances by reactivating the task at each occurrence.
```

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/012_recurring_task_rules.sql \
        supabase/tests/012_recurring_task_rules.sql \
        supabase/seed.sql \
        src/app/tasks/actions.ts src/app/tasks/page.tsx src/app/tasks/bucket-tasks.ts \
        docs/db.md docs/product.md
git commit -m "feat(db): make task_rules a 1:1 schedule for a task, with RLS

task_rules has been unsecured since 001 — migration 002 enabled RLS on
every other table and missed this one. Empty table, so nothing leaked,
but any signed-in user could reach it through PostgREST.

The FK reverses to task_rules.task_id with on delete cascade, so a
recurrence cannot outlive its task, and title, description and
workspace_id are dropped as second copies of what the task row holds.
biweekly goes with them: it is weekly with interval_count 2."
```

---

### Task 3: Migration 013 — the generator, the local-time upsert, and the cron job

**Files:**
- Create: `supabase/migrations/013_recurrence_generator.sql`
- Create: `supabase/tests/013_recurrence_generator.sql`

**Interfaces:**
- Consumes: the `task_rules` shape from Task 2
- Produces:
  - `private.advance_next_run(p_from timestamptz, p_frequency text, p_interval_count int) → timestamptz`
  - `public.run_due_recurrences() → integer` (count of rules processed), `service_role` only
  - `public.upsert_task_recurrence(p_task_id uuid, p_frequency text, p_interval_count int, p_first_run_local text, p_due_offset_hours int, p_is_active boolean) → void`, `service_role` only

- [ ] **Step 1: Write the verification SQL first**

`supabase/tests/013_recurrence_generator.sql`:

```sql
-- Phase 07 Task 3 — generator behaviour. Run against task-manager-dev; nothing is kept.
begin;

-- Fixtures: a workspace, a member, a task, and a rule that is already due.
insert into workspaces (id, name, kind)
values ('11111111-1111-1111-1111-111111111111', 'phase07 test', 'household');

insert into workspace_members (id, workspace_id, auth_user_id, display_name)
values ('22222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111',
        '33333333-3333-3333-3333-333333333333', 'Tester');

insert into tasks (id, workspace_id, title, completed_at)
values ('44444444-4444-4444-4444-444444444444',
        '11111111-1111-1111-1111-111111111111',
        'Take trash', now());

insert into task_assignments (task_id, member_id)
values ('44444444-4444-4444-4444-444444444444',
        '22222222-2222-2222-2222-222222222222');

insert into task_rules (id, task_id, frequency, interval_count, next_run_at, is_active)
values ('55555555-5555-5555-5555-555555555555',
        '44444444-4444-4444-4444-444444444444',
        'daily', 3, now() - interval '1 minute', true);

-- Check 2: a due rule reactivates its task and advances the schedule.
select public.run_due_recurrences() as processed;   -- expect 1

select
  (completed_at is null) as task_reactivated,
  (due_at is not null)   as due_at_set
from tasks where id = '44444444-4444-4444-4444-444444444444';

select next_run_at > now() as schedule_advanced
from task_rules where id = '55555555-5555-5555-5555-555555555555';

-- Check 4: idempotency. An immediate second call must not select the rule again.
select public.run_due_recurrences() = 0 as second_run_is_noop;

-- Check 3: overdue by three intervals produces ONE advance past now(), anchor preserved.
update task_rules
   set next_run_at = date_trunc('day', now()) - interval '9 days' + interval '9 hours'
 where id = '55555555-5555-5555-5555-555555555555';
update tasks set completed_at = now() where id = '44444444-4444-4444-4444-444444444444';

select public.run_due_recurrences() = 1 as overdue_processed;

select
  next_run_at > now()                                          as rolled_past_now,
  next_run_at < now() + interval '3 days'                      as only_one_period_ahead,
  extract(hour from next_run_at at time zone 'America/Los_Angeles') = 9 as anchor_kept
from task_rules where id = '55555555-5555-5555-5555-555555555555';

-- Check 5: an inactive rule is skipped.
update task_rules set is_active = false, next_run_at = now() - interval '1 minute'
 where id = '55555555-5555-5555-5555-555555555555';
select public.run_due_recurrences() = 0 as inactive_skipped;

-- Check 6: an already-active task is a no-op, not an error.
update task_rules set is_active = true where id = '55555555-5555-5555-5555-555555555555';
update tasks set completed_at = null where id = '44444444-4444-4444-4444-444444444444';
select public.run_due_recurrences() = 1 as active_task_is_noop;

-- Check 7: DST. 09:00 PT before the spring-forward boundary is still 09:00 PT after.
select
  extract(hour from private.advance_next_run(
    timestamptz '2027-03-13 09:00:00-08', 'daily', 1
  ) at time zone 'America/Los_Angeles') = 9 as dst_spring_holds,
  extract(hour from private.advance_next_run(
    timestamptz '2027-11-06 09:00:00-07', 'daily', 1
  ) at time zone 'America/Los_Angeles') = 9 as dst_fall_holds;

-- Check 9: interval_count = 0 is rejected.
do $$
begin
  update public.task_rules set interval_count = 0
   where id = '55555555-5555-5555-5555-555555555555';
  raise exception 'interval_count = 0 was accepted';
exception when check_violation then
  raise notice 'ok: interval_count = 0 rejected';
end $$;

-- Check 10: deleting the task deletes the rule.
delete from tasks where id = '44444444-4444-4444-4444-444444444444';
select count(*) = 0 as rule_cascaded
from task_rules where id = '55555555-5555-5555-5555-555555555555';

rollback;
```

- [ ] **Step 2: Run it against dev to verify it fails**

Run: the script above against `task-manager-dev`.
Expected: FAIL at the first `select public.run_due_recurrences()` with `function public.run_due_recurrences() does not exist`.

- [ ] **Step 3: Write the migration**

`supabase/migrations/013_recurrence_generator.sql`:

```sql
-- Phase 07 Task 3 — reactivate recurring tasks on schedule.
--
-- IDEMPOTENCY (phase success criterion 2): nothing is ever inserted, so "double-create" has no
-- mechanism. A committed run leaves next_run_at in the future, so a repeat run does not select the
-- rule at all, and `for update skip locked` means a concurrent run skips a rule already in flight
-- rather than processing it twice.
--
-- TIMEZONE: the app is Pacific. `set timezone` on these functions makes day and week arithmetic
-- resolve there, so a 9am rule stays 9am across a DST boundary. Without it the cron session runs
-- UTC and every spring and fall shift moves every recurring task by an hour.

-- ---------------------------------------------------------------------------
-- Interval arithmetic
-- ---------------------------------------------------------------------------

-- A pure helper, so it lives in `private` and is never reachable as an RPC endpoint.
-- An unknown frequency returns NULL, which fails the not-null column loudly rather than silently
-- skipping a rule. The check constraint on task_rules.frequency makes that unreachable.
create or replace function private.advance_next_run(
  p_from timestamptz,
  p_frequency text,
  p_interval_count int
)
returns timestamptz
language sql
immutable
set search_path = ''
set timezone = 'America/Los_Angeles'
as $$
  select p_from + case p_frequency
    when 'daily'   then make_interval(days   => p_interval_count)
    when 'weekly'  then make_interval(weeks  => p_interval_count)
    when 'monthly' then make_interval(months => p_interval_count)
  end;
$$;

-- ---------------------------------------------------------------------------
-- The generator
-- ---------------------------------------------------------------------------

-- In `public` rather than `private` so the e2e suite can trigger a run by RPC and assert the
-- result deterministically instead of waiting on the clock. Same grant posture as 009: execute is
-- revoked from everyone and granted to service_role only. pg_cron runs as superuser regardless.
create or replace function public.run_due_recurrences()
returns integer
language plpgsql
security definer
set search_path = ''
set timezone = 'America/Los_Angeles'
as $$
declare
  r record;
  v_next timestamptz;
  v_processed int := 0;
begin
  for r in
    select tr.id, tr.task_id, tr.next_run_at, tr.frequency, tr.interval_count,
           tr.default_due_offset_hours
      from public.task_rules tr
     where tr.is_active
       and tr.next_run_at <= now()
     order by tr.id
       for update skip locked
  loop
    begin
      -- Roll forward by whole intervals from the original anchor rather than from now(), so a rule
      -- that was missed for a week comes back on its own weekday instead of drifting to whenever
      -- the catch-up happened to run. One reactivation, never a backlog.
      v_next := r.next_run_at;
      loop
        v_next := private.advance_next_run(v_next, r.frequency, r.interval_count);
        exit when v_next > now();
      end loop;

      -- If the task was never completed this cycle, completed_at is already null and this is a
      -- no-op. That is the whole handling the "still open on day 3" case needs.
      update public.tasks
         set completed_at = null,
             due_at = r.next_run_at
                      + coalesce(make_interval(hours => r.default_due_offset_hours), interval '0')
       where id = r.task_id;

      update public.task_rules
         set next_run_at = v_next
       where id = r.id;

      v_processed := v_processed + 1;
    exception when others then
      -- Batch-item isolation, not a swallowed error: one malformed rule must not stop every other
      -- household's chores, and the failure is logged with the rule id that caused it.
      raise warning 'run_due_recurrences: rule % failed: %', r.id, sqlerrm;
    end;
  end loop;

  return v_processed;
end;
$$;

revoke execute on function public.run_due_recurrences() from public;
revoke execute on function public.run_due_recurrences() from anon;
revoke execute on function public.run_due_recurrences() from authenticated;
grant  execute on function public.run_due_recurrences() to service_role;

-- ---------------------------------------------------------------------------
-- Writing a rule, with the first run given in local time
-- ---------------------------------------------------------------------------

-- The form submits a datetime-local string with no offset ("2026-07-30T09:00"). Casting that to
-- timestamptz uses the SESSION timezone, which is UTC for the app's connections — so the same
-- string written through a plain insert would land eight hours out. This function does the cast
-- with timezone set to Pacific, which is the only place in the stack that knows what the string
-- means. Same grant posture as run_due_recurrences.
create or replace function public.upsert_task_recurrence(
  p_task_id uuid,
  p_frequency text,
  p_interval_count int,
  p_first_run_local text,
  p_due_offset_hours int,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
set timezone = 'America/Los_Angeles'
as $$
begin
  insert into public.task_rules (
    task_id, frequency, interval_count, next_run_at, default_due_offset_hours, is_active
  )
  values (
    p_task_id,
    p_frequency,
    p_interval_count,
    p_first_run_local::timestamp,   -- cast resolves in America/Los_Angeles, set above
    p_due_offset_hours,
    p_is_active
  )
  on conflict (task_id) do update
     set frequency                = excluded.frequency,
         interval_count           = excluded.interval_count,
         next_run_at              = excluded.next_run_at,
         default_due_offset_hours = excluded.default_due_offset_hours,
         is_active                = excluded.is_active;
end;
$$;

revoke execute on function public.upsert_task_recurrence(uuid, text, int, text, int, boolean) from public;
revoke execute on function public.upsert_task_recurrence(uuid, text, int, text, int, boolean) from anon;
revoke execute on function public.upsert_task_recurrence(uuid, text, int, text, int, boolean) from authenticated;
grant  execute on function public.upsert_task_recurrence(uuid, text, int, text, int, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- Schedule
-- ---------------------------------------------------------------------------

create extension if not exists pg_cron;

-- Named job: cron.schedule upserts by name, so re-running this migration updates the entry rather
-- than stacking a duplicate. Fifteen-minute granularity — a task can reappear up to fifteen minutes
-- after its occurrence.
select cron.schedule(
  'run-due-recurrences',
  '*/15 * * * *',
  $cron$select public.run_due_recurrences()$cron$
);
```

- [ ] **Step 4: Dry-run migration + verification against dev**

Run against `task-manager-dev` inside one `begin; … rollback;`: the migration body, then the fixture-and-assertion body of `supabase/tests/013_recurrence_generator.sql`.

Expected: `processed` is 1; `task_reactivated`, `due_at_set`, `schedule_advanced`, `second_run_is_noop`, `overdue_processed`, `rolled_past_now`, `only_one_period_ahead`, `anchor_kept`, `inactive_skipped`, `active_task_is_noop`, `dst_spring_holds`, `dst_fall_holds`, `rule_cascaded` are all `true`; the `interval_count = 0` block raises the `ok:` notice rather than the `raise exception`.

- [ ] **Step 5: Verify the RLS half of the story**

Still against dev, in its own `begin; … rollback;`, using the fixtures from Step 1 and the project's existing technique for impersonating a user:

```sql
set local role authenticated;
set local request.jwt.claims = '{"sub":"99999999-9999-9999-9999-999999999999"}';
select count(*) = 0 as non_assignee_sees_nothing from task_rules;

set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';
select count(*) = 1 as assignee_sees_their_rule from task_rules;
```

Expected: both `true`. This is verification check 8 from the spec.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/013_recurrence_generator.sql \
        supabase/tests/013_recurrence_generator.sql
git commit -m "feat(db): reactivate recurring tasks on schedule via pg_cron

run_due_recurrences clears completed_at and re-dates any task whose rule
is due, then rolls next_run_at forward by whole intervals from the
original anchor — one reactivation after an outage, not a backlog, and a
weekly rule keeps its weekday.

Nothing is inserted, so the phase's idempotency criterion holds
structurally: a committed run leaves next_run_at in the future and a
repeat run does not select the rule.

upsert_task_recurrence exists because a datetime-local string has no
offset and casting it uses the session timezone, which is UTC for the
app's connections. The cast belongs where Pacific is known."
```

---

### Task 4: Recurrence input contract

**Files:**
- Modify: `src/app/tasks/schemas.ts`
- Create: `src/app/tasks/schemas.recurrence.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `recurrenceSchema` — `{ frequency, intervalCount, firstRunAt, dueOffsetHours?, isActive }`
  - `setTaskRecurrenceSchema` — `{ taskId } & recurrence fields`
  - `createTaskWithSubtasksSchema` gains optional `recurrence`
  - types `RecurrenceInput`, `SetTaskRecurrenceInput`

- [ ] **Step 1: Write the failing tests**

`src/app/tasks/schemas.recurrence.test.ts`:

```ts
import { recurrenceSchema, setTaskRecurrenceSchema, createTaskWithSubtasksSchema } from "./schemas";

const validRecurrence = {
  frequency: "daily" as const,
  intervalCount: 3,
  firstRunAt: "2026-07-30T09:00",
  dueOffsetHours: 0,
  isActive: true,
};

describe("recurrenceSchema", () => {
  it("accepts an every-3-days rule", () => {
    expect(recurrenceSchema.safeParse(validRecurrence).success).toBe(true);
  });

  it("defaults isActive to true when omitted", () => {
    const { isActive, ...withoutActive } = validRecurrence;
    const parsed = recurrenceSchema.parse(withoutActive);
    expect(parsed.isActive).toBe(true);
  });

  it("rejects biweekly, which is weekly with interval 2", () => {
    const result = recurrenceSchema.safeParse({ ...validRecurrence, frequency: "biweekly" });
    expect(result.success).toBe(false);
  });

  it("rejects an interval of zero", () => {
    const result = recurrenceSchema.safeParse({ ...validRecurrence, intervalCount: 0 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/at least 1/i);
    }
  });

  it("rejects a fractional interval", () => {
    expect(recurrenceSchema.safeParse({ ...validRecurrence, intervalCount: 1.5 }).success).toBe(false);
  });

  it("rejects a date-only first run, because the time of day is the point", () => {
    expect(recurrenceSchema.safeParse({ ...validRecurrence, firstRunAt: "2026-07-30" }).success).toBe(false);
  });

  it("rejects a negative due offset", () => {
    expect(recurrenceSchema.safeParse({ ...validRecurrence, dueOffsetHours: -1 }).success).toBe(false);
  });
});

describe("setTaskRecurrenceSchema", () => {
  it("requires a task id", () => {
    expect(setTaskRecurrenceSchema.safeParse(validRecurrence).success).toBe(false);
  });

  it("accepts a task id with the recurrence fields", () => {
    const result = setTaskRecurrenceSchema.safeParse({
      taskId: "0f1e2d3c-4b5a-4968-8776-655443332211",
      ...validRecurrence,
    });
    expect(result.success).toBe(true);
  });
});

describe("createTaskWithSubtasksSchema recurrence", () => {
  const base = {
    title: "Take trash",
    workspaceId: "0f1e2d3c-4b5a-4968-8776-655443332211",
    memberIds: ["1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d"],
    subtasks: [],
  };

  it("is optional", () => {
    expect(createTaskWithSubtasksSchema.safeParse(base).success).toBe(true);
  });

  it("accepts a recurrence alongside the task", () => {
    const result = createTaskWithSubtasksSchema.safeParse({ ...base, recurrence: validRecurrence });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid recurrence rather than dropping it", () => {
    const result = createTaskWithSubtasksSchema.safeParse({
      ...base,
      recurrence: { ...validRecurrence, intervalCount: 0 },
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/app/tasks/schemas.recurrence.test.ts`
Expected: FAIL — `recurrenceSchema is not a function` / `undefined` on the imports.

- [ ] **Step 3: Add the schemas**

In `src/app/tasks/schemas.ts`, after the `memberIds` definition and before `createTaskWithSubtasksSchema`:

```ts
/**
 * A recurrence is the schedule half of a recurring task; the task row owns everything else.
 *
 * `biweekly` is deliberately absent — with a free interval count it is `weekly` with
 * `intervalCount: 2`, and two encodings of one schedule means nothing decides which the form emits.
 * Migration 012 drops it from the database check constraint for the same reason.
 */
const frequency = z.enum(["daily", "weekly", "monthly"], {
  message: "Choose days, weeks or months",
});

const intervalCount = z
  .number()
  .int("Repeat interval must be a whole number")
  .min(1, "Repeat interval must be at least 1")
  .max(365, "Repeat interval must be 365 or fewer");

/**
 * A wall-clock time with no offset, exactly as `<input type="datetime-local">` produces it. It is
 * resolved to an instant by `public.upsert_task_recurrence`, which is the only place in the stack
 * that knows the app is Pacific. Date-only is rejected: 9am versus midnight is the point of a
 * chore schedule.
 */
const firstRunAt = z.iso.datetime({
  local: true,
  message: "Start must include a date and a time",
});

const dueOffsetHours = z
  .number()
  .int("Due offset must be a whole number of hours")
  .min(0, "Due offset cannot be negative")
  .max(8760, "Due offset must be 8760 hours or fewer")
  .optional();

export const recurrenceSchema = z.object({
  frequency,
  intervalCount,
  firstRunAt,
  dueOffsetHours,
  /** Toggling Repeats off pauses rather than deletes, so the schedule survives being turned back on. */
  isActive: z.boolean().default(true),
});

export const setTaskRecurrenceSchema = recurrenceSchema.extend({ taskId: uuid });
```

Add `recurrence` to `createTaskWithSubtasksSchema`:

```ts
export const createTaskWithSubtasksSchema = z.object({
  title,
  description,
  dueAt,
  workspaceId: uuid,
  memberIds,
  subtasks: z
    .array(z.object({ title, dueAt, description }))
    .max(50, "A task cannot have more than 50 subtasks"),
  /** Present when the Repeats section is on. The task and its rule are written by one action. */
  recurrence: recurrenceSchema.optional(),
});
```

And the exported types, beside the existing ones:

```ts
export type RecurrenceInput = z.input<typeof recurrenceSchema>;
export type Recurrence = z.output<typeof recurrenceSchema>;
export type SetTaskRecurrenceInput = z.input<typeof setTaskRecurrenceSchema>;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/app/tasks/schemas.recurrence.test.ts && npm run typecheck`
Expected: PASS, 12 tests.

If `z.iso.datetime({ local: true })` is unavailable in the installed zod version, replace `firstRunAt` with an explicit pattern and keep the same message — the contract is "date and time, no offset":

```ts
const firstRunAt = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Start must include a date and a time");
```

- [ ] **Step 5: Commit**

```bash
git add src/app/tasks/schemas.ts src/app/tasks/schemas.recurrence.test.ts
git commit -m "feat(tasks): add the recurrence input contract"
```

---

### Task 5: Recurrence server actions

**Files:**
- Create: `src/app/tasks/recurring-actions.ts`
- Create: `src/app/tasks/recurring-actions.test.ts`
- Modify: `src/app/tasks/actions.ts` (`createTaskWithSubtasks`)

**Interfaces:**
- Consumes: `setTaskRecurrenceSchema`, `recurrenceSchema` (Task 4); `public.upsert_task_recurrence` (Task 3); `requireUser`, `assertTaskAssignee` from `@/lib/auth`
- Produces:
  - `setTaskRecurrence(input: SetTaskRecurrenceInput): Promise<ActionResult>`
  - `writeRecurrence(admin, taskId, recurrence): Promise<void>` — internal, shared with `createTaskWithSubtasks`
  - `createTaskWithSubtasks` accepts `input.recurrence`

- [ ] **Step 1: Write the failing tests**

`src/app/tasks/recurring-actions.test.ts`. Mirror the mocking style already used by `src/app/tasks/actions.test.ts` — read that file first and match it rather than inventing a second harness.

```ts
import { setTaskRecurrence } from "./recurring-actions";

const rpc = jest.fn();
jest.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc }),
}));

const requireUser = jest.fn();
const assertTaskAssignee = jest.fn();
jest.mock("@/lib/auth", () => ({
  ...jest.requireActual("@/lib/auth"),
  requireUser: () => requireUser(),
  assertTaskAssignee: (taskId: string, userId: string) => assertTaskAssignee(taskId, userId),
}));

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

const TASK_ID = "0f1e2d3c-4b5a-4968-8776-655443332211";
const validInput = {
  taskId: TASK_ID,
  frequency: "daily" as const,
  intervalCount: 3,
  firstRunAt: "2026-07-30T09:00",
  dueOffsetHours: 0,
  isActive: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  requireUser.mockResolvedValue({ user: { id: "user-1" } });
  assertTaskAssignee.mockResolvedValue(undefined);
  rpc.mockResolvedValue({ error: null });
});

describe("setTaskRecurrence", () => {
  it("writes the rule through the RPC that resolves local time", async () => {
    const result = await setTaskRecurrence(validInput);

    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("upsert_task_recurrence", {
      p_task_id: TASK_ID,
      p_frequency: "daily",
      p_interval_count: 3,
      p_first_run_local: "2026-07-30T09:00",
      p_due_offset_hours: 0,
      p_is_active: true,
    });
  });

  it("authorizes the specific task before writing", async () => {
    await setTaskRecurrence(validInput);
    expect(assertTaskAssignee).toHaveBeenCalledWith(TASK_ID, "user-1");
  });

  it("refuses a caller who is not an assignee, and writes nothing", async () => {
    const { ForbiddenError } = jest.requireActual("@/lib/auth");
    assertTaskAssignee.mockRejectedValue(new ForbiddenError("not assigned to task"));

    const result = await setTaskRecurrence(validInput);

    expect(result).toEqual({ ok: false, error: "not assigned to task" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects invalid input before authorizing", async () => {
    const result = await setTaskRecurrence({ ...validInput, intervalCount: 0 });

    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes a paused rule through as is_active false", async () => {
    await setTaskRecurrence({ ...validInput, isActive: false });
    expect(rpc).toHaveBeenCalledWith(
      "upsert_task_recurrence",
      expect.objectContaining({ p_is_active: false })
    );
  });

  it("reports a database failure without leaking its message", async () => {
    rpc.mockResolvedValue({ error: { message: 'relation "task_rules" does not exist' } });

    const result = await setTaskRecurrence(validInput);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain("task_rules");
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/app/tasks/recurring-actions.test.ts`
Expected: FAIL — cannot resolve `./recurring-actions`.

- [ ] **Step 3: Write the action**

`src/app/tasks/recurring-actions.ts`:

```ts
"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { requireUser, assertTaskAssignee } from "@/lib/auth";
import { parseInput, setTaskRecurrenceSchema } from "./schemas";
import type { Recurrence, SetTaskRecurrenceInput } from "./schemas";
import type { ActionResult } from "./action-result";
import { run } from "./action-run";

/**
 * Writes a task's schedule.
 *
 * The write goes through `upsert_task_recurrence` rather than a plain insert because `firstRunAt`
 * is a wall-clock string with no offset: casting it to timestamptz uses the session timezone, which
 * is UTC for these connections, and the same string would land eight hours out. The RPC does the
 * cast with timezone set to Pacific. See migration 013.
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

export async function setTaskRecurrence(
  input: SetTaskRecurrenceInput
): Promise<ActionResult> {
  return run("setTaskRecurrence", async () => {
    const { user } = await requireUser();
    const { taskId, ...recurrence } = parseInput(setTaskRecurrenceSchema, input);
    await assertTaskAssignee(taskId, user.id);

    await writeRecurrence(createAdminClient(), taskId, recurrence);

    revalidatePath("/tasks");
    return {};
  });
}
```

- [ ] **Step 4: Move `run` and `assertNoError` out of actions.ts**

Both action files need the identical error contract, and duplicating it would let the two drift. Exporting `run` from `actions.ts` is not an option: `actions.ts` imports `writeRecurrence` from `recurring-actions.ts` in Step 6, so importing `run` back the other way is an import cycle. Extract it instead.

Create `src/app/tasks/action-run.ts` — no `"use server"` directive, because this module exports a generic helper and a synchronous function, neither of which is a server action:

```ts
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
```

Delete both functions from `src/app/tasks/actions.ts` — move them, do not copy — and import them there instead:

```ts
import { run, assertNoError } from "./action-run";
```

`recurring-actions.ts` imports `run` from the same place. Its import line becomes:

```ts
import { run } from "./action-run";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest src/app/tasks/recurring-actions.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Wire recurrence into task creation**

In `src/app/tasks/actions.ts`, `createTaskWithSubtasks`. Destructure the new field:

```ts
    const { title, description, dueAt, workspaceId, memberIds, subtasks, recurrence } = parseInput(
      createTaskWithSubtasksSchema,
      input
    );
```

And after the assignment loop, before the subtask loop:

```ts
    // Inside the same action as the task insert, deliberately: a recurring task whose rule failed
    // to write is a task the user believes repeats and which never will. A thrown error here is
    // turned into { ok: false } by `run`, and the modal's optimistic row is rolled back with it.
    if (recurrence) {
      await writeRecurrence(admin, parentId, recurrence);
    }
```

Import it at the top of `actions.ts`:

```ts
import { writeRecurrence } from "./recurring-actions";
```

- [ ] **Step 7: Add a creation test**

Append to `src/app/tasks/recurring-actions.test.ts` — or to `src/app/tasks/actions.test.ts` if that file already has a `createTaskWithSubtasks` describe block, in which case add the case there and match its harness:

```ts
it("writes the rule when a task is created with a recurrence", async () => {
  const { createTaskWithSubtasks } = await import("./actions");

  await createTaskWithSubtasks({
    title: "Take trash",
    workspaceId: "0f1e2d3c-4b5a-4968-8776-655443332211",
    memberIds: ["1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d"],
    subtasks: [],
    recurrence: {
      frequency: "daily",
      intervalCount: 3,
      firstRunAt: "2026-07-30T09:00",
      isActive: true,
    },
  });

  expect(rpc).toHaveBeenCalledWith(
    "upsert_task_recurrence",
    expect.objectContaining({ p_frequency: "daily", p_interval_count: 3 })
  );
});
```

- [ ] **Step 8: Run the full suite**

Run: `npm run typecheck && npm test`
Expected: PASS. Existing `actions.test.ts` cases must be unaffected — `recurrence` is optional.

- [ ] **Step 9: Commit**

```bash
git add src/app/tasks/recurring-actions.ts \
        src/app/tasks/recurring-actions.test.ts \
        src/app/tasks/actions.ts
git commit -m "feat(tasks): add setTaskRecurrence and write rules on creation

Creation writes the task and its rule in one action, so there is no
window where a task the user asked to repeat exists without the rule
that makes it repeat — a failure rolls the optimistic row back with it."
```

---

### Task 6: Extract `<TaskFields>` — pure refactor, no behaviour change

Nothing new appears on screen in this task. The two existing modal test suites (539 and 758 lines) are the regression signal: they must pass untouched. Do not edit them.

**Files:**
- Create: `src/app/tasks/task-fields.tsx`
- Modify: `src/app/tasks/new-task-modal.tsx:211-296` (the five fields) and its local `Workspace` types
- Modify: `src/app/tasks/edit-task-modal.tsx:382-475` (the five fields)

**Interfaces:**
- Consumes: `DictationTextarea`, `useDictation`
- Produces:

```ts
export type WorkspaceMember = { id: string; display_name: string };
export type Workspace = { id: string; name: string; kind: string; members: WorkspaceMember[] };

export type TaskFieldsProps = {
  /** Namespaces every control id so both modals can be mounted in the same document. */
  idPrefix: "new-task" | "edit-task";
  title: string;
  onTitleChange: (value: string) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  dueAt: string;
  onDueAtChange: (value: string) => void;
  workspaces: Workspace[];
  workspaceId: string;
  onWorkspaceChange: (id: string) => void;
  /** Edit hides the select when there is nowhere to move to; new always shows it. */
  hideWorkspaceWhenOnlyOne?: boolean;
  /** Rendered under the workspace select — the edit modal's move warning lives here. */
  workspaceNote?: React.ReactNode;
  selectedMemberIds: string[];
  onToggleMember: (id: string) => void;
  disabled: boolean;
  dictation: ReturnType<typeof useDictation>;
};
```

- [ ] **Step 1: Run both modal suites and record the baseline**

Run: `npx jest src/app/tasks/new-task-modal.test.tsx src/app/tasks/edit-task-modal.test.tsx`
Expected: PASS. Note the test counts — the same counts must pass at the end of this task.

- [ ] **Step 2: Create the component**

`src/app/tasks/task-fields.tsx`. Move the JSX verbatim from `new-task-modal.tsx:211-296`, swapping the hard-coded `new-task-` id prefix for the prop and the local state setters for the callbacks. Keep every existing comment — they record accessibility decisions from Phase 4 and are not decoration.

```tsx
"use client";

import { DictationTextarea } from "@/components/dictation-textarea";
import { useDictation } from "@/lib/use-dictation";

export type WorkspaceMember = { id: string; display_name: string };
export type Workspace = { id: string; name: string; kind: string; members: WorkspaceMember[] };

export type TaskFieldsProps = {
  idPrefix: "new-task" | "edit-task";
  title: string;
  onTitleChange: (value: string) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  dueAt: string;
  onDueAtChange: (value: string) => void;
  workspaces: Workspace[];
  workspaceId: string;
  onWorkspaceChange: (id: string) => void;
  hideWorkspaceWhenOnlyOne?: boolean;
  workspaceNote?: React.ReactNode;
  selectedMemberIds: string[];
  onToggleMember: (id: string) => void;
  disabled: boolean;
  dictation: ReturnType<typeof useDictation>;
};

/**
 * The fields both task modals share.
 *
 * New and Edit are the same form wrapped around different lifecycles — Edit persists each section
 * through its own action and carries updates and real subtask rows, New stages everything and
 * submits once. The form was duplicated between them, so the two drifted and every field change had
 * to be made twice. This component owns the shared half and holds no state: the modals keep theirs,
 * which is what lets the lifecycles stay separate.
 */
export function TaskFields({
  idPrefix,
  title,
  onTitleChange,
  description,
  onDescriptionChange,
  dueAt,
  onDueAtChange,
  workspaces,
  workspaceId,
  onWorkspaceChange,
  hideWorkspaceWhenOnlyOne = false,
  workspaceNote,
  selectedMemberIds,
  onToggleMember,
  disabled,
  dictation,
}: TaskFieldsProps) {
  const currentWorkspace = workspaces.find((w) => w.id === workspaceId);
  const showWorkspace = !hideWorkspaceWhenOnlyOne || workspaces.length > 1;

  return (
    <>
      {/*
        Every field carries a visible label tied to its control by id. Title and details used to
        rely on their placeholder alone, which disappears the moment typing starts and is not a
        label to a screen reader; Due date, Workspace and Assign to had visible text that was
        never associated with anything.
      */}
      <div>
        <label htmlFor={`${idPrefix}-title`} className="block text-xs text-[var(--color-text-muted)] mb-1">
          Title
        </label>
        <input
          id={`${idPrefix}-title`}
          type="text"
          placeholder="Task title"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          disabled={disabled}
          className="w-full border border-[var(--color-border)] rounded-sm px-3 py-2 text-sm bg-transparent disabled:opacity-50"
        />
      </div>

      <div>
        <label htmlFor={`${idPrefix}-description`} className="block text-xs text-[var(--color-text-muted)] mb-1">
          Details (optional)
        </label>
        <DictationTextarea
          id={`${idPrefix}-description`}
          field="description"
          dictation={dictation}
          dictateLabel="Dictate task details"
          placeholder="Add details…"
          value={description}
          onChange={onDescriptionChange}
          disabled={disabled}
          rows={3}
          className="w-full border border-[var(--color-border)] rounded-sm px-3 py-2 text-sm bg-transparent resize-none disabled:opacity-50"
        />
      </div>

      <div>
        <label htmlFor={`${idPrefix}-due`} className="block text-xs text-[var(--color-text-muted)] mb-1">
          Due date (optional)
        </label>
        <input
          id={`${idPrefix}-due`}
          type="date"
          value={dueAt}
          onChange={(e) => onDueAtChange(e.target.value)}
          disabled={disabled}
          className="w-full border border-[var(--color-border)] rounded-sm px-3 py-2 text-sm bg-[var(--color-surface)] disabled:opacity-50"
        />
      </div>

      {/*
        Sits directly above Assign to because it governs that list: member rows belong to one
        workspace, so changing this changes who the task can be assigned to.
      */}
      {showWorkspace && (
        <div>
          <label htmlFor={`${idPrefix}-workspace`} className="block text-xs text-[var(--color-text-muted)] mb-1">
            Workspace
          </label>
          <select
            id={`${idPrefix}-workspace`}
            value={workspaceId}
            onChange={(e) => onWorkspaceChange(e.target.value)}
            disabled={disabled}
            className="w-full border border-[var(--color-border)] rounded-sm px-3 py-2 text-sm bg-[var(--color-surface)] disabled:opacity-50"
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          {workspaceNote}
        </div>
      )}

      {/* A group of checkboxes needs a group label, which is what fieldset/legend is for. */}
      <fieldset>
        <legend className="block text-xs text-[var(--color-text-muted)] mb-1">Assign to</legend>
        <div className="flex flex-col gap-1.5">
          {currentWorkspace?.members.map((m) => (
            <label key={m.id} className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={selectedMemberIds.includes(m.id)}
                onChange={() => onToggleMember(m.id)}
                disabled={disabled}
                className="rounded accent-[var(--color-accent)]"
              />
              {m.display_name}
            </label>
          ))}
        </div>
      </fieldset>
    </>
  );
}
```

- [ ] **Step 3: Use it from the new-task modal**

In `src/app/tasks/new-task-modal.tsx`: delete the local `WorkspaceMember` and `Workspace` type aliases and import them from `./task-fields`. Replace lines 211-296 with:

```tsx
          <TaskFields
            idPrefix="new-task"
            title={title}
            onTitleChange={setTitle}
            description={description}
            onDescriptionChange={setDescription}
            dueAt={dueAt}
            onDueAtChange={setDueAt}
            workspaces={workspaces}
            workspaceId={workspaceId}
            onWorkspaceChange={handleWorkspaceChange}
            selectedMemberIds={selectedMemberIds}
            onToggleMember={toggleMember}
            disabled={disabled}
            dictation={dictation}
          />
```

`currentWorkspace` becomes unused in this file — delete the `const currentWorkspace = …` line.

- [ ] **Step 4: Use it from the edit-task modal**

In `src/app/tasks/edit-task-modal.tsx`, replace lines 382-475 with the same call, passing `idPrefix="edit-task"`, `disabled={pending}`, `hideWorkspaceWhenOnlyOne`, and the move warning through `workspaceNote`:

```tsx
          <TaskFields
            idPrefix="edit-task"
            title={title}
            onTitleChange={setTitle}
            description={description}
            onDescriptionChange={setDescription}
            dueAt={dueAt}
            onDueAtChange={setDueAt}
            workspaces={workspaces}
            workspaceId={workspaceId}
            onWorkspaceChange={handleWorkspaceChange}
            hideWorkspaceWhenOnlyOne
            workspaceNote={
              isMove && (
                <p className="mt-1 text-2xs text-[var(--color-text-muted)]">
                  Saving moves this task
                  {subtasks.length > 0 &&
                    ` and its ${subtasks.length === 1 ? "subtask" : `${subtasks.length} subtasks`}`}{" "}
                  to {selectedWorkspace?.name} and replaces who it is assigned to. Priority order in{" "}
                  {task.workspace.name} is not kept.
                </p>
              )
            }
            selectedMemberIds={selectedMemberIds}
            onToggleMember={toggleMember}
            disabled={pending}
            dictation={dictation}
          />
```

Keep `selectedWorkspace` — the note still reads it.

- [ ] **Step 5: Run both suites unchanged**

Run: `npx jest src/app/tasks/new-task-modal.test.tsx src/app/tasks/edit-task-modal.test.tsx`
Expected: PASS, the same test counts as Step 1, with no edits to either test file. A failure here means the extraction changed behaviour — fix the component, not the test.

- [ ] **Step 6: Run everything**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/tasks/task-fields.tsx \
        src/app/tasks/new-task-modal.tsx \
        src/app/tasks/edit-task-modal.tsx
git commit -m "refactor(tasks): extract the fields both task modals share

Title, details, due date, workspace and Assign to were duplicated
verbatim between the two modals, differing only by id prefix, so every
field change had to be made twice. TaskFields holds no state — the
modals keep theirs, which is what lets New stage its subtasks and submit
once while Edit persists each section through its own action.

No behaviour change: both modal suites pass untouched."
```

---

### Task 7: The Repeats section

**Files:**
- Create: `src/app/tasks/recurrence-time.ts`
- Create: `src/app/tasks/recurrence-time.test.ts`
- Modify: `src/app/tasks/task-fields.tsx`
- Create: `src/app/tasks/task-fields.test.tsx`
- Modify: `src/app/tasks/new-task-modal.tsx` (recurrence state, submit payload)
- Modify: `src/app/tasks/edit-task-modal.tsx` (recurrence state, save)

**Interfaces:**
- Consumes: `TaskFieldsProps` (Task 6), `setTaskRecurrence` (Task 5), `recurrenceSchema` (Task 4)
- Produces:
  - `APP_TIME_ZONE = "America/Los_Angeles"`
  - `toLocalInputValue(iso: string): string` — an instant to a `datetime-local` value in Pacific
  - `defaultFirstRun(now?: Date): string` — tomorrow 09:00 Pacific, the initial value when Repeats is switched on
  - `export type RecurrenceValue = { frequency: "daily" | "weekly" | "monthly"; intervalCount: number; firstRunAt: string; dueOffsetHours: number | null }` — declared in `recurrence-time.ts`, **not** in `task-fields.tsx`. `bucket-tasks.ts` needs it too, and that module must not import a `"use client"` component.
  - `RawTask` gains `recurrence?: RecurrenceValue | null` and `recurring?: boolean`
  - `TaskFieldsProps` gains `recurrence: RecurrenceValue | null` and `onRecurrenceChange: (next: RecurrenceValue | null) => void`

- [ ] **Step 1: Design the section through ui-ux-pro-max**

Invoke the `ui-ux-pro-max` skill for the Repeats section and the recurring badge, giving it the Phase 6.5 token set (`var(--color-*)`, `ICON_PRIMARY`/`ICON_SECONDARY`/`ICON_STROKE`) and the existing modal field markup as the house style. The layout below is the contract the tests assert — labels, controls and behaviour. Take the visual treatment from the skill; do not change the accessible names.

```
↻ Repeats            [ off | on ]     checkbox, label "Repeats"
  Every  [ 3 ]  [ days ▾ ]            number + select: days / weeks / months
  Starting  [ 2026-07-30 09:00 ]      datetime-local
  Due       [ 0 ] hours after         number, optional
```

- [ ] **Step 2: Write the failing tests for the time helpers**

`src/app/tasks/recurrence-time.test.ts`:

```ts
import { toLocalInputValue, defaultFirstRun, APP_TIME_ZONE } from "./recurrence-time";

describe("toLocalInputValue", () => {
  it("renders an instant as Pacific wall-clock time", () => {
    // 2026-07-30T16:00Z is 09:00 PDT.
    expect(toLocalInputValue("2026-07-30T16:00:00Z")).toBe("2026-07-30T09:00");
  });

  it("uses PST, not PDT, in winter", () => {
    // 2026-12-30T17:00Z is 09:00 PST.
    expect(toLocalInputValue("2026-12-30T17:00:00Z")).toBe("2026-12-30T09:00");
  });

  it("does not shift the date when local time is behind UTC midnight", () => {
    // 2026-07-31T02:00Z is 2026-07-30 19:00 PDT — the previous day locally.
    expect(toLocalInputValue("2026-07-31T02:00:00Z")).toBe("2026-07-30T19:00");
  });
});

describe("defaultFirstRun", () => {
  it("is tomorrow at 09:00 local", () => {
    expect(defaultFirstRun(new Date("2026-07-30T16:00:00Z"))).toBe("2026-07-31T09:00");
  });
});

describe("APP_TIME_ZONE", () => {
  it("is the one the database functions use", () => {
    expect(APP_TIME_ZONE).toBe("America/Los_Angeles");
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx jest src/app/tasks/recurrence-time.test.ts`
Expected: FAIL — cannot resolve `./recurrence-time`.

- [ ] **Step 4: Write the helpers**

`src/app/tasks/recurrence-time.ts`:

```ts
/**
 * Converting between an instant and the wall-clock string `<input type="datetime-local">` uses.
 *
 * The app is Pacific and the database functions in migration 013 say so explicitly. The browser's
 * own timezone is deliberately not used: a user in another zone editing a household chore must see
 * the time the chore actually fires, not that instant rendered where they happen to be sitting.
 *
 * The reverse direction has no function here on purpose. A `datetime-local` value is submitted
 * verbatim and resolved by `public.upsert_task_recurrence`, which is the only place that should
 * decide what a bare wall-clock string means.
 */
export const APP_TIME_ZONE = "America/Los_Angeles";

/**
 * A task's schedule as the form holds it. Declared here rather than in `task-fields.tsx` because
 * `bucket-tasks.ts` needs the same shape and must not import a client component.
 */
export type RecurrenceValue = {
  frequency: "daily" | "weekly" | "monthly";
  intervalCount: number;
  /** Pacific wall-clock, exactly as `<input type="datetime-local">` produces it. */
  firstRunAt: string;
  dueOffsetHours: number | null;
};

/**
 * `sv-SE` formats as `YYYY-MM-DD HH:mm:ss`, which is the `datetime-local` value with a space where
 * the T goes — the shortest correct route from an instant to that format without a date library.
 */
export function toLocalInputValue(iso: string): string {
  const formatted = new Date(iso).toLocaleString("sv-SE", { timeZone: APP_TIME_ZONE });
  return formatted.slice(0, 16).replace(" ", "T");
}

/** Tomorrow at 09:00 Pacific — the value Repeats starts on rather than an empty field. */
export function defaultFirstRun(now: Date = new Date()): string {
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return `${toLocalInputValue(tomorrow.toISOString()).slice(0, 10)}T09:00`;
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `npx jest src/app/tasks/recurrence-time.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Write the failing tests for the section**

`src/app/tasks/task-fields.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe, toHaveNoViolations } from "jest-axe";
import { TaskFields } from "./task-fields";

expect.extend(toHaveNoViolations);

jest.mock("@/lib/use-dictation", () => ({
  useDictation: () => ({ stop: jest.fn(), field: null, claim: jest.fn(), supported: false }),
}));

const workspaces = [
  { id: "w1", name: "Household", kind: "household", members: [{ id: "m1", display_name: "Alice" }] },
];

function setup(overrides: Partial<React.ComponentProps<typeof TaskFields>> = {}) {
  const onRecurrenceChange = jest.fn();
  const props = {
    idPrefix: "new-task" as const,
    title: "Take trash",
    onTitleChange: jest.fn(),
    description: "",
    onDescriptionChange: jest.fn(),
    dueAt: "",
    onDueAtChange: jest.fn(),
    workspaces,
    workspaceId: "w1",
    onWorkspaceChange: jest.fn(),
    selectedMemberIds: ["m1"],
    onToggleMember: jest.fn(),
    disabled: false,
    dictation: { stop: jest.fn(), field: null, claim: jest.fn(), supported: false },
    recurrence: null,
    onRecurrenceChange,
    ...overrides,
  } as React.ComponentProps<typeof TaskFields>;

  render(<TaskFields {...props} />);
  return { onRecurrenceChange };
}

describe("Repeats", () => {
  it("is off when the task has no recurrence", () => {
    setup();
    expect(screen.getByLabelText("Repeats")).not.toBeChecked();
    expect(screen.queryByLabelText("Repeat every")).not.toBeInTheDocument();
  });

  it("switching it on proposes a daily rule starting tomorrow at 09:00", async () => {
    const { onRecurrenceChange } = setup();
    await userEvent.click(screen.getByLabelText("Repeats"));

    expect(onRecurrenceChange).toHaveBeenCalledWith(
      expect.objectContaining({
        frequency: "daily",
        intervalCount: 1,
        firstRunAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T09:00$/),
      })
    );
  });

  it("switching it off clears the recurrence", async () => {
    const { onRecurrenceChange } = setup({
      recurrence: { frequency: "daily", intervalCount: 3, firstRunAt: "2026-07-30T09:00", dueOffsetHours: null },
    });
    await userEvent.click(screen.getByLabelText("Repeats"));
    expect(onRecurrenceChange).toHaveBeenCalledWith(null);
  });

  it("shows the schedule when it is on", () => {
    setup({
      recurrence: { frequency: "weekly", intervalCount: 2, firstRunAt: "2026-07-30T09:00", dueOffsetHours: null },
    });
    expect(screen.getByLabelText("Repeat every")).toHaveValue(2);
    expect(screen.getByLabelText("Repeat unit")).toHaveValue("weekly");
    expect(screen.getByLabelText("Starting")).toHaveValue("2026-07-30T09:00");
  });

  it("offers no biweekly unit, because that is weekly every 2", () => {
    setup({
      recurrence: { frequency: "weekly", intervalCount: 1, firstRunAt: "2026-07-30T09:00", dueOffsetHours: null },
    });
    const units = Array.from(screen.getByLabelText("Repeat unit").querySelectorAll("option")).map(
      (o) => (o as HTMLOptionElement).value
    );
    expect(units).toEqual(["daily", "weekly", "monthly"]);
  });

  it("reports an interval change without dropping the rest of the rule", async () => {
    const { onRecurrenceChange } = setup({
      recurrence: { frequency: "daily", intervalCount: 1, firstRunAt: "2026-07-30T09:00", dueOffsetHours: null },
    });
    await userEvent.clear(screen.getByLabelText("Repeat every"));
    await userEvent.type(screen.getByLabelText("Repeat every"), "3");

    expect(onRecurrenceChange).toHaveBeenLastCalledWith({
      frequency: "daily",
      intervalCount: 3,
      firstRunAt: "2026-07-30T09:00",
      dueOffsetHours: null,
    });
  });

  it("has no accessibility violations with the section open", async () => {
    const { container } = render(<div />);
    setup({
      recurrence: { frequency: "daily", intervalCount: 3, firstRunAt: "2026-07-30T09:00", dueOffsetHours: null },
    });
    expect(await axe(container.ownerDocument.body)).toHaveNoViolations();
  });
});
```

- [ ] **Step 7: Run to verify they fail**

Run: `npx jest src/app/tasks/task-fields.test.tsx`
Expected: FAIL — `Unable to find a label with the text of: Repeats`.

- [ ] **Step 8: Add the section to TaskFields**

Extend `TaskFieldsProps` — import the type, do not redeclare it:

```ts
import { defaultFirstRun, type RecurrenceValue } from "./recurrence-time";
```

```ts
  recurrence: RecurrenceValue | null;
  onRecurrenceChange: (next: RecurrenceValue | null) => void;
```

Also extend `RawTask` now, in `src/app/tasks/bucket-tasks.ts`, replacing the `rule_id` line deleted in Task 2 — Step 11 below reads `task.recurrence`, so the field has to exist before the edit modal can use it:

```ts
import type { RecurrenceValue } from "./recurrence-time";
```

```ts
  /** Present when the task has an active schedule. Seeds the Repeats section in the edit modal. */
  recurrence?: RecurrenceValue | null;
  /** Whether the card shows the repeat badge. Set optimistically before `recurrence` is read back. */
  recurring?: boolean;
```

Render below the Assign-to fieldset, taking the visual treatment from Step 1:

```tsx
      {/*
        Recurrence is a property of the task, not a separate entity — one permanent task row that
        reactivates at each occurrence. Switching Repeats off in the modal clears the draft; the
        edit modal turns that into is_active = false so the schedule survives being switched back
        on, and deleting the task is what removes a recurrence for good.
      */}
      <div>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={recurrence !== null}
            onChange={() =>
              onRecurrenceChange(
                recurrence
                  ? null
                  : {
                      frequency: "daily",
                      intervalCount: 1,
                      firstRunAt: defaultFirstRun(),
                      dueOffsetHours: null,
                    }
              )
            }
            disabled={disabled}
            className="rounded accent-[var(--color-accent)]"
          />
          <Repeat size={ICON_SECONDARY} strokeWidth={ICON_STROKE} aria-hidden="true" />
          Repeats
        </label>

        {recurrence && (
          <div className="mt-2 flex flex-col gap-2 rounded-sm border border-[var(--color-border)] p-2">
            <div className="flex items-end gap-2">
              <div className="w-20">
                <label
                  htmlFor={`${idPrefix}-repeat-interval`}
                  className="block text-xs text-[var(--color-text-muted)] mb-1"
                >
                  Repeat every
                </label>
                <input
                  id={`${idPrefix}-repeat-interval`}
                  type="number"
                  min={1}
                  max={365}
                  value={recurrence.intervalCount}
                  onChange={(e) =>
                    onRecurrenceChange({
                      ...recurrence,
                      intervalCount: Number(e.target.value),
                    })
                  }
                  disabled={disabled}
                  className="w-full border border-[var(--color-border)] rounded-sm px-2 py-1 text-sm bg-transparent disabled:opacity-50"
                />
              </div>
              <div className="flex-1">
                <label
                  htmlFor={`${idPrefix}-repeat-unit`}
                  className="block text-xs text-[var(--color-text-muted)] mb-1"
                >
                  Repeat unit
                </label>
                <select
                  id={`${idPrefix}-repeat-unit`}
                  value={recurrence.frequency}
                  onChange={(e) =>
                    onRecurrenceChange({
                      ...recurrence,
                      frequency: e.target.value as RecurrenceValue["frequency"],
                    })
                  }
                  disabled={disabled}
                  className="w-full border border-[var(--color-border)] rounded-sm px-2 py-1 text-sm bg-[var(--color-surface)] disabled:opacity-50"
                >
                  {/* No biweekly: it is weekly with an interval of 2, and migration 012 drops it. */}
                  <option value="daily">days</option>
                  <option value="weekly">weeks</option>
                  <option value="monthly">months</option>
                </select>
              </div>
            </div>

            <div>
              <label
                htmlFor={`${idPrefix}-repeat-start`}
                className="block text-xs text-[var(--color-text-muted)] mb-1"
              >
                Starting
              </label>
              {/*
                datetime-local, not date: the existing due-date fields are date-only, but 9am versus
                midnight is the point of a chore schedule. The value is Pacific wall-clock and is
                resolved server-side — see recurrence-time.ts.
              */}
              <input
                id={`${idPrefix}-repeat-start`}
                type="datetime-local"
                value={recurrence.firstRunAt}
                onChange={(e) => onRecurrenceChange({ ...recurrence, firstRunAt: e.target.value })}
                disabled={disabled}
                className="w-full border border-[var(--color-border)] rounded-sm px-2 py-1 text-sm bg-[var(--color-surface)] disabled:opacity-50"
              />
            </div>

            <div>
              <label
                htmlFor={`${idPrefix}-repeat-offset`}
                className="block text-xs text-[var(--color-text-muted)] mb-1"
              >
                Due hours after it appears (optional)
              </label>
              <input
                id={`${idPrefix}-repeat-offset`}
                type="number"
                min={0}
                max={8760}
                value={recurrence.dueOffsetHours ?? ""}
                onChange={(e) =>
                  onRecurrenceChange({
                    ...recurrence,
                    dueOffsetHours: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
                disabled={disabled}
                className="w-full border border-[var(--color-border)] rounded-sm px-2 py-1 text-sm bg-transparent disabled:opacity-50"
              />
            </div>
          </div>
        )}
      </div>
```

Imports to add at the top of `task-fields.tsx`:

```tsx
import { Repeat } from "lucide-react";
import { ICON_SECONDARY, ICON_STROKE } from "@/components/icon";
import { defaultFirstRun } from "./recurrence-time";
```

- [ ] **Step 9: Run to verify they pass**

Run: `npx jest src/app/tasks/task-fields.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 10: Wire the new-task modal**

Add the import and the state, and pass it through:

```tsx
import type { RecurrenceValue } from "./recurrence-time";
```

```tsx
  const [recurrence, setRecurrence] = useState<RecurrenceValue | null>(null);
```

Add `setRecurrence(null)` to `resetForm()`. Add `recurrence` and `onRecurrenceChange={setRecurrence}` to the `<TaskFields>` call. Include it in the parsed payload in `handleSubmit`:

```tsx
      recurrence: recurrence
        ? { ...recurrence, dueOffsetHours: recurrence.dueOffsetHours ?? undefined, isActive: true }
        : undefined,
```

The optimistic `RawTask` gains the recurring flag declared in Step 8, so the badge appears on the optimistic row rather than only after the page revalidates:

```tsx
      recurring: recurrence !== null,
```

- [ ] **Step 11: Wire the edit modal**

Add the same import, plus state seeded from the task, reset alongside the existing `loadedTaskId` reset so a modal pointed at a different task never shows the previous task's schedule:

```tsx
import type { RecurrenceValue } from "./recurrence-time";
```

```tsx
  const [recurrence, setRecurrence] = useState<RecurrenceValue | null>(task.recurrence ?? null);
```

Pass `recurrence` / `onRecurrenceChange={setRecurrence}` to `<TaskFields>`. In `handleSubmit`, after the existing `updateTask` call succeeds, persist the schedule:

```tsx
      // Turning Repeats off pauses rather than deletes, so the schedule the user already set is
      // still there if they turn it back on. Deleting the task is what ends a recurrence, and the
      // FK cascade in migration 012 does that.
      if (recurrence || task.recurrence) {
        const recurrenceResult = await setTaskRecurrence({
          taskId: task.id,
          frequency: recurrence?.frequency ?? task.recurrence!.frequency,
          intervalCount: recurrence?.intervalCount ?? task.recurrence!.intervalCount,
          firstRunAt: recurrence?.firstRunAt ?? task.recurrence!.firstRunAt,
          dueOffsetHours:
            (recurrence?.dueOffsetHours ?? task.recurrence?.dueOffsetHours) ?? undefined,
          isActive: recurrence !== null,
        });

        if (!recurrenceResult.ok) {
          // Inline, not a toast. This modal is still open at this point, and an open
          // `<dialog>.showModal()` makes the rest of the document inert — the toaster included —
          // so a toast here would be unfocusable and unclickable (`tasks/lessons.md` L11).
          setFormError(recurrenceResult.error);
          return;
        }
      }
```

- [ ] **Step 12: Run everything**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS. Both modal suites still green.

- [ ] **Step 13: Commit**

```bash
git add src/app/tasks/recurrence-time.ts src/app/tasks/recurrence-time.test.ts \
        src/app/tasks/task-fields.tsx src/app/tasks/task-fields.test.tsx \
        src/app/tasks/new-task-modal.tsx src/app/tasks/edit-task-modal.tsx
git commit -m "feat(tasks): let a task repeat, from either modal

Written once in TaskFields, so New and Edit cannot drift. Start is a
datetime-local in Pacific wall-clock — the time of day is the point of a
chore schedule, and the instant is resolved server-side where the
timezone is known."
```

---

### Task 8: Read recurrence on the tasks page and badge the card

**Files:**
- Modify: `src/app/tasks/page.tsx` (new query, RawTask mapping)
- Modify: the task card in `src/app/tasks/tasks-page-client.tsx`
- Modify: `src/app/tasks/tasks-page-client.test.tsx` (badge cases)

**Interfaces:**
- Consumes: `task_rules` (Task 2); `toLocalInputValue` and `RawTask.recurrence` / `RawTask.recurring` (Task 7)
- Produces: nothing consumed by later tasks — this task fills fields Task 7 declared

- [ ] **Step 1: Write the failing badge tests**

Add to `src/app/tasks/tasks-page-client.test.tsx`, matching the existing fixture helper in that file rather than building a new one:

```tsx
it("marks a recurring task with a repeat badge", () => {
  renderWithTasks([makeTask({ id: "t1", title: "Take trash", recurring: true })]);
  expect(screen.getByLabelText("Repeats")).toBeInTheDocument();
});

it("leaves a one-off task unbadged", () => {
  renderWithTasks([makeTask({ id: "t2", title: "Pay rent" })]);
  expect(screen.queryByLabelText("Repeats")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/app/tasks/tasks-page-client.test.tsx -t "repeat badge"`
Expected: FAIL — no element with that accessible name.

- [ ] **Step 3: Query the rules**

In `src/app/tasks/page.tsx`, after Query 3b:

```ts
  // Query 3c: recurrence for these tasks. RLS scopes task_rules to tasks the user is assigned to,
  // so this needs no membership filter of its own.
  const { data: rulesData } = myTaskIds.length
    ? await supabase
        .from("task_rules")
        .select("task_id, frequency, interval_count, next_run_at, default_due_offset_hours, is_active")
        .in("task_id", myTaskIds)
        .eq("is_active", true)
    : { data: [] };

  const recurrenceByTaskId: Record<string, NonNullable<RawTask["recurrence"]>> = {};
  (rulesData ?? []).forEach((r) => {
    recurrenceByTaskId[r.task_id as string] = {
      frequency: r.frequency as "daily" | "weekly" | "monthly",
      intervalCount: r.interval_count as number,
      firstRunAt: toLocalInputValue(r.next_run_at as string),
      dueOffsetHours: (r.default_due_offset_hours as number | null) ?? null,
    };
  });
```

Import the helper: `import { toLocalInputValue } from "./recurrence-time";`

In the `rawTasks` mapping, replacing the deleted `rule_id` line:

```ts
      recurrence: recurrenceByTaskId[t.id] ?? null,
      recurring: Boolean(recurrenceByTaskId[t.id]),
```

- [ ] **Step 4: Badge the card**

In the task card markup in `src/app/tasks/tasks-page-client.tsx`, beside the title:

```tsx
                    {task.recurring && (
                      <Repeat
                        size={ICON_SECONDARY}
                        strokeWidth={ICON_STROKE}
                        aria-label="Repeats"
                        className="shrink-0 text-[var(--color-text-muted)]"
                      />
                    )}
```

`aria-label` rather than `aria-hidden`: the badge carries information the card states nowhere else, so it must be announced. Import `Repeat` from `lucide-react` and the size tokens from `@/components/icon` if they are not already imported in this file.

- [ ] **Step 5: Run to verify they pass**

Run: `npx jest src/app/tasks/tasks-page-client.test.tsx`
Expected: PASS, including the two new cases.

- [ ] **Step 6: Run everything**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/tasks/page.tsx src/app/tasks/bucket-tasks.ts \
        src/app/tasks/tasks-page-client.tsx src/app/tasks/tasks-page-client.test.tsx
git commit -m "feat(tasks): show which tasks repeat"
```

---

### Task 9: End-to-end verification

**Files:**
- Create: `e2e/recurring.spec.ts`
- Modify: `e2e/fixtures.ts` (`cleanupUiWrites` must clear rules written by the UI)
- Modify: `e2e/screenshots.spec.ts-snapshots/` (regenerated, not hand-edited)

**Interfaces:**
- Consumes: `adminClient()`, `E2E_TAG`, `cleanupUiWrites()` from `e2e/fixtures.ts`; `public.run_due_recurrences()` (Task 3)
- Produces: nothing consumed by later tasks

- [ ] **Step 1: Write the spec**

`e2e/recurring.spec.ts`. Read `e2e/task-flow.spec.ts` first and match its fixture and selector conventions.

```ts
import { test, expect } from "@playwright/test";
import { adminClient, E2E_TAG, cleanupUiWrites } from "./fixtures";

test.afterEach(async () => {
  await cleanupUiWrites();
});

test("a task can be created as recurring and shows the badge", async ({ page }) => {
  await page.goto("/tasks");
  await page.getByRole("button", { name: /new task/i }).click();

  await page.getByLabel("Title").fill(`${E2E_TAG} Take trash`);
  await page.getByLabel("Repeats").check();
  await page.getByLabel("Repeat every").fill("3");
  await page.getByLabel("Repeat unit").selectOption("daily");

  await page.getByRole("button", { name: /add task/i }).click();

  const card = page.getByText(`${E2E_TAG} Take trash`).locator("..");
  await expect(card.getByLabel("Repeats")).toBeVisible();
});

test("completing a recurring task and running the generator brings it back", async ({ page }) => {
  const admin = adminClient();
  const title = `${E2E_TAG} Water plants`;

  await page.goto("/tasks");
  await page.getByRole("button", { name: /new task/i }).click();
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Repeats").check();
  await page.getByRole("button", { name: /add task/i }).click();

  await expect(page.getByText(title)).toBeVisible();

  // Complete it — it leaves the active list.
  await page.getByRole("button", { name: new RegExp(`complete ${title}`, "i") }).click();
  await expect(page.getByRole("heading", { name: /completed/i })).toBeVisible();

  // Make the rule due, then run the generator deterministically rather than waiting on cron.
  const { data: task } = await admin.from("tasks").select("id").eq("title", title).single();
  await admin
    .from("task_rules")
    .update({ next_run_at: new Date(Date.now() - 60_000).toISOString() })
    .eq("task_id", task!.id);

  const { data: processed, error } = await admin.rpc("run_due_recurrences");
  expect(error).toBeNull();
  expect(processed).toBeGreaterThanOrEqual(1);

  // Same row, back on the active list.
  await page.reload();
  const { data: after } = await admin
    .from("tasks")
    .select("id, completed_at")
    .eq("id", task!.id)
    .single();
  expect(after!.id).toBe(task!.id);
  expect(after!.completed_at).toBeNull();
  await expect(page.getByText(title)).toBeVisible();
});

test("a recurrence can be turned off from the edit modal", async ({ page }) => {
  const admin = adminClient();
  const title = `${E2E_TAG} Sweep porch`;

  await page.goto("/tasks");
  await page.getByRole("button", { name: /new task/i }).click();
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Repeats").check();
  await page.getByRole("button", { name: /add task/i }).click();

  await page.getByText(title).click();
  await page.getByLabel("Repeats").uncheck();
  await page.getByRole("button", { name: /save/i }).click();

  const { data: task } = await admin.from("tasks").select("id").eq("title", title).single();
  const { data: rule } = await admin
    .from("task_rules")
    .select("is_active")
    .eq("task_id", task!.id)
    .single();

  // Paused, not deleted — turning Repeats back on restores the schedule.
  expect(rule!.is_active).toBe(false);
});
```

- [ ] **Step 2: Extend cleanup**

`task_rules` cascades when its task is deleted, so `cleanupUiWrites()` needs no rule-specific delete **if** it already deletes tasks by the tag. Read it and confirm. If it deletes assignments and tasks by title prefix, nothing changes; if it only deletes assignments, add the task delete. Leftover rows are invisible to the spec that wrote them and break every spec that runs later.

- [ ] **Step 3: Run the suite**

Run: `npm run test:e2e`
Expected: PASS on chromium, WebKit, Firefox and the iPhone profile.

If the second test is flaky on the reload, the cause is the page reading before the RPC commits — wait on the assertion against the database (already present) before `page.reload()`, do not add a sleep.

- [ ] **Step 4: Regenerate the screenshot baselines**

Repeats changes both modals, so the Phase 6.5 baselines no longer match.

Run: `npx playwright test screenshots --update-snapshots`
Then open the regenerated PNGs in `e2e/screenshots.spec.ts-snapshots/` and confirm the only difference is the Repeats section. A diff anywhere else means Task 6's extraction changed layout — fix the component rather than accepting the baseline.

- [ ] **Step 5: Commit**

```bash
git add e2e/recurring.spec.ts e2e/fixtures.ts e2e/screenshots.spec.ts-snapshots
git commit -m "test(e2e): cover creating, reactivating and pausing a recurrence

The generator is triggered by RPC rather than by waiting on cron, which
is why run_due_recurrences is granted to service_role."
```

---

### Task 10: Deploy and close the phase

**Files:**
- Modify: `.planning/ROADMAP.md`, `.planning/STATE.md`
- Modify: `tasks/lessons.md` (only if the phase produced a lesson)
- Create: `.planning/phases/07-recurring-tasks/07-VERIFICATION.md`

- [ ] **Step 1: Apply the migrations to dev for real**

The dry-runs in Tasks 2 and 3 rolled back. Apply them properly to `task-manager-dev` and confirm:

Run: `supabase migration list --linked`
Expected: 012 and 013 listed as applied on both local and remote columns for the dev project.

- [ ] **Step 2: Confirm the cron job is registered**

```sql
select jobname, schedule, active, command from cron.job where jobname = 'run-due-recurrences';
```

Expected: one row, `*/15 * * * *`, `active` true.

- [ ] **Step 3: Write the verification record**

`.planning/phases/07-recurring-tasks/07-VERIFICATION.md`: the ten SQL checks with their actual output, which project each ran against, the jest and e2e results, and anything that failed first and why. Record what turned out not to be true, not only what passed.

- [ ] **Step 4: Deploy to production**

Merge to `main` and let `.github/workflows/deploy-migrations.yml` apply 012 and 013 to production. Then confirm against production:

Run: `supabase migration list --linked` against `xamdgvxziobpptcfymug`, plus the `cron.job` query from Step 2.
Expected: 012 and 013 applied, job registered. Dev and production are separate projects — state which one each result came from.

- [ ] **Step 5: Update the roadmap and state**

In `.planning/ROADMAP.md`, mark Phase 7 complete with the date, fill in its Plans list, and update the progress table row and the completed-phase count.

In `.planning/STATE.md`, update `stopped_at`, `progress`, Current Position, and add to Decisions:

```
- [Phase 07-recurring-tasks]: A recurring task is ONE task row that reactivates, not a stream of
  generated instances — so idempotency is structural (nothing is inserted) rather than a constraint
  to maintain
- [Phase 07-recurring-tasks]: task_rules.task_id -> tasks on delete cascade, reversing the original
  FK, because "recurs until deleted" is a database rule and an orphan rule is unrepresentable
- [Phase 07-recurring-tasks]: `biweekly` dropped from the frequency enum — it is `weekly` with
  interval 2, and two encodings of one schedule means nothing decides which the form emits
- [Phase 07-recurring-tasks]: datetime-local strings are resolved to instants by
  public.upsert_task_recurrence, not in TypeScript — the session timezone for app connections is
  UTC, so the cast has to happen where Pacific is known
```

Under Blockers/Concerns, add the two accepted limitations:

```
- Monthly recurrence drifts on month-end anchors: `interval '1 month'` moves Jan 31 to Feb 28 and it
  stays on the 28th. Needs a day-of-month anchor column to fix. Accepted in Phase 07.
- Recurrence has no per-occurrence history. The one-row model means nothing records that a given
  occurrence was completed; task_updates cannot fill it because member_id is not null and the
  generator does not know who completed the task. Accepted in Phase 07.
```

- [ ] **Step 6: Commit**

```bash
git add .planning/ROADMAP.md .planning/STATE.md \
        .planning/phases/07-recurring-tasks/07-VERIFICATION.md
git commit -m "docs(planning): close Phase 7 — recurring tasks"
```

---

## Deferred, deliberately

These are out of scope per the spec. Do not add them mid-plan; raise them as followups.

- Per-occurrence history of completions.
- A day-of-month anchor so monthly rules survive month-end.
- Multiple timezones (one Pacific constant, in the migrations).
- A dedicated recurring-tasks screen — recurrence is reachable from both modals.
- Rotating assignees between members per occurrence.
- Backfilling missed occurrences.
