# Open work

## Grocery list — implementation and verification complete (2026-09-07)

Branch `feat/grocery-list`. All twelve plan tasks (categories and timezone-safe date arithmetic,
per-user sort orders, migrations 026–028, zod schemas, seven server actions, the add row with
history-backed autocomplete, foreground-refresh polling, the page with pantry/shopping views, item
rows, the edit-item dialog, the nav entry, the e2e suite, and this docs/verification pass) are done.
The prior handover here was stale; historical reviews remain in
`.superpowers/sdd/2026-09-06-grocery-list/progress.md`.

`docs/db.md`'s `grocery_items` section and `docs/product.md`'s `Groceries` section were checked
against the Task 12 brief's two checklists item by item; both already covered every item (column
list, four-state table, archived-rows-as-autocomplete-history, `grocery_forget` as the only real
delete, the `categories.ts`/check-constraint slug duplication, the two triggers, RPCs as the only
transition path with constraints as backstop; workspace-membership visibility as the departure from
assignment-based visibility, full member CRUD, the two views, low-stock, the `~` estimate
convention, shopping list as default) — nothing was added or rewritten.

**Full verification, run 2026-09-07:**
- `npm run typecheck` — clean.
- `npm test` — **61 suites / 764 tests passed.** (Regression baseline going forward — supersedes the
  earlier `53 suites / 717 tests` baseline, which this run's counts replace; a future session below
  these numbers has regressed.)
- `npm run lint` — 0 errors, 1 pre-existing warning in `src/app/tasks/schemas.recurrence.test.ts`
  (unrelated to groceries, not touched).
- `npm run build` — succeeds.
- `npx playwright test` — the full five-project matrix would not stay resident in memory on this
  machine (one run was killed by the operator investigating a stalled wait, a second was killed by
  the OS under memory pressure at 349/471 tests, both green up to the kill). Verified instead
  **project by project, single worker, in config order** (chromium, webkit, firefox, iphone,
  iphone-16-pro), each a clean process: chromium 91 passed/6 skipped/0 failed; webkit 80 passed/16
  skipped/**1 failed** (`task-flow.spec.ts:53`, an update posted in the edit modal persists across a
  reload — `page.goto` timeout during context teardown); firefox 81 passed/16 skipped/0 failed;
  iphone 96 passed/**1 failed** (`screenshots.spec.ts:85`, edit-task dialog — light — `page.goto`
  timeout); iphone-16-pro 87 passed/0 failed. No grocery spec failed in any run, chunked or full.
  Both failures are pre-existing, unrelated specs (task-flow, screenshots) failing on navigation
  timeouts, not on assertions — consistent with memory pressure on this run's machine rather than a
  code defect; not fixed or weakened per the task's no-source-changes constraint. Left as a real,
  reported gap: **not a clean green five-for-five.**

Nothing from this task is merged or pushed. Migrations 026–028 are applied to **dev only**;
production gets them through the `deploy-migrations` workflow on merge, not from this branch.

## Known exposure: the public workspace directory (accepted 2026-09-06)

`007_rls_security_definer.sql:134` makes `workspaces_select` `using (true)`, and
`workspace_members_insert_self` constrains only `auth_user_id`, not which workspace. Any
authenticated user can therefore join the Household workspace and read whatever membership alone
protects. Production has `disable_signup: false` with email and Google enabled, so account creation
is open to anyone.

Today that exposes workspace names and kinds plus member display names. The grocery feature will
make it household content, and because grocery authorization is membership, a self-joined outsider
would get the same full read, write and permanent-delete access as a real member.

The owner accepted this on 2026-09-06 after both the read and the write/delete scope were spelled
out: the app is login-gated and only household members hold accounts. Members having full CRUD over
the shared list is the intended design.

- [ ] Cheapest mitigation, no code: disable new signups in the Supabase dashboard
      (Authentication -> Sign In / Providers). Both users already have accounts.
- [ ] Proper fix, if the app ever gains a third user: narrow `workspaces_select` to
      `private.is_workspace_member(id)` and gate self-join behind an invite.

## iOS standalone / mobile app — shipped 2026-09-06

Branch `feat/ios-standalone`, merged; head `ed885e5`, working tree clean. All eight plan steps
and the verification follow-up are complete: manifest served without a session, build-id endpoint,
`<ResumeRefresh />` with resume and 5-minute polling, push badge, 393px layout fixes, Playwright
projects for both phones, and the desktop visual baselines. Execution lessons live in
`tasks/lessons.md`; behaviour is documented in `docs/ios.md`.

### Still outstanding

Push is verified end to end as of 2026-09-07: delivery was confirmed on the 08:00
America/Los_Angeles tick, and the second device (user `752a8633`) is now subscribed, so
production `push_subscriptions` holds a row for both users. The digest-seeding, delivery-check
and second-device items that lived here are done and have been removed rather than left as
stale checkboxes.

- [ ] Confirm on device whether an app-switcher resume fires `pageshow{persisted:true}` on current
      iOS. Undocumented anywhere; `ResumeRefresh` listens to both `visibilitychange` and `pageshow`
      because of it. If only one fires, the other listener can go.

Device checks the user already confirmed on 2026-09-06: launch with Safari closed, refresh after
backgrounding, task create/edit with the keyboard, board dragging, Settings reachable.
