# Todo

Working phase: **06.5 — App-Wide UI/UX Polish (followups)**
Followups: `.planning/phases/06.5-app-wide-ui-polish/06.5-FOLLOWUPS.md`
State: `.planning/STATE.md`
Lessons: `tasks/lessons.md`

Session 2026-07-27 on branch `main`, starting at `2726965`. This file held Phase 03's todo until
now; that phase is complete and its content survives in `.planning/phases/03-security-hardening/`,
in `STATE.md`'s blockers, and in `lessons.md` (L1–L11).

## Done — 2026-07-27

- [x] **F3** — subtask delete goes through `DeleteConfirmDialog`. `09b6dda`.
      Nested `showModal()` inside the open edit modal: it stacks above it in the top layer, so
      Escape dismisses only the confirmation. 3 tests in `edit-task-modal.test.tsx`.
- [x] **F5** — subtask fields symmetric between the two modals. `d5cc3eb`.
      New `updateSubtask` action + schema; the subtasks query and `RawTask` now carry `description`
      and `due_at`; the edit modal's add row matches the new-task modal and existing subtasks are
      editable behind a pencil. 3 tests.
- [x] **F4** — `RowMenu` roving focus per the ARIA APG menu-button pattern. `bed3fa8`.
      Implemented rather than dropping the roles. New `src/components/__tests__/row-menu.test.tsx`,
      7 tests.
- [x] **F7** — `e2e/drag-reorder.spec.ts`. `e752d88`.
      Pointer (mouse, and a dispatched touch sequence past the 120ms long-press threshold on the
      iPhone profile) and keyboard paths; the new order survives a reload; each test restores the
      seeded order. Passing in all four browsers.
- [x] **F8** — contrast walk parameterised over four routes and three dialogs. `d95fb70`.
      Caught a real defect: `--color-text-muted` was 4.39:1 on `--color-surface-sunken`, the panel
      behind Updates and Subtasks. Darkened `#726f80` → `#6d6a7b` (4.73:1).
- [x] **F9** — screenshot baselines. `ceff361`.
      Task list, both dialogs (including the edit dialog scrolled to Subtasks), workspace card;
      both schemes; chromium and iphone only.
- [x] **e2e fixture drift** — `task-flow.spec.ts` calls `cleanupUiWrites()` in `afterAll`.
      `d1da8d0`. The baselines passed alone and failed in a full run: the persistence specs leave
      rows behind by design and the iPhone project runs last, so it saw four projects' worth.
- [x] **F1** — `main` pushed to `origin`.
- [x] **F13** — `STATE.md` position block and progress counts refreshed.
- [x] **F2** — the suite runs against a second project, `task-manager-dev`
      (`mcdpiuiayfljzvnhtqto`), created and migrated 2026-07-27. `.env.local` points local
      development and the suite at it; production is reached only by a deployment. The refusal in
      `e2e/fixtures.ts` keys on `E2E_SUPABASE_URL`, which exists only in `.env.local` — verified by
      forcing the production URL and watching the run abort before seeding. Full suite green against
      the new project: 187 passed, 38 skipped.

Verified: `npx tsc --noEmit` clean, 245 jest tests pass, full Playwright suite 187 passed /
38 skipped (the screenshot specs skip on webkit and firefox by design).

## Open followups — full statement of each in `06.5-FOLLOWUPS.md`

- **F14** — production's migration history holds only 007, and
  `.github/workflows/deploy-migrations.yml` runs `supabase db push` against it on every migration
  change landing on `main`. The first such push fails (it aborts on 001's bare `create table`, so
  nothing is corrupted, but migrations stop deploying). Needs `migration list --linked` then
  `migration repair --status applied` per already-applied migration. Highest-value item left.
- **F10** — dictation and mic-permission denial still need a human in Chrome and Safari.
- **F6** — reopening a parent leaves its subtasks completed. Deliberate; watch in real use.
- **F11** — no service worker, so the installed app needs the network for every load. Decide whether
  offline is in scope; if yes it is its own slice, not a config flag.
- **F12** — icons are placeholder art. Needs real artwork at 192, 512, maskable 512 and 180.

## Still open from earlier phases

- Phase 04 — the real-device address-bar-collapse check (U7) needs an actual phone; leaked-password
  protection is a Supabase dashboard toggle and is still off.
- Phase 07 (recurring tasks) is next and has not started. `task_rules` and `tasks.rule_id` exist
  with no generator; `task_rules` has RLS enabled and no policies, which is deny-all — the safe
  direction. The generator must be idempotent for a repeated `next_run_at`.

## Resume commands

```bash
cd /Users/abindal/dev/taskManager
npx tsc --noEmit && npx jest
npm run build && npx playwright test          # writes to the hosted Supabase project — see F2
git log --oneline -8
```
