/** @jest-environment node */
import type { SupabaseClient } from '@supabase/supabase-js';
import { runReminders } from './delivery';
import { sendEmail } from './email';
import webpush from 'web-push';

jest.mock('./email', () => ({ emailConfigured: () => true, sendEmail: jest.fn() }));
jest.mock('web-push', () => ({ __esModule: true, default: { sendNotification: jest.fn() } }));
type Row = Record<string, unknown>;

function database() {
  const prefs: Row[] = [{ user_id: 'alice', email_enabled: true, push_enabled: false, work_email: 'work@example.com', personal_email: 'home@example.com', digest_time: '08:00:00', timezone: 'America/Los_Angeles', soon_window_days: 3 }];
  const tables: Record<string, Row[]> = {
    notification_prefs: prefs,
    workspace_members: [
      { id: 'work-member', auth_user_id: 'alice', workspaces: { kind: 'work', name: 'Anything at all' } },
      { id: 'home-member', auth_user_id: 'alice', workspaces: { kind: 'household', name: 'Office is just a name' } },
    ],
    task_assignments: [
      { member_id: 'work-member', member_sort_key: 2, tasks: { id: 'work-task', title: 'Private work task', due_at: '2026-09-04T12:00:00Z', completed_at: null } },
      { member_id: 'home-member', member_sort_key: 1, tasks: { id: 'home-task', title: 'Private home task', due_at: '2026-09-05T20:00:00Z', completed_at: null } },
      { member_id: 'someone-else', member_sort_key: 0, tasks: { id: 'secret-task', title: 'Someone else secret', due_at: '2026-09-04T12:00:00Z', completed_at: null } },
    ], notification_log: [], push_subscriptions: [],
  };
  // A small query fake with actual filtering; embedded tasks are already joined fixtures.
  function from(table: string) {
    let rows = tables[table];
    let patch: Row | undefined;
    let remove = false;
    const value = (row: Row, key: string): unknown => key.split('.').reduce<unknown>((v, part) => (v as Row)?.[part], row);
    const chain = {
      select: () => chain,
      eq: (key: string, expected: unknown) => { rows = rows.filter(r => value(r, key) === expected); return chain; },
      in: (key: string, expected: unknown[]) => { rows = rows.filter(r => expected.includes(value(r, key))); return chain; },
      is: (key: string, expected: unknown) => { rows = rows.filter(r => value(r, key) === expected); return chain; },
      not: (key: string, _op: string, expected: unknown) => { rows = rows.filter(r => value(r, key) !== expected); return chain; },
      or: () => { rows = rows.filter(r => r.email_enabled || r.push_enabled); return chain; },
      order: () => chain,
      limit: () => chain,
      update: (data: Row) => { patch = data; return chain; },
      delete: () => { remove = true; return chain; },
      then: (resolve: (result: { data: Row[]; error: null }) => unknown) => {
        if (patch) rows.forEach(row => Object.assign(row, patch));
        if (remove) tables[table] = tables[table].filter(row => !rows.includes(row));
        return Promise.resolve(resolve({ data: rows, error: null }));
      },
    };
    return chain;
  }
  const rpc = jest.fn(async (_name: string, args: Row) => {
    const existing = tables.notification_log.find(row => row.user_id === args.p_user_id && row.period_key === args.p_period_key && row.channel === args.p_channel);
    if (existing) return { data: [], error: null };
    const row = { id: `claim-${tables.notification_log.length}`, user_id: args.p_user_id, period_key: args.p_period_key, channel: args.p_channel, payload: args.p_payload, claim_token: args.p_token, delivered_endpoints: [] };
    tables.notification_log.push(row);
    return { data: [row], error: null };
  });
  return { admin: { from, rpc } as unknown as SupabaseClient, tables, rpc, prefs };
}
const now = new Date('2026-09-05T15:00:00Z');
beforeEach(() => {
  jest.clearAllMocks();
  process.env.GMAIL_USER = 'sender@gmail.com'; process.env.REMINDER_APP_URL = 'https://hearth.vercel.app';
  process.env.VAPID_SUBJECT = 'mailto:sender@gmail.com'; process.env.VAPID_PRIVATE_KEY = 'private'; process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'public';
  jest.mocked(sendEmail).mockResolvedValue(undefined);
  jest.mocked(webpush.sendNotification).mockResolvedValue({ statusCode: 201, body: '', headers: {} });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

it('routes by workspace kind, excluding unassigned tasks and keeping addresses isolated', async () => {
  const db = database();
  expect(await runReminders(db.admin, now)).toEqual({ sent: 2, failed: 0, skipped: 0 });
  const emails = jest.mocked(sendEmail).mock.calls.map(([payload]) => payload);
  expect(emails[0].to).toEqual(['work@example.com']);
  expect(emails[0].text).toContain('Private work task');
  expect(emails[0].text).not.toContain('Private home task');
  expect(emails[1].to).toEqual(['home@example.com']);
  expect(emails[1].text).toContain('Private home task');
  expect(emails[1].text).not.toContain('Private work task');
  expect(JSON.stringify(emails)).not.toContain('Someone else secret');
});
it('sends an html part whose task list matches the text part', async () => {
  const db = database();
  await runReminders(db.admin, now);
  const [work] = jest.mocked(sendEmail).mock.calls.map(([payload]) => payload);
  expect(work.html).toContain('<table');
  expect(work.html).toContain('Private work task');
  expect(work.html).not.toContain('Private home task');
  // The frozen claim must carry both parts, or a retry would send a degraded message.
  expect(db.tables.notification_log[0].payload).toMatchObject({ text: work.text, html: work.html });
});
it('does not send twice on concurrent cron ticks', async () => {
  const db = database();
  await Promise.all([runReminders(db.admin, now), runReminders(db.admin, now)]);
  expect(sendEmail).toHaveBeenCalledTimes(2);
});
it('skips future send times, disabled preferences and empty digests without creating claims', async () => {
  for (const mode of ['future', 'disabled', 'empty']) {
    const db = database();
    if (mode === 'future') db.prefs[0].digest_time = '09:00';
    if (mode === 'disabled') db.prefs[0].email_enabled = false;
    if (mode === 'empty') db.tables.task_assignments = [];
    await runReminders(db.admin, now);
    expect(db.rpc).not.toHaveBeenCalled();
  }
  expect(sendEmail).not.toHaveBeenCalled();
});
it('does not reroute work tasks when the work address is blank', async () => {
  const db = database(); db.prefs[0].work_email = '';
  await runReminders(db.admin, now);
  expect(sendEmail).toHaveBeenCalledTimes(1);
  expect(jest.mocked(sendEmail).mock.calls[0][0].text).not.toContain('Private work task');
});
it('keeps successful personal delivery independent of a failed work email', async () => {
  const db = database();
  jest.mocked(sendEmail).mockRejectedValueOnce(Object.assign(new Error('rejected'), { responseCode: 450 }));
  expect(await runReminders(db.admin, now)).toMatchObject({ sent: 1, failed: 1 });
  expect(db.tables.notification_log[0].attempted_at).toBeNull();
  expect(db.tables.notification_log[0].sent_at).toBeUndefined();
  expect(db.tables.notification_log[1].sent_at).toBe(now.toISOString());
});
it('does not release a permanent SMTP rejection for retry', async () => {
  const db = database();
  jest.mocked(sendEmail).mockRejectedValueOnce(Object.assign(new Error('no such user'), { responseCode: 550 }));
  expect(await runReminders(db.admin, now)).toMatchObject({ sent: 1, failed: 1 });
  expect(db.tables.notification_log[0].attempted_at).toBe(now.toISOString());
});
it('sends tasks from an unrecognised workspace kind to the personal address', async () => {
  const db = database();
  db.tables.workspace_members.push({ id: 'other-member', auth_user_id: 'alice', workspaces: { kind: 'volunteering' } });
  db.tables.task_assignments.push({ member_id: 'other-member', member_sort_key: 3, tasks: { id: 'other-task', title: 'Unrouted task', due_at: '2026-09-04T12:00:00Z', completed_at: null } });
  await runReminders(db.admin, now);
  const emails = jest.mocked(sendEmail).mock.calls.map(([payload]) => payload);
  expect(emails[0].text).not.toContain('Unrouted task');
  expect(emails[1].text).toContain('Unrouted task');
});
it('leaves ambiguous SMTP attempts claimed to avoid duplicate email', async () => {
  const db = database();
  jest.mocked(sendEmail).mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));
  await runReminders(db.admin, now);
  expect(db.tables.notification_log[0].attempted_at).toBe(now.toISOString());
  expect(db.tables.notification_log[0].sent_at).toBeUndefined();
});
it('removes expired push subscriptions and records successful device delivery', async () => {
  const db = database(); db.prefs[0].push_enabled = true; db.prefs[0].email_enabled = false;
  db.tables.push_subscriptions = ['expired', 'live'].map(id => ({ id, user_id: 'alice', endpoint: `https://web.push.apple.com/${id}`, p256dh: 'a'.repeat(87), auth: 'a'.repeat(22) }));
  jest.mocked(webpush.sendNotification).mockRejectedValueOnce({ statusCode: 410 });
  expect(await runReminders(db.admin, now)).toMatchObject({ sent: 1, failed: 0 });
  expect(db.tables.push_subscriptions.map(row => row.id)).toEqual(['live']);
  expect(db.tables.notification_log[0].delivered_endpoints).toEqual(['https://web.push.apple.com/live']);
});
