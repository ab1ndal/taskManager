-- Phase 07 followup — reactivation reopens subtasks. Run against task-manager-dev; nothing is kept.
begin;

set local timezone = 'America/Los_Angeles';

-- Fixtures: a workspace, a member, a recurring parent task with two completed subtasks, all
-- completed exactly as `completeTask`'s downward cascade would leave them.
insert into workspaces (id, name, kind)
values ('11111111-1111-1111-1111-111111111114', 'phase07 014 test', 'household');

insert into workspace_members (id, workspace_id, auth_user_id, display_name)
values ('22222222-2222-2222-2222-222222222224',
        '11111111-1111-1111-1111-111111111114',
        '33333333-3333-3333-3333-333333333334', 'Tester');

insert into tasks (id, workspace_id, title, completed_at)
values ('44444444-4444-4444-4444-444444444447',
        '11111111-1111-1111-1111-111111111114',
        'Clean kitchen', now());

insert into tasks (id, parent_task_id, title, completed_at)
values
  ('44444444-4444-4444-4444-444444444448', '44444444-4444-4444-4444-444444444447', 'Counters', now()),
  ('44444444-4444-4444-4444-444444444449', '44444444-4444-4444-4444-444444444447', 'Floor', now());

insert into task_assignments (task_id, member_id)
values ('44444444-4444-4444-4444-444444444447',
        '22222222-2222-2222-2222-222222222224');

insert into task_rules (id, task_id, frequency, interval_count, next_run_at, is_active)
values ('55555555-5555-5555-5555-555555555559',
        '44444444-4444-4444-4444-444444444447',
        'weekly', 1, now() - interval '1 minute', true);

-- Reactivation must reopen the parent AND both subtasks in one pass.
select public.run_due_recurrences() as processed;   -- expect 1

select
  (completed_at is null) as parent_reopened
from tasks where id = '44444444-4444-4444-4444-444444444447';

select
  bool_and(completed_at is null) as subtasks_reopened,
  count(*) = 2 as both_subtasks_present
from tasks where parent_task_id = '44444444-4444-4444-4444-444444444447';

-- A subtask that was already open before the run must stay open and untouched (no spurious update
-- to an already-null completed_at).
insert into tasks (id, parent_task_id, title, completed_at)
values ('44444444-4444-4444-4444-44444444444a', '44444444-4444-4444-4444-444444444447', 'Bins', null);

update task_rules set next_run_at = now() - interval '1 minute'
 where id = '55555555-5555-5555-5555-555555555559';
update tasks set completed_at = now() where id = '44444444-4444-4444-4444-444444444447';

select public.run_due_recurrences() as processed_again;   -- expect 1

select
  bool_and(completed_at is null) as all_three_subtasks_open,
  count(*) = 3 as all_three_subtasks_present
from tasks where parent_task_id = '44444444-4444-4444-4444-444444444447';

rollback;
