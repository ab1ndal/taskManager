-- Fix round 1 on 015: move_task_workspace, the last-non-terminal-column guard, and a name index gap.
--
-- Important 1: 015's tasks_board_column_workspace_matches trigger fires on `update of ...
-- workspace_id`, and public.move_task_workspace (011) writes workspace_id without touching
-- board_column_id. The trigger then compares the task's still-old column against its new
-- workspace and raises, so every cross-workspace move aborts — reachable from
-- src/app/tasks/actions.ts:363. Fixed by making move_task_workspace reassign the root task's
-- column to the destination workspace's leftmost non-terminal column in the same update that
-- changes workspace_id.
--
-- Important 2: board_columns_delete let any member delete a workspace's last non-terminal column
-- through PostgREST, which then made every future root task uninsertable (the leftmost-non-terminal
-- lookup resolves to null and tasks_board_column_matches_root rejects the insert). Fixed by a guard
-- trigger plus removing the client-reachable delete policy — deletion has exactly one intended path,
-- the reassign-then-delete RPC, which runs as service_role and is not subject to RLS.
--
-- Minor 3: board_columns_workspace_name_key indexed lower(name) while the not-blank check btrims,
-- so "Blocked" and "Blocked " could coexist in one workspace — the exact ambiguity the
-- cross-workspace merge by lower(name) can't resolve. Fixed by indexing lower(btrim(name)).

-- ---------------------------------------------------------------------------
-- Important 1: move_task_workspace also moves the column
-- ---------------------------------------------------------------------------

create or replace function public.move_task_workspace(
  p_task_id uuid,
  p_workspace_id uuid,
  p_member_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent_task_id uuid;
  v_task_ids uuid[];
  v_member_id uuid;
  v_task_id uuid;
  v_board_column_id uuid;
begin
  select parent_task_id into v_parent_task_id
  from public.tasks
  where id = p_task_id
  for update;

  if not found then
    raise exception 'task % not found', p_task_id;
  end if;

  -- A subtask has no workspace of its own to change; it follows its root.
  if v_parent_task_id is not null then
    raise exception 'task % is a subtask; move its parent instead', p_task_id;
  end if;

  -- Visibility is defined by task_assignments, so a task left with none is invisible to everyone.
  if coalesce(array_length(p_member_ids, 1), 0) = 0 then
    raise exception 'a task must keep at least one assignee';
  end if;

  -- The caller checks this too (assertMembersInWorkspace), but this function is the atomic boundary:
  -- between that check and this transaction the membership could have changed.
  if exists (
    select 1
    from unnest(p_member_ids) as requested(member_id)
    where not exists (
      select 1
      from public.workspace_members wm
      where wm.id = requested.member_id
        and wm.workspace_id = p_workspace_id
    )
  ) then
    raise exception 'members do not all belong to workspace %', p_workspace_id;
  end if;

  -- The task's column is workspace-scoped (015), so a move needs a destination column, not just a
  -- destination workspace. Same rule board creation uses: the leftmost non-terminal column.
  select bc.id into v_board_column_id
  from public.board_columns bc
  where bc.workspace_id = p_workspace_id
    and not bc.is_done
  order by bc.position
  limit 1;

  if v_board_column_id is null then
    raise exception 'workspace % has no non-terminal board column to receive task %',
      p_workspace_id, p_task_id;
  end if;

  update public.tasks
  set workspace_id = p_workspace_id,
      board_column_id = v_board_column_id
  where id = p_task_id;

  select array_agg(id) into v_task_ids
  from (
    select p_task_id as id
    union all
    select id from public.tasks where parent_task_id = p_task_id
  ) affected;

  delete from public.task_assignments
  where task_id = any(v_task_ids);

  -- Assignees are chosen for the task as a whole; every subtask inherits that set, which is what
  -- addSubtask does at creation time as well.
  foreach v_member_id in array p_member_ids
  loop
    -- Held for the rest of the transaction, so a concurrent assign for the same member cannot read
    -- the same max sort key. Same lock key as assign_task_member (009).
    perform pg_advisory_xact_lock(hashtext(v_member_id::text));

    foreach v_task_id in array v_task_ids
    loop
      insert into public.task_assignments (task_id, member_id, member_sort_key)
      select v_task_id, v_member_id, coalesce(max(member_sort_key), 0) + 1000
      from public.task_assignments
      where member_id = v_member_id;
    end loop;
  end loop;
end;
$$;

-- create or replace does not reset grants, but restating them keeps this file self-contained,
-- matching how 010/011 read.
revoke execute on function public.move_task_workspace(uuid, uuid, uuid[]) from public;
revoke execute on function public.move_task_workspace(uuid, uuid, uuid[]) from anon;
revoke execute on function public.move_task_workspace(uuid, uuid, uuid[]) from authenticated;
grant execute on function public.move_task_workspace(uuid, uuid, uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- Important 2: a workspace can never be left with zero non-terminal columns
-- ---------------------------------------------------------------------------

-- Protects every delete path, including the reassign-then-delete RPC: a bug there should still not
-- be able to strand a workspace.
create or replace function private.assert_board_column_not_last_non_terminal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_remaining int;
begin
  if old.is_done then
    return old;
  end if;

  select count(*) into v_remaining
  from public.board_columns
  where workspace_id = old.workspace_id
    and not is_done
    and id <> old.id;

  if v_remaining = 0 then
    raise exception 'workspace % would be left with no non-terminal board column', old.workspace_id;
  end if;

  return old;
end;
$$;

create trigger board_columns_guard_last_non_terminal
  before delete on public.board_columns
  for each row execute function private.assert_board_column_not_last_non_terminal();

-- Deletion has exactly one intended path, the delete_board_column RPC, which runs as service_role
-- through createAdminClient() and is not subject to RLS. A client-reachable delete policy is a
-- second path that bypasses the reassign-then-delete flow the restrict FK exists to force.
drop policy "board_columns_delete" on public.board_columns;

-- ---------------------------------------------------------------------------
-- Minor 3: the uniqueness index must match the not-blank check's normalization
-- ---------------------------------------------------------------------------

drop index public.board_columns_workspace_name_key;

create unique index board_columns_workspace_name_key
  on public.board_columns (workspace_id, lower(btrim(name)));
