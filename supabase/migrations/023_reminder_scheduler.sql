-- pg_net availability verified on both projects. No requests are issued until Vault is configured.
create extension if not exists pg_net with schema extensions;

create function private.dispatch_daily_reminders()
returns void language plpgsql security definer set search_path = '' as $$
declare
  app_url text;
  cron_secret text;
begin
  select decrypted_secret into app_url from vault.decrypted_secrets where name = 'reminder_app_url';
  select decrypted_secret into cron_secret from vault.decrypted_secrets where name = 'reminder_cron_secret';
  if app_url is null or cron_secret is null then return; end if;
  perform net.http_post(
    url := rtrim(app_url, '/') || '/api/cron/reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', cron_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end;
$$;
revoke all on function private.dispatch_daily_reminders() from public, anon, authenticated;
select cron.schedule('hearth-daily-reminders', '*/15 * * * *', 'select private.dispatch_daily_reminders()');
