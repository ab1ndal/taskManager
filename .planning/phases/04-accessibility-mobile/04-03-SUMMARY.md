---
phase: 04-accessibility-mobile
plan: 03
subsystem: ui
tags: [nextjs, react, tailwind, accessibility, viewport, eslint]

requires:
  - phase: 03-security-hardening
    provides: "Stable RLS-backed task/workspace reads that this plan's UI wraps"
provides:
  - "Nav that only renders for signed-in users, with dead non-functional filter pills removed"
  - "Tasks page layout using min-h-dvh instead of a static 100vh calc"
  - "login-card.tsx reset-mode sync moved off useEffect onto the render-time pattern"
affects: [accessibility-mobile, ui]

tech-stack:
  added: []
  patterns:
    - "Render-time state sync (compare tracked value vs derived value during render, update both in the same pass) used for login-card.tsx's URL-param-driven mode — same pattern already established in tasks-page-client.tsx for react-hooks/set-state-in-effect"

key-files:
  created:
    - src/app/layout.test.tsx
  modified:
    - src/app/layout.tsx
    - src/app/tasks/tasks-page-client.tsx
    - src/app/login/login-card.tsx

key-decisions:
  - "Nav visibility gated on the whole <nav> element via {user && (...)}, not a route group — CONTEXT.md D-15 keeps this out of scope for this phase"
  - "Removed -m-6 rather than changing layout.tsx's p-6, so gutter padding has one owner instead of two competing values"
  - "syncedResetParam tracker initializes to null (not to the derived resetParam) so the render-time sync still fires on first mount when ?mode=reset is present"

patterns-established:
  - "Render-time URL-param sync: initialize the tracked shadow state to a sentinel that differs from the first derived value so the mount-time sync isn't skipped"

requirements-completed: [U5, U7]

duration: 25min
completed: 2026-07-26
---

# Phase 04 Plan 03: Nav Cleanup & Viewport Fix Summary

**Nav hidden for signed-out users with dead filter pills removed, tasks page moved from calc(100vh) to min-h-dvh, and login-card's URL-param mode sync moved off useEffect to fix a lint error.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-07-26T04:32:00Z
- **Completed:** 2026-07-26T04:57:14Z
- **Tasks:** 3
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments
- Nav (`layout.tsx`) no longer renders for signed-out users and no longer contains three handler-less `All`/`Household`/`Work` buttons that duplicated the real `tab-pill.tsx` controls
- Tasks page main layout uses `min-h-dvh`, eliminating mobile overflow/clipping caused by `100vh` including the collapsible address bar
- `login-card.tsx`'s `react-hooks/set-state-in-effect` lint violation is resolved by moving the reset-mode URL param sync to render time

## Task Commits

Each task was committed atomically:

1. **Task 1: Delete dead nav pills and hide nav when signed out** — test: `0e5ed41`, feat: `b80b1c8`
2. **Task 2: Fix the mobile viewport unit on the tasks page** — `6347e46` (fix)
3. **Task 3: Fix the react-hooks/set-state-in-effect lint error in login-card.tsx** — `8733563` (fix)

_Task 1 used TDD (test → feat); Tasks 2 and 3 were straightforward fixes verified by existing test suites plus targeted greps._

## Files Created/Modified
- `src/app/layout.tsx` - Whole `<nav>` now wrapped in `{user && (...)}`; dead pill buttons deleted
- `src/app/layout.test.tsx` - New: covers nav absent when signed out, present with `NavUser` when signed in
- `src/app/tasks/tasks-page-client.tsx` - `min-h-[calc(100vh-52px)] -m-6` → `min-h-dvh`
- `src/app/login/login-card.tsx` - Replaced the `useEffect` that synced `?mode=reset` into `mode` state with a render-time derived-value comparison

## Decisions Made
- Kept the nav-hiding fix as a single boolean conditional rather than a route group, per CONTEXT.md D-15
- Left `layout.tsx`'s `p-6` untouched and removed `tasks-page-client.tsx`'s competing `-m-6` instead, per the plan's explicit choice (Option A) to avoid double-touching gutter ownership across other pages (`/workspaces`, `/profile`, `/login`)
- `syncedResetParam` tracker starts at `null`, not at the first-computed `resetParam` — during implementation the naive version (tracker initialized to the derived value) silently skipped the sync on first mount because both values already matched, which is exactly the mount pass the original `useEffect` relied on. Discovered via the existing `login-card.test.tsx` reset-mode suite failing 4/12 tests; fixed before commit.

## Deviations from Plan

None — plan executed exactly as written. The `syncedResetParam` initial-value fix above was implementation detail work within Task 3's own acceptance criteria (existing tests had to still pass unchanged), not a deviation from the plan's scope.

## Issues Encountered
- Initial `syncedResetParam` implementation (seeded from the derived value) passed the two new tests I'd have added but broke 4 of the 12 existing `login-card.test.tsx` reset-mode tests, because seeding from the derived value makes the tracker already "in sync" on first mount whenever the URL already carries `?mode=reset`. Fixed by seeding the tracker to `null` instead, so the first render always runs the sync check when a reset param is present — same net effect as the original `useEffect`, no test changes required.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All three targeted U5/U7 audit gaps closed; no follow-on work identified for this specific plan
- `/tasks` still has no signed-out redirect (STATE.md-tracked, explicitly out of scope here) — the hidden nav is cosmetic only, not an access-control change (see plan's `threat_model`, T-04-04, disposition: accept)

## Self-Check: PASSED

- FOUND: src/app/layout.tsx
- FOUND: src/app/layout.test.tsx
- FOUND: src/app/tasks/tasks-page-client.tsx
- FOUND: src/app/login/login-card.tsx
- FOUND: 0e5ed41
- FOUND: b80b1c8
- FOUND: 6347e46
- FOUND: 8733563

---
*Phase: 04-accessibility-mobile*
*Completed: 2026-07-26*
