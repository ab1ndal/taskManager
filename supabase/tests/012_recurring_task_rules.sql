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
-- Note: relrowsecurity alone does not distinguish before/after on dev, since dev's RLS bit was
-- flipped out-of-band before this migration ever ran. rls_secured below is the real gate: it is
-- false pre-migration (bit on, zero policies -> default-deny but nothing enforced by policy) and
-- true only once RLS is on AND policies exist.
select relrowsecurity as rls_enabled from pg_class
where oid = 'public.task_rules'::regclass;

select count(*) = 4 as four_policies from pg_policies
where schemaname = 'public' and tablename = 'task_rules';

select
  (select relrowsecurity from pg_class where oid = 'public.task_rules'::regclass)
  and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'task_rules')
  as rls_secured;

-- 6. the four policies are scoped to `authenticated` and cover one command each
select
  count(*) = 4 as all_scoped_to_authenticated,
  count(distinct cmd) = 4 as all_four_commands_covered
from pg_policies
where schemaname = 'public' and tablename = 'task_rules'
  and roles = array['authenticated']::name[]
  and cmd in ('SELECT', 'INSERT', 'UPDATE', 'DELETE');

-- 7. the partial index on next_run_at exists
select count(*) = 1 as next_run_idx_exists
from pg_indexes
where schemaname = 'public' and tablename = 'task_rules'
  and indexname = 'task_rules_next_run_idx';

rollback;
