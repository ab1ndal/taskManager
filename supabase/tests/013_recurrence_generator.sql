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
