# Daily reminder setup

Deployment and configuration for the reminder system. For what the code actually does, see
[Daily reminders](reminders.md).

Daily email uses an existing Gmail account through SMTP. No domain purchase, Resend account, Apple
developer membership, or paid scheduler is required; existing free hosting and database quotas are
enough. Gmail account sending limits still apply, but two people receiving at most one work and one
personal email each day is a very small volume.

## Steps

1. Apply migrations 022–025 through the normal `supabase db push` / migration deployment workflow.
   Migration 024 fills the four approved recipient addresses by matching the two existing login
   emails. Preferences stay disabled until saved with email/push enabled. The migration does not
   change existing opt-in settings or overwrite schedules.
2. Set Vercel server environment variables:
   - `GMAIL_USER`: the Gmail account that sends the messages. Independent of recipient addresses.
   - `GMAIL_APP_PASSWORD`: a Google app password, not the regular account password. Google requires
     2-Step Verification; some managed or Advanced Protection accounts cannot use app passwords.
     Create it at https://myaccount.google.com/apppasswords and enter it directly in Vercel, never
     in chat or git.
   - `REMINDER_APP_URL`: the canonical HTTPS app origin (the free `*.vercel.app` address works).
   - `CRON_SECRET`: a random value, e.g. `openssl rand -hex 32`.
3. Store `reminder_app_url` and `reminder_cron_secret` in **each appropriate Supabase project's
   Vault**. Their values must match that environment's app URL and `CRON_SECRET`. Use the Vault
   dashboard; no secrets belong in migrations. The 15-minute job does nothing until both exist.
4. Redeploy with those environment variables. Each person opens Settings → Notifications, verifies
   their two addresses and timezone, chooses a time, and enables daily email reminders.
5. Optional push: generate a VAPID key pair with `npx web-push generate-vapid-keys`. Set
   `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` (`mailto:` plus the
   sender address). Rebuild after setting the public key. On iPhone, install Hearth to the Home
   Screen, open it there, use "Enable on this device", then Save changes.

   As of 2026-09-05 none of the three VAPID variables is set on the production project, so push has
   never been configured there; email digests are unaffected. Removing and re-adding Hearth to the
   Home Screen discards notification permission and the push subscription, and both must be granted
   again from the installed app.

Recipients preconfigured in migration 024:

| Person | Personal | Work |
| --- | --- | --- |
| Abhinav | bindal.abhinav@gmail.com | abindal@nyase.com |
| Anushka | anushka.a.jindal@gmail.com | ajindal@nyase.com |

## Verifying a deployment

`npm run typecheck`, `npm run lint`, and `npm test -- --runInBand` cover the app. Run
`supabase/tests/notifications.sql` against a disposable or test database after 022 and roll back its
fixtures. Migrations 022–025 and those assertions were verified together inside a rolled-back
transaction on the development project, and `pg_net` availability was probed on both development and
production.

Automated tests mock the delivery providers, so after deployment and credential setup verify a real
email for each category and a real push on a Home Screen iPhone.

Corporate mail gateways can queue a message well after Gmail accepted it. Mail to the `nyase.com`
work addresses passes through Proofpoint and arrives noticeably later than the personal Gmail copy —
confirmed on 2026-09-05. A work digest that has not landed yet is usually still in transit, so check
timing before investigating filtering.

References: [Google app passwords](https://support.google.com/accounts/answer/185833),
[Supabase pg_net](https://supabase.com/docs/guides/database/extensions/pg_net),
[Apple web push](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers).
