# Todo

Working phase: **03 — Security Hardening & Failure Visibility**
Plan: `.planning/phases/03-security-hardening/03-PLAN.md`
Research: `.planning/phases/03-security-hardening/03-RESEARCH.md`
Audit: `.planning/AUDIT-2026-07-25.md`

Started 2026-07-25 on branch `main` @ `5d3c743`.

## Environment — resolved 2026-07-25

- Secret key rotated by the user. `.env` holds all three variables under the correct names
  (`SUPABASE_SECRET_KEY`, no `NEXT_PUBLIC_` prefix) and is gitignored.
- Migration 007 **applied to the hosted project** `xamdgvxziobpptcfymug` (task-manager) via the
  Supabase MCP server, not the CLI. `supabase link` succeeded but `db push` needs
  `SUPABASE_DB_PASSWORD` — the CLI's passwordless login-role fallback fails on this project with
  "permission denied to alter role".
- **Remote migration history contains only `20260725220330 rls_security_definer`.** Migrations
  001-006 were applied out-of-band before the CLI was ever used, so they are absent from
  `supabase_migrations.schema_migrations`. Do **not** run `supabase db push` without repairing that
  history first — it would try to replay 001-006 against a schema that already has them.
- Local Docker/`supabase start` still unavailable, and there is still no `supabase/config.toml`
  beyond what `link` generated. Verification of DB behaviour is done by running SQL as the
  `authenticated` role with `set local request.jwt.claims`, which is how 007 and Task 3 were checked.

## Done

- [x] **Task 2** — `SUPABASE_SECRET_KEY` + `import "server-only"` + `.env.example`. `e44da0e`.
      Installed the `server-only` package — it was missing, and `tsc` did not catch it because
      Next's ambient types declare the module. The build would have failed.
      **Still needs the user to rotate the key in the Supabase dashboard.**
- [x] **Task 1 (authoring)** — `supabase/migrations/007_rls_security_definer.sql` written.
      Apply + verify still blocked on the environment above.
- [x] **Task 4** — `requireUser()` + per-row authorization in all five remaining task actions. `5cf8987`.
      `createTask` deleted rather than guarded — no callers, `createTaskWithSubtasks` supersedes it.
      The mock-builder extraction did not land as a separate commit as planned; `actions.ts` was
      already rewritten when the work resumed, so splitting it would have been artificial.
      Verified: `npx tsc --noEmit` clean, 125 tests pass, lint down to the pre-existing 2 errors +
      3 warnings (the dead `supabase` binding at `actions.ts:102` is gone).

## Discovered during Task 1 — changes Task 4

**`INSERT ... RETURNING` breaks under the new `tasks_select` policy.** Postgres must SELECT a row to
return it, and `tasks_select` requires an assignment row that does not exist yet at insert time. So
`createTask` / `createTaskWithSubtasks`, which both do `.insert().select().single()`, will fail once
007 is applied.

Fix in Task 4: pre-generate ids with `crypto.randomUUID()` and drop the `.select()`, rather than
widening the SELECT policy. Widening it would contradict `docs/product.md` — "Tasks not assigned to
the current user must not be shown."

Same trap applies to any future insert-then-return on `task_assignments` and `task_updates`.

- [x] **Task 5** — zod 4 schemas in `src/app/tasks/schemas.ts`, parsed after `requireUser()`, and
      reused by both modals before their optimistic close. `23ae4cb`.
      Zod 4 API: top-level `z.uuid()` / `z.iso.date()`, `z.flattenError()`. Not the v3 method forms.
      `memberIds` requires ≥1 in create *and* update — an empty list makes the task invisible to
      everyone, not merely unassigned.
      All test fixtures now use real UUIDs; `"t-1"`-style ids fail validation.
      Verified: `npx tsc --noEmit` clean, 134 tests pass, lint unchanged.

- [x] **Task 1 (apply + verify)** — 007 live on the hosted project. Verified: policies all scoped to
      `authenticated` and expressed through `private.*` helpers; all five helpers are
      `SECURITY DEFINER` with `search_path=''` and **not** executable by `anon`; no 42P17. Two users
      queried under their own JWT claims see 12 and 1 tasks out of 13 — isolation holds.
- [x] **Task 6** — actions return `{ ok, error }`, every Supabase error checked, failures toasted,
      optimistic row rolled back, `error.tsx` + `loading.tsx` added. `7d8081a`.
      Also replaced the `initialTasks` sync effect with a render-time adjustment — that was the
      second `set-state-in-effect` lint error.
- [x] **Task 3** — `/tasks` reads through the user client. `094b4a3`. Verified by replaying the
      page's query chain as the `authenticated` role: same counts as service-role for that user.

