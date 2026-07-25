# Todo

Working phase: **03 — Security Hardening & Failure Visibility**
Plan: `.planning/phases/03-security-hardening/03-PLAN.md`
Research: `.planning/phases/03-security-hardening/03-RESEARCH.md`
Audit: `.planning/AUDIT-2026-07-25.md`

Started 2026-07-25 on branch `main` @ `5d3c743`.

## Environment blocker (affects Tasks 1 and 3)

**Update 2026-07-25:** the user populated `.env` with all three variables under the correct names
(`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` — no
`NEXT_PUBLIC_` on the secret). `.env` is gitignored. The URL points at a hosted project, so
migration 007 could be applied with `supabase db push`, but that is a production schema change and
needs an explicit go-ahead — and the key still needs rotating in the dashboard first (Task 2).

No `supabase/config.toml` (`supabase init` never ran), Docker not running, no `.env.local`.
Migration 007 can be **authored** but not applied or verified. Task 3 cannot be verified.

To unblock, the user runs:

```bash
open -a Docker           # then wait for it to come up
supabase init
supabase start
supabase db reset        # applies 001-007 + seed.sql
```

Everything else in the phase is verifiable with `npx tsc --noEmit` and `npx jest`.

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

## In progress

- [ ] **Task 5** — zod schemas at the action boundary.

## Lint findings, deferred (surfaced once `npm run lint` worked again)

`npm run lint` now runs and reports 2 errors + 4 warnings, all pre-existing. Not fixed in Task 8 —
out of scope, and the first one is a deliberate decision.

- `react-hooks/set-state-in-effect` at `tasks-page-client.tsx:64` — this is the
  "sync localTasks with server data on revalidation" effect from commit `3e03df1`. Task 6 rewrites
  this area for optimistic rollback; fix it there, not before.
- `react-hooks/set-state-in-effect` at `login-card.tsx:26` — belongs to Phase 04.
- Unused `supabase` binding at `actions.ts:102` — dead `createClient()` call inside
  `createTaskWithSubtasks`. Task 4 rewrites that function; remove it there.
- Unused `currentMemberIds` (`edit-task-modal.tsx:16`), unused `memberIdByWorkspaceId`
  (`tasks-page-client.tsx:44`) — the latter is reserved for drag-to-reorder, Phase 05.
- Unused `workspaceData` (`workspaces/actions.test.ts:99`).

## Next

- [ ] **Task 5** — zod schemas at the action boundary, shared with the modals.
- [ ] **Task 6** — Actions return `{ ok, error }`; surface failures via toaster; add `error.tsx` /
      `loading.tsx`; roll back optimistic state.
- [ ] **Task 7** — Completing a parent task completes its subtasks; re-enable the disabled button.
- [ ] **Task 3** — Drop admin client from `page.tsx` read path. **Blocked** on the environment above.

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
