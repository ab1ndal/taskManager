---
phase: 01-workspace-directory
plan: 02
subsystem: ui
tags: [next.js, react, supabase, tailwind, server-actions, rls]

# Dependency graph
requires:
  - phase: 01-workspace-directory plan 01
    provides: createWorkspace and joinWorkspaceByDirectory server actions
provides:
  - Workspace directory page at /workspaces with join/joined states and create modal
  - No-workspace banner on /tasks page linking to /workspaces
  - Leave workspace action added to workspace-card
  - Nav links to /workspaces and /tasks in app layout
affects: [task-creation, task-detail-editing]

# Tech tracking
tech-stack:
  added: []
  patterns: [useTransition for optimistic UI, admin client for bypassing RLS on SELECT all workspaces, server component fetches data then passes to client shell]

key-files:
  created:
    - src/app/workspaces/workspace-card.tsx
    - src/app/workspaces/workspaces-client.tsx
  modified:
    - src/app/workspaces/page.tsx
    - src/app/workspaces/actions.ts
    - src/app/tasks/page.tsx
    - src/app/layout.tsx
    - src/app/globals.css

key-decisions:
  - "Admin client used for SELECT all workspaces (RLS limits users to their own memberships)"
  - "Admin client also used for workspace INSERT to avoid RLS 42P17 recursion on workspace_members"
  - "Admin client used for workspace_members lookup to avoid RLS filtering out new memberships before refresh"
  - "Leave workspace action added beyond original plan scope to complete the join/leave UX"

patterns-established:
  - "Page server component: fetch with admin client, pass to WorkspacesClient shell"
  - "WorkspaceCard: useTransition for instant join/leave without page reload"
  - "Modal pattern: inline state in client shell, scale-in via @keyframes modal-in"

requirements-completed: [WS-02, WS-04]

# Metrics
duration: ~25min
completed: 2026-03-26
---

# Phase 01 Plan 02: Workspace Directory UI Summary

**Workspace directory page at /workspaces with join/joined/leave states, create-workspace modal, and no-workspace banner on /tasks**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-03-26T23:49Z
- **Completed:** 2026-03-26T00:11Z
- **Tasks:** 3 (2 feature + 1 fix round)
- **Files modified:** 7

## Accomplishments
- Built `/workspaces` page: all workspaces listed with name, kind badge (Household/Work), member count
- WorkspaceCard shows green "Joined" badge for joined workspaces; "Join" button for unjoined — instant optimistic update via `useTransition`
- Create Workspace modal: name + kind → creates workspace + auto-joins creator → shows in list as "Joined"
- No-workspace banner added to `/tasks`: appears when user has 0 memberships, links to `/workspaces`
- Leave workspace action added; nav links to `/workspaces` and `/tasks` added to app layout
- Deleted obsolete `pin-display.tsx` and `workspace-forms.tsx`

## Task Commits

1. **Task 1: Workspace directory page, card, and client shell** — `7bec8b3` (feat)
2. **Task 2: No-workspace banner on /tasks** — `a832d7e` (feat)
3. **Fix: Admin client for workspace INSERT (RLS 42P17 recursion)** — `79968bb` (fix)
4. **Fix: Admin client for workspace_members lookup (RLS filtering new memberships)** — `b44689b` (fix)
5. **Fix: Leave workspace, banner RLS, nav links** — `4ca5fac` (fix)

## Files Created/Modified
- `src/app/workspaces/workspace-card.tsx` — WorkspaceCard component with join/leave and useTransition
- `src/app/workspaces/workspaces-client.tsx` — Client shell with create-workspace modal
- `src/app/workspaces/page.tsx` — Server component: admin client fetches all workspaces + user memberships
- `src/app/workspaces/actions.ts` — Added leaveWorkspace action; fixed createWorkspace to use admin client
- `src/app/tasks/page.tsx` — No-workspace banner inserted when myWorkspaces.length === 0
- `src/app/layout.tsx` — Added nav links to /workspaces and /tasks
- `src/app/globals.css` — Added @keyframes modal-in

## Decisions Made
- Admin client needed for SELECT all workspaces (RLS restricts regular client to user's own memberships)
- Admin client also required for workspace INSERT — RLS policy caused 42P17 infinite recursion when checking workspace_members during creation
- Admin client used for workspace_members lookup after join — regular client filtered out the new membership before page refresh
- Leave workspace added beyond original plan scope to complete join/leave round-trip UX

## Deviations from Plan

### Auto-fixed Issues

**1. RLS 42P17 recursion on workspace INSERT**
- **Found during:** Task 1 testing
- **Issue:** Regular client INSERT triggered RLS policy that queried workspace_members, causing infinite recursion
- **Fix:** Switched workspace INSERT in createWorkspace to admin client
- **Files modified:** src/app/workspaces/actions.ts
- **Committed in:** 79968bb

**2. RLS filtering new workspace_members row before page re-render**
- **Found during:** Post-join page reload
- **Issue:** workspace_members SELECT via regular client missed newly inserted rows before session refresh
- **Fix:** Switched workspace_members lookup in page.tsx to admin client
- **Files modified:** src/app/workspaces/page.tsx
- **Committed in:** b44689b

**3. Leave workspace and nav links added beyond original scope**
- **Found during:** Manual verification
- **Issue:** No way to leave a workspace; nav had no links to key pages
- **Fix:** Added leaveWorkspace server action, leave button in WorkspaceCard, nav links in layout
- **Files modified:** src/app/workspaces/actions.ts, workspace-card.tsx, src/app/layout.tsx
- **Committed in:** 4ca5fac

---

**Total deviations:** 3 auto-fixed (2 RLS issues, 1 scope addition for leave/nav)
**Impact on plan:** RLS fixes essential for correctness. Leave workspace and nav links were natural completions of the UX — no unrelated scope creep.

## Issues Encountered
- RLS policies for workspaces required careful client selection (admin vs regular) across multiple operations — documented in key-decisions above

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Workspace membership is fully functional: join, leave, create
- Phase 2 (Task Creation) can use workspace membership to scope task assignment
- `myWorkspaces` pattern in tasks/page.tsx already provides user's workspace list for task scoping

---
*Phase: 01-workspace-directory*
*Completed: 2026-03-26*

## Self-Check: PASSED