## In progress

- [ ] **Task 7** — completing a parent completes its subtasks; re-enable the button.

## Lint findings, deferred

`npm run lint` reports 1 error + 3 warnings, all pre-existing. Both original `set-state-in-effect`
errors are gone (Task 4 removed the dead binding, Task 6 removed the tasks-page effect).

- `react-hooks/set-state-in-effect` at `login-card.tsx:26` — belongs to Phase 04.
- Unused `currentMemberIds` (`edit-task-modal.tsx:16`), unused `memberIdByWorkspaceId`
  (`tasks-page-client.tsx:44`) — the latter is reserved for drag-to-reorder, Phase 05.
- Unused `workspaceData` (`workspaces/actions.test.ts:99`).

## Next

- [ ] **Task 7** — Completing a parent task completes its subtasks; re-enable the disabled button.
- [ ] **Task 8** — Phase wrap-up: reconcile `.planning/STATE.md`, renumber `ROADMAP.md`.

### Surfaced during Task 3, not yet done

`src/app/workspaces/page.tsx` and all three actions in `src/app/workspaces/actions.ts` still use the
service-role client. All three actions *are* authenticated and scoped to `user.id`, so this is not
the S1 hole — but every comment justifying the admin client there is now stale: 007 gives
`workspaces_select` (true), so `RETURNING` and the directory read both work, and
`workspace_members_delete_self` now exists for `leaveWorkspace`. Port them to the user client and
move `workspaces/actions.test.ts` onto `src/test/supabase-fake.ts` while doing it.

### Production advisories worth a look (from `get_advisors` after 007)

- `public.rls_auto_enable()` is a `SECURITY DEFINER` function in the exposed schema, callable by
  `anon`. It is Supabase platform-provided (an event-trigger function, not ours — nothing in
  `supabase/migrations/` creates it) and returns `event_trigger`, so an RPC call cannot do anything
  useful. Left alone deliberately.
- `task_rules` has RLS enabled and no policies — deny-all, which is the safe direction. Phase 07.
- `workspaces_insert` is `with check (true)`: any signed-in user can create a workspace. Deliberate,
  matches the public-directory decision.
- Leaked-password protection is disabled in Auth settings. Dashboard toggle, Phase 04.

## Deferred to later phases

Not in scope for phase 03. Recorded so they are not rediscovered.

**Phase 04 — Accessibility & mobile** (audit U1–U5, U7)
- Touch targets in `task-card.tsx` are bare 14–18px SVGs, far under the 44px minimum, on the
  primary mobile surface
- No `focus-visible` styling on any button or link — inputs only
- Modals lack `role="dialog"`, `aria-modal`, focus trap, Escape-to-close, focus restore
- Toaster has no `aria-live` / `role="status"`
- Dead All/Household/Work pills in `layout.tsx:44-54`; nav renders for signed-out users on `/login`
- `min-h-[calc(100vh-52px)]` should be `100dvh`; the neighbouring `-m-6` cancels layout padding

**Phase 05 — Drag-to-reorder**
- `reorderTask()` exists and is tested with zero UI callers; `@hello-pangea/dnd` installed, imported
  nowhere. Fix audit C3 (global, racy `max + 1000` sort keys; N+1 inserts) before wiring the UI.
  Needs a keyboard alternative.

**Phase 06 — Task updates + speech-to-text**
- `task_updates` table exists, no code. Web Speech API at the input layer only. Never persist audio.

**Phase 07 — Recurring tasks**
- `task_rules` + `tasks.rule_id` exist, no generator. pg_cron. Generator must be idempotent for a
  repeated `next_run_at`.

**Phase 08 — Design polish** (audit U6, U8–U12)
- Dark mode via a second `@theme` block; semantic tokens for deadline + toast surfaces (raw
  `bg-red-50` etc. leak into `task-card.tsx:9-11` and `toaster.tsx:44`); `lucide-react` migration to
  replace one-off inline SVGs at 5 different sizes and 4 stroke widths; `prefers-reduced-motion`
  guard; loading skeletons

**Housekeeping**
- `.planning/STATE.md` is stale — says phase 02 complete 2026-03-27, but `9f1ab80`, `93eb2fc`,
  `5d3c743` landed outside the GSD loop and are unrecorded
- `ROADMAP.md` needs renumbering — "Phase 3: Task Detail & Editing" is already largely built
- Orphan pre-reconcile history is tagged `orphan/local-planning-2026-03-23`; `stash@{0}` holds
  `.planning` edits from that dead lineage and should almost certainly be dropped

## Resume commands

```bash
cd /Users/abindal/dev/taskManager
npx tsc --noEmit && npx jest
git log --oneline -5
```
