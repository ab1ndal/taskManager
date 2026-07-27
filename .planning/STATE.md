---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: in_progress
stopped_at: Phase 6.5 followups F1, F3, F4, F5, F7, F8, F9 closed; F2, F6, F10-F13 open
last_updated: "2026-07-27T00:00:00.000Z"
progress:
  # Counted from ROADMAP.md's progress table: phases 1, 2, 3, 5 and 6.5 complete; 4 in progress
  # (one plan and the deferred manual checks open); 6 code-landed with dictation still manual;
  # 7 not started.
  total_phases: 7
  completed_phases: 5
  total_plans: 27
  completed_plans: 26
  percent: 71
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-25)

**Core value:** Users can create, manage, and complete tasks across household and work workspaces — with frictionless workspace onboarding and full task lifecycle control.
**Current focus:** Phase 06.5 — app-wide UI/UX polish (followups)

## Current Position

Phase: 04 (accessibility-mobile) — 3 of 4 manual checks in 04-06 resolved (fully or partial),
resuming the rest (real-device address-bar check, leaked-password dashboard toggle) later.
Phase: 05 (task-prioritization) — COMPLETE, all verification checks pass.
Phase: 06 (task-updates-speech-to-text) — code landed; only dictation and mic-permission denial
still need a human (see followup F10).
Phase: 06.5 (app-wide-ui-polish) — COMPLETE. Followups F1, F3, F4, F5, F7, F8 and F9 closed
2026-07-27; F2, F6, F10, F11, F12 and F13 remain open in `06.5-FOLLOWUPS.md`.
Next: Phase 07 (recurring tasks) — not started, depends on 6.5.

All work has been landing directly on `main` (not a feature branch) since phase 03, and `main` is
now pushed to `origin`.

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
- [Phase 05-task-prioritization]: Sort-key computation and the row insert must share one
  advisory-lock scope — a lock held only for the RPC's own transaction protects nothing once the
  actual write happens in a separate round trip (`tasks/lessons.md` L10)
- [Phase 04-accessibility-mobile]: Toasts fired while a modal is open must render inline in that
  dialog, not through the global toaster — a `<dialog>.showModal()` makes all other content inert,
  including other top-layer elements like popovers, so there is no way to keep a separate toast
  interactive over an open modal (`tasks/lessons.md` L11)

### Decisions reversed

- [Phase 01-workspace-directory]: "joinWorkspaceByDirectory uses admin client for workspace lookup" — no longer true. Migration 007 makes `workspaces_select` public to signed-in users, so it runs as the user (`1750d9d`).
- [Phase 02-task-creation]: "Success toast fires before server resolves" — still true in the create modal, which has optimistic state to roll back, but the edit modal now waits for the result. It had nothing optimistic to show, so an early success toast was simply wrong.

### Roadmap Evolution

- Phase 3 was "Task Detail & Editing"; that work landed outside the planning loop, and Phase 3 is now Security Hardening, matching `.planning/phases/03-security-hardening/`
- Phases renumbered 2026-07-25: 4 accessibility, 5 prioritization, 6 updates/speech, 7 recurring, 8 design polish
- Old "Phase 5: Task and workspace lifecycle" superseded — only workspace deletion remains, and it needs an ownership rule first
- Phase 6.5 (INSERTED) added 2026-07-26 during Phase 6 brainstorm: task panel UI polish via ui-ux-pro-max, needs its own brainstorm before planning
- Phase 8 (Design Polish) folded into Phase 6.5 on 2026-07-26 — one polish pass across the whole app instead of a task-panel pass now and a design-system pass three phases later. 6.5 is now "App-Wide UI/UX Polish"; Phase 7 depends on 6.5; there is no Phase 8. Total phases 8 → 7.

### Blockers/Concerns

- Remote migration history holds only `20260725220330 rls_security_definer`; 001-006 were applied out-of-band. `supabase db push` would try to replay them (tasks/lessons.md L9)
- No local Supabase stack: Docker unavailable, and `db push` needs `SUPABASE_DB_PASSWORD`. DB verification is done by running SQL as the `authenticated` role with `set local request.jwt.claims`
- ~~`/tasks` has no redirect for signed-out users~~ — resolved 2026-07-27. The proxy existed but was
  never registered: Next resolves `proxy.ts` relative to the app dir, so a root-level file is ignored
  when the app lives in `src/`. Moved to `src/proxy.ts`; both redirect directions are covered by
  `e2e/auth-routing.spec.ts`
- Leaked-password protection is disabled in Supabase Auth settings — dashboard toggle, Phase 04, still pending (deferred with the rest of 04-06)
- Phase 04-06 real-device address-bar-collapse check (U7) still needs an actual phone — devtools/Playwright viewport emulation can't reproduce it
- Phase 06 manual verification: mostly closed 2026-07-27 by the `e2e/` Playwright suite, which drives
  the real signed-in app in Chromium, WebKit, Firefox and an iPhone profile. Update and subtask
  persistence and the two-member author-name check now run automatically. Dictation and microphone
  permission denial remain manual — Chromium's fake-device flags do not drive the Web Speech API,
  which is a cloud service in Chrome and absent in Firefox.

### Resolved concerns

- ~~`completeTask()` and `deleteTask()` have silent error handling~~ — fixed in Phase 3 (`7d8081a`)
- ~~PIN system live in DB and server actions~~ — removed in Phase 1
- ~~Sort key allocation is a racy global `max + 1000` (audit C3)~~ — fixed in Phase 5, migration
  009 (`assign_task_member`). Migration 008's fix was incomplete — its advisory lock only covered
  the read, not the app's separate follow-up insert; see `tasks/lessons.md` L10.
- ~~Error toast unreachable while a modal is open~~ — found + fixed during Phase 04-06 manual
  verification. Client-side validation errors now render inline in the still-open dialog instead
  of toasting; a `<dialog>.showModal()` makes all other top-layer content (including popovers)
  inert, so a separate toast can never be interactive over an open modal. See
  `tasks/lessons.md` L11.

### Verification tooling

- `npm run test:e2e` builds and runs `e2e/` against the hosted Supabase project. Global setup seeds a
  throwaway workspace, two users and five tasks with the service-role key; teardown deletes all of
  it. Never point it at production data — it deletes by the `e2e-phase65` tag and by workspace name.
- The suite also holds screenshot baselines (`e2e/screenshots.spec.ts-snapshots/`), captured on
  chromium and the iPhone profile only. They are platform-suffixed, so a machine with different font
  rendering regenerates rather than inherits: `npx playwright test screenshots --update-snapshots`.
- Specs that assert persistence must clean up their own rows (`cleanupUiWrites()` in
  `e2e/fixtures.ts`). Leftovers are invisible to the spec that wrote them and break every spec that
  runs later — that is how the screenshot baselines passed alone and failed in a full run.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260325-g5e | Clean up unused directories | 2026-03-25 | d811f76 | [260325-g5e-clean-up-unused-directories](./quick/260325-g5e-clean-up-unused-directories/) |

## Session Continuity

Last session: 2026-07-27
Stopped at: Phase 6.5 followups — seven closed, six open
Resume file: .planning/phases/06.5-app-wide-ui-polish/06.5-FOLLOWUPS.md
