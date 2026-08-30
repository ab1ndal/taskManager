-- Task 2 review fix round: three defects in the SQL 018/019 shipped verbatim from the brief.
--
-- 018 and 019 are applied and append-only; this migration create-or-replaces all three functions
-- with the fixes below layered on top of their existing bodies.

-- ---------------------------------------------------------------------------
-- Important 1: move_task_to_column skipped the assignment check on the both-null branch
-- ---------------------------------------------------------------------------
--
-- The both-null branch (destination column empty) returns before the task_assignments update ever
-- runs, and that update's "not found" was the only place membership was checked — so a drop into an
-- EMPTY column succeeded for a member who is in the workspace but not assigned to the task, while
-- the identical drop into a non-empty column correctly raised. Visibility in this product is
-- assignment (docs/db.md), so this was an authorization hole on the one branch that skipped the
-- check. Fix: check assignment before any write, so every branch is covered.
create or replace function public.move_task_to_column(
  p_task_id uuid,
  p_column_id uuid,
  p_member_id uuid,
  p_prev_key numeric,
  p_next_key numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task_workspace uuid;
  v_parent_task_id uuid;
  v_column_workspace uuid;
  v_member_workspace uuid;
  v_new_key numeric;
begin
  select workspace_id, parent_task_id into v_task_workspace, v_parent_task_id
  from public.tasks
  where id = p_task_id
  for update;

  if not found then
    raise exception 'task % not found', p_task_id;
  end if;

  -- The board renders root tasks only, and migration 015's check constraint forbids a column on a
  -- subtask, so this would fail downstream anyway. Failing here names the actual problem.
  if v_parent_task_id is not null then
    raise exception 'task % is a subtask and has no board column', p_task_id;
  end if;

  select workspace_id into v_column_workspace
  from public.board_columns
  where id = p_column_id;

  if v_column_workspace is null then
    raise exception 'board column % not found', p_column_id;
  end if;

  if v_column_workspace is distinct from v_task_workspace then
    raise exception 'board column % is not in workspace %', p_column_id, v_task_workspace;
  end if;

  -- member_sort_key is per-user priority: the caller may only reorder their own list. The action
  -- checks this too, but membership could have changed since.
  select workspace_id into v_member_workspace
  from public.workspace_members
  where id = p_member_id;

  if v_member_workspace is distinct from v_task_workspace then
    raise exception 'member % is not in workspace %', p_member_id, v_task_workspace;
  end if;

  -- Visibility is assignment, so this is an authorization check, not a bookkeeping one. It must run
  -- before any write: the both-null branch below returns without touching task_assignments, so a
  -- check placed after the column write would never run for a drop into an empty column.
  perform 1
  from public.task_assignments
  where task_id = p_task_id
    and member_id = p_member_id;

  if not found then
    raise exception 'member % is not assigned to task %', p_member_id, p_task_id;
  end if;

  update public.tasks
  set board_column_id = p_column_id
  where id = p_task_id;

  -- Same key arithmetic as reorderTask in src/app/tasks/actions.ts: midpoint between neighbours,
  -- or a full step beyond the one neighbour that exists. Both null means the destination column is
  -- empty, so the existing key stands and only the column changes.
  if p_prev_key is null and p_next_key is null then
    return;
  elsif p_prev_key is null then
    v_new_key := p_next_key - 1000;
  elsif p_next_key is null then
    v_new_key := p_prev_key + 1000;
  else
    v_new_key := (p_prev_key + p_next_key) / 2;
  end if;

  update public.task_assignments
  set member_sort_key = v_new_key
  where task_id = p_task_id
    and member_id = p_member_id;

  if not found then
    raise exception 'member % is not assigned to task %', p_member_id, p_task_id;
  end if;
end;
$$;

revoke execute on function public.move_task_to_column(uuid, uuid, uuid, numeric, numeric) from public;
revoke execute on function public.move_task_to_column(uuid, uuid, uuid, numeric, numeric) from anon;
revoke execute on function public.move_task_to_column(uuid, uuid, uuid, numeric, numeric) from authenticated;
grant execute on function public.move_task_to_column(uuid, uuid, uuid, numeric, numeric) to service_role;

-- ---------------------------------------------------------------------------
-- Important 2: the relocation update did not re-assert the column it verified
-- ---------------------------------------------------------------------------
--
-- The coverage check reads a snapshot; the relocation update is a separate statement under a fresh
-- READ COMMITTED snapshot. Updating a task's FK column locks the NEW referenced row, not the old
-- one, so a concurrent move_task_to_column moving a task OUT of this column was not blocked by it.
-- If that move committed inside the window, the relocation update silently dragged the task back to
-- the deleting user's chosen destination — the exact outcome the coverage check exists to prevent.
-- Fix: take the coverage select `for update` (locks the actual rows the check is about), and add
-- `and t.board_column_id = p_column_id` to the write so it re-verifies rather than trusts the read.
create or replace function public.delete_board_column(
  p_column_id uuid,
  p_moves jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_remaining int;
  v_actual uuid[];
  v_requested uuid[];
begin
  select workspace_id into v_workspace_id
  from public.board_columns
  where id = p_column_id
  for update;

  if not found then
    raise exception 'board column % not found', p_column_id;
  end if;

  -- A workspace with no NON-TERMINAL column cannot hold a new task: migration 015 requires every
  -- root task to have a column, and createTaskWithSubtasks picks the leftmost non-terminal one, so
  -- a workspace left with only its Completed column rejects every task insert. Counting all columns
  -- is not enough — that was Task 1's review finding, and migrations 016 and 017 enforce the same rule with
  -- a before-delete trigger for the direct-DELETE path.
  select count(*) into v_remaining
  from public.board_columns
  where workspace_id = v_workspace_id
    and id <> p_column_id
    and not is_done;

  if v_remaining = 0 then
    raise exception 'cannot delete the last non-terminal column of workspace %', v_workspace_id;
  end if;

  if jsonb_typeof(p_moves) is distinct from 'array' then
    raise exception 'p_moves must be a json array';
  end if;

  -- Coverage check: p_moves must name exactly the tasks currently in the column. The dialog listed
  -- what it read a moment ago; if someone else added a task to this column or moved one out since,
  -- deleting now would relocate a task nobody chose a destination for. Refuse instead. `for update`
  -- locks these rows so a concurrent move out of the column blocks here instead of racing the
  -- relocation write below.
  select coalesce(array_agg(id order by id), '{}') into v_actual
  from public.tasks
  where board_column_id = p_column_id
  for update;

  select coalesce(array_agg(task_id order by task_id), '{}') into v_requested
  from jsonb_to_recordset(p_moves) as m(task_id uuid, target_column_id uuid);

  if v_actual is distinct from v_requested then
    raise exception 'column % changed since it was listed', p_column_id
      using errcode = 'serialization_failure';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_moves) as m(task_id uuid, target_column_id uuid)
    where m.target_column_id = p_column_id
       or not exists (
         select 1 from public.board_columns bc
         where bc.id = m.target_column_id
           and bc.workspace_id = v_workspace_id
       )
  ) then
    raise exception 'every destination must be a different column in workspace %', v_workspace_id;
  end if;

  -- Re-assert board_column_id = p_column_id here rather than trusting the coverage check above: the
  -- `for update` lock makes a genuinely concurrent move block until this transaction commits, but a
  -- task that stopped being in this column for any other reason still must not be silently rewritten.
  update public.tasks t
  set board_column_id = m.target_column_id
  from jsonb_to_recordset(p_moves) as m(task_id uuid, target_column_id uuid)
  where t.id = m.task_id
    and t.board_column_id = p_column_id;

  delete from public.board_columns where id = p_column_id;
