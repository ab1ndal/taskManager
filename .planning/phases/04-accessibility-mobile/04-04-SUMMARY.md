---
phase: 04-accessibility-mobile
plan: 04
subsystem: task-modals
tags: [accessibility, dialog, focus-management, testing]
dependency-graph:
  requires: ["Dialog component (src/components/dialog.tsx, from 04-01)"]
  provides: ["new-task-modal.tsx on Dialog primitive", "edit-task-modal.tsx on Dialog primitive"]
  affects: ["04-05-PLAN.md (task-card.tsx + delete confirm dialog conversion, no file overlap)"]
tech-stack:
  added: []
  patterns: ["initialFocusSelector over autoFocus for content shown via showModal()", "showModal()/close() jsdom mock that toggles the open attribute so RTL's accessibility tree treats dialog content as visible"]
key-files:
  created: []
  modified:
    - src/app/tasks/new-task-modal.tsx
    - src/app/tasks/new-task-modal.test.tsx
    - src/app/tasks/edit-task-modal.tsx
    - src/app/tasks/edit-task-modal.test.tsx
decisions:
  - "Removed autoFocus from both modals' title inputs — RESEARCH.md flags autofocus as unreliable for content shown via showModal() after mount, and jsdom's React autoFocus polyfill produced a false-positive RED-phase pass; initialFocusSelector on Dialog is now the single source of truth for initial focus"
  - "jsdom showModal()/close() mocks now toggle the `open` attribute (not just no-op jest.fn()) — without it, testing-library's accessibility tree treats all dialog content as hidden and every getByRole query inside the modal fails"
metrics:
  duration: "~20 min"
  completed: "2026-07-26"
---

# Phase 4 Plan 04: New-Task & Edit-Task Modal Dialog Conversion Summary

Converted both task modals from hand-rolled `<div className="fixed inset-0 ...">` overlays to
the native `Dialog` primitive built in 04-01, gaining a real focus trap, Escape-to-close, and
initial-focus-on-open for free, while leaving every Phase 2 close-timing behavior (optimistic
close for create, close-before-resolve-with-no-optimistic-update for edit) byte-for-byte intact.

## What Was Built

**Task 1 — new-task-modal.tsx (TDD):** Wrote 2 failing tests first (RED, commit `5095cb6`) —
title input has focus on open, and firing a native `close` event on the dialog element calls the
same `onClose` prop Cancel uses. Both overlay divs (the `workspaces.length === 0` empty-state
branch and the main form branch) now render through `<Dialog>`. The empty-state branch uses
Dialog's default styling with a custom `className` (no `ariaLabelledBy` — it's a single paragraph,
not a labelled form). The main branch passes `initialFocusSelector="input[type=text]"` and
`ariaLabelledBy="new-task-modal-title"`, with a matching `id` added to the `<h3>`. `handleSubmit`
was not touched — the optimistic-close sequence (`onTaskCreated?.()`, `resetForm()`, `onClose()`,
`toast()`) fires in the same order as before.

**Task 2 — edit-task-modal.tsx (TDD):** Same pattern — 2 failing tests first (RED, commit
`c94ba2c`), then the single overlay div replaced with `<Dialog>` (GREEN, commit `b78ece3`).
`handleSubmit`'s `onClose()`-before-`startTransition` ordering (no optimistic list update) was
not touched.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `autoFocus` on the title input produced a false-positive RED-phase test pass**
- **Found during:** Task 1, running the new "focuses the title input on open" test before any
  Dialog conversion (fail-fast RED-phase check per TDD execution rules)
- **Issue:** React's `autoFocus` prop calls `.focus()` directly during commit, independent of
  actual browser `autofocus`-attribute semantics. In jsdom this made the test pass even with the
  old fixed-`<div>` modal (no Dialog, no `showModal()`), which contradicts RESEARCH.md's finding
  that `autofocus` does not reliably fire for content revealed via `showModal()` in real browsers.
  A passing RED-phase test masks whether the assertion is actually testing production behavior.
