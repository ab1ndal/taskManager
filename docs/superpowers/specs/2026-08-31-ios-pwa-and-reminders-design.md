# iPhone Install & Daily Reminders — Design

Date: 2026-08-31
Status: original approved design; reminder implementation updated 2026-09-05.

The current reminder implementation and setup are documented in [Daily reminders](../../reminders.md).
User decisions supersede the email portions below: free Gmail SMTP, separate work/personal recipient
addresses per user, and routing by workspace kind rather than name. Atomic leases replace the
read-before-send check, and ambiguous SMTP attempts are not automatically retried.
The push worker is included; the broader offline-shell phase remains separate.

Two roadmap phases, designed together because they couple: iOS grants web push only to a PWA that
has been installed to the home screen, so the reminder channel depends on the install phase.

## Goal

**Phase 8** — both phones install Hearth from Safari's share sheet and it behaves like an app.

**Phase 9** — each user gets one message a day listing what is overdue, due today, and due soon,
by email and/or web push.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| iOS delivery | Harden the existing PWA | `src/app/manifest.ts` and the maskable icons already ship and already declare the PWA the iPhone deliverable. Two phones do not justify an Apple developer account, a Mac build step, or a second deploy pipeline. |
| Service worker | Hand-written `public/sw.js` | Next 16 ships no SW. `next-pwa` is unmaintained against Next 16; a ~60-line SW is less risk than the dependency. |
| Reminder channels | Email + web push | Both are free and need no vendor approval. |
| WhatsApp | Rejected | See Rejected Alternatives. |
| Reminder shape | One digest per user per day, three sections | Chosen over per-task offset fires: no per-task schema, no per-task UI, and one message a day cannot become noise. |
| Scheduler | `pg_cron` every 15 min → `pg_net.http_post` → `/api/cron/reminders` | `pg_cron` is already live in production (migration 013). Vercel Cron on Hobby caps at one run per day, which cannot serve per-user send times. |
| Idempotency unit | The digest, not the task | One `notification_log` row per (user, local date, channel), unique. A retry after partial failure re-sends nothing already logged. |
| Email provider | Resend | Supabase's built-in SMTP is auth-only and rate-limited. |
| Digest contents | Incomplete tasks assigned to the user, with a deadline | Completion — not board column — is the filter. Undated tasks are the default in this product and would flood the digest. |
| Empty digest | Send nothing, log nothing | A message that is usually empty trains the reader to ignore it. |

---

# Phase 8: Installable on iPhone (PWA hardening)

Not greenfield. `manifest.ts` (`display: standalone`, `start_url: /tasks`) and the 192/512/maskable
icons exist. This phase is the gap list between "installs" and "behaves like an app".

## Scope

1. **Service worker + offline shell.** `public/sw.js`, registered from a client component.
   Cache-first for the app shell and static assets; network-first for task data with the last
   successful response as fallback. Versioned cache name so a deploy evicts the old shell.

2. **Standalone-mode layout.** `viewport-fit=cover` plus `env(safe-area-inset-*)` padding so
   content clears the notch and the home indicator. `overscroll-behavior` to stop rubber-banding
   the whole page.

3. **Navigation dead ends.** A standalone PWA has no browser back button. Every route reachable
   from `/tasks` must offer an in-app way back. Audit `/board`, `/settings`, `/workspaces`,
   `/profile` and the modals.

4. **Session survival across cold launch.** iOS evicts standalone PWA storage aggressively. Confirm
   the Supabase refresh-token cookie survives a cold launch, or the two installs silently log out
   every week.

5. **Web push permission plumbing.** VAPID keypair in Vercel env, a `push_subscriptions` table, and
   a subscribe/unsubscribe control. This lands here rather than in Phase 9 because iOS only grants
   the permission prompt to a home-screen install — the capability is a property of the install.

## Verification

Manual checkpoint on a real iPhone, same shape as `04-06-PLAN.md`: install from the share sheet,
cold launch, airplane-mode load, notch/home-indicator clearance, back-navigation from every route,
and a test push. Playwright cannot drive iOS standalone mode; nothing here is asserted by e2e.

## Out of scope

App Store submission, Capacitor, any native code, Apple developer account, Android.

---

# Phase 9: Daily Reminder Digest

## Data model

Migration `022_notifications.sql`.

