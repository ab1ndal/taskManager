-- Move a task (and its subtasks) to another workspace, atomically.
--
-- A move touches two tables and its intermediate states are broken: member ids are workspace-scoped
-- (workspace_members is keyed per workspace), so a task whose workspace_id has been changed but whose
-- task_assignments still point at the old workspace's members is both visible to the wrong people and
-- in violation of the invariant every reassignment path assumes. A server action issuing separate
-- PostgREST calls has no rollback, so the whole move lives here, in one transaction.
--
-- Same grant posture as 009: `public` schema for PostgREST exposure, EXECUTE for service_role only.

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
begin
  select parent_task_id into v_parent_task_id
  from public.tasks
  where id = p_task_id
  for update;

  if not found then
    raise exception 'task % not found', p_task_id;
  end if;

  -- A subtask shares its parent's workspace by construction. Moving one alone would split a task
  -- across two workspaces, so the parent is the only thing that can be moved.
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

  select array_agg(id) into v_task_ids
  from (
    select p_task_id as id
    union all
    select id from public.tasks where parent_task_id = p_task_id
  ) moved;

  update public.tasks
  set workspace_id = p_workspace_id
  where id = any(v_task_ids);

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

revoke execute on function public.move_task_workspace(uuid, uuid, uuid[]) from public;
revoke execute on function public.move_task_workspace(uuid, uuid, uuid[]) from anon;
revoke execute on function public.move_task_workspace(uuid, uuid, uuid[]) from authenticated;
grant execute on function public.move_task_workspace(uuid, uuid, uuid[]) to service_role;