- **Fix:** Removed the `autoFocus` attribute from both modals' title inputs so initial focus is
  driven exclusively by `Dialog`'s `initialFocusSelector`, matching what plan `<interfaces>`
  recommended ("more reliable than the autofocus attribute inside a dynamically-shown native
  dialog"). Re-ran the test — genuinely failed (RED) before the Dialog conversion, then passed
  (GREEN) after.
- **Files modified:** `src/app/tasks/new-task-modal.tsx`, `src/app/tasks/edit-task-modal.tsx`
- **Commits:** `5095cb6`, `c94ba2c` (RED, autoFocus removed), `f78b540`, `b78ece3` (GREEN)

**2. [Rule 3 - Blocking issue] jsdom's `showModal()`/`close()` no-op mocks left dialog content
inaccessible to `getByRole` queries**
- **Found during:** Task 1, first GREEN-phase test run — 26 of 37 tests failed with "unable to
  find an accessible element" for every `getByRole("button", ...)` query inside the modal
- **Issue:** jsdom does not implement `<dialog>`'s native `showModal()`, so `dialog.test.tsx`'s
  existing pattern was to mock it as a bare `jest.fn()`. That leaves the dialog element without
  its `open` attribute, and testing-library's accessibility tree treats content inside a
  non-open `<dialog>` as hidden — every default (non-`{ hidden: true }`) query inside it fails,
  which would have broken all 35 pre-existing tests in each modal's test file, not just the 2 new
  ones.
- **Fix:** Changed the `beforeAll` mocks in both test files so `showModal()` sets the `open`
  attribute and `close()` removes it, matching real `<dialog>` semantics closely enough for RTL's
  accessibility-tree computation to treat the content as visible.
- **Files modified:** `src/app/tasks/new-task-modal.test.tsx`, `src/app/tasks/edit-task-modal.test.tsx`
- **Commits:** `5095cb6`, `c94ba2c`

Neither deviation altered a plan artifact, acceptance criterion, or locked Phase 2 behavior —
both are test-infrastructure and initial-focus-mechanism fixes required to make the plan's own
acceptance criteria (all existing tests + 2 new behavior tests, both pass) achievable and honest.

## Verification

- `npx jest new-task-modal.test.tsx edit-task-modal.test.tsx` → 2 suites, 43/43 tests pass
- `npx jest` (full suite) → 14 suites, 162/162 tests pass, no regression in `tasks-page-client.test.tsx`
- `npx tsc --noEmit` → no errors
- `grep -c "fixed inset-0" src/app/tasks/new-task-modal.tsx` → 0
- `grep -c "fixed inset-0" src/app/tasks/edit-task-modal.tsx` → 0
- `grep -c 'from "@/components/dialog"' src/app/tasks/new-task-modal.tsx` → 1
- `grep -c 'from "@/components/dialog"' src/app/tasks/edit-task-modal.tsx` → 1
- `npx eslint` on the four changed files → 0 errors, 1 pre-existing warning (`currentMemberIds`
  unused in `edit-task-modal.tsx`, present before this plan, out of scope)

## TDD Gate Compliance

**new-task-modal.tsx:**
- RED: `5095cb6 test(04-04): add failing Dialog behavior tests for new-task-modal` — 2/37 tests
  failed (confirmed genuinely red after removing the `autoFocus` false-positive), 35 pre-existing
  tests still passed
- GREEN: `f78b540 feat(04-04): convert new-task-modal to Dialog primitive` — 37/37 tests pass

**edit-task-modal.tsx:**
- RED: `c94ba2c test(04-04): add failing Dialog behavior tests for edit-task-modal` — 2/6 tests
  failed, 4 pre-existing tests still passed
- GREEN: `b78ece3 feat(04-04): convert edit-task-modal to Dialog primitive` — 6/6 tests pass

REFACTOR: not needed, no follow-up cleanup required.

Gate sequence satisfied for both files.

## Commits

| Task | Type | Commit | Description |
|------|------|--------|-------------|
| 1 (RED) | test | `5095cb6` | Failing Dialog behavior tests + autoFocus removal, new-task-modal |
| 1 (GREEN) | feat | `f78b540` | Convert new-task-modal to Dialog primitive |
| 2 (RED) | test | `c94ba2c` | Failing Dialog behavior tests + autoFocus removal, edit-task-modal |
| 2 (GREEN) | feat | `b78ece3` | Convert edit-task-modal to Dialog primitive |

## Self-Check: PASSED

- FOUND: src/app/tasks/new-task-modal.tsx (imports Dialog, no fixed inset-0)
- FOUND: src/app/tasks/edit-task-modal.tsx (imports Dialog, no fixed inset-0)
- FOUND: src/app/tasks/new-task-modal.test.tsx (Dialog primitive describe block)
- FOUND: src/app/tasks/edit-task-modal.test.tsx (Dialog primitive describe block)
- FOUND commit 5095cb6
- FOUND commit f78b540
- FOUND commit c94ba2c
- FOUND commit b78ece3
