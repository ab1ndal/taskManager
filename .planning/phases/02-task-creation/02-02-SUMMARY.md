---
phase: 02-task-creation
plan: 02
subsystem: ui
tags: [react, optimistic-ui, state, testing-library, jest, tdd, task-list]

# Dependency graph
requires:
  - phase: 02-task-creation
    plan: 01
    provides: new-task-modal.tsx with onTaskCreated/onTaskError props and optimistic close
provides:
  - tasks-page-client.tsx with localTasks state, optimisticTaskIds, handleTaskCreated, handleTaskError
  - page.tsx passing initialTasks + userName to client (task rendering moved out of server)
  - tasks-page-client.test.tsx covering initial render, callback wiring, optimistic opacity
affects:
  - phase 05 (task lifecycle — delete/edit/complete — will interact with localTasks state)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Optimistic insert: handleTaskCreated appends task + marks ID in optimisticTaskIds Set
    - Optimistic rollback: handleTaskError removes task + clears ID on server error
    - Opacity-40 wrapper div: optimistic tasks rendered at 40% opacity until confirmed
    - initialTasks hydration: server passes rawTasks (unfiltered) to client; client applies filters + bucketing

key-files:
  created:
    - src/app/tasks/tasks-page-client.test.tsx
  modified:
    - src/app/tasks/tasks-page-client.tsx
    - src/app/tasks/page.tsx

key-decisions:
  - "Task list rendering moved entirely to TasksPageClient — server passes raw data, client filters and buckets"
  - "initialTasks passed unfiltered from server; URL filters (workspaceFilter, viewFilter) applied client-side"
  - "userName passed as optional prop to avoid server data access in client component"
  - "TabPill useSearchParams mock added to test file — Rule 3 fix (blocking test infrastructure issue)"

requirements-completed:
  - TASK-02

# Metrics
duration: 4min
completed: 2026-03-27
---

# Phase 02 Plan 02: TasksPageClient Refactor + Optimistic Insert Summary

**TasksPageClient refactored to own task list state with optimistic insert/rollback and 40% opacity pending indicator**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-27T03:43:00Z
- **Completed:** 2026-03-27T03:46:25Z
- **Tasks:** 3 (Task 0 stub tests, Task 1 component refactor, Task 2 page.tsx update)
- **Files modified:** 3

## Accomplishments

- Created `tasks-page-client.test.tsx` with 5 stub tests (RED phase) covering initial render, callback wiring, optimistic behavior
- Refactored `tasks-page-client.tsx`: removed `children: React.ReactNode`, added `initialTasks: RawTask[]`, `localTasks` state, `optimisticTaskIds` Set, `handleTaskCreated`, `handleTaskError`, full task list rendering (buckets + TaskCard + CompletedSection), `opacity-40` optimistic indicator
- Updated `page.tsx`: removed task rendering, removed `bucketTasks` call and URL filter logic, passes `initialTasks={rawTasks}` and `userName={name}` to client via self-closing tag
- All 68 task suite tests pass, TypeScript compiles clean

## Task Commits

Each task was committed atomically:

1. **Task 0: Stub tests** - `38a1c10` (test)
2. **Task 1: Refactor TasksPageClient** - `df34369` (feat)
3. **Task 2: Update page.tsx** - `70391fc` (feat)

## Files Created/Modified

- `src/app/tasks/tasks-page-client.test.tsx` — New: 5 tests for initial render, callback wiring, optimistic behavior
- `src/app/tasks/tasks-page-client.tsx` — Rewritten: owns task list state, renders optimistic tasks at 40% opacity, wires modal callbacks
- `src/app/tasks/page.tsx` — Updated: passes initialTasks + userName, removes all task rendering (TaskCard, CompletedSection, bucketTasks)

## Decisions Made

- Task list rendering moved entirely to TasksPageClient — server passes raw data, client filters and buckets
- initialTasks passed unfiltered from server; URL filters applied client-side (consistent with workspaceFilter/viewFilter props)
- userName passed as optional prop to avoid server data access in client component
- TabPill useSearchParams mock added to test file (deviation Rule 3 — blocked tests until added)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added next/navigation mock to test file**
- **Found during:** Task 0 verification (tests failed due to TabPill calling useSearchParams)
- **Issue:** TabPill component uses `useSearchParams()` from `next/navigation`. Without a mock, all render tests threw an error at the TabPill call site before any assertions could run.
- **Fix:** Added `jest.mock("next/navigation", () => ({ useSearchParams: jest.fn(() => new URLSearchParams()) }))` to test file
- **Files modified:** src/app/tasks/tasks-page-client.test.tsx
- **Commit:** df34369 (included in Task 1 commit since test fix enabled GREEN)

---

**Total deviations:** 1 auto-fixed (Rule 3 - Blocking)
**Impact on plan:** Minimal — test infrastructure fix required for tests to run. No behavioral change.

## Issues Encountered

None beyond the TabPill mock deviation.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Task list is fully wired end-to-end: submit modal → task appears immediately at 40% opacity → server confirms → opacity returns to 100%
- Error path: server failure → optimistic task removed from list → error toast shown
- Phase 05 (task lifecycle) can now interact with `localTasks` state for delete/edit/complete operations

## Self-Check

Files exist:
- src/app/tasks/tasks-page-client.test.tsx: FOUND
- src/app/tasks/tasks-page-client.tsx: FOUND
- src/app/tasks/page.tsx: FOUND

Commits exist:
- 38a1c10: test(02-02): add stub tests — FOUND
- df34369: feat(02-02): refactor TasksPageClient — FOUND
- 70391fc: feat(02-02): update page.tsx — FOUND

## Self-Check: PASSED

---
*Phase: 02-task-creation*
*Completed: 2026-03-27*
