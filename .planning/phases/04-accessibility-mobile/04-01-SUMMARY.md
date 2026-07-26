---
phase: 04-accessibility-mobile
plan: 01
subsystem: ui-primitives
tags: [accessibility, dialog, jest-axe, testing]
dependency-graph:
  requires: []
  provides: ["Dialog component (src/components/dialog.tsx)", "jest-axe test infrastructure"]
  affects: ["04-04-PLAN.md (new-task-modal conversion)", "04-05-PLAN.md (edit-task-modal + delete confirm conversion)"]
tech-stack:
  added: ["jest-axe@10.0.0"]
  patterns: ["native <dialog>/showModal() instead of hand-rolled focus trap", "ambient module declaration instead of adding @types/* dependency"]
key-files:
  created:
    - src/components/dialog.tsx
    - src/components/__tests__/dialog.test.tsx
    - src/types/jest-axe.d.ts
  modified:
    - package.json
    - package-lock.json
    - jest.setup.ts
decisions:
  - "Ambient .d.ts for jest-axe instead of installing @types/jest-axe — avoids a second unaudited package install just to satisfy tsc, per plan's package-install exclusion rule"
metrics:
  duration: "~25 min"
  completed: "2026-07-25"
---

# Phase 4 Plan 01: Dialog Primitive + jest-axe Infrastructure Summary

Native `<dialog>`/`showModal()` wrapper component (`Dialog`) plus jest-axe test
infrastructure, giving the three Wave 2 modal conversions (new-task, edit-task,
delete-confirm) a single accessible primitive with focus trap, Escape-to-close,
and backdrop-click-to-close for free from the browser.

## What Was Built

**Task 1 — jest-axe infrastructure:** Installed `jest-axe@10.0.0` (audited package
per RESEARCH.md Package Legitimacy Audit — no checkpoint required). Registered
`jest-axe/extend-expect` in `jest.setup.ts` so `toHaveNoViolations()` is available
globally in every test file.

**Task 2 — Dialog component (TDD):** Wrote 7 failing tests first (RED, commit
`dd6fb9f`) covering `aria-labelledby`, `showModal()` invocation on mount,
`initialFocusSelector` focus behavior, native `close` event → `onClose`, backdrop
click → `onClose`, child click → no `onClose`, and an axe violation check. Then
implemented `src/components/dialog.tsx` (GREEN, commit `13330e5`) as a mount-only
client component: a `useEffect` with an empty dependency array calls
`dialogRef.current.showModal()` and optionally focuses the `initialFocusSelector`
match. No hand-rolled focus trap or `keydown === "Escape"` handler exists —
`showModal()` provides both natively. Backdrop click is detected via
`event.target === dialogRef.current`, matching the "click outside closes" behavior
of the fixed-overlay modals it replaces.

All 7 tests pass (plan specified 6 behaviors; implementation split them across 7
test cases for one-assertion-per-test clarity — no behavior was added or dropped).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Missing TypeScript types for `jest-axe`**
- **Found during:** Task 2, running `npx tsc --noEmit` per the plan's `<verification>` step
- **Issue:** `jest-axe@10.0.0` ships no bundled `.d.ts`, and there is no first-party
  `@types/jest-axe` maintained by the `jest-axe` authors (only a third-party
  DefinitelyTyped package). Compiling failed with `TS7016` (implicit `any`) and
  `TS2339` (`toHaveNoViolations` not on `JestMatchers`).
- **Fix:** Added `src/types/jest-axe.d.ts` — an ambient module declaration for
  `axe()` and `toHaveNoViolations()`, plus a `jest.Matchers<R>` augmentation. This
  satisfies `tsc --noEmit` without installing a second, unaudited package
  (`@types/jest-axe`), staying inside this plan's package-install exclusion rule.
- **Files modified:** `src/types/jest-axe.d.ts` (new, not in original `files_modified` list)
- **Commit:** `13330e5` (bundled with the Dialog implementation commit)

None of the plan's core artifacts, behavior, or acceptance criteria changed —
this is a types-only addition required to make the plan's own verification
command (`npx tsc --noEmit`) pass cleanly.

## Verification

- `npm ls jest-axe` → `jest-axe@10.0.0` installed
- `npx jest dialog.test.tsx` → 7/7 tests pass
- `npx jest` (full suite) → 12 suites, 150/150 tests pass, no regressions
- `npx tsc --noEmit` → no errors
- `grep -n "Escape" src/components/dialog.tsx` → no matches (no hand-rolled Escape handler)

## TDD Gate Compliance

- RED: `dd6fb9f test(04-01): add failing tests for Dialog primitive` — verified failing (module not found) before this commit
- GREEN: `13330e5 feat(04-01): implement Dialog native <dialog> wrapper component` — all 7 tests pass after this commit
- REFACTOR: not needed, no follow-up cleanup required

Gate sequence satisfied.

## Commits

| Task | Type | Commit | Description |
|------|------|--------|-------------|
| 1 | chore | b9bb5d5 | Install jest-axe, register matcher |
| 2 (RED) | test | dd6fb9f | Failing tests for Dialog |
| 2 (GREEN) | feat | 13330e5 | Dialog implementation + jest-axe ambient types |

## Self-Check: PASSED

- FOUND: src/components/dialog.tsx
- FOUND: src/components/__tests__/dialog.test.tsx
- FOUND: src/types/jest-axe.d.ts
- FOUND: jest.setup.ts contains `jest-axe/extend-expect`
- FOUND commit b9bb5d5
- FOUND commit dd6fb9f
- FOUND commit 13330e5
