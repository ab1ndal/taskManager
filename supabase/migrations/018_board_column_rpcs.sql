-- Two board operations that span tables, so neither can be a sequence of PostgREST calls.
--
-- Same grant posture as 009/010: public schema for PostgREST exposure, EXECUTE for service_role
-- only, and each function re-checks authorization itself because it is the atomic boundary — the
-- caller's checks happened before this transaction started.

-- A drop writes the shared column on tasks and the caller's own priority key on task_assignments.
-- Half of that is a broken state: the card would appear in the new column for everyone while
-- sitting in the wrong place in the dragger's own list, or vice versa.
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

-- Deleting a column reassigns its tasks and then drops the row. p_moves is
-- [{"task_id": uuid, "target_column_id": uuid}, ...] — one entry per task, because the user picks a
-- destination for each task individually rather than one destination for the column.
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
  -- deleting now would relocate a task nobody chose a destination for. Refuse instead.
  select coalesce(array_agg(id order by id), '{}') into v_actual
  from public.tasks
  where board_column_id = p_column_id;

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

  update public.tasks t
  set board_column_id = m.target_column_id
  from jsonb_to_recordset(p_moves) as m(task_id uuid, target_column_id uuid)
  where t.id = m.task_id;

  delete from public.board_columns where id = p_column_id;
end;
$$;

revoke execute on function public.delete_board_column(uuid, jsonb) from public;
revoke execute on function public.delete_board_column(uuid, jsonb) from anon;
revoke execute on function public.delete_board_column(uuid, jsonb) from authenticated;
grant execute on function public.delete_board_column(uuid, jsonb) to service_role;
