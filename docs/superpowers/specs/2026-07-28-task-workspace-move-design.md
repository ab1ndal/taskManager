# Move a task to another workspace

Date: 2026-07-28

## Problem

A task is created inside one workspace and stays there. A household task typed into the work
workspace (or the reverse) can only be fixed by deleting it and retyping it, losing its subtasks and
its update history.

## Follow-up: normalization (migration 011)

The first cut kept `workspace_id NOT NULL` on subtask rows and copied the parent's value into them.
That is a denormalization — the value is derivable from `parent_task_id` — and nothing in the schema
forced the copies to agree, so a manual `UPDATE` or a future code path could split a task across two
workspaces. Migration 011 removes the duplication: `workspace_id` is nullable and constrained to be
present exactly when `parent_task_id` is null, `private.task_workspace()` resolves a subtask's
workspace by walking to the root, and the move updates one row. The assignment rebuild is unchanged —
`task_assignments.member_id` points at workspace-scoped member rows, so those still all have to be
replaced.

The alternative considered and rejected was keeping the column and adding a composite deferrable
foreign key `(parent_task_id, workspace_id) → (id, workspace_id)`, which makes disagreement
impossible without touching any reader. Cheaper, but it preserves the duplicate value; normalization
was preferred.

## Why this is not a one-field edit

`workspace_members.id` is workspace-scoped, and `task_assignments.member_id` points at those rows.
Changing `tasks.workspace_id` alone therefore leaves the task assigned to members of the workspace it
just left — which both breaks the `assertMembersInWorkspace` invariant and keeps the task visible to
people who are no longer in the same workspace as it. Subtasks are `tasks` rows carrying their own
`workspace_id` and their own assignments, so they must move with the parent.

`task_updates.member_id` needs no change: authorship is resolved by member id
(`getTaskUpdates` looks the id up in `workspace_members` with no workspace filter), so history
survives the move intact.

## Behaviour

- The Edit task modal gets a **Workspace** select, directly above the **Assign to** fieldset,
  rendered only when the user belongs to more than one workspace.
- Selecting a different workspace swaps the assignee checkbox list to that workspace's members and
  preselects the user's own member row there. Selecting the original workspace again restores the
  task's existing assignees.
- A muted hint appears while a different workspace is selected: subtasks move too, and assignments
  in the current workspace are replaced.
- Nothing is written until **Save**. Cancel discards the move, like every other field in the form.
- After the move, the parent and every subtask are assigned to exactly the chosen destination
  members. A subtask does not keep an assignee set of its own.

### Edge cases

- Subtask: cannot be moved on its own; it moves with its parent. Rejected server-side.
- Caller not a member of the destination workspace: rejected.
- Chosen members not in the destination workspace: rejected.
- Empty assignee list: already rejected by `memberIds` in `updateTaskSchema` (a task with no
  assignment row is invisible to everyone).
- Per-user priority: destination assignments get fresh `member_sort_key` values at the end of each
  member's list. Priority is per user per task and does not survive a reassignment.

## Implementation

**Migration `010_move_task_workspace.sql`** — `move_task_workspace(p_task_id uuid, p_workspace_id
uuid, p_member_ids uuid[])`, `security definer`, `service_role` only, matching the grant posture of
`assign_task_member` (009). In one transaction it rejects a subtask or an empty member list,
re-checks that every member belongs to the destination, moves the parent and its subtasks, deletes
every assignment row for them, and reinserts assignments for each member × each task under the same
`pg_advisory_xact_lock(hashtext(member))` scope 009 established.

The move lives in a function rather than in a sequence of statements from the action because its
intermediate states are broken: a crash between "moved" and "reassigned" leaves the task in the new
workspace assigned to old-workspace members — visible to the wrong people and violating an invariant
the rest of the code relies on. There is no rollback available from a server action issuing separate
PostgREST calls.

**`schemas.ts`** — `updateTaskSchema` gains `workspaceId: uuid.optional()`. Absent means "leave the
workspace alone", which keeps every existing caller valid; present and different from the task's
current workspace means move.

**`updateTask`** — it already loads the task row to scope reassignment; that select also returns
`parent_task_id`. When a different `workspaceId` arrives: `assertWorkspaceMember(dest, user.id)`,
`assertMembersInWorkspace(members, dest)`, then the `move_task_workspace` rpc, then the ordinary
title/description/due update. The same-workspace path is untouched, including its diff-based
assignment add/remove.

**`edit-task-modal.tsx`** — new `memberIdByWorkspaceId` prop (already computed in `page.tsx:75` and
already passed to `TasksPageClient`), `workspaceId` state, and the select described above.
`currentWorkspace` resolves from the selected workspace rather than `task.workspace.id`.

## Tests

- `actions.test.ts`: a move relocates parent and subtasks and replaces their assignments; a subtask
  move is rejected; a caller outside the destination workspace is rejected; members outside the
  destination are rejected; passing the current workspace id behaves exactly like a plain edit.
- `edit-task-modal.test.tsx`: the select swaps the member list and preselects the user's own member;
  switching back restores the original assignees; submit carries `workspaceId`.

## Known race, narrowed by 011

`move_task_workspace` takes `for update` on the parent row and then snapshots its subtasks. A
concurrent `addSubtask` does not lock the parent, so a subtask inserted in the same instant can miss
the snapshot. Under 011 it can no longer end up in the wrong workspace — it has none, and resolves
through its parent — but it can keep assignments pointing at the old workspace's member rows, which
makes it invisible to the destination members until reassigned. Closing it means locking the parent
in `addSubtask` too, which is a change to a path this work does not otherwise touch.

## Out of scope

- Moving a subtask independently of its parent.
- Mapping shared assignees across workspaces by `auth_user_id`.
- Preserving `member_sort_key` across a move.
