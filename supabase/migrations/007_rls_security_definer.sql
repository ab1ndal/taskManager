-- Phase 03 Task 1 — Replace recursive RLS policies with private security-definer helpers.
--
-- ROOT CAUSE this migration fixes:
--   workspace_members_select (002) was defined in terms of workspace_members, so evaluating it
--   re-entered itself → Postgres 42P17 infinite recursion. Every policy joining that table
--   inherited the recursion. Each error was then worked around by swapping in the service-role
--   client, and 006 finished the job by replacing real checks with `auth.uid() IS NOT NULL`.
--   The net effect was that neither the database nor the application enforced access control.
--
-- FIX: SECURITY DEFINER helpers run with the creator's privileges and therefore do not re-enter
--   RLS on the table they read, breaking the cycle. They live in `private` — NEVER `public`:
--   Postgres grants EXECUTE to PUBLIC on every new function and anon/authenticated inherit from
--   PUBLIC, so a SECURITY DEFINER function in an exposed schema is a callable, RLS-bypassing
--   endpoint. `set search_path = ''` is mandatory; without it the function is itself a
--   privilege-escalation vector, and every reference inside must be schema-qualified.

-- ---------------------------------------------------------------------------
-- Private schema
-- ---------------------------------------------------------------------------

create schema if not exists private;

-- `private` must NOT be added to PostgREST's exposed schemas, so these helpers are not reachable
-- as RPC endpoints. USAGE is still required: RLS policy expressions are evaluated with the
-- privileges of the querying role, so `authenticated` must be able to call them from a policy.
grant usage on schema private to authenticated;
revoke usage on schema private from anon;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Is the current user a member of this workspace?
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

-- Is the current user assigned to this task? This is the visibility rule from docs/product.md:
-- "A user must only see tasks that are relevant to them... assigned to the current user."
create or replace function private.is_task_assignee(t uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.task_assignments ta
    join public.workspace_members wm on wm.id = ta.member_id
    where ta.task_id = t
      and wm.auth_user_id = (select auth.uid())
  );
$$;

-- Does this workspace_members row belong to the current user? Used to scope per-user data
-- (member_sort_key ordering, authored task_updates) to the acting member.
create or replace function private.is_own_member(m uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.id = m
      and wm.auth_user_id = (select auth.uid())
  );
$$;

-- Which workspace does this task belong to? Needed by task_assignments policies: reading
-- public.tasks directly from a policy would trigger tasks_select, which requires an assignment
-- row that does not exist yet at assignment-insert time.
create or replace function private.task_workspace(t uuid)
returns uuid
language sql
security definer
stable
set search_path = ''
as $$
  select workspace_id from public.tasks where id = t;
$$;

-- Which workspace does this member row belong to? Used to reject cross-workspace assignment.
create or replace function private.member_workspace(m uuid)
returns uuid
language sql
security definer
stable
set search_path = ''
as $$
  select workspace_id from public.workspace_members where id = m;
$$;

revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

-- ---------------------------------------------------------------------------
-- workspaces
-- ---------------------------------------------------------------------------

-- Deliberate product decision, not an oversight: the workspace directory is public to signed-in
-- users so they can discover and join without a PIN or an approval step. See .planning/STATE.md,
-- "Public workspace directory (no pin)". Only id/name/kind live on this table; task content does
-- not, and workspace_members below stays members-only.
drop policy if exists "workspaces_select" on workspaces;
create policy "workspaces_select" on workspaces
  for select to authenticated
  using ( true );

drop policy if exists "workspaces_insert" on workspaces;
create policy "workspaces_insert" on workspaces
  for insert to authenticated
  with check ( true );

-- No UPDATE or DELETE policy: workspaces cannot be renamed or removed through the Data API.
-- Deleting a workspace is Phase 05 scope and needs an explicit ownership rule first.

-- ---------------------------------------------------------------------------
-- workspace_members
-- ---------------------------------------------------------------------------

drop policy if exists "workspace_members_select" on workspace_members;
create policy "workspace_members_select" on workspace_members
  for select to authenticated
  using ( private.is_workspace_member(workspace_id) );

