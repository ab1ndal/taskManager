import 'server-only';
import webpush from 'web-push';
import { emailConfigured, sendEmail } from './email';
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { buildDigest, digestCount, localParts, type DigestTask, type Preferences } from './digest';
import { digestHtml, digestText } from './render';
import { subscriptionSchema } from './schemas';

type PrefRow = Preferences & { user_id: string };
// PostgREST returns at most this many rows; read it explicitly so truncation is detectable.
const ASSIGNMENT_LIMIT = 1000;
/**
 * Declarative Web Push (iOS/iPadOS 18.4+). The OS renders this shape itself and applies
 * `app_badge` without waking a service worker, and because visibility is guaranteed these messages
 * are exempt from the silent-push penalty that revokes a subscription. `public/sw.js` still
 * receives the event on older iOS and reads the same fields from `notification`.
 */
type PushPayload = {
  web_push: 8030;
  notification: { title: string; body: string; tag: string; navigate: string; app_badge: number };
};

export async function runReminders(admin: SupabaseClient, now = new Date()) {
  const start = Date.now();
  const { data: prefs, error } = await admin.from('notification_prefs').select('*').or('push_enabled.eq.true,email_enabled.eq.true');
  if (error) throw new Error('Could not load reminder preferences.');
  const result = { sent: 0, failed: 0, skipped: 0 };
  for (const pref of (prefs ?? []) as PrefRow[]) {
    // Leave room before the route's 60-second deadline; next tick handles remaining users.
    if (Date.now() - start > 40000) break;
    try {
      const local = localParts(now, pref.timezone);
      if (local.time < pref.digest_time.slice(0, 5)) { result.skipped++; continue; }
      const { data: members, error: memberError } = await admin.from('workspace_members').select('id, workspaces!inner(kind)').eq('auth_user_id', pref.user_id);
      if (memberError) throw memberError;
      if (!members?.length) { result.skipped++; continue; }
      const { data: assignments, error: assignmentError } = await admin.from('task_assignments')
        .select('member_id, member_sort_key, tasks!inner(id,title,due_at,completed_at)')
        .in('member_id', members.map(m => m.id)).is('tasks.completed_at', null).not('tasks.due_at', 'is', null)
        .order('member_sort_key').limit(ASSIGNMENT_LIMIT);
      if (assignmentError) throw assignmentError;
      // PostgREST caps rows silently. Say so rather than mailing a quietly short digest.
      if ((assignments?.length ?? 0) >= ASSIGNMENT_LIMIT) console.error('Digest truncated at the assignment limit', { userId: pref.user_id, limit: ASSIGNMENT_LIMIT });
      const memberKinds = new Map((members as unknown as { id: string; workspaces: { kind: 'work' | 'household' } }[]).map(member => [member.id, member.workspaces.kind]));
      const tasks = (assignments ?? []).map(row => ({ ...row.tasks, workspace_kind: memberKinds.get(row.member_id), member_sort_key: Number(row.member_sort_key) })) as unknown as DigestTask[];
      const digest = buildDigest(tasks, now, pref.timezone, pref.soon_window_days);
      if (!digestCount(digest)) { result.skipped++; continue; }
      for (const kind of ['work', 'household'] as const) {
        if (!pref.email_enabled) break;
        const recipient = kind === 'work' ? pref.work_email : pref.personal_email;
        if (!recipient) continue;
        const channel = kind === 'work' ? 'email_work' : 'email_personal';
        // Total partition: an unrecognised workspace kind must not vanish from email.
        const emailDigest = buildDigest(tasks.filter(task => (task.workspace_kind === 'work') === (kind === 'work')), now, pref.timezone, pref.soon_window_days);
        if (!digestCount(emailDigest)) continue;
        if (Date.now() - start > 35000) break;
        try {
          if (!emailConfigured()) throw new Error('Email is not configured');
          const links = {
            app: new URL('/tasks', process.env.REMINDER_APP_URL!).href,
            settings: new URL('/settings?tab=notifications', process.env.REMINDER_APP_URL!).href,
          };
          const email = {
            from: process.env.GMAIL_USER!, to: [recipient],
            subject: `Hearth · ${kind === 'work' ? 'Work' : 'Personal'} reminders for ${local.date}`,
            text: digestText(emailDigest, pref.timezone, links, now),
            html: digestHtml(emailDigest, pref.timezone, links, now),
          };
          const emailToken = randomUUID();
          const { data: emailClaims, error: emailClaimError } = await admin.rpc('claim_notification', {
            p_user_id: pref.user_id, p_period_key: local.date, p_channel: channel, p_payload: email, p_token: emailToken,
          });
          if (emailClaimError) throw emailClaimError;
          const emailClaim = emailClaims?.[0];
          if (emailClaim) {
            // SMTP has no idempotency API. Record the attempt BEFORE sending; an ambiguous
            // timeout must not send a second daily email. Transient rejection releases it again.
            const { error: attemptError } = await admin.from('notification_log').update({ attempted_at: now.toISOString() })
              .eq('id', emailClaim.id).eq('claim_token', emailToken);
            if (attemptError) throw attemptError;
            try {
              await sendEmail(emailClaim.payload, `<hearth-${pref.user_id}-${local.date}-${channel}@gmail.com>`);
            } catch (error) {
              const smtp = error as { responseCode?: number; code?: string };
              // 4xx is a transient refusal and EAUTH/EDNS never reached the mailbox, so a later
              // tick can retry. A 5xx rejection is permanent: releasing it would retry a certain
              // failure every tick until the local day rolls over.
              if ((smtp.responseCode && smtp.responseCode >= 400 && smtp.responseCode < 500) || smtp.code === 'EAUTH' || smtp.code === 'EDNS') {
                const { error: resetError } = await admin.from('notification_log').update({ attempted_at: null })
                  .eq('id', emailClaim.id).eq('claim_token', emailToken);
                if (resetError) throw resetError;
              }
              throw error;
            }
            const { error: sentError } = await admin.from('notification_log').update({ sent_at: now.toISOString() })
              .eq('id', emailClaim.id).eq('claim_token', emailToken);
            if (sentError) throw sentError;
            result.sent++;
          } else { result.skipped++; }
        } catch {
          result.failed++;
          console.error('Email reminder failed', { userId: pref.user_id, period: local.date });
        }
      }
      if (!pref.push_enabled) continue;
      if (!process.env.VAPID_SUBJECT || !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
        result.failed++;
        console.error('Push reminder skipped: VAPID keys are not configured', { userId: pref.user_id, period: local.date });
        continue;
      }
      const { data: subscriptions, error: subscriptionError } = await admin.from('push_subscriptions')
        .select('*').eq('user_id', pref.user_id);
      if (subscriptionError) throw subscriptionError;
      if (!subscriptions?.length) { result.skipped++; continue; }
      // Keep the encrypted payload well below browser push size limits. The app shows the full list.
      const sections = ([['Overdue', digest.overdue], ['Due today', digest.today], ['Due soon', digest.soon]] as const)
        .filter(([, items]) => items.length).map(([label, items]) => `${label} (${items.length}): ${items.slice(0, 2).map(t => t.title.slice(0, 70)).join(', ')}${items.length > 2 ? ', …' : ''}`);
      // The badge is what is late or due now, not the whole digest: a number that counts tasks
      // due next week is lit permanently and stops meaning anything.
      const appBadge = digest.overdue.length + digest.today.length;
      const payload: PushPayload = {
        web_push: 8030,
        notification: {
          title: 'Hearth · Daily reminders',
          body: sections.join('\n'),
          tag: `hearth-${pref.user_id}-${local.date}`,
          // `navigate` must be absolute; REMINDER_APP_URL is the canonical origin the cron job
          // already posts to.
          navigate: new URL('/tasks', process.env.REMINDER_APP_URL ?? 'https://localhost').toString(),
          app_badge: appBadge,
        },
      };
      const token = randomUUID();
      const { data: claims, error: claimError } = await admin.rpc('claim_notification', {
        p_user_id: pref.user_id, p_period_key: local.date, p_channel: 'push', p_payload: payload, p_token: token,
      });
      if (claimError) throw claimError;
      const claim = claims?.[0];
      if (!claim) { result.skipped++; continue; }
      const delivered: string[] = [...claim.delivered_endpoints];
      let failed = false;
      for (const subscription of subscriptions) {
        if (delivered.includes(subscription.endpoint)) continue;
        if (Date.now() - start > 45000) { failed = true; break; }
        try {
          const checked = subscriptionSchema.parse({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } });
          await webpush.sendNotification(checked, JSON.stringify(claim.payload), {
            vapidDetails: { subject: process.env.VAPID_SUBJECT!, publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, privateKey: process.env.VAPID_PRIVATE_KEY! },
            TTL: 3600, timeout: 5000,
          });
          delivered.push(subscription.endpoint);
          const { error: receiptError } = await admin.from('notification_log').update({ delivered_endpoints: delivered }).eq('id', claim.id).eq('claim_token', token);
          if (receiptError) throw receiptError;
        } catch (error) {
          // Only 404/410 prove the endpoint is gone. Anything else — a 403 from a rotated VAPID
          // key included — retries, because deleting on a configuration mistake would silently
          // unsubscribe every device and force a manual re-enable on each one.
          const status = (error as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            const { error: deleteError } = await admin.from('push_subscriptions').delete().eq('id', subscription.id).eq('user_id', pref.user_id);
            if (deleteError) failed = true;
          } else {
            failed = true;
            console.error('Push delivery failed', { userId: pref.user_id, period: local.date, status });
          }
        }
      }
      if (!failed) {
        const { error: logError } = await admin.from('notification_log').update({ sent_at: now.toISOString() }).eq('id', claim.id).eq('claim_token', token);
        if (logError) throw logError;
        result.sent++;
      } else { result.failed++; console.error('Reminder delivery failed', { userId: pref.user_id, period: local.date }); }
    } catch {
      result.failed++;
      console.error('Reminder processing failed', { userId: pref.user_id });
    }
  }
  return result;
}
