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
- [x] **F14** — raised, then closed the same day because its premise was false. L9 recorded
      production's migration history as holding one row; it actually lists 001-009, which the repair
      workflow's own first step showed. `deploy-migrations.yml` was never broken, and a `--dry-run`
      push now reports "Remote database is up to date". Kept the manual
      `repair-migration-history.yml` for the next out-of-band apply, and added a `migration list`
      step to the deploy workflow. L9 rewritten.

Verified: `npx tsc --noEmit` clean, 245 jest tests pass, full Playwright suite 187 passed /
38 skipped (the screenshot specs skip on webkit and firefox by design).

- [x] **F10** — dictation and mic-permission denial run by hand in Chrome, Safari and Firefox.
      All five checks in `06-VERIFICATION.md` pass: the mid-sentence pause survives (auto-restart),
      a blocked mic shows "Microphone access was denied" with no restart loop, Safari's
      `webkitSpeechRecognition` path works, Firefox renders no mic button. Five observations from
      the run are raised as F15–F19.

## Open followups — full statement of each in `06.5-FOLLOWUPS.md`

- **F17** — Subtasks belong above Updates; updates should scroll with the modal, not in a 160px
  inner box, and should carry an exact date and time, not only "3h ago".
- **F16** — dictation only exists on the update composer. Wanted on the task and subtask
  description fields. One recognizer at a time, so it needs a shared session with an owning field.
- **F18** — a task opens only through the row menu. Clicking the card should open it, without
  breaking the checkbox, drag handle or menu, and reachable by keyboard.
- **F15** — the dictation textarea does not scroll, so spoken text lands out of sight past two lines.
- **F19** — updates take 1–2s to render on open and a new task is not editable until the server
  revalidates. Measure against a production build before fixing — `next dev` compiles per route.
- **F6** — reopening a parent leaves its subtasks completed. Deliberate; watch in real use.
- **F11** — no service worker, so the installed app needs the network for every load. Decide whether
  offline is in scope; if yes it is its own slice, not a config flag.
- **F12** — icons are placeholder art. Needs real artwork at 192, 512, maskable 512 and 180.

## Still open from earlier phases

- Phase 04 — the real-device address-bar-collapse check (U7) needs an actual phone; leaked-password
  protection is a Supabase dashboard toggle and is still off.
- Phase 06 — closed 2026-07-27 with F10. Nothing manual left.
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
