# Open work

## Grocery dictation Record button (branch `feat/grocery-voice-transcription`, 2026-09-27)

- [ ] Add `OPENAI_API_KEY` to `.env.local` and to Vercel (Preview + Production).
- [ ] The grocery parser moved from Claude Haiku to `gpt-6-luna` on the same branch. Parse a real
      list once the key is in and compare categories/quantities against the old behaviour; then
      remove `ANTHROPIC_API_KEY` from Vercel and `.env.local` (nothing reads it any more).
- [ ] Verify on the installed iPhone app: mic permission prompt, a 10-second list round-trips into
      the textarea, backgrounding mid-recording delivers what was said. Note whether iOS re-asks
      for mic permission on every launch (docs/ios.md says unverified).
- [ ] Confirm OpenAI accepts `keywords[]` / `languages[]` as sent (never exercised against the live
      API — no key on this machine when it was built). A 400 naming either field means the
      multipart encoding in `transcribe-actions.ts` is wrong.
- [ ] Pre-existing, not from this branch: `add-row.tsx:114` quantity input is `min-h-10` (40px), so
      the pantry and dictate-entry 44px sweeps in `e2e/layout.spec.ts` fail on every project.
      Introduced by caaf77d (2026-09-10).

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
