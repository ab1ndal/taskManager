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
- **+ New task** button — opens the new task modal
- **My Tasks** pill — default view
- **Shared** pill — filters to tasks with multiple assignees
- One pill per workspace (🏠 Home, 💼 Acme Corp, …) — filters by workspace kind

### Behaviour
- Active pill: accent background (`bg-[var(--color-accent-subtle)]`) + accent text
- Strip: `overflow-x-auto`, `flex-nowrap` so it scrolls horizontally if many workspaces
- Positioned in the tasks page layout, above the main content area, only on small screens
- Uses the same URL search param logic as the sidebar links (`?workspace=`, `?view=shared`)

---

## 2. New Task Modal — Scrollability + New Fields

### Problem
- The modal card has no `max-height` or scroll, so on short/partial windows the workspace dropdown and assignee checkboxes are clipped below the viewport and unreachable.
- No description field.
- No subtask support.

### Fix: Make Modal Scrollable
Add `max-h-[90vh] overflow-y-auto` to the modal card element. This ensures all fields are reachable by scrolling within the modal regardless of window height.

### New Field: Description (optional)
- Textarea, 3 rows, placeholder "Add details…"
- Sits between **Title** and **Due date**
- Stored in the `description` column on the `tasks` table (already exists in schema)
- Passed to the `createTask` server action

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

---

## 3. Subtasks — Inline Row Interaction

### Interaction
- A `+ Add subtask` link at the bottom of the subtasks section appends a new editable row
- Each row: `○  [title input]  [date input]  [✕]`
- Pressing `Enter` in the title field appends another row immediately
- Clicking `✕` removes that row
- Rows are stored in local component state until the parent task is submitted

### Data Model
- Subtasks use the existing `parent_task_id` column on `tasks` — no schema changes needed
- Each subtask has its own `title` and optional `due_at`
- Subtasks are assigned to the **same members** as the parent task

### Creation Flow (server-side)
1. `createTask` is called for the parent task → returns `parentId`
2. For each subtask row, `createTask` is called with `parent_task_id: parentId`, same `workspace_id` and member assignments
3. All calls happen sequentially after parent creation; page revalidates once at the end

### Server Action Changes
- `createTask` accepts an optional `parentTaskId` parameter
- No new server action needed

---

## Out of Scope
- Editing subtasks after creation (future work)
- Drag-to-reorder subtasks
- Nested subtasks (subtasks of subtasks)
- Assigning subtasks to different members than the parent

---

## Files Affected

| File | Change |
|------|--------|
| `src/app/tasks/page.tsx` | Add top tab bar component for small screens |
| `src/app/tasks/new-task-modal.tsx` | Add `max-h-[90vh] overflow-y-auto`, description field, subtasks section |
| `src/app/tasks/actions.ts` | Add optional `parentTaskId` param to `createTask` |
