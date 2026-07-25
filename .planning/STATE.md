---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: in_progress
stopped_at: Phase 4 UI-SPEC approved
last_updated: "2026-07-25T23:13:27.250Z"
progress:
  total_phases: 8
  completed_phases: 2
  total_plans: 6
  completed_plans: 5
  percent: 25
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-25)

**Core value:** Users can create, manage, and complete tasks across household and work workspaces — with frictionless workspace onboarding and full task lifecycle control.
**Current focus:** Phase 04 — accessibility & mobile

## Current Position

Phase: 03 (security-hardening) — COMPLETE
Plan: 1 of 1 (8 tasks, all complete)

Branch: `feat/security-hardening`, not yet merged to `main`.

## Accumulated Context

### Decisions

- Public workspace directory (no pin): Simpler UX; pin added friction without real security benefit
- Instant join (no approval): Low-friction onboarding appropriate for personal/small-team use
- Display name from profile: Avoids per-workspace name friction; consistent identity
- [Phase 01-workspace-directory]: workspace_members_insert_self RLS policy preserved from migration 004, not recreated in 005
- [Phase 01-workspace-directory]: PIN join form removed from workspace-forms.tsx; create form only until Plan 02 directory UI ships
- [Phase 01-workspace-directory]: Disabled-but-visible New Task buttons: banner explains context, hiding would be confusing
- [Phase 02-task-creation]: Optimistic close — modal closes and onTaskCreated fires BEFORE startTransition so user sees instant feedback
- [Phase 02-task-creation]: Snapshot pattern — form state captured before resetForm() to prevent stale closure bug in fire-and-forget async callback
- [Phase 02-task-creation]: Task list rendering moved entirely to TasksPageClient — server passes raw data, client filters and buckets
- [Phase 03-security-hardening]: RLS recursion broken with `private.*` SECURITY DEFINER helpers, never `public.*` — a definer function in an exposed schema is a callable RLS bypass (tasks/lessons.md L1)
- [Phase 03-security-hardening]: Authorization assertions in `src/lib/auth.ts` deliberately use the service-role client, so they give the same answer whether or not RLS is enforcing
- [Phase 03-security-hardening]: `createTaskWithSubtasks` pre-generates ids instead of `INSERT ... RETURNING` — under `tasks_select` the returning row is invisible until its assignment exists
- [Phase 03-security-hardening]: Actions return `{ ok, error }` rather than throwing; DB errors are logged and replaced with a generic message so schema detail never reaches the client
- [Phase 03-security-hardening]: `memberIds` requires at least one entry — an unassigned task is invisible to everyone, not merely unassigned
- [Phase 03-security-hardening]: Completing a parent completes its open subtasks; the rule now holds in both directions
- [Phase 03-security-hardening]: `createTask` deleted rather than guarded — it had no callers
- [Phase 03-security-hardening]: One service-role read remains by design, member counts in `workspaces/page.tsx`; RLS cannot produce counts for workspaces you have not joined

### Decisions reversed

- [Phase 01-workspace-directory]: "joinWorkspaceByDirectory uses admin client for workspace lookup" — no longer true. Migration 007 makes `workspaces_select` public to signed-in users, so it runs as the user (`1750d9d`).
- [Phase 02-task-creation]: "Success toast fires before server resolves" — still true in the create modal, which has optimistic state to roll back, but the edit modal now waits for the result. It had nothing optimistic to show, so an early success toast was simply wrong.

### Roadmap Evolution

- Phase 3 was "Task Detail & Editing"; that work landed outside the planning loop, and Phase 3 is now Security Hardening, matching `.planning/phases/03-security-hardening/`
- Phases renumbered 2026-07-25: 4 accessibility, 5 prioritization, 6 updates/speech, 7 recurring, 8 design polish
- Old "Phase 5: Task and workspace lifecycle" superseded — only workspace deletion remains, and it needs an ownership rule first

### Blockers/Concerns

- Remote migration history holds only `20260725220330 rls_security_definer`; 001-006 were applied out-of-band. `supabase db push` would try to replay them (tasks/lessons.md L9)
- No local Supabase stack: Docker unavailable, and `db push` needs `SUPABASE_DB_PASSWORD`. DB verification is done by running SQL as the `authenticated` role with `set local request.jwt.claims`
- Sort key allocation is still a racy global `max + 1000` (audit C3) — fix before wiring drag-to-reorder in Phase 5
- `/tasks` has no redirect for signed-out users. Under RLS the page now renders empty rather than leaking, but there is still no middleware
- Leaked-password protection is disabled in Supabase Auth settings — dashboard toggle, Phase 04

### Resolved concerns

- ~~`completeTask()` and `deleteTask()` have silent error handling~~ — fixed in Phase 3 (`7d8081a`)
- ~~PIN system live in DB and server actions~~ — removed in Phase 1

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260325-g5e | Clean up unused directories | 2026-03-25 | d811f76 | [260325-g5e-clean-up-unused-directories](./quick/260325-g5e-clean-up-unused-directories/) |

## Session Continuity

Last session: 2026-07-25T23:13:27.240Z
Stopped at: Phase 4 UI-SPEC approved
Resume file: .planning/phases/04-accessibility-mobile/04-UI-SPEC.md
