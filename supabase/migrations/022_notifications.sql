-- Preferences are private to each user. Delivery state is service-role-only.
create table public.notification_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  work_email text not null default '' check (length(work_email) <= 254),
  personal_email text not null default '' check (length(personal_email) <= 254),
  email_enabled boolean not null default false,
  push_enabled boolean not null default false,
  digest_time time not null default '08:00',
  timezone text not null default 'UTC',
  soon_window_days integer not null default 3 check (soon_window_days between 1 and 30),
  updated_at timestamptz not null default now()
);
alter table public.notification_prefs enable row level security;
create policy notification_prefs_own on public.notification_prefs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.notification_prefs to authenticated;

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_id on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
create policy push_subscriptions_own on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.push_subscriptions to authenticated;

create table public.notification_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  period_key date not null,
  channel text not null check (channel in ('email_work', 'email_personal', 'push')),
  payload jsonb not null,
  claim_token uuid not null,
  claimed_at timestamptz not null default now(),
  sent_at timestamptz,
  attempted_at timestamptz,
  delivered_endpoints text[] not null default '{}',
  unique(user_id, period_key, channel)
);
alter table public.notification_log enable row level security;
revoke all on public.notification_log from anon, authenticated;
grant all on public.notification_prefs, public.push_subscriptions, public.notification_log to service_role;

-- One INSERT/UPDATE claims the entire send, across HTTP requests and server instances.
-- Freeze the digest across retries.
create function public.claim_notification(p_user_id uuid, p_period_key date, p_channel text, p_payload jsonb, p_token uuid)
returns setof public.notification_log
language sql set search_path = '' as $$
  insert into public.notification_log(user_id, period_key, channel, payload, claim_token)
  values (p_user_id, p_period_key, p_channel, p_payload, p_token)
  on conflict (user_id, period_key, channel) do update
    set claim_token = excluded.claim_token, claimed_at = now()
    where notification_log.sent_at is null
      and (notification_log.channel = 'push' or notification_log.attempted_at is null)
      and notification_log.claimed_at < now() - interval '10 minutes'
  returning *;
$$;
revoke all on function public.claim_notification(uuid, date, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.claim_notification(uuid, date, text, jsonb, uuid) to service_role;
