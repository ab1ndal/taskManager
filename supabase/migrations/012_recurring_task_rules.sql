-- Phase 07 Task 2 — make task_rules the schedule for exactly one task, and close the RLS gap.
--
-- task_rules has existed since 001 and was never used: migration 002 enabled RLS on workspaces,
-- workspace_members, tasks, task_assignments and task_updates, and left task_rules out. On dev,
-- the table's RLS bit is on but was flipped outside migration history (no migration before this
-- one touches it), leaving it with zero policies -- default-deny for non-superuser roles, so dev
-- was not actually reachable despite the gap in the ledger. Production's RLS state has not been
-- checked. Either way, with no policies the table's access rule was undefined rather than
-- deliberate. It is empty, so nothing is known to have been exposed, but the gap is closed here.
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
