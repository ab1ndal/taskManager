# Open work

## Known exposure: the public workspace directory (accepted 2026-09-06)

`007_rls_security_definer.sql:134` makes `workspaces_select` `using (true)`, and
`workspace_members_insert_self` constrains only `auth_user_id`, not which workspace. Any
authenticated user can therefore join the Household workspace and read whatever membership alone
protects. Production has `disable_signup: false` with email and Google enabled, so account creation
is open to anyone.

Today that exposes workspace names and kinds plus member display names. The grocery feature will
make it household content. The owner accepted this rather than delay the feature.

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
