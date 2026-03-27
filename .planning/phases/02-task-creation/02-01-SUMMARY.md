---
phase: 02-task-creation
plan: 01
subsystem: ui
tags: [react, toast, optimistic-ui, testing-library, jest, tdd]

# Dependency graph
requires:
  - phase: 01-workspace-directory
    provides: new-task-modal.tsx with base form, createTaskWithSubtasks action
provides:
  - toaster.tsx with "warning" type and amber styling
  - new-task-modal.tsx with optimistic close, onTaskCreated callback, success/warning/error toast feedback
  - new-task-modal.test.tsx covering all toast paths and onTaskCreated/onTaskError callbacks
affects:
  - 02-02 (task list page will wire onTaskCreated to insert optimistic task)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Optimistic UI: call onTaskCreated + onClose + toast BEFORE awaiting server action
    - Snapshot form state before resetForm() to avoid closure-over-stale-state in async callback
    - TDD RED-GREEN: write failing tests before implementing code

key-files:
  created: []
  modified:
    - src/components/toaster.tsx
    - src/app/tasks/new-task-modal.tsx
    - src/app/tasks/new-task-modal.test.tsx

key-decisions:
  - "Optimistic close: modal closes and onTaskCreated fires BEFORE startTransition so user sees instant feedback"
  - "Success toast fires before server resolves (not inside the async block), so it always shows even if server is slow"
  - "Subtask warning replaces — does not stack with — the initial success toast in the async block"
  - "Form state snapshotted before resetForm() to prevent stale closure bug in startTransition async callback"

patterns-established:
  - "Snapshot pattern: const snapshot* = currentState before calling resetForm() when using async fire-and-forget"
  - "Optimistic callback order: onTaskCreated → resetForm → onClose → toast (sync), then startTransition async"

requirements-completed:
  - TASK-01

# Metrics
duration: 15min
completed: 2026-03-26
---

# Phase 02 Plan 01: Task Creation Modal Feedback Summary

**Optimistic task creation modal: warning toast type added to toaster, modal closes before server responds, onTaskCreated/onTaskError callbacks wired for parent rollback**

## Performance

- **Duration:** 15 min
- **Started:** 2026-03-26T00:00:00Z
- **Completed:** 2026-03-26T00:15:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Added "warning" type to toaster.tsx with bg-amber-500 styling (fixes silent happy path and wrong toast type for subtask errors)
- Rewired new-task-modal handleSubmit: modal closes + onTaskCreated fires immediately before server responds (true optimistic UX)
- Added onTaskCreated?(task: RawTask) and onTaskError?(taskId: string) props for parent-level optimistic insert and rollback
- 6 new tests added (3 toast feedback, 3 callback behavior), all 33 modal tests and 63 total task suite tests pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Add warning toast type + fix modal feedback** - `04ca012` (feat)
2. **Task 2: Add onTaskCreated callback + immediate pre-server close** - `40700db` (feat)

## Files Created/Modified
- `src/components/toaster.tsx` - Added "warning" type union, bg-amber-500 conditional, updated toast() signature
- `src/app/tasks/new-task-modal.tsx` - Optimistic close/callback pattern, snapshot form state, onTaskCreated/onTaskError props
- `src/app/tasks/new-task-modal.test.tsx` - Added jest.mock for toaster, toast feedback tests, onTaskCreated callback tests

## Decisions Made
- Optimistic close: modal closes and onTaskCreated fires BEFORE startTransition so user sees instant feedback
- Success toast fires before server resolves (not inside the async block), so it always shows even if server is slow
- Subtask warning replaces — does not stack with — the initial success toast in the async block
- Form state snapshotted before resetForm() to prevent stale closure bug in startTransition async callback

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Snapshot form values before resetForm() call**
- **Found during:** Task 1 (optimistic close implementation)
- **Issue:** Moving resetForm() before startTransition would cause stale state read inside async callback — description, dueAt, etc. would be empty string when createTaskWithSubtasks was called
- **Fix:** Captured all form values into const snapshot* variables before calling resetForm()
- **Files modified:** src/app/tasks/new-task-modal.tsx
- **Verification:** Existing test "passes description to createTaskWithSubtasks when filled in" still passes
- **Committed in:** 04ca012 (Task 1 commit)

**2. [Rule 1 - Bug] Updated existing "does not close modal when action throws" test**
- **Found during:** Task 1 (optimistic close breaks existing test semantics)
- **Issue:** The plan specifies modal closes BEFORE server (optimistic), but the existing test asserted onClose was NOT called after server error. After the change, onClose IS called (before server), so the test was semantically wrong for the new behavior.
- **Fix:** Replaced the test with "closes modal immediately on submit (optimistic close)" which correctly verifies the new behavior
- **Files modified:** src/app/tasks/new-task-modal.test.tsx
- **Verification:** All 33 modal tests pass
- **Committed in:** 04ca012 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 - Bug)
**Impact on plan:** Both fixes necessary for correctness. The snapshot fix prevents a data loss bug. The test update aligns tests with the new specified behavior (optimistic close).

## Issues Encountered
None — both deviations were caught and fixed proactively before tests could surface them.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Modal is fully wired: toaster supports warning, feedback fires on all three paths (success/partial/error), modal closes optimistically, onTaskCreated prop is ready for parent to wire
- Plan 02-02 can now wire onTaskCreated to insert an optimistic task row into the task list

---
*Phase: 02-task-creation*
*Completed: 2026-03-26*
