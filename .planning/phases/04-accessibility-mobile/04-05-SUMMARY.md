---
phase: 04-accessibility-mobile
plan: 05
subsystem: task-card-accessibility
tags: [accessibility, touch-targets, aria-label, confirm-dialog, testing]
dependency-graph:
  requires: ["04-01 (Dialog primitive)"]
  provides: ["DeleteConfirmDialog component (src/components/delete-confirm-dialog.tsx)", "44px touch targets on task-card.tsx"]
  affects: []
tech-stack:
  added: []
  patterns: ["mount-only Dialog wrapper with if (!open) return null guard, matching new-task-modal's existing pattern"]
key-files:
  created:
    - src/components/delete-confirm-dialog.tsx
    - src/components/__tests__/delete-confirm-dialog.test.tsx
  modified:
    - src/components/task-card.tsx
    - src/components/__tests__/task-card.test.tsx
decisions:
  - "Worktree branch was 25 commits behind main (missing all of phase-04 wave 1, including the Dialog primitive this plan depends on). Fast-forward merged main into the worktree branch before starting — 0 commits diverged so no conflict risk, and it's a non-destructive git operation."
metrics:
  duration: "~20 min"
  completed: "2026-07-25"
---

# Phase 4 Plan 05: Task Card Touch Targets + Delete Confirm Dialog Summary

44px touch targets and task-scoped aria-labels on all four task-card button types (complete, edit,
delete, subtask toggle), plus a new `DeleteConfirmDialog` built on the `Dialog` primitive from 04-01
that replaces `window.confirm` for task deletion with Cancel-first focus.

## What Was Built

**Task 1 (TDD) — DeleteConfirmDialog:** Wrote 5 failing tests first (RED, commit `d554f88`)
covering Cancel-first focus, `onConfirm`/`onCancel` wiring via distinct aria-labels
(`Confirm delete "..."` / `Cancel delete`), `min-h-11` on both buttons, and an axe violations
check. Implemented `src/components/delete-confirm-dialog.tsx` (GREEN, commit `7abb69c`) as a
client component wrapping `Dialog` from 04-01, guarded by `if (!open) return null` (matching the
existing mount-only pattern in `new-task-modal.tsx`), with `initialFocusSelector="[data-cancel-button]"`
so Cancel — not the destructive Delete button — receives focus on open.

**Task 2 (TDD) — task-card.tsx wiring:** Updated the existing test file first (RED, commit
`f7f86ff`) to assert the new task-scoped labels and 44px classes, and to cover the two-step
delete-confirm flow (click delete-trigger → dialog opens without calling `deleteTask` → click
confirm → `deleteTask` called, failure still toasts). Then (GREEN, commit `3fcef18`):
- Complete button: `aria-label="Mark complete"` → `` `Mark "${title}" complete` ``, added
  `w-11 h-11 flex items-center justify-center` (SVG stays 18px).
- Edit button: `aria-label="Edit task"` → `` `Edit "${title}"` ``, same sizing classes added.
- Delete button: `aria-label="Delete task"` → `` `Delete "${title}"` ``, same sizing classes;
  `onClick` now sets `deleteConfirmOpen` state instead of calling `window.confirm` inline.
- Subtask toggle: `aria-label="Complete subtask"` → `` `Mark "${sub.title}" complete` ``, same
  sizing classes.
- `<DeleteConfirmDialog>` rendered after the main button row, wired to the new
  `deleteConfirmOpen` state; confirming closes the dialog and calls the same
  `runAction(() => deleteTask(taskId), "Failed to delete task")` as before.

All 5 + 6 behavior tests pass (14 total in task-card.test.tsx including 4 pre-existing baseline
tests updated in place); full suite (167 tests) and `tsc --noEmit` are clean.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Worktree branch missing prerequisite commits**
- **Found during:** Initial file discovery — `src/components/dialog.tsx` (the 04-01 dependency)
  did not exist in the worktree, and `.planning/phases/04-accessibility-mobile/` was entirely
  absent.
- **Issue:** This worktree's branch point was 25 commits behind `main`, predating all of
  phase-04 wave 1 (including the Dialog primitive this plan explicitly depends on via
  `depends_on: ["04-01"]`).
- **Fix:** Ran `git merge main` — a clean fast-forward (0 commits had diverged on the worktree
  branch, so no merge commit or conflict risk). This brought in `dialog.tsx`, jest-axe
  infrastructure, and all phase-04 planning docs.
- **Files affected:** none directly; this was a branch-sync operation, not a code change.
- **Commit:** fast-forward to `ebe2133`, no new commit created.

None of the plan's core artifacts, behavior, or acceptance criteria changed — this was
purely a prerequisite-availability fix, required before Task 1 could even begin.

### Test infrastructure notes (not deviations, no plan change)

The plan's behavior tests for `DeleteConfirmDialog` assume `getByRole("button", ...)` finds the
buttons directly. In practice, jsdom's `<dialog>` element requires the native `open` attribute for
its contents to be in the accessible tree by default, and `showModal()` (which sets that attribute
natively) is mocked to a no-op in tests — the same mocking approach used in `dialog.test.tsx` from
04-01. Role queries for elements inside the dialog therefore need `{ hidden: true }`, matching the
pattern `dialog.test.tsx` already used for `getByRole("dialog", { hidden: true })`. This did not
change any assertion's intent, only the query option needed to reach the same element.

## Verification

- `npm test -- delete-confirm-dialog.test.tsx` → 5/5 pass
- `npm test -- task-card.test.tsx` → 14/14 pass
- `npm test` (full suite) → 15 suites, 167/167 tests pass, no regressions
- `npx tsc --noEmit` → no errors
- `grep -c "window.confirm" src/components/task-card.tsx` → 0
- `grep -c "w-11 h-11" src/components/task-card.tsx` → 4
- `grep -c "data-cancel-button" src/components/delete-confirm-dialog.tsx` → 2
- `grep -c "Confirm delete" src/components/delete-confirm-dialog.tsx` → 1

## TDD Gate Compliance

**Task 1:**
- RED: `d554f88 test(04-05): add failing tests for DeleteConfirmDialog` — verified failing
  (module not found) before this commit
- GREEN: `7abb69c feat(04-05): implement DeleteConfirmDialog with Cancel-first focus` — all 5
  tests pass after this commit
- REFACTOR: not needed

**Task 2:**
- RED: `f7f86ff test(04-05): update task-card tests for 44px targets and delete confirm flow` —
  verified 6 new/changed tests failing before this commit (8 unrelated pre-existing tests still
  passed)
- GREEN: `3fcef18 feat(04-05): 44px touch targets, task-scoped labels, delete confirm wiring in
  task-card` — all 14 tests pass after this commit
- REFACTOR: not needed

Gate sequence satisfied for both tasks.

## Commits

| Task | Type | Commit | Description |
|------|------|--------|-------------|
| 1 (RED) | test | d554f88 | Failing tests for DeleteConfirmDialog |
| 1 (GREEN) | feat | 7abb69c | DeleteConfirmDialog implementation |
| 2 (RED) | test | f7f86ff | Updated task-card tests for 44px targets + delete confirm flow |
| 2 (GREEN) | feat | 3fcef18 | 44px touch targets, task-scoped labels, delete confirm wiring |

## Self-Check: PASSED

- FOUND: src/components/delete-confirm-dialog.tsx
- FOUND: src/components/__tests__/delete-confirm-dialog.test.tsx
- FOUND commit d554f88
- FOUND commit 7abb69c
- FOUND commit f7f86ff
- FOUND commit 3fcef18