-- Replaces workspace_members_insert_self from 004. A user may only add themselves.
drop policy if exists "workspace_members_insert_self" on workspace_members;
create policy "workspace_members_insert_self" on workspace_members
  for insert to authenticated
  with check ( auth_user_id = (select auth.uid()) );

-- New. 004/005 never created a DELETE policy, which is why leaveWorkspace() had to use the
-- service-role client.
drop policy if exists "workspace_members_delete_self" on workspace_members;
create policy "workspace_members_delete_self" on workspace_members
  for delete to authenticated
  using ( auth_user_id = (select auth.uid()) );

-- ---------------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------------

drop policy if exists "tasks_select" on tasks;
create policy "tasks_select" on tasks
  for select to authenticated
  using ( private.is_task_assignee(id) );

-- 006 had: with check (auth.uid() is not null) — any authenticated user could insert a task into
-- any workspace.
drop policy if exists "tasks_insert" on tasks;
create policy "tasks_insert" on tasks
  for insert to authenticated
  with check ( private.is_workspace_member(workspace_id) );

drop policy if exists "tasks_update" on tasks;
create policy "tasks_update" on tasks
  for update to authenticated
  using ( private.is_task_assignee(id) )
  with check ( private.is_task_assignee(id) );

drop policy if exists "tasks_delete" on tasks;
create policy "tasks_delete" on tasks
  for delete to authenticated
  using ( private.is_task_assignee(id) );

-- ---------------------------------------------------------------------------
-- task_assignments
-- ---------------------------------------------------------------------------

-- Intentionally broader than "my own assignments": the app needs every assignment row for a task
-- it can see, to compute assignee_count for the Shared view.
drop policy if exists "task_assignments_select" on task_assignments;
create policy "task_assignments_select" on task_assignments
  for select to authenticated
  using ( private.is_task_assignee(task_id) );

-- 006 had: with check (auth.uid() is not null) — a caller could assign any task to any member row,
-- including members of workspaces they do not belong to. Both conditions are required: the caller
-- must be in the task's workspace, and the member being assigned must be in that same workspace.
drop policy if exists "task_assignments_insert" on task_assignments;
create policy "task_assignments_insert" on task_assignments
  for insert to authenticated
  with check (
    private.is_workspace_member(private.task_workspace(task_id))
    and private.task_workspace(task_id) = private.member_workspace(member_id)
  );

-- member_sort_key is per-user priority (docs/product.md). You may only reorder your own list.
drop policy if exists "task_assignments_update" on task_assignments;
create policy "task_assignments_update" on task_assignments
  for update to authenticated
  using ( private.is_own_member(member_id) )
  with check ( private.is_own_member(member_id) );

drop policy if exists "task_assignments_delete" on task_assignments;
create policy "task_assignments_delete" on task_assignments
  for delete to authenticated
  using ( private.is_workspace_member(private.task_workspace(task_id)) );

-- ---------------------------------------------------------------------------
-- task_updates
-- ---------------------------------------------------------------------------

drop policy if exists "task_updates_select" on task_updates;
create policy "task_updates_select" on task_updates
  for select to authenticated
  using ( private.is_task_assignee(task_id) );

drop policy if exists "task_updates_insert" on task_updates;
create policy "task_updates_insert" on task_updates
  for insert to authenticated
  with check (
    private.is_task_assignee(task_id)
    and private.is_own_member(member_id)
  );

-- ---------------------------------------------------------------------------
-- Indexes the new policies depend on
-- ---------------------------------------------------------------------------

-- Both are specified in docs/db.md and were never created by 001.
--
-- workspace_members has unique (workspace_id, auth_user_id), but every helper above looks up by
-- auth_user_id alone, which cannot use that index — workspace_id is the leading column.
create index if not exists workspace_members_auth_user_idx
  on workspace_members (auth_user_id);

-- tasks has (workspace_id, parent_task_id); the subtask fetch filters on parent_task_id alone.
create index if not exists tasks_parent_idx
  on tasks (parent_task_id);
