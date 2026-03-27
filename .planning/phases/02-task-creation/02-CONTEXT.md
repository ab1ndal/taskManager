# Phase 2: Task Creation - Context

**Gathered:** 2026-03-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can create fully-formed tasks (title, optional description, optional due date, workspace, one or more assignees, optional subtasks) that appear immediately in their task list after submission. The modal and server action are largely already built — this phase audits and completes them, then adds optimistic list update for instant appearance.

Explicitly out of scope: task detail view, editing after creation, reassigning members (Phase 3).

</domain>

<decisions>
## Implementation Decisions

### Instant appearance
- Optimistic insert: task appears in the list immediately when submit is clicked (before server confirms)
- Modal closes immediately on submit — no waiting for server response
- Smart bucket placement: client-side logic mirrors server bucket rules (overdue / today / upcoming based on due date)
- On server error: remove optimistic task from list + show error toast (clean rollback, no retry inline)

### Post-create feedback
- Success toast: "Task created" fires after optimistic insert
- If subtasks partially fail: warning toast "Task created, but N subtask(s) could not be saved" (current behavior — keep it)
- No success toast for the subtask warning path — the warning toast covers it

### Assignee defaults
- Creator is always pre-selected as an assignee when the modal opens
- Submit is blocked if no assignee is selected — enforces visibility (a task with no assignees is invisible to everyone)
- Switching workspace resets assignee selection to the creator's member ID in the new workspace

### Subtasks
- Keep subtasks in the create modal — they're already built and working
- Phase 3 (task detail) can extend subtask management (view, edit, add after creation)

### Tests
- Server action tests: `createTaskWithSubtasks` — field coverage, assignment logic, error handling, subtask partial failure
- Modal component tests: renders correctly, submits with valid data, blocks submit when no assignee, assignee toggles, workspace switching resets assignees, error state handling
- TDD: write tests RED first, then implement GREEN

### Claude's Discretion
- Exact optimistic placeholder styling (pending visual treatment)
- Loading state on the submit button during the round-trip
- Exact bucket assignment logic implementation (can mirror server-side bucket-tasks.ts logic)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Task creation
- `docs/product.md` — Product requirements (TASK-01, TASK-02)
- `docs/db.md` — Database schema: tasks, task_assignments, member_sort_key

### Existing implementation to audit/extend
- `src/app/tasks/actions.ts` — `createTaskWithSubtasks` server action (audit field coverage + error handling)
- `src/app/tasks/new-task-modal.tsx` — Existing modal UI (add optimistic close + toast)
- `src/app/tasks/tasks-page-client.tsx` — Client shell (add optimistic state management here)
- `src/app/tasks/bucket-tasks.ts` — Bucket logic (TODAY / UPCOMING / OVERDUE) — mirror this for client-side optimistic placement
- `src/app/tasks/page.tsx` — Server component (understand data shape passed to client)

### Test patterns
- `src/app/tasks/actions.test.ts` — Existing action tests (follow this pattern)
- `src/app/tasks/new-task-modal.test.tsx` — Existing modal tests (follow this pattern)
- `src/app/tasks/bucket-tasks.test.ts` — Bucket logic tests

### Styling reference
- `src/app/globals.css` — CSS custom properties (color tokens)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/components/toaster.tsx` — `toast(msg)` / `toast(msg, "error")` / `toast(msg, "warning")` — use for success and error feedback
- `src/app/tasks/bucket-tasks.ts` — bucket assignment logic to mirror client-side for smart optimistic placement
- `createTaskWithSubtasks` in `actions.ts` — already handles title, description, dueAt, workspaceId, memberIds, subtasks. Returns `{ subtaskErrors }`.

### Established Patterns
- `useTransition` for server action pending states (already used in modal)
- Server component fetches data → passes to client shell (`tasks-page-client.tsx`)
- Optimistic state: add pending item to local state, call server action, settle or rollback on result
- `revalidatePath("/tasks")` in server action triggers background refresh after optimistic settle

### Integration Points
- Optimistic state lives in `tasks-page-client.tsx` — it owns the task list rendered to the user
- `NewTaskModal` receives `onTaskCreated` callback (or similar) to trigger optimistic insert in parent
- `bucket-tasks.ts` exports `bucketTasks()` — reuse or extract pure date logic for client-side bucketing
- `task_assignments` RLS: user can only insert assignments for their own member rows — server action handles this

### Known Issues (from STATE.md)
- `completeTask()` and `deleteTask()` have silent error handling (no error check after mutation) — audit these too if time permits but not primary Phase 2 scope
- Sort key race condition in `createTaskWithSubtasks` (sequential fetch of last sort_key) — low risk for single user, note for future

</code_context>

<specifics>
## Specific Ideas

- Optimistic task should use smart bucket placement: mirror the `bucket-tasks.ts` date logic on the client so the task lands in the right bucket (Today / Upcoming / Overdue) immediately
- Pending visual: subtle opacity or a small spinner indicator on the optimistic task card while server confirms

</specifics>

<deferred>
## Deferred Ideas

- None surfaced during discussion — all ideas stayed within Phase 2 scope

</deferred>

---

*Phase: 02-task-creation*
*Context gathered: 2026-03-26*
