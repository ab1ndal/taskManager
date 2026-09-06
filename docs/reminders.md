# Daily reminders

Daily email uses an existing Gmail account through SMTP. No domain purchase, Resend account,
Apple developer membership, or paid scheduler is required. Use existing free hosting/database
quotas. Gmail account sending limits still apply; two people receiving at most one work and one
personal email each day is a very small volume.

Each user's Notifications settings contain a work address, personal address, send time, IANA
timezone, and a 1–30 calendar-day upcoming window. The send time is a quarter hour, because the
dispatcher ticks every 15 minutes and a time such as 23:50 has no tick left in its own local day.
Workspaces are routed by `workspaces.kind`: `work` → work email; every other kind, `household`
included, → personal email. Workspace names never determine routing.
A blank address skips that category; it never falls back to another address. Each category gets
at most one daily email, even when it contains multiple workspaces. Push combines both categories.
Only assigned, incomplete, dated tasks are included, including assigned subtasks. Past deadlines
are overdue, even earlier today; the other sections are mutually exclusive. Priority is per assignee.

## Deployment setup

1. Apply migrations 022–025 through the normal `supabase db push` / migration deployment workflow.
   Migration 024 fills the four approved recipient addresses by matching the two existing login
   emails. Preferences remain disabled until saved with email/push enabled. The migration does not
   change existing opt-in settings or overwrite schedules.
2. Set Vercel server environment variables:
   - `GMAIL_USER`: the Gmail account that will send messages. This is independent of recipient addresses.
   - `GMAIL_APP_PASSWORD`: a Google app password, not the regular account password. Google requires
     2-Step Verification; some managed accounts or Advanced Protection accounts cannot use app passwords.
     Create it at https://myaccount.google.com/apppasswords and enter it directly in Vercel, never chat or git.
   - `REMINDER_APP_URL`: the canonical HTTPS app origin (the free `*.vercel.app` address works).
   - `CRON_SECRET`: a random value, e.g. generate locally with `openssl rand -hex 32`.
3. Store `reminder_app_url` and `reminder_cron_secret` in **each appropriate Supabase project's Vault**.
   Their values must match that environment's app URL and `CRON_SECRET`. Use the Vault dashboard;
   no secrets belong in migrations. The 15-minute job does nothing until both values exist.
4. Redeploy the app with those environment variables. Each person opens Settings → Notifications,
   verifies their two addresses and timezone, chooses a time, and enables daily email reminders.
5. Optional push: generate a VAPID key pair using `npx web-push generate-vapid-keys`. Set
   `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` (e.g. `mailto:` plus the
   sender address). Rebuild after setting the public key. On iPhone install Hearth to the Home Screen,
   open it there, and use “Enable on this device”, then Save changes.

Recipients preconfigured in migration 024:

| Person | Personal | Work |
| --- | --- | --- |
| Abhinav | bindal.abhinav@gmail.com | abindal@nyase.com |
| Anushka | anushka.a.jindal@gmail.com | ajindal@nyase.com |

## Email content

Each digest is sent as both a plain-text and an HTML part; a client that refuses HTML still shows
the text. Both parts are rendered in `src/lib/reminders/render.ts` from the same `Digest` object, so
they cannot disagree about which tasks are listed. Sections are `Overdue`, `Due today` and
`Due soon`, each headed with its own count and omitted entirely when empty. Due dates are relative
near today (`yesterday`, `earlier today, 9:00 AM`, `Tue, 9:00 AM`) and absolute beyond a week, all
counted from local calendar dates so a DST day cannot shift a label.

The HTML uses nested tables with inline styles and states every colour explicitly. Outlook renders
through Word, which ignores `<style>` blocks, flex and grid, and no client can be relied on to
inherit a theme. There are no images or web fonts. Task titles are user input and are HTML-escaped;
the plain-text part leaves them as typed. Both parts are stored in the frozen claim payload, so a
retry resends the identical message.

## Delivery and retries

`pg_cron` calls a private dispatcher every 15 minutes. It reads Vault and uses `pg_net` to POST
`/api/cron/reminders` with `x-cron-secret`. That exact route bypasses cookie-login middleware but
checks its secret before creating a service-role database client. Regular user settings actions
use authenticated clients and RLS. Neither logs nor the claim RPC are available to app users.

An atomic database upsert leases `(user, local date, channel)` for ten minutes; email channels are
`email_work` and `email_personal`, while push is `push`. Sent rows cannot be reclaimed. Empty
digests do not create rows. Claimed payloads are frozen across retries. Failures are independent
between email categories and push, and one user's failure does not stop subsequent users.

SMTP cannot guarantee exactly-once delivery. We record `attempted_at` before sending. A transient
4xx refusal, or an `EAUTH`/`EDNS` failure that never reached the mailbox, releases that marker so a
later tick can retry. A 5xx rejection is permanent and keeps the marker, because retrying it would
repeat a certain failure every tick until the local day rolls over. An ambiguous timeout or process
crash after this marker prevents automatic re-send that day, favoring no duplicates over a possibly
missed email. `attempted_at IS NOT NULL AND sent_at IS NULL` identifies these cases for inspection.
A stable Message-ID aids tracing but is not treated as provider deduplication.

For push, successful endpoints are recorded separately so a partially failed run skips them on
retry. Expired (404/410) endpoints are removed. Any other status — a 403 from a rotated VAPID key
included — is logged with its status code and retried rather than deleted, so one bad credential
cannot silently unsubscribe every device. A process crash between provider acceptance and
receipt persistence can still repeat a push; the stable notification tag replaces the visible
notification where supported. Provider acceptance does not guarantee display on a device.

Changing an email address after a failed attempt does not redirect the frozen retry payload.
Address and task-content changes appear in the next day's digest. Disabling email stops both
email categories immediately for subsequent runs. Removing a device only removes that device.

The route is bounded to 60 seconds and stops starting new work before that deadline. For this
household's size, normal runs take a few seconds. Delivery is approximate, within the next scheduler
tick; infrastructure outages can delay it. The worker is push-only and does not cache private pages.

## Verification

`npm run typecheck`, `npm run lint`, and `npm test -- --runInBand` cover the app. Reminder-specific
tests cover local-day/DST boundaries, visibility, routing by type, concurrent claims, independent
failures, SMTP ambiguity, expired subscriptions, cron authorization, and settings editing.
`supabase/tests/notifications.sql` checks database claims and RLS inside a caller-owned transaction.
Run against a disposable/test database after 022 and roll back its fixtures. Migrations 022–025
and these assertions were verified together inside a rolled-back transaction on the development
project. `pg_net` availability was probed on both development and production.

After deployment and credential setup, verify an actual email for each category and an actual
push on a Home Screen iPhone. Automated tests mock delivery providers and do not send messages.

References: [Google app passwords](https://support.google.com/accounts/answer/185833),
[Supabase pg_net](https://supabase.com/docs/guides/database/extensions/pg_net),
[Apple web push](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers).
