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
