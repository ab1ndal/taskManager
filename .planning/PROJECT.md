# Hearth

## What This Is

Hearth is a personal task manager for household and work contexts, accessible from anywhere. Users belong to one or more workspaces (household or work kind), see only their assigned tasks, and can collaborate on shared tasks with other workspace members.

## Core Value

Users can create, manage, and complete their tasks across household and work workspaces — with frictionless workspace onboarding and full task lifecycle control.

## Requirements

### Validated

- ✓ User can sign up with email/password — existing
- ✓ User can log in and session persists — existing
- ✓ User can reset password via email link — existing
- ✓ User can view their tasks bucketed by overdue/today/upcoming/completed — existing
- ✓ User can complete and delete tasks — existing
- ✓ User can filter tasks by workspace or shared view — existing

### Validated

- ✓ User can create a workspace (household or work kind) — Validated in Phase 01: workspace-directory
- ✓ User can browse a public directory of all workspaces — Validated in Phase 01: workspace-directory
- ✓ User can join any workspace instantly using their profile name (no pin, no approval) — Validated in Phase 01: workspace-directory
- ✓ Task creation is blocked when user has no workspace memberships — Validated in Phase 01: workspace-directory

### Validated

- ✓ User can create tasks with title, description, due date, workspace, and assignees — Validated in Phase 02: task-creation
- ✓ Newly created task appears immediately in task list (optimistic insert, no reload) — Validated in Phase 02: task-creation

### Active
- [ ] User can open a task detail view to see full info, subtasks, and updates
- [ ] User can edit task details (title, description, due date) after creation
- [ ] User can reassign or add members to an existing task
- [ ] User can drag tasks to reorder their personal priority

### Out of Scope

- Pin-based workspace join — replaced by public directory + instant join
- Workspace join approval flow — instant join with no gating
- Per-workspace display names — profile name used everywhere

## Context

- **Stack:** Next.js 16, TypeScript, Tailwind v4, Supabase (PostgreSQL + Auth + RLS), Vercel
- **Auth:** Supabase Auth with cookie-based sessions via `@supabase/ssr`
- **Data model:** Tasks are visible only via `task_assignments`; priority is per-user via `member_sort_key`
- **Current state:** Phase 02 complete — task creation with optimistic inserts, immediate modal close, success/warning/error toast feedback, and opacity-40 pending state. Phase 05 (task lifecycle: edit/delete/complete) next.
- **Codebase map:** `.planning/codebase/` — full analysis available

## Constraints

- **Tech stack:** Next.js 16 App Router, Supabase — no changes to core stack
- **RLS:** All data access must respect row-level security policies
- **DB migrations:** Schema changes go in `supabase/migrations/` numbered sequentially
- **Display name:** Auto-sourced from `user.user_metadata.name` when joining workspaces

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Public workspace directory (no pin) | Simpler UX; pin added friction without real security benefit for this use case | Shipped in Phase 01 |
| Display name from profile | Avoids per-workspace name friction; consistent identity | Shipped in Phase 01 |
| Instant join (no approval) | Low-friction onboarding; appropriate for personal/small-team use | Shipped in Phase 01 |
| Admin client for workspace operations | RLS recursion on INSERT and filtering on post-join SELECT required admin bypass | Shipped in Phase 01 |

---
*Last updated: 2026-03-26 after Phase 02 completion*
