# UI Improvements: Sidebar Responsiveness, Task Modal Fixes & Subtasks

**Date:** 2026-03-24
**Status:** Approved

---

## Overview

Three related improvements to the task manager UI:

1. Make the sidebar accessible on partial/small screens via a top tab bar
2. Fix the new task modal so workspace and assignee fields are always visible, and add description + subtasks fields
3. Support inline subtask creation within the new task modal

---

## 1. Sidebar — Top Tab Bar on Small Screens

### Problem
The sidebar uses `hidden md:flex`, making it completely inaccessible when the window is narrower than the `md` breakpoint (~768px).

### Solution
Add a horizontally-scrollable pill tab strip that appears **below the navbar** on small screens and is hidden on medium+ screens (`flex md:hidden`). The existing sidebar remains unchanged for medium+ screens.

### Tab Strip Contents (same items as sidebar, same order)
- **+ New task** button — triggers the shared task modal (see Modal Trigger Refactor below)
- **My Tasks** pill — default view (`href="/tasks"`)
- **Shared** pill — `href="/tasks?view=shared"`
- One pill per workspace — `href="/tasks?workspace=ws.kind"`

### Workspace Filter Note
Workspace pills link using `?workspace=ws.kind`, consistent with the existing sidebar behavior. Two workspaces of the same kind produce the same URL — this is a known limitation accepted as-is.

### Behaviour
- Active pill: `bg-[var(--color-accent-subtle)] text-[var(--color-accent-text)]`; detected by matching `searchParams` against each pill's href params (same logic as the existing sidebar's `active` prop, extracted to a shared helper)
- Strip container: `overflow-x-auto`; each pill: `shrink-0 whitespace-nowrap` to prevent wrapping
- If `workspaces` is empty: the strip shows only My Tasks + Shared + the New task button (no workspace pills, no placeholder text)
- Positioned in `src/app/tasks/page.tsx` above the `<main>` content block, wrapped in `<div className="flex md:hidden ...">`

### Modal Trigger Refactor
Currently `NewTaskModal` renders both the trigger button and the modal overlay as a single self-contained component. To allow both the sidebar and the tab strip to trigger the same modal without duplicating state, the modal is refactored:

- **Lift state to the page**: `isOpen` state moves to `page.tsx` (or a new `TasksLayout` client wrapper if the page is a Server Component — see note below)
- **`NewTaskModal` becomes pure overlay**: it accepts `open: boolean` and `onClose: () => void` props and no longer renders a trigger button
- **Trigger buttons** in the sidebar and tab strip call a shared `openModal` callback (passed as a prop)
- The sidebar's existing "+ New task" button is updated to call `openModal()` instead of managing its own state

> **Note:** `page.tsx` is currently a Server Component. The `isOpen` state + `openModal` callback should live in a new `"use client"` wrapper component (`TasksPageClient`) that is rendered inside the Server Component. The Server Component fetches data and passes it down; `TasksPageClient` owns the modal open state.

### Active State Component
A new `TabPill` client component handles the tab strip pills. It reads `useSearchParams()` to determine active state, matching on `workspace` and `view` params. This replaces the inline active logic used in the sidebar and is not shared with the sidebar (the sidebar keeps its existing `SidebarLink` component).

---

## 2. New Task Modal — Scrollability + New Fields

### Problem
- The modal card has no `max-height` or scroll, so on short/partial windows the workspace dropdown and assignee checkboxes are clipped below the viewport.
- No description field.
- No subtask support.

### Fix: Make Modal Scrollable
Add `max-h-[90vh] overflow-y-auto` to the modal card element.

### New Field: Description (optional)
- Textarea, 3 rows, placeholder "Add details…"
- Sits between **Title** and **Due date**
- Stored in the `description` column on `tasks` (already in schema)

### New Field: Subtasks (optional)
- Sits between **Assign to** and the action buttons
- See Section 3 for interaction design

### Final Field Order
```
Title *
Description (optional)
Due date (optional) | Workspace *
Assign to *
Subtasks (optional)
[Add task]  [Cancel]
```

