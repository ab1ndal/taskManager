# Open work

## IN FLIGHT: grocery list, subagent-driven execution (handover 2026-09-06)

Branch `feat/grocery-list`, based on `aacf10d` on `main`. **Nothing is merged and nothing is
pushed.** Six of twelve plan tasks are complete and reviewed clean; a seventh is mid-fix.

Read these three, in this order, before doing anything:

1. `.superpowers/sdd/2026-09-06-grocery-list/progress.md` — the SDD ledger. It is the authority on
   what is done, every ruling made, and every deferred minor. Trust it and `git log` over any
   summary, including this one.
2. `docs/superpowers/plans/2026-09-06-grocery-list.md` — the plan being executed, 12 tasks.
3. `docs/superpowers/specs/2026-09-06-grocery-list-design.md` — the spec the plan argues from. It is
   the binding authority when the plan and a review disagree.

### State right now

| Task | Status | Commit |
|---|---|---|
| 1 categories + timezone-safe dates | complete, review clean | `d1f2a56` |
| 2 sort orders | complete, review clean | `6a12b93` |
| 3 migration 026 (table, triggers, RLS) | complete, review clean | `d7b5c48` |
| 4 migrations 027/028 (six RPCs) | complete after 1 fix round | `342e100`, `141a621` |
| 5 schemas + rpc-errors | complete after 1 fix round | `1b679ce`, `c6d3030` |
| 6 server actions + fake handlers | complete after 1 fix round | `591823d`, `a691215` |
| 9 foreground refresh hook | fix round 1 committed, **re-review pending** | `9e28614`, `65dae91` |
| 8 add row + suggestions | not started, brief staged | — |
| 7 page + views + rows | not started | — |
| 10 nav slot, 11 e2e, 12 docs | not started | — |

**Build order is 1,2,3,4,5,6,9,8,7,10,11,12** — not the plan's numbering. Ruling 1 in the ledger
explains why: Task 7 declares `GroceryItem` while importing Task 8's and Task 9's modules, and Task
8 imports the type back, so the plan's order cannot compile. `GroceryItem` moves to
`src/app/groceries/types.ts`, created in Task 8, and `groceries-client.tsx` re-exports it.

### The exact resume point

Task 9's fix round is committed at `65dae91`: its tests now assert `jest.getTimerCount()` is 0 when
the timer is stopped and 1 when running, and the implementer proved they discriminate by breaking
`stop()` to a no-op (3 tests failed) and restoring it (all 4 pass). The hook itself was never
changed and must not be.

Two steps, in order:

1. **Scoped re-review of `9e28614..65dae91`.** Generate the package with
   `<superpowers>/skills/subagent-driven-development/scripts/review-package docs/superpowers/plans/2026-09-06-grocery-list.md 9e28614 65dae91`
   and dispatch the re-review prompt with the one finding ("two tests assert only that refresh was
   not called, so an interval that keeps firing and early-returns would pass"). Cheap model is fine
   — it is a two-file test change. Then write `Task 9: complete (...)` to the ledger.
2. **Task 8**, whose brief is already extracted at
   `.superpowers/sdd/2026-09-06-grocery-list/task-8-brief.md`. Record `git rev-parse HEAD` as BASE
   before dispatching. Task 8 creates `src/app/groceries/types.ts` (Ruling 1), `suggest.ts` and
   `add-row.tsx`. Two things its dispatch must carry: the plan's `submit(value, categoryOverride?)`
   signature is load-bearing — picking a suggestion must submit *that item's* category, because
   `setCategory()` does not change the binding the current render closed over and `grocery_upsert`
   overwrites the column; and `add-row.test.tsx` must mock `./actions`, since importing a
   `"use server"` module in jsdom otherwise fails.

Task 7 follows, and its dispatch must carry Ruling 2: the "Still good" button uses
`estimatedExpiry(item.category) ?? addDays(today, 7)`, not a flat 7 days.

### Database state (dev only)

Migrations 026, 027 and 028 are applied to **task-manager-dev** (`mcdpiuiayfljzvnhtqto`) and
recorded local and remote. Production (`xamdgvxziobpptcfymug`) has none of them and must not — it
gets them through the `deploy-migrations` workflow on merge. `grocery_items` holds zero rows; all
six RPCs exist with `security definer`, `search_path=""`, EXECUTE for `service_role` only.

### Verification baseline

`npm test` was 48 suites / 672 tests before this work and 53 / 717 after Task 6's fix round.
Anything lower means a regression, not a new baseline.

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

- [ ] Second device never subscribed. Production `push_subscriptions` holds one row only — user
      `3c18a37f`, a `web.push.apple.com` endpoint created 2026-09-06 21:47 UTC. The other user,
      `752a8633`, has `push_enabled = false` and no subscription, so the OS permission granted on
      that phone never reached the database. Open the app there, enable push in
      Settings -> Notifications, then re-check the table.
- [ ] Push delivery and badge on device. VAPID keys are in production and deployed (2026-09-06).
      Remaining: see one push actually arrive, and check the badge count matches overdue + due today
      and clears on task-list load.
**Plan: verify on the 08:00 America/Los_Angeles tick of 2026-09-07** rather than sending a one-off.
No test push can be signed from a laptop — `vercel env pull --environment=production` returns `""`
for every variable marked Sensitive in Vercel (`VAPID_PRIVATE_KEY`, `CRON_SECRET`,
`SUPABASE_SECRET_KEY`, both `GMAIL_*`), since sensitive values are write-only after creation. Only
the plain ones (`NEXT_PUBLIC_*`, `VAPID_SUBJECT`, `REMINDER_APP_URL`) come back.

- [ ] Before tomorrow morning: each user under test needs a non-empty digest. `runReminders` skips
      when `digestCount()` is 0, and a skip leaves no `notification_log` row — indistinguishable
      from a delivery failure. Give each one a task due today or tomorrow.
- [ ] Tomorrow after 08:00: check the phone, then read `notification_log` for `channel = 'push'`,
      `period_key = '2026-09-07'` — `sent_at` set and `delivered_endpoints` holding the endpoint
      means delivery worked.
- [ ] Confirm on device whether an app-switcher resume fires `pageshow{persisted:true}` on current
      iOS. Undocumented anywhere; `ResumeRefresh` listens to both `visibilitychange` and `pageshow`
      because of it. If only one fires, the other listener can go.

Device checks the user already confirmed on 2026-09-06: launch with Safari closed, refresh after
backgrounding, task create/edit with the keyboard, board dragging, Settings reachable.
