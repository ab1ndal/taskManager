# Daily reminders

What the reminder code does. For environment variables, Vault keys, migration order and the manual
post-deploy checks, see [reminder setup](reminders-setup.md).

| Concern | File |
| --- | --- |
| Cron entry point | `src/app/api/cron/reminders/route.ts` |
| Run loop, routing, claims, retries | `src/lib/reminders/delivery.ts` |
| Task classification | `src/lib/reminders/digest.ts` |
| Email rendering | `src/lib/reminders/render.ts` |
| SMTP transport | `src/lib/reminders/email.ts` |
| Preference and subscription validation | `src/lib/reminders/schemas.ts` |
| Tables, claim RPC, RLS | `supabase/migrations/022_notifications.sql` – `025_reminder_time_grid.sql` |

## Scheduling and authorization

`pg_cron` runs `private.dispatch_daily_reminders()` every 15 minutes. The function reads
`reminder_app_url` and `reminder_cron_secret` from Vault, returns immediately if either is missing,
and uses `pg_net` to POST `/api/cron/reminders` with an `x-cron-secret` header.

The route accepts POST only. It compares the header against `CRON_SECRET` with a length check and
`timingSafeEqual`, answering `401` before it constructs anything, and only then creates the
service-role client. Regular settings actions use authenticated clients under RLS; neither
`notification_log` nor `claim_notification` is reachable by app users.

## Choosing who is due

`runReminders` loads every `notification_prefs` row with `email_enabled` or `push_enabled` set, and
for each one compares the user's local `HH:MM` against `digest_time`. A user is due once local time
has reached that value, so the digest goes out on the **first tick at or after** the send time, not
only on an exact match. `digest_time` is constrained to quarter hours, because a time like 23:50
would have no tick left in its own local day.

Local dates and times come from `localParts`, which formats through `Intl` in the user's IANA
timezone. Every day boundary in the system is a local calendar date, never a UTC offset or an
elapsed-hours calculation, so a 23- or 25-hour DST day cannot shift a task into the wrong section or
a digest into the wrong period.

## Building the digest

Tasks come from `task_assignments` joined to `tasks`, filtered to the caller's workspace memberships,
incomplete, and dated. Assigned subtasks are included like any other task. Ordering is
`member_sort_key`, so priority is per assignee and a shared task can sit at different positions for
different people. The query is capped at 1000 assignment rows; hitting the cap logs an error rather
than mailing a quietly short digest.

`buildDigest` splits tasks into three mutually exclusive sections. Anything whose deadline has
already passed is `overdue`, including earlier the same day. Remaining tasks due on the local
current date are `today`. Tasks falling within the next `soon_window_days` calendar days
(1–30) are `soon`. Undated, completed and duplicate rows are dropped.

Email is then split by workspace: `workspaces.kind = 'work'` goes to the work address and every other
kind, `household` included, goes to the personal address. Workspace names never affect routing. Each
category is re-classified on its own subset, so counts and sections match that email's contents. A
blank address skips its category without falling back to the other one, and a category with nothing
in it is not sent. Push combines both categories into one notification.

## Email content

Each digest is sent as both a plain-text and an HTML part; a client that refuses HTML still shows the
text. Both come from the same `Digest` object, so they cannot disagree about which tasks are listed.
Sections are `Overdue`, `Due today` and `Due soon`, each headed with its own count and omitted
entirely when empty. Due dates read relatively near today (`yesterday`, `earlier today, 9:00 AM`,
`Tue, 9:00 AM`) and absolutely beyond a week.

The HTML nests tables with inline styles and states every colour explicitly. Outlook renders through
Word, which ignores `<style>` blocks, flex and grid, and no client can be relied on to inherit a
theme. There are no images or web fonts. Task titles are user input and are HTML-escaped; the
plain-text part leaves them as typed.

The push payload is deliberately small, to stay under browser push size limits: per section, a count
and the first two titles truncated to 70 characters. The app shows the full list.

It is sent in Declarative Web Push shape (`web_push: 8030` with the fields nested under
`notification`). iOS and iPadOS 18.4+ render that themselves without waking a service worker, and
apply `app_badge` to the Home Screen icon directly. Because the notification is guaranteed to be
visible, declarative messages are exempt from the silent-push penalty that revokes a subscription.
`public/sw.js` still receives the event on older systems, reads the same fields, and sets the badge
through `WorkerNavigator.setAppBadge` — supported for Home Screen web apps since iOS 16.4. It falls
back to the flat `{title, body, tag, url}` shape so a payload queued before the change still shows.

`app_badge` counts overdue plus due-today tasks only. A badge that includes next week's work is lit
permanently and stops carrying information. Nothing clears a badge automatically — not reading the
notification, not opening the app — so `PushUpkeep` clears it whenever the app becomes visible.

## Claims and idempotency

`claim_notification` leases `(user_id, period_key, channel)` in a single upsert, across HTTP requests
and server instances. Email channels are `email_work` and `email_personal`; push is `push`. A row can
only be re-claimed when it has no `sent_at`, when its `claimed_at` is more than ten minutes old, and
— for email — when `attempted_at` is still null. The claimed payload is frozen and replayed on every
retry, so a changed address or a changed task title after a failed attempt does not alter the message
in flight; both appear in the next day's digest instead. Empty digests create no rows at all.

## Retries and failure semantics

SMTP has no idempotency API, so `attempted_at` is written *before* the send. A transient 4xx refusal,
or an `EAUTH`/`EDNS` failure that never reached a mailbox, clears that marker so a later tick can
retry. A 5xx rejection keeps it, because retrying a certain failure would repeat it every tick until
the local day rolls over. An ambiguous timeout or a crash after the marker prevents an automatic
re-send that day, preferring a possibly missed email over a duplicate.
`attempted_at IS NOT NULL AND sent_at IS NULL` finds these rows. The stable Message-ID aids tracing
and is not treated as provider deduplication.

`sent_at` records that the SMTP server accepted the message. Delivery beyond that point is out of the
system's hands; a receiving gateway may queue a message for minutes after `sent_at` is written.

For push, each accepted endpoint is appended to `delivered_endpoints`, so a partially failed run
skips what already arrived. Only 404 and 410 delete a subscription. Any other status — a 403 from a
rotated VAPID key included — is logged and retried, because deleting on a configuration mistake
would silently unsubscribe every device. A crash between provider acceptance and receipt persistence
can still repeat a push; the stable notification tag replaces the visible one where supported.
Provider acceptance does not guarantee display.

Failures are independent: work email, personal email and push each succeed or fail on their own, and
one user's failure does not stop the users after them. Missing VAPID keys count as a push failure and
are logged. The run returns `{ sent, failed, skipped }`.

## Time budget

The route declares `maxDuration = 60`. Within it the loop stops starting new users at 40s, new emails
at 35s, and new push endpoints at 45s, leaving room to finish work already in flight. Whatever is
left waits for the next 15-minute tick, so delivery is approximate rather than exact.

## Tests

`src/lib/reminders/*.test.ts` covers DST and local-day boundaries, section classification, routing by
workspace kind, relative date formatting, HTML escaping, concurrent claims, independent failures,
SMTP ambiguity and expired subscriptions. `supabase/tests/notifications.sql` checks the claim RPC and
RLS inside a caller-owned transaction. Provider calls are mocked throughout — no test sends a real
message.
