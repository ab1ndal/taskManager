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
- [x] **F5** — subtask fields symmetric between the two modals. `d5cc3eb`.
- [x] **F4** — `RowMenu` roving focus per the ARIA APG menu-button pattern. `bed3fa8`.
- [x] **F7** — `e2e/drag-reorder.spec.ts`, pointer and keyboard paths. `e752d88`.
- [x] **F8** — contrast walk over four routes and three dialogs. `d95fb70`.
      Caught a real defect: `--color-text-muted` was 4.39:1 on `--color-surface-sunken`.
- [x] **F9** — screenshot baselines. `ceff361`.
- [x] **e2e fixture drift** — `task-flow.spec.ts` calls `cleanupUiWrites()` in `afterAll`. `d1da8d0`.
- [x] **F1** — `main` pushed to `origin`.
- [x] **F2** — the suite runs against `task-manager-dev` (`mcdpiuiayfljzvnhtqto`); production is
      reached only by a deployment, and `e2e/fixtures.ts` refuses to seed without `E2E_SUPABASE_URL`.
- [x] **F14** — raised, then closed the same day because its premise was false. L9 rewritten.
- [x] **F10** — dictation and mic-permission denial run by hand in Chrome, Safari and Firefox.
      All five checks in `06-VERIFICATION.md` pass: the mid-sentence pause survives (auto-restart),
      a blocked mic shows "Microphone access was denied" with no restart loop, Safari's
      `webkitSpeechRecognition` path works, Firefox renders no mic button. The run raised F15–F19.
- [x] **F6** — reopening a parent leaving its subtasks completed confirmed correct in real use.
      The rule stands as written; no reset added.
- [x] **F13** — `STATE.md` position block, progress counts and blockers reconciled.
- [x] **F15** — dictatable fields scroll to their newest text. `58d8dfe`.
- [x] **F16** — dictation on the task description and every subtask description, not just updates.
      `58d8dfe`. One shared session claimed by field id (`src/lib/use-dictation.ts`).
- [x] **F17** — Subtasks above Updates, no inner scroller, exact date/time behind the relative
      label. `58d8dfe`. Screenshot baselines regenerated.
- [x] **F18** — pressing a card opens its modal; the complete toggles on the task and each subtask
      stay one-press completes. One guard skips events from `button/a/input/label/dialog` and any
      `defaultPrevented` event, which is how a finished drag announces itself.
- [x] **mic nesting** — the in-field mic is borderless and inset clear of the field's border; the
      textarea is `block`, without which its inline descender space pushed the mic below the border.

Verified: `npx tsc --noEmit` clean, 263 jest tests pass, full Playwright suite 187 passed /
38 skipped, screenshot baselines regenerated for chromium and iphone in both schemes.

## Open followups — full statement of each in `06.5-FOLLOWUPS.md`

- **F22** — production email still goes through Supabase's built-in SMTP, which delivers only to
  project-team addresses and rate-limits at ~2/hour. Split out of F20; blocks email signup and
  password reset for anyone outside the team. Google sign-in is unaffected.
F20 (duplicate-signup message, explicit `emailRedirectTo`), F21 (Google sign-in) and F23 (generic
error on missing server config — closed as accepted, the structured log already names the cause)
all closed 2026-07-27. Full write-ups in `06.5-FOLLOWUPS.md`.
- **F19** — updates take 1–2s to render on open and a new task is not editable until the server
  revalidates. Measure against `npm run build && npm start` before fixing — `next dev` compiles
  per route, so the observed number may be a dev artefact.
- **F11** — no service worker, so the installed app needs the network for every load. Decide
  whether offline is in scope; if yes it is its own slice, not a config flag.
- **F12** — icons are placeholder art. Needs real artwork at 192, 512, maskable 512 and 180.

## Still open from earlier phases

- Phase 04 — the real-device address-bar-collapse check (U7) needs an actual phone; leaked-password
  protection is a Supabase dashboard toggle and is still off.
- Phase 06 — closed 2026-07-27 with F10. Nothing manual left.
- Phase 07 (recurring tasks) is code-complete and verified on dev (`mcdpiuiayfljzvnhtqto`);
  production deploy is pending. `task_rules` holds the schedule as a 1:1 row keyed by `task_id` —
  there is no `tasks.rule_id` column. `public.run_due_recurrences()` (013, followed up by 014) is
  the idempotent generator, run every 15 minutes by pg_cron.

## Resume commands

```bash
cd /Users/abindal/dev/taskManager
npx tsc --noEmit && npx jest
npm run build && npx playwright test          # writes to task-manager-dev — see F2
git log --oneline -8
```
