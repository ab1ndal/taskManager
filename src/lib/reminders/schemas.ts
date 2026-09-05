import { z } from 'zod';
const recipient = z.union([z.literal(''), z.email().max(254)]);
export const preferencesSchema = z.object({
  work_email: recipient, personal_email: recipient,
  email_enabled: z.boolean(), push_enabled: z.boolean(),
  // pg_cron ticks every 15 minutes, so only quarter-hour times are reachable. A time such as
  // 23:50 has no tick left in its own local day and would never send.
  digest_time: z.string().regex(/^([01]\d|2[0-3]):(00|15|30|45)$/),
  timezone: z.string().max(100).refine(value => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
  }, 'Choose a valid IANA timezone.'),
  soon_window_days: z.number().int().min(1).max(30),
}).refine(value => !value.email_enabled || Boolean(value.work_email || value.personal_email), 'Add at least one recipient email.');
// Only known browser push services: never allow user-controlled URLs to reach internal services.
export const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2048).refine(value => {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.port && !url.username && !url.password &&
      (url.hostname === 'fcm.googleapis.com' || url.hostname === 'updates.push.services.mozilla.com' ||
       url.hostname.endsWith('.push.services.mozilla.com') || url.hostname === 'web.push.apple.com' ||
       url.hostname.endsWith('.notify.windows.com'));
  }, 'Unsupported push service.'),
  keys: z.object({ p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/), auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/) }),
});
