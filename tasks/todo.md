# Open work

## Grocery: shopping list category mismatches (deferred)

7 items on the shopping list have wrong categories (Broccoli/Bell Pepper→produce, Chick
Patties→frozen, Bread→baked, shoes/lint roller/oil spray→household). Shopping list doesn't show or
need categories today — the issue is upstream, on add.

## Grocery-list branch follow-ups, none blocking (from the 2026-09-08 merge)

- [ ] `board.spec.ts:297` fails on `iphone-16-pro` on this machine and is **not** one of the two
      previously known pre-existing failures. Unrelated to grocery-list; confirm on a machine that is
      not under memory pressure.
- [ ] `029_grocery_expiry_and_category.sql:26-28` — the comment claims more than shipped. A
      perishable's user-asserted date is still replaced by a fresh estimate on every Bought, which is
      defensible behaviour; the comment should say so.
- [ ] `e2e/layout.spec.ts:115` leaks its seeded row if the test fails before reaching cleanup. The
      `E2E ` prefix and workspace scoping bound the damage.
- [ ] The canonicalizing redirect carries an invalid `?workspace=` through one pass before the
      validation rejects it. Cosmetic.

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

## iOS standalone: confirm resume event on device

Confirm on device whether an app-switcher resume fires `pageshow{persisted:true}` on current iOS.
Undocumented anywhere; `ResumeRefresh` listens to both `visibilitychange` and `pageshow` because of
it. If only one fires, the other listener can go.
