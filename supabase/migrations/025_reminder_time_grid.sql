-- The dispatcher runs every 15 minutes, so the last tick of any local day is 23:45. A digest_time
-- such as 23:50 was never reachable: no tick that day satisfied it, and the next tick belonged to
-- the following local date. Restrict the column to the grid the scheduler can actually serve.
update public.notification_prefs
  set digest_time = date_trunc('hour', digest_time)
        + make_interval(mins => (extract(minute from digest_time)::int / 15) * 15),
      updated_at = now()
  where extract(minute from digest_time)::int % 15 <> 0
     or extract(second from digest_time) <> 0;

alter table public.notification_prefs
  add constraint notification_prefs_digest_time_quarter_hour
  check (extract(minute from digest_time)::int % 15 = 0 and extract(second from digest_time) = 0);
