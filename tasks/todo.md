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

- **F20** — cause found and fixed 2026-07-27: the report was a repeat signup on an existing address,
  which Supabase answers with no error and no email, and the old code called that success.
  Duplicate-signup message and explicit `emailRedirectTo` now in `login-card.tsx`. Remaining: custom
  SMTP, because built-in SMTP delivers only to team addresses, and no fresh-address signup has been
  seen through end to end on production.
- **F21** — Google sign-in built 2026-07-27; Google Cloud client and Supabase provider configured by
  the owner. "Continue with Google" button in `login-card.tsx` reuses `/auth/callback`. Remaining:
  walk the flow once on production. Cannot be tested locally — no `supabase/config.toml`.
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
- Phase 07 (recurring tasks) is next and has not started. `task_rules` and `tasks.rule_id` exist
  with no generator; `task_rules` has RLS enabled and no policies, which is deny-all — the safe
  direction. The generator must be idempotent for a repeated `next_run_at`.

## Resume commands

```bash
cd /Users/abindal/dev/taskManager
npx tsc --noEmit && npx jest
npm run build && npx playwright test          # writes to task-manager-dev — see F2
git log --oneline -8
```
