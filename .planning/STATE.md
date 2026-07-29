---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: in_progress
stopped_at: Phase 7 (recurring tasks) code-complete and verified on DEV 2026-07-29; production deploy PENDING, a separate human decision
last_updated: "2026-07-29T00:00:00.000Z"
progress:
  # Counted from ROADMAP.md's progress table: phases 1, 2, 3, 5 and 6.5 complete; 4 in progress
  # (one plan and the deferred manual checks open); 6 code-landed with dictation still manual;
  # 7 code-complete and dev-verified, production deploy pending (not counted as complete here
  # since it has not shipped).
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
**Current focus:** Phase 07 — recurring tasks: code-complete and verified on dev; production deploy
is a pending human decision

## Current Position

Phase: 04 (accessibility-mobile) — 3 of 4 manual checks in 04-06 resolved (fully or partial),
resuming the rest (real-device address-bar check, leaked-password dashboard toggle) later.
Phase: 05 (task-prioritization) — COMPLETE, all verification checks pass.
Phase: 06 (task-updates-speech-to-text) — COMPLETE. The last two manual checks (dictation, mic
permission denial) were run by hand 2026-07-27 in Chrome, Safari and Firefox and passed; see F10.
Phase: 06.5 (app-wide-ui-polish) — COMPLETE. Followups F1-F10 and F13-F18 closed 2026-07-27.
Still open: F11 (offline/service worker), F12 (real icons), F19 (perceived latency, unmeasured),
plus F22 (production email delivery limited to team addresses) — all in `06.5-FOLLOWUPS.md`. F20 and
F21 closed 2026-07-27.
Phase: 07 (recurring-tasks) — CODE-COMPLETE, verified on dev (`task-manager-dev`,
`mcdpiuiayfljzvnhtqto`) 2026-07-29; see `07-VERIFICATION.md`. Production deploy (merge to `main`,
which auto-applies migrations 012/013 via `deploy-migrations.yml`) is explicitly PENDING — a
separate human decision, not blocked on anything left to build. Open followups in
`07-FOLLOWUPS.md`, most notably F4 (production `task_rules` row count unverified — check before
merging) and F1 (a pre-existing, unrelated optimistic-row race that surfaces a raw error string).
Next: the production deploy decision (Phase 7 Step 4, deliberately not taken in Task 10), then
whatever the roadmap picks up after Phase 7.

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
- [Phase 07-recurring-tasks]: A recurring task is ONE task row that reactivates, not a stream of
  generated instances — so idempotency is structural (nothing is inserted) rather than a constraint
  to maintain
- [Phase 07-recurring-tasks]: task_rules.task_id -> tasks on delete cascade, reversing the original
  FK, because "recurs until deleted" is a database rule and an orphan rule is unrepresentable
- [Phase 07-recurring-tasks]: `biweekly` dropped from the frequency enum — it is `weekly` with
  interval 2, and two encodings of one schedule means nothing decides which the form emits
- [Phase 07-recurring-tasks]: datetime-local strings are resolved to instants by
  public.upsert_task_recurrence, not in TypeScript — the session timezone for app connections is
  UTC, so the cast has to happen where Pacific is known
- [Phase 07-recurring-tasks]: HUMAN DECISION 2026-07-28, mid-phase — `due_at` on reactivation is
  anchored to the MOST RECENT missed occurrence, not the oldest. A 9-day outage on a 3-day rule
  returns the task due today, not 9 days overdue; the original plan anchored to the stale original
  occurrence and was corrected during Task 3's review.
- [Phase 07-recurring-tasks]: the recurrence model is three states, not two — no rule, paused
  (`is_active = false`, schedule retained), and active — replacing an original two-state
  (on/off) assumption that lost the schedule on pause. The badge is driven by `is_active`; the
  modal's prefill is driven by the stored row regardless of its active state.

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

- ~~Remote migration history holds only `20260725220330 rls_security_definer`~~ — resolved. Both
  projects list 001-009, verified 2026-07-27 with `supabase migration list --linked`: production in
  the `repair-migration-history` workflow run, which finished "Remote database is up to date", and
  `task-manager-dev` locally after its clean `db push`. `.github/workflows/deploy-migrations.yml`
  works. L9 kept the broken state on record for two days after it stopped being true, which is what
  produced the short-lived followup F14.
- No local Supabase stack: Docker unavailable, and `db push` needs `SUPABASE_DB_PASSWORD`. DB verification is done by running SQL as the `authenticated` role with `set local request.jwt.claims`
- ~~`/tasks` has no redirect for signed-out users~~ — resolved 2026-07-27. The proxy existed but was
  never registered: Next resolves `proxy.ts` relative to the app dir, so a root-level file is ignored
  when the app lives in `src/`. Moved to `src/proxy.ts`; both redirect directions are covered by
  `e2e/auth-routing.spec.ts`
- Leaked-password protection is disabled in Supabase Auth settings — dashboard toggle, Phase 04, still pending (deferred with the rest of 04-06)
- Phase 04-06 real-device address-bar-collapse check (U7) still needs an actual phone — devtools/Playwright viewport emulation can't reproduce it
- ~~Phase 06 manual verification incomplete~~ — closed 2026-07-27. The `e2e/` Playwright suite
  covers update and subtask persistence and the two-member author-name check across Chromium,
  WebKit, Firefox and an iPhone profile; dictation and microphone-permission denial stay manual
  (Chromium's fake-device flags do not drive the Web Speech API, a cloud service in Chrome and
  absent in Firefox) and were run by hand in Chrome, Safari and Firefox. All passed — F10.
- Monthly recurrence drifts on month-end anchors: `interval '1 month'` moves Jan 31 to Feb 28 and it
  stays on the 28th. Needs a day-of-month anchor column to fix. Accepted in Phase 07.
- Recurrence has no per-occurrence history. The one-row model means nothing records that a given
  occurrence was completed; task_updates cannot fill it because member_id is not null and the
  generator does not know who completed the task. Accepted in Phase 07.
- Phase 07 production deploy is PENDING — a human decision, not a blocked task. Before merging to
  `main`, `07-FOLLOWUPS.md` F4 needs a check of production's `task_rules` row count: migration 012
  adds a `not null` column plus two validating `check` constraints that abort the migration if any
  existing row fails them. Dev had zero rows, so this path was never exercised there.

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

- `npm run test:e2e` builds and runs `e2e/` against **`task-manager-dev`** (`mcdpiuiayfljzvnhtqto`),
  the second project created 2026-07-27. Production (`xamdgvxziobpptcfymug`) is reached only by a
  deployment. Global setup seeds a workspace, two users and five tasks with the service-role key;
  teardown deletes them by the `e2e-phase65` tag and by workspace name. `E2E_SUPABASE_URL` in
  `.env.local` declares the project disposable, and `e2e/fixtures.ts` refuses to run without it —
  see `tasks/lessons.md` L14.
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

Last session: 2026-07-29
Stopped at: Phase 07 (recurring tasks) closed out on the dev side — 10/10 tasks code-complete,
verified against `task-manager-dev`, `07-VERIFICATION.md` and `07-FOLLOWUPS.md` written. Production
deploy (Phase 7 Step 4: merge to `main`) was deliberately NOT taken — awaiting a human decision.
Resume file: .planning/phases/07-recurring-tasks/07-VERIFICATION.md (and 07-FOLLOWUPS.md F4 before
any merge to main)
