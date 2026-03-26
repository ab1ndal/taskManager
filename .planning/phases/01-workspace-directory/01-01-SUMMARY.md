---
phase: 01-workspace-directory
plan: 01
subsystem: database
tags: [supabase, postgres, rls, server-actions, next-server-actions]

# Dependency graph
requires: []
provides:
  - "Migration 005 removes join_pin column and associated unique index from workspaces table"
  - "createWorkspace server action: inserts workspace without PIN, creates owner member row, returns { id, name, kind }"
  - "joinWorkspaceByDirectory server action: joins workspace by ID using admin client, inserts member row"
  - "RLS policy workspaces_insert recreated cleanly (no PIN required)"
affects:
  - 01-workspace-directory/01-02
  - workspaces UI pages

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Admin client (createAdminClient) used for workspace lookup when user is not yet a member — bypasses RLS"
    - "Server actions validate input before auth check for empty name (early return), auth check before DB operations"
    - "Display name derived from user_metadata.name > email prefix > 'Member' fallback"

key-files:
  created:
    - supabase/migrations/005_remove_workspace_pin.sql
  modified:
    - src/app/workspaces/actions.ts
    - src/app/workspaces/workspace-forms.tsx
    - src/app/workspaces/page.tsx
    - src/app/workspaces/actions.test.ts

key-decisions:
  - "joinWorkspaceByDirectory uses admin client for workspace lookup so non-members can find workspaces by ID"
  - "workspace_members_insert_self RLS policy preserved from migration 004 (not recreated in 005)"
  - "PIN join form removed from UI; workspace-forms.tsx now only exposes Create workspace"

patterns-established:
  - "Admin client pattern: import createAdminClient from @/lib/supabase/admin, call synchronously (no await)"
  - "Server action pattern: trim + validate input → auth check → DB operation → revalidatePath"

requirements-completed:
  - WS-01
  - WS-03

# Metrics
duration: 5min
completed: 2026-03-26
---

# Phase 01 Plan 01: Remove PIN System and Add Directory Join Actions Summary

**PIN-based workspace system removed from DB and server actions; replaced with directory join (by ID) using admin client for RLS bypass**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-26T23:41:37Z
- **Completed:** 2026-03-26T23:46:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Migration 005 drops `join_pin` column, unique index, and stale policy from workspaces table
- `createWorkspace` no longer generates or stores a PIN; returns `{ id, name, kind }` only
- `joinWorkspaceByDirectory(workspaceId)` replaces `joinWorkspaceByPin` — looks up workspace by ID via admin client, inserts member via regular client
- All 9 unit tests pass; full test suite (65 tests) passes
- TypeScript compilation clean for workspace files (pre-existing toast warning type error in new-task-modal.tsx deferred)

## Task Commits

Each task was committed atomically:

1. **Task 1: Migration — drop join_pin column** - `1740fed` (chore)
2. **Task 2 RED: Failing tests for new actions** - `8117879` (test)
3. **Task 2 GREEN: Implement new actions.ts** - `1aac5cf` (feat)
4. **Rule 3 auto-fix: Fix workspace UI PIN references** - `d231625` (fix)

**Plan metadata:** _(final docs commit — see below)_

_Note: TDD task 2 has RED+GREEN commits as expected_

## Files Created/Modified
- `supabase/migrations/005_remove_workspace_pin.sql` - Drops join_pin column, index, policy; recreates clean insert policy
- `src/app/workspaces/actions.ts` - Exports createWorkspace (no PIN) and joinWorkspaceByDirectory; removed generatePin and joinWorkspaceByPin
- `src/app/workspaces/actions.test.ts` - 9 tests covering both actions, all edge cases
- `src/app/workspaces/workspace-forms.tsx` - Removed PIN join form; create form only (Rule 3 fix)
- `src/app/workspaces/page.tsx` - Removed join_pin from query and type; removed PinDisplay usage (Rule 3 fix)

## Decisions Made
- Used admin client in `joinWorkspaceByDirectory` so non-members can look up a workspace by ID without being blocked by RLS — consistent with the pattern already in `joinWorkspaceByPin`
- Dropped the `formatPin` helper from workspace-forms.tsx as it has no use without a PIN field

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed TypeScript errors in workspace-forms.tsx and page.tsx**
- **Found during:** Task 2 (overall verification — `npx tsc --noEmit`)
- **Issue:** `workspace-forms.tsx` still imported `joinWorkspaceByPin` and used `join_pin` in state type; `page.tsx` still queried `join_pin` column and used `PinDisplay` — both caused TypeScript compilation errors
- **Fix:** Updated `workspace-forms.tsx` to remove PIN join form and use correct `"household" | "work"` union type; updated `page.tsx` to query only `id, name, kind` and remove PinDisplay reference
- **Files modified:** `src/app/workspaces/workspace-forms.tsx`, `src/app/workspaces/page.tsx`
- **Verification:** `npx tsc --noEmit` returns no workspace errors; all 65 tests pass
- **Committed in:** `d231625` (separate fix commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 — blocking TypeScript errors)
**Impact on plan:** Fix necessary to achieve TypeScript compilation success criterion. No scope creep — only removed PIN references that our task introduced the incompatibility for.

## Issues Encountered
- Pre-existing TypeScript error in `src/app/tasks/new-task-modal.tsx` (toast "warning" type): logged to `deferred-items.md`, out of scope for this plan.

## User Setup Required
None — migration 005 needs to be applied to Supabase when the DB is next provisioned, but no manual dashboard steps required. Run `supabase db push` or apply via migration tooling.

## Next Phase Readiness
- Server actions are ready: `createWorkspace` and `joinWorkspaceByDirectory` are exported and tested
- Plan 02 (workspace directory UI) can import both actions directly
- `pin-display.tsx` component is now unused — Plan 02 may clean it up or it can be deferred

---
*Phase: 01-workspace-directory*
*Completed: 2026-03-26*

## Self-Check: PASSED

- `supabase/migrations/005_remove_workspace_pin.sql` — FOUND
- `src/app/workspaces/actions.ts` — FOUND
- `.planning/phases/01-workspace-directory/01-01-SUMMARY.md` — FOUND
- Commits: `1740fed`, `8117879`, `1aac5cf`, `d231625` — all verified in git log
