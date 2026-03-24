# Tasks Wiring Design

**Date:** 2026-03-24
**Status:** Approved

## Overview

Replace mock task data on the tasks page with real Supabase data. Add create, complete, and delete interactions. Implement workspace and shared-view filtering via URL params.

## Architecture

**Pattern:** Server Component page + Server Actions for mutations + URL search params for filters.

No client-side fetch state. The page re-renders server-side after each mutation via `revalidatePath("/tasks")`.

### URL params

| Param | Values | Effect |
|---|---|---|
| `workspace` | `household`, `work`, absent | Filter tasks to that workspace kind |
| `view` | `shared`, absent | Filter to shared tasks only |

Params can be combined: `?workspace=household&view=shared`.

## RLS Policies (migration 002)

Enable RLS on all five tables. All policies derive identity from `workspace_members.auth_user_id = auth.uid()`.

### workspaces
- **SELECT**: user has a `workspace_members` row for this workspace

### workspace_members
- **SELECT**: member shares a workspace with the current user (same `workspace_id`)

### tasks
- **SELECT / UPDATE / DELETE**: a `task_assignments` row exists linking this task to the current user's member ID
- **INSERT**: current user is a member of the task's workspace

### task_assignments
- **SELECT**: `member_id` belongs to the current user
- **INSERT**: current user is a member of the same workspace as the task being assigned (allows assigning to any workspace member)
- **DELETE**: same condition as INSERT

### task_updates
- **SELECT / INSERT**: the linked task is visible to the current user

## Task Query

Run server-side on every page load. Joins four tables:

```
tasks
  JOIN task_assignments  ON task_assignments.task_id = tasks.id
  JOIN workspace_members ON workspace_members.id = task_assignments.member_id
  JOIN workspaces        ON workspaces.id = tasks.workspace_id
WHERE workspace_members.auth_user_id = current user
  AND tasks.parent_task_id IS NULL          -- top-level tasks only
  AND workspaces.kind = $workspace          -- if workspace param set
ORDER BY task_assignments.member_sort_key
```

Each task row also carries `assignee_count` (subquery on `task_assignments`) to derive the shared flag (`assignee_count > 1`).

If `?view=shared`: additional filter `assignee_count > 1`.

## Deadline Bucketing (server-side)

Computed from `due_at` and `completed_at` at query time:

| Condition | Section | Badge colour |
|---|---|---|
| `completed_at` is set | Completed | Grey |
| `due_at < now` | Overdue | Red |
| `due_at < now + 24h` | Today | Yellow |
| `due_at ≥ now + 24h` or null | Upcoming | Green / none |

Tasks without a deadline show no badge and land in Upcoming.

## Server Actions (`src/app/tasks/actions.ts`)

| Action | Signature | DB operations |
|---|---|---|
| `completeTask` | `(taskId: string)` | `UPDATE tasks SET completed_at = now() WHERE id = taskId` |
| `deleteTask` | `(taskId: string)` | `DELETE FROM tasks WHERE id = taskId` (cascades to assignments) |
| `createTask` | `({ title, dueAt?, workspaceId, memberIds[] })` | INSERT task → INSERT task_assignments for each member; sort key = MAX(existing) + 1000 |

Each action calls `revalidatePath("/tasks")` on success.

## UI Components

### Modified

**`src/app/tasks/page.tsx`** (Server Component)
- Reads `searchParams` for workspace/view filters
- Fetches current user → member rows → tasks via query above
- Fetches user's workspaces for sidebar and new-task modal
- Passes all data down as props

**`src/components/task-card.tsx`**
- Accepts `taskId` and wires complete/delete actions
- Complete: circle button on left — calls `completeTask`, renders as checkmark when `completed_at` set, greyed-out title
- Delete: trash icon on right — replaces drag-handle dots; calls `deleteTask` after `window.confirm`

### New

**`src/app/tasks/actions.ts`** — the three Server Actions described above

**`src/app/tasks/new-task-modal.tsx`** (Client Component)
- Triggered by "New task" sidebar button
- Fields: Title (required), Due date (optional date picker), Workspace (dropdown), Assignees (multi-select, populated from workspace members, updates when workspace changes)
- On submit: calls `createTask` action, closes modal

**`src/app/tasks/completed-section.tsx`** (Client Component)
- Collapsible section at bottom of task list
- Closed by default; toggle label shows count ("3 completed")
- Renders greyed-out TaskCards without complete/delete actions

## Sidebar

Remains server-rendered. Workspace and view links become `<Link>` tags updating URL params. Active state derived from current `searchParams`. Workspaces populated from the user's real workspace rows (not hardcoded).

## Assignee Visibility Rule

A task is visible only to members who have a `task_assignments` row for it. If Alice creates a task and assigns it only to Bob, Alice cannot see it. The task creator is not auto-included — assignee selection is explicit.

## New Task Sort Key

`member_sort_key = MAX(existing member_sort_key for this member) + 1000`

New tasks land at the bottom of each member's list. If no tasks exist yet, default to `1000`.

## Out of Scope

- Subtasks
- Priority reordering (drag-and-drop)
- Task detail / updates view
- Recurring tasks
- Speech-to-text
