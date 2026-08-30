# Database Design

Database: Supabase Postgres

## Concepts

Workspace
A tenant container for tasks. A workspace may be of kind household or work.

Membership
Users gain access to a workspace through workspace_members.

Task visibility
A task is visible to a user only if there is a task_assignments row for that user.

Per user priority
Priority is stored per user per task via task_assignments.member_sort_key.
Shared tasks may have different priority for different users.

## Tables

### workspaces

id uuid primary key
name text not null
kind text not null, household or work
created_at timestamptz not null

### workspace_members

id uuid primary key
workspace_id uuid not null
auth_user_id uuid not null
display_name text not null
role text nullable
created_at timestamptz not null

Notes
auth_user_id refers to auth.users id logically
Unique auth_user_id within a workspace
Unique display_name within a workspace

### task_rules

id uuid primary key
task_id uuid not null unique, references tasks(id) on delete cascade

frequency text not null          daily | weekly | monthly
interval_count int not null      > 0
next_run_at timestamptz not null
is_active boolean not null

default_due_offset_hours int nullable
created_at timestamptz not null

Notes
One rule per task, one task per rule. A recurring task is a single permanent tasks row.
A scheduled function clears completed_at and re-dates the task when next_run_at is reached,
then rolls next_run_at forward by whole intervals. Nothing is inserted, so a repeated run
cannot double-create.
Deleting the task deletes the rule. That is how a recurrence is stopped for good.
All schedule arithmetic runs in America/Los_Angeles.

### board_columns

id uuid primary key
workspace_id uuid not null, references workspaces(id) on delete cascade

name text not null
color text not null                tab20 slug, e.g. tab20-blue
position numeric not null
is_done boolean not null

created_at timestamptz not null

Notes
Columns belong to a workspace and are shared by everyone in it. Any member may add, rename,
recolour or delete one, and the change is immediately everyone's.

At most one is_done column per workspace, enforced by a partial unique index. That column is the
terminal one: a task dragged there is completed, and a completed task always renders there.

Names are unique per workspace case-insensitively (board_columns_workspace_name_key over
(workspace_id, lower(name))). The all-workspaces board merges columns across workspaces by
lower(name), so two workspaces both having "In Progress" produce one column on screen — the
uniqueness rule is what keeps that merge unambiguous within a workspace.

color is checked against the twenty tab20 slugs. That list is duplicated in
src/app/board/colors.ts (TAB20_SLUGS) and in the check constraint; the two must change together.

position orders the columns and is spaced by 1000 so a column can be inserted between two others
without renumbering. Positions need not be unique; the board sorts by (position, name).

A new workspace gets five columns from a seed trigger: Not Started, In Progress, Blocked,
Follow-up, Completed (the last is_done).

### tasks

id uuid primary key
workspace_id uuid nullable, set on root tasks only

parent_task_id uuid nullable

title text not null
description text nullable

due_at timestamptz nullable
completed_at timestamptz nullable

board_column_id uuid nullable, references board_columns(id) on delete restrict

created_by_member_id uuid nullable
created_at timestamptz not null

Notes
Subtasks are rows with parent_task_id set.

Every root task sits in a board column and no subtask does:
check ((parent_task_id is null) = (board_column_id is not null)). Subtasks appear only inside their
parent, so the board never has to place one.

The board_column_id FK is on delete restrict, deliberately: a column can only be removed through
delete_board_column, which reassigns every task in it first. There is no path that silently drops a
task's column, and no cascade that would delete tasks along with a column.

Completion is not stored twice. completed_at remains the single fact; the board derives a completed
task's placement from it, which is why a completed task shows in the terminal column whatever
board_column_id it still carries.

A workspace is recorded once per task tree, on the root task. Migration 011 enforces
check ((parent_task_id is null) = (workspace_id is not null)), so a subtask cannot carry a workspace
and therefore cannot disagree with its parent. A subtask's workspace is resolved through
parent_task_id — private.task_workspace(task_id) does this for the RLS policies.

Subtasks are one level deep. Nothing in the schema enforces the depth; addSubtask rejects a parent
that is itself a subtask, and private.task_workspace walks up to the root regardless.

A task may be moved to another workspace only through move_task_workspace (migration 011). The
workspace write is one row, but member ids are workspace-scoped, so the assignments of the root task
and every subtask are deleted and rebuilt for members of the destination — all in one transaction.

### task_assignments

task_id uuid not null
member_id uuid not null

member_sort_key numeric not null
assigned_at timestamptz not null

Primary key
task_id, member_id

Notes
Defines both visibility and ordering for a given user.
My tasks are tasks with an assignment row for the current member.
Shared tasks are tasks with more than one assignment row.
Ordering for the current user uses member_sort_key.

### task_updates

id uuid primary key
task_id uuid not null
member_id uuid not null
created_at timestamptz not null
update_text text not null

Notes
Updates are text only.
Speech to text is performed at input time in the client or via a transcription API.
Audio is never stored.

## Indexing

Indexes should exist on:

tasks.workspace_id, tasks.parent_task_id, tasks.board_column_id
board_columns.(workspace_id, position)
task_assignments.member_id, task_assignments.member_sort_key
task_rules.next_run_at (partial, where is_active)
task_updates.task_id, task_updates.created_at
workspace_members.workspace_id, workspace_members.auth_user_id
