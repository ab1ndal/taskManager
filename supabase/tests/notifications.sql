-- Run after 022 in a transaction; caller rolls back all fixtures.
do $$
declare
  first_user uuid;
  second_user uuid;
  claim_count integer;
begin
  first_user := gen_random_uuid();
  second_user := gen_random_uuid();
  insert into auth.users(id) values(first_user),(second_user);
  insert into public.notification_prefs(user_id) values(first_user),(second_user);
  select count(*) into claim_count from public.claim_notification(first_user, '2099-01-01', 'email_work', '{}'::jsonb, gen_random_uuid());
  if claim_count <> 1 then raise exception 'First claim failed'; end if;
  select count(*) into claim_count from public.claim_notification(first_user, '2099-01-01', 'email_work', '{}'::jsonb, gen_random_uuid());
  if claim_count <> 0 then raise exception 'Duplicate active claim'; end if;
  update public.notification_log set claimed_at = now() - interval '11 minutes';
  select count(*) into claim_count from public.claim_notification(first_user, '2099-01-01', 'email_work', '{"changed":true}'::jsonb, gen_random_uuid());
  if claim_count <> 1 then raise exception 'Expired claim was not recovered'; end if;
  if exists(select 1 from public.notification_log where payload <> '{}'::jsonb) then raise exception 'Payload changed across retries'; end if;
  update public.notification_log set claimed_at = now() - interval '11 minutes', attempted_at = now();
  select count(*) into claim_count from public.claim_notification(first_user, '2099-01-01', 'email_work', '{}'::jsonb, gen_random_uuid());
  if claim_count <> 0 then raise exception 'Ambiguous SMTP send retried'; end if;
  select count(*) into claim_count from public.claim_notification(first_user, '2099-01-01', 'push', '{}'::jsonb, gen_random_uuid());
  if claim_count <> 1 then raise exception 'Channel isolation failed'; end if;
  update public.notification_log set sent_at = now(), claimed_at = now() - interval '11 minutes';
  select count(*) into claim_count from public.claim_notification(first_user, '2099-01-01', 'push', '{}'::jsonb, gen_random_uuid());
  if claim_count <> 0 then raise exception 'Sent claim retried'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub',first_user,'role','authenticated')::text,true);
end;
$$;
set local role authenticated;
do $$
begin
  if (select count(*) from public.notification_prefs) <> 1 then raise exception 'Preference RLS leaked rows'; end if;
  begin
    perform * from public.claim_notification(auth.uid(), '2099-01-02', 'push', '{}'::jsonb, gen_random_uuid());
    raise exception 'Authenticated user could claim a send';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.notification_log;
    raise exception 'Authenticated user could read delivery log';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
