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

### Active

- [ ] User can create a workspace (household or work kind)
- [ ] User can browse a public directory of all workspaces
- [ ] User can join any workspace instantly using their profile name (no pin, no approval)
- [ ] User can create tasks with title, description, due date, workspace, and assignees
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
- **Current state:** Workspace creation exists with a pin system (to be removed). Task creation UI exists but is gated on workspace membership. No task detail view or editing exists yet.
- **Codebase map:** `.planning/codebase/` — full analysis available

## Constraints

- **Tech stack:** Next.js 16 App Router, Supabase — no changes to core stack
- **RLS:** All data access must respect row-level security policies
- **DB migrations:** Schema changes go in `supabase/migrations/` numbered sequentially
- **Display name:** Auto-sourced from `user.user_metadata.name` when joining workspaces

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Public workspace directory (no pin) | Simpler UX; pin added friction without real security benefit for this use case | — Pending |
| Display name from profile | Avoids per-workspace name friction; consistent identity | — Pending |
| Instant join (no approval) | Low-friction onboarding; appropriate for personal/small-team use | — Pending |

---
*Last updated: 2026-03-25 after initialization*