### notification_prefs

```
user_id          uuid primary key references auth.users(id) on delete cascade
email_enabled    boolean not null default false
push_enabled     boolean not null default false
digest_time      time not null default '08:00'
timezone         text not null default 'UTC'      -- IANA name
soon_window_days int  not null default 3
updated_at       timestamptz not null default now()
```

RLS: a user reads and writes only their own row. The cron route reads through `service_role`.

### notification_log

```
id          uuid primary key default gen_random_uuid()
user_id     uuid not null references auth.users(id) on delete cascade
period_key  date not null           -- the user's LOCAL send date, not UTC
channel     text not null           -- 'email' | 'push'
sent_at     timestamptz not null default now()

unique (user_id, period_key, channel)
```

The unique constraint is the whole idempotency story. `period_key` is local, not UTC, so a user in
UTC+13 does not get two digests on the day their local and UTC dates disagree.

### push_subscriptions (created in Phase 8)

```
id          uuid primary key default gen_random_uuid()
user_id     uuid not null references auth.users(id) on delete cascade
endpoint    text not null unique
p256dh      text not null
auth        text not null
created_at  timestamptz not null default now()
```

## Delivery pipeline

```
pg_cron (*/15 * * * *)
  └─ pg_net.http_post → POST /api/cron/reminders   (header: x-cron-secret)
       └─ for each user whose local digest_time has passed today
          and who has no notification_log row for (user, local date, channel):
            build digest → send → insert log row
```

`CRON_SECRET`, `RESEND_API_KEY`, and the VAPID keypair live in Vercel env. Never in the repo, never
in `vercel.json`. The route rejects any request without a matching secret before doing any work.

**Gate before planning:** probe that `pg_net` is available on both Supabase projects, exactly as
Task 1 of Phase 7 probed `pg_cron`. If it is not, the fallback is a GitHub Actions schedule hitting
the same route — the route contract does not change either way.

## Digest content

One message, three sections, in this order:

- **Overdue** — `due_at < now()`
- **Due today** — `due_at` within the user's local today
- **Due soon** — `due_at` within the next `soon_window_days`

Selection rules, all of which mirror existing read paths:

- assigned to this user via `task_assignments` (the product's visibility rule — never a workspace-wide list)
- `completed_at is null`
- `due_at is not null`
- ordered within each section by `member_sort_key`, so the digest agrees with what the user sees

If all three sections are empty, send nothing and write no log row.

## Settings surface

New **Notifications** tab in `/settings`, alongside the existing `board-tab` and `profile-tab`:
channel toggles, digest time, timezone, and the "due soon" window. The push toggle drives the
Phase 8 subscribe/unsubscribe flow and is disabled with an explanation when the browser has not
granted permission.

## Failure modes

| Mode | Handling |
|---|---|
| Email sends, push fails | Per-channel log rows, so the next tick retries only push. |
| Route times out mid-run | No log row written for unsent users; next tick picks them up. |
| Duplicate cron tick | Unique constraint rejects the second insert; the send is guarded by the log check that precedes it. |
| Stale push subscription (410/404 from the push service) | Delete the `push_subscriptions` row. |
| Resend outage | Log the failure with user id and period key; do not write the log row. Retries next tick, and stops retrying when the local day rolls over. |

## Out of scope

Per-task custom reminder times, due-date offset fires, assignment and update event notifications,
SMS, and WhatsApp.

## Rejected alternatives

**WhatsApp.** Requires the Meta WhatsApp Business Cloud API, a verified business, pre-approved
message templates, and per-message billing, and it cannot send free-form text to a user who has not
messaged the business in the previous 24 hours. For two phones that is vendor overhead and recurring
cost with no advantage over web push. Revisit only if the user base leaves those two phones.

**Capacitor wrapper / React Native rewrite.** Both buy APNs and a real native install at the cost of
an Apple developer account, a Mac-dependent build step, per-device distribution, and — for React
Native — duplicating every screen already built. Rejected for a two-phone deployment.

**Vercel Cron as the scheduler.** One run per day on Hobby cannot serve per-user send times, and the
project already runs `pg_cron` in production.

**Per-task offset reminders.** Superseded by the single daily digest during design: they add a
column, modal fields on both create and edit paths, and e2e coverage, to deliver information the
digest's "Due soon" section already carries.