### State Reset After Submission
After a successful submit, all form state resets to initial values:
- `title` → `""`
- `description` → `""`
- `dueAt` → `""`
- `workspaceId` → `workspaces[0]?.id ?? ""`
- `selectedMemberIds` → current user's member IDs scoped to `workspaces[0]` (same logic as `handleWorkspaceChange` applied to the first workspace)
- `subtaskRows` → `[]`

All form inputs (title, description, due date, workspace, assignee checkboxes, subtask inputs) are disabled while `pending` is `true`.

---

## 3. Subtasks — Inline Row Interaction

### Interaction
- Empty state: just the `+ Add subtask` link, no rows, no divider
- Clicking `+ Add subtask` appends a new editable row
- Each row: `○  [title input — flex:1]  [date input]  [✕]`
- Pressing `Enter` in the title field: if the current title is **non-empty**, appends a new empty row and focuses it; if the title is **empty**, no-op
- Clicking `✕` removes that row
- Rows are stored in local component state: `subtaskRows: { title: string; dueAt: string }[]`

### Date Input Type for Subtasks
Subtask due dates use `type="date"` (day-level granularity). The bare ISO date string (e.g., `"2026-03-24"`) is converted to a UTC midnight timestamp (`"2026-03-24T00:00:00Z"`) inside the `createTaskWithSubtasks` server action before writing to Supabase.

### Data Model
- Subtasks use the existing `parent_task_id` column — no schema changes needed
- Each subtask has its own `title` and optional `due_at`
- Subtasks are assigned to the same members as the parent task

---

## 4. Server Action: `createTaskWithSubtasks`

A single new server action replaces the client-side sequencing for subtask creation.

### Signature
```ts
async function createTaskWithSubtasks(input: {
  title: string
  description?: string
  dueAt?: string           // datetime-local string (parent)
  workspaceId: string
  memberIds: string[]
  subtasks: { title: string; dueAt?: string }[]  // bare date strings for subtasks
}): Promise<{ subtaskErrors: number }>
```

### Behaviour
1. Insert parent task with `title`, `description`, `due_at`, `workspace_id`; get back `parentId`
2. Insert `task_assignments` for each `memberId` on the parent
3. For each subtask: insert task with `parent_task_id: parentId`, `due_at` converted to `"${dueAt}T00:00:00Z"` if provided
4. Insert `task_assignments` for each `memberId` on each subtask
5. Call `revalidatePath("/tasks")` once at the end
6. Return `{ subtaskErrors: N }` where N = number of subtasks that failed to insert (0 means full success)

### Error Handling in the Modal
- If the action **throws** (parent insert failed): catch the error, show `toast("Failed to create task", "error")`, keep modal open with all values intact
- If the action returns `{ subtaskErrors: N > 0 }`: show `toast("Task created, but ${N} subtask(s) could not be saved", "warning")`, close modal
- If `subtaskErrors === 0`: close modal silently (existing success behavior)

### Changes to `createTask`
`createTask` keeps its current signature and `void` return type. It is **not** changed. The modal calls `createTaskWithSubtasks` for all new task creation (with or without subtasks — subtasks array is just empty `[]` when none are added). `createTask` remains available for other callers (complete/delete actions are unaffected).

---

## Out of Scope
- Editing subtasks after creation
- Drag-to-reorder subtasks
- Nested subtasks
- Assigning subtasks to different members than the parent
- Filtering by workspace id (currently by `ws.kind`)

---

## Files Affected

| File | Change |
|------|--------|
| `src/app/tasks/page.tsx` | Extract `TasksPageClient` client wrapper; pass `openModal` to sidebar + tab strip |
| `src/app/tasks/tasks-page-client.tsx` | New client wrapper: owns `isOpen` state, renders sidebar, tab strip, modal |
| `src/app/tasks/tab-pill.tsx` | New `TabPill` component with `useSearchParams`-based active detection |
| `src/app/tasks/new-task-modal.tsx` | Remove self-contained trigger; accept `open`/`onClose` props; add description + subtasks; call `createTaskWithSubtasks`; full state reset |
| `src/app/tasks/actions.ts` | Add `createTaskWithSubtasks` server action |
