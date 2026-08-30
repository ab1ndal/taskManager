-- Fix-round defect in 020, found while probing it before reporting: Postgres rejects `FOR UPDATE`
-- directly on a query with an aggregate function ("FOR UPDATE is not allowed with aggregate
-- functions"). 020's Important-2 fix for delete_board_column added exactly that combination to the
-- coverage-check select, so the function was syntactically valid (CREATE FUNCTION does not fully
-- typecheck a plpgsql body) but raised on every call that reached it. Caught by probe 3 (the happy
-- path) before this was reported as done — 020 as pushed to dev never worked.
--
-- Fix: lock the rows in a subquery, then aggregate the locked result. Same locking intent 020
-- described — a concurrent move out of the column blocks here instead of racing the relocation
-- write below — just expressed in a form Postgres accepts. Nothing else in 020's bodies changes.
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
  -- deleting now would relocate a task nobody chose a destination for. Refuse instead. The rows are
  -- locked in the inner subquery so a concurrent move out of the column blocks here instead of
  -- racing the relocation write below — FOR UPDATE cannot sit directly on the aggregate query above
  -- it, so the lock happens on the plain select and the aggregation wraps it.
  select coalesce(array_agg(id order by id), '{}') into v_actual
  from (
    select id
    from public.tasks
    where board_column_id = p_column_id
    for update
  ) locked_tasks;

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
  -- FOR UPDATE lock makes a genuinely concurrent move block until this transaction commits, but a
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
