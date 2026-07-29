-- Phase 07 followup — reactivation must reopen a recurring task's subtasks too.
--
-- `completeTask` (src/app/tasks/actions.ts) cascades completion DOWN: finishing a parent also
-- stamps `completed_at` on every open subtask (docs/product.md: "A task is completed when the
-- entire task and all its subtasks are marked as complete"). That cascade only runs one direction
-- — nothing un-completes a subtask when its parent reopens. Before recurrence existed that was
-- fine: a completed task stayed completed, subtasks and all. Recurrence makes it permanent damage
-- instead: `run_due_recurrences` (013) reopens the parent by clearing `completed_at` on
-- `r.task_id` alone, so a weekly "Clean kitchen" with subtasks Counters/Floor/Bins comes back every
-- week with the parent open but all three subtasks still struck through — and the
-- auto-complete-parent rule in `completeTask` never re-fires, because it only runs when a subtask
-- transitions to complete, and by then there are none left open to complete. Migration 012's header
-- promised the card returns with its "subtasks ... intact"; leaving them completed does not meet
-- that.
--
-- `create or replace function` on an existing, already-applied function: this is a migration in its
-- own right (013 already ran on dev), not an edit to 013's file.
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
      update public.tasks
         set completed_at = null,
             due_at = v_fired
                      + coalesce(make_interval(hours => r.default_due_offset_hours), interval '0')
       where id = r.task_id;

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