end;
$$;

revoke execute on function public.delete_board_column(uuid, jsonb) from public;
revoke execute on function public.delete_board_column(uuid, jsonb) from anon;
revoke execute on function public.delete_board_column(uuid, jsonb) from authenticated;
grant execute on function public.delete_board_column(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Minor 3 (promoted): run_due_recurrences could write a NULL board_column_id
-- ---------------------------------------------------------------------------
--
-- If a workspace momentarily has no non-terminal column, 019's case then-branch subquery returns
-- NULL, the write violates 015's tasks_board_column_matches_root, and the abort is swallowed by
-- 014's per-rule exception handler: v_failed increments, a warning is raised, and next_run_at is NOT
-- advanced — so the rule stays due and fails again every cron tick, forever, with nothing surfacing
-- to a user. The delete guard makes that state unreachable today; fixed anyway because a silent
-- infinite retry is worth one coalesce. Everything else in the body stays byte-identical to 014/019.
create or replace function public.run_due_recurrences()
returns integer
language plpgsql
security definer
set search_path = ''
set timezone = 'America/Los_Angeles'
as $$
declare
  r record;
  v_fired timestamptz;
  v_next timestamptz;
  v_processed int := 0;
  v_failed int := 0;
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
      --
      -- v_fired tracks the most recent occurrence that has actually come due — the one being
      -- fired now — as opposed to v_next, which is the schedule's next future slot. On time
      -- (the common case), the loop body runs once and exits immediately, so v_fired never moves
      -- off r.next_run_at: current behaviour for an on-schedule rule is unchanged. After an
      -- outage, v_fired advances one interval behind v_next each pass, so it lands on the last
      -- occurrence that was due rather than the stale original anchor — a task that missed nine
      -- days of a three-day rule comes back dated today, not nine days overdue.
      v_fired := r.next_run_at;
      v_next  := r.next_run_at;
      loop
        v_next := private.advance_next_run(v_next, r.frequency, r.interval_count);
        exit when v_next > now();
        v_fired := v_next;
      end loop;

      -- If the task was never completed this cycle, completed_at is already null and this is a
      -- no-op. That is the whole handling the "still open on day 3" case needs.
      update public.tasks t
         set completed_at = null,
             due_at = v_fired
                      + coalesce(make_interval(hours => r.default_due_offset_hours), interval '0'),
             -- Reactivation makes the task open again, so it must not stay in the terminal column it
             -- was dragged into to complete it. Any non-terminal column is a valid landing spot; the
             -- leftmost is the "new work" column task creation uses. coalesce to the task's current
             -- column when none exists (workspace momentarily has no non-terminal column) — a NULL
             -- here would violate 015's root-task check and silently wedge the rule into a forever
             -- retry, since the abort would be swallowed below without advancing next_run_at.
             board_column_id = case
               when exists (
                 select 1 from public.board_columns bc
                 where bc.id = t.board_column_id and bc.is_done
               )
               then coalesce(
                 (
                   select bc.id from public.board_columns bc
                   where bc.workspace_id = t.workspace_id and not bc.is_done
                   order by bc.position
                   limit 1
                 ),
                 t.board_column_id
               )
               else t.board_column_id
             end
       where t.id = r.task_id;

      -- Reopen the parent's subtasks along with it — see the header comment above. `due_at` is
      -- untouched here: a subtask's own due date is not tied to the parent's schedule, only its
      -- completion state is.
      update public.tasks
         set completed_at = null
       where parent_task_id = r.task_id
         and completed_at is not null;

      update public.task_rules
         set next_run_at = v_next
       where id = r.id;

      v_processed := v_processed + 1;
    exception when others then
      -- Batch-item isolation, not a swallowed error: one malformed rule must not stop every other
      -- household's chores, and the failure is logged with the rule id that caused it. The
      -- subtransaction rollback here also undoes the next_run_at advance, so a failing rule stays
      -- due and is retried every cron tick — by design, not a bug, but silent otherwise: v_failed
      -- surfaces it to both the cron log and the e2e caller without building a counter or
      -- dead-letter table.
      v_failed := v_failed + 1;
      raise warning 'run_due_recurrences: rule % failed: %', r.id, sqlerrm;
    end;
  end loop;

  if v_failed > 0 then
    raise warning 'run_due_recurrences: % processed, % failed', v_processed, v_failed;
  end if;

  return v_processed;
end;
$$;

revoke execute on function public.run_due_recurrences() from public;
revoke execute on function public.run_due_recurrences() from anon;
revoke execute on function public.run_due_recurrences() from authenticated;
grant  execute on function public.run_due_recurrences() to service_role;
