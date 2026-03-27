---
phase: 01-workspace-directory
plan: "03"
subsystem: ui
tags: [react, next.js, task-creation, workspace-guard, disabled-state]

# Dependency graph
requires:
  - phase: 01-workspace-directory
    provides: tasks-page-client.tsx and new-task-modal.tsx components from plan 01-01 and 01-02
provides:
  - Disabled-state guard on both New Task buttons when user has no workspaces
  - Early-return guard in NewTaskModal rendering "join a workspace" message instead of form
  - Defensive workspaceId submit guard in handleSubmit
affects: [tasks-ui, workspace-onboarding]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Disabled-but-visible pattern: use disabled attr + opacity-50/cursor-not-allowed instead of hiding controls"
    - "Early-return guard pattern: check invariants at top of render before main UI"
    - "Defensive submit guard: validate workspaceId even when upstream UI prevents invalid state"

key-files:
  created: []
  modified:
    - src/app/tasks/tasks-page-client.tsx
    - src/app/tasks/new-task-modal.tsx

key-decisions:
  - "Disabled-but-visible buttons: the No-Workspace banner explains context, hiding would be confusing"
  - "Two-layer defense: button disabled + modal early-return ensure no code path reaches createTaskWithSubtasks with no workspace"

patterns-established:
  - "hasWorkspace boolean: derive from workspaces.length > 0 at top of component body"
  - "workspaceId guard in handleSubmit: defensive fallback even when UI prevents invalid state"

requirements-completed: [WS-06]

# Metrics
duration: 8min
completed: 2026-03-26
---

# Phase 01 Plan 03: No-Workspace Task Creation Guard Summary

**Disabled New Task buttons and modal early-return guard prevent task creation when user belongs to no workspaces, closing UAT gap from test 6.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-03-26T23:55:00Z
- **Completed:** 2026-03-26T23:58:00Z
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments

- Both New Task buttons (mobile tab-strip + sidebar) render as visually disabled (opacity-50, cursor-not-allowed) when workspaces array is empty
- NewTaskModal renders a "join a workspace first" fallback with link to /workspaces instead of the task form when workspaces is empty
- handleSubmit guards against falsy workspaceId as a defensive fallback — prevents any code path reaching createTaskWithSubtasks without a valid workspace
- All 94 existing tests pass with no regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Disable New Task buttons when no workspaces** - `4aa371a` (fix)
2. **Task 2: Guard new-task-modal against empty workspaces** - `4660196` (fix)
3. **Task 3: Run existing test suite** - no commit (verification only, no files changed)

## Files Created/Modified

- `src/app/tasks/tasks-page-client.tsx` - Added `hasWorkspace` boolean, applied `disabled={!hasWorkspace}` and disabled classes to both New Task buttons
- `src/app/tasks/new-task-modal.tsx` - Added early-return guard rendering workspace join message, added `!workspaceId` check in handleSubmit

## Decisions Made

- Kept buttons visible but disabled rather than hidden — the No-Workspace banner already explains the reason; hiding adds confusion
- Used two-layer defense (button disabled + modal early-return) so no single point of failure can reach createTaskWithSubtasks without a workspace
- No new tests written — changes are purely presentational guards; existing 94 tests cover core task creation logic

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- UAT gap (test 6: "New task buttons disabled when user has no workspaces") is now closed
- All three plans in Phase 01 complete: workspace directory, join/leave flows, and no-workspace guards
- Phase 02 task creation context already captured in commit 50f4128

---
*Phase: 01-workspace-directory*
*Completed: 2026-03-26*
