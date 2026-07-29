-- Normalize task→workspace: a workspace is recorded once per task tree, on the root task.
--
-- ROOT CAUSE this migration fixes:
--   tasks.workspace_id was NOT NULL on every row, including subtasks, where the value is derivable
--   from the parent. Nothing in the schema forced the two to agree — only write-path discipline
--   (insertSubtask copying the parent's value, move_task_workspace rewriting parent and children
--   together). A manual UPDATE, a future code path, or a partial failure could split a task across
--   two workspaces, and every visibility rule reads that column.
--
-- FIX: subtasks stop storing it. `workspace_id` is NOT NULL exactly when `parent_task_id` IS NULL,
--   so the fact lives in one place and disagreement is unrepresentable rather than merely avoided.
--
-- Resolution walks up to the root rather than assuming one level of nesting. Depth is not
-- constrained by the schema (tasks.parent_task_id references tasks with no depth limit), so a
-- resolver that read only the immediate parent would return NULL for a grandchild. The walk is
-- bounded so a parent cycle cannot spin.

-- ---------------------------------------------------------------------------
-- Private schema
-- ---------------------------------------------------------------------------

-- Repeated from 007 so this migration applies whether or not 007 has run yet. Both are idempotent.
create schema if not exists private;
grant usage on schema private to authenticated;
revoke usage on schema private from anon;

-- ---------------------------------------------------------------------------
-- Column
-- ---------------------------------------------------------------------------

alter table public.tasks alter column workspace_id drop not null;

update public.tasks set workspace_id = null where parent_task_id is not null;

-- Both halves matter: a root without a workspace is unreachable by every visibility rule, and a
-- subtask with one reintroduces the duplication this migration removes.
alter table public.tasks
  add constraint tasks_workspace_only_on_root
  check ((parent_task_id is null) = (workspace_id is not null));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Identical to 007's definition, repeated for the same reason as the schema above.
create or replace function private.is_workspace_member(ws uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = ws
      and wm.auth_user_id = (select auth.uid())
  );
$$;

-- Which workspace does this task belong to? Replaces 007's version, which read the row's own
-- column — now NULL for every subtask. Walks to the root instead.
--
-- The depth ceiling is a safety stop, not a product limit: parent_task_id has no constraint
-- preventing a cycle, and a cycle would otherwise make this recurse forever inside an RLS policy.
-- Real trees are one level deep (docs/product.md), so the walk terminates on the first hop.
create or replace function private.task_workspace(t uuid)
returns uuid
language sql
security definer
stable
set search_path = ''
as $$
  with recursive chain as (
    select id, parent_task_id, workspace_id, 1 as depth
    from public.tasks
    where id = t
    union all
    select parent.id, parent.parent_task_id, parent.workspace_id, child.depth + 1
    from public.tasks parent
    join chain child on child.parent_task_id = parent.id
    where child.depth < 10
  )
  select workspace_id from chain where workspace_id is not null limit 1;
$$;

revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Policy that read the column directly
-- ---------------------------------------------------------------------------

-- A subtask now arrives with workspace_id NULL, which would make the 007 form of this policy
-- (is_workspace_member(workspace_id)) reject every subtask insert. The workspace to authorize
-- against is the parent's.
drop policy if exists "tasks_insert" on tasks;
create policy "tasks_insert" on tasks
  for insert to authenticated
  with check (
    private.is_workspace_member(
      coalesce(workspace_id, private.task_workspace(parent_task_id))
    )
  );

-- ---------------------------------------------------------------------------
-- Moving a task between workspaces
-- ---------------------------------------------------------------------------

-- Supersedes 010. The workspace write is now a single row — that is the point of normalizing — but
-- the assignment rebuild is unchanged: task_assignments.member_id points at workspace_members rows,
-- which are workspace-scoped, so the parent's and every subtask's assignments still have to be
-- replaced with members of the destination. Both halves stay in one transaction for the same reason
-- 010 gave: a task whose workspace has moved while its assignments have not is visible to the wrong
-- people.
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

  update public.tasks
  set workspace_id = p_workspace_id
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

revoke execute on function public.move_task_workspace(uuid, uuid, uuid[]) from public;
revoke execute on function public.move_task_workspace(uuid, uuid, uuid[]) from anon;
revoke execute on function public.move_task_workspace(uuid, uuid, uuid[]) from authenticated;
grant execute on function public.move_task_workspace(uuid, uuid, uuid[]) to service_role;
