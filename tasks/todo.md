# Open work

## Grocery list — complete and merge-ready, not merged (2026-09-07)

Branch `feat/grocery-list`, head `25efbc2`, based on `aacf10d`. **Nothing is merged and nothing is
pushed.** All twelve plan tasks are complete and individually reviewed, and the whole-branch review
found two Criticals that the per-task reviews structurally could not see; both are fixed at the
server boundary and the fixes were re-reviewed clean.

What the whole-branch review caught, worth remembering because both were silent data loss on the
ordinary path:

- Re-adding an item by **typing its name** rewrote its stored category to `pantry`, because the
  upsert's conflict branch overwrote `category` unconditionally and the add row's selector defaults.
  The column drives shelf-life estimates and list ordering, so the loss was permanent and invisible.
- **Bought erased a user-entered expiry** for the five categories with no shelf life, because the
  RPC could not distinguish "no date supplied" from "explicitly no expiry".

Migration `029_grocery_expiry_and_category.sql` fixes both server-side, adds `grocery_extend_expiry`
so the "Still good" nudge stops writing back stale columns, and re-issues its own grants.
**Migrations 026-029 are applied to dev only** (`mcdpiuiayfljzvnhtqto`). Production
(`xamdgvxziobpptcfymug`) has none of them and gets them through the `deploy-migrations` workflow on
merge.

### Verification baseline

`npm test` is **61 suites / 775 tests**. Anything lower is a regression, not a new baseline.
typecheck clean, lint 0 errors (1 pre-existing warning), build succeeds. Playwright per project:
chromium 93, webkit 83, iphone 99, iphone-16-pro 87 — run **per project with `--workers=1`**, since
the full five-project matrix does not fit in memory on this machine.

Before any e2e run here: kill any stale `next start` on port 3100. `reuseExistingServer: true` will
otherwise hand the suite a server whose `.next` was rebuilt underneath it, and every server action
404s — it faked four grocery failures once already.

### Follow-ups, none blocking merge

- [ ] `board.spec.ts:297` fails on `iphone-16-pro` on this machine and is **not** one of the two
      previously known pre-existing failures. Unrelated to this branch; confirm on a machine that is
      not under memory pressure.
- [ ] `029_grocery_expiry_and_category.sql:26-28` — the comment claims more than shipped. A
      perishable's user-asserted date is still replaced by a fresh estimate on every Bought, which is
      defensible behaviour; the comment should say so.
- [ ] `e2e/layout.spec.ts:115` leaks its seeded row if the test fails before reaching cleanup. The
      `E2E ` prefix and workspace scoping bound the damage.
- [ ] The canonicalizing redirect carries an invalid `?workspace=` through one pass before the
      validation rejects it. Cosmetic.

Deferred minors judged shippable by the final review are recorded in the branch's commits and
reviews; the execution lessons live in `tasks/lessons.md`.

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
