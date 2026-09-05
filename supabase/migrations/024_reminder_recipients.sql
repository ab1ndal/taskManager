-- User-provided routing. Match account emails, never display names or workspace names.
-- Reminders remain opt-in until each user enables them in Settings.
insert into public.notification_prefs(user_id, personal_email, work_email)
select id, 'bindal.abhinav@gmail.com', 'abindal@nyase.com'
from auth.users where lower(email) = 'bindal.abhinav@gmail.com'
on conflict (user_id) do update set personal_email = excluded.personal_email,
  work_email = excluded.work_email, updated_at = now();

insert into public.notification_prefs(user_id, personal_email, work_email)
select id, 'anushka.a.jindal@gmail.com', 'ajindal@nyase.com'
from auth.users where lower(email) = 'anushka.a.jindal@gmail.com'
on conflict (user_id) do update set personal_email = excluded.personal_email,
  work_email = excluded.work_email, updated_at = now();
