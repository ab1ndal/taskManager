'use server';

import { emailConfigured } from '@/lib/reminders/email';
import { requireUser } from '@/lib/auth';
import { preferencesSchema, subscriptionSchema } from '@/lib/reminders/schemas';

export async function getNotificationSettings() {
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase.from('notification_prefs').select('*').eq('user_id', user.id).maybeSingle();
  if (error) throw new Error('Could not load notification settings.');
  const { data: devices, error: deviceError } = await supabase.from('push_subscriptions').select('endpoint').eq('user_id', user.id);
  if (deviceError) throw new Error('Could not load connected devices.');
  return { endpoints: (devices ?? []).map(device => device.endpoint as string), preferences: data, publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '', emailAvailable: emailConfigured() };
}

export async function saveNotificationSettings(input: unknown) {
  const parsed = preferencesSchema.safeParse(input);
  if (!parsed.success) return { error: 'Check your recipient emails, timezone, and due-soon window (1–30 days). Reminder time must be on a quarter hour. Add an email address to enable email reminders.' };
  const { supabase, user } = await requireUser();
  if (parsed.data.email_enabled && !emailConfigured()) return { error: 'Email reminders are not configured yet.' };
  if (parsed.data.push_enabled) {
    const { data, error } = await supabase.from('push_subscriptions').select('id').eq('user_id', user.id).limit(1);
    if (error || !data?.length) return { error: 'Enable notifications on this device first.' };
  }
  const { error } = await supabase.from('notification_prefs').upsert({
    ...parsed.data, user_id: user.id, updated_at: new Date().toISOString(),
  });
  return error ? { error: 'Could not save notification settings.' } : { success: true };
}

export async function subscribeToPush(input: unknown) {
  const parsed = subscriptionSchema.safeParse(input);
  if (!parsed.success) return { error: 'This browser returned an unsupported push subscription.' };
  const { supabase, user } = await requireUser();
  const { endpoint, keys } = parsed.data;
  // RLS prevents transferring another account's endpoint to this account.
  const { error } = await supabase.from('push_subscriptions').upsert({
    user_id: user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth,
  }, { onConflict: 'endpoint' });
  return error ? { error: 'Could not register this device. If another account used it, disable its notifications first.' } : { success: true };
}

export async function unsubscribeFromPush(endpoint: string) {
  const { supabase, user } = await requireUser();
  const { error } = await supabase.from('push_subscriptions').delete().eq('user_id', user.id).eq('endpoint', endpoint);
  return error ? { error: 'Could not remove this device.' } : { success: true };
}
