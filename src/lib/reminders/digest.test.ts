import { buildDigest, digestCount, localParts, type DigestTask } from './digest';
import { preferencesSchema, subscriptionSchema } from './schemas';
const task = (id: string, due_at: string | null, member_sort_key = 0, completed_at: string | null = null): DigestTask => ({ id, title: id, due_at, member_sort_key, completed_at });

it('uses local dates even when UTC has already rolled into tomorrow', () => {
  expect(localParts(new Date('2026-09-06T02:00:00Z'), 'America/Los_Angeles')).toEqual({ date: '2026-09-05', time: '19:00' });
  expect(localParts(new Date('2026-09-05T12:00:00Z'), 'Pacific/Auckland').date).toBe('2026-09-06');
});
it('classifies without overlap, excludes completed and undated tasks, and preserves member priority', () => {
  const now = new Date('2026-09-05T15:00:00Z');
  const digest = buildDigest([
    task('overdue', '2026-09-05T14:59:00Z', 4), task('first', '2026-09-04T12:00:00Z', 1),
    task('today', now.toISOString()), task('soon', '2026-09-09T06:59:00Z'),
    task('later', '2026-09-09T07:00:00Z'), task('undated', null),
    task('complete', '2026-09-01T00:00:00Z', 0, now.toISOString()),
    task('first', '2026-09-04T12:00:00Z', 9),
  ], now, 'America/Los_Angeles', 3);
  expect(digest.overdue.map(t => t.id)).toEqual(['first', 'overdue']);
  expect(digest.today.map(t => t.id)).toEqual(['today']);
  expect(digest.soon.map(t => t.id)).toEqual(['soon']);
  expect(digestCount(digest)).toBe(4);
});
it('uses calendar days across spring-forward and fall-back', () => {
  for (const [now, end, beyond] of [
    ['2026-03-07T16:00:00Z', '2026-03-09T06:59:00Z', '2026-03-09T07:00:00Z'],
    ['2026-10-31T15:00:00Z', '2026-11-02T07:59:00Z', '2026-11-02T08:00:00Z'],
  ]) {
    expect(buildDigest([task('in', end), task('out', beyond)], new Date(now), 'America/Los_Angeles', 1).soon.map(t => t.id)).toEqual(['in']);
  }
});
it('validates preferences and blocks arbitrary push destinations', () => {
  const pref = { email_enabled: true, work_email: 'me@example.com', personal_email: '', push_enabled: false, digest_time: '08:00', timezone: 'UTC', soon_window_days: 3 };
  expect(preferencesSchema.safeParse(pref).success).toBe(true);
  // 23:50 has no scheduler tick left in its own local day, so it could never have been sent.
  for (const changes of [{ timezone: 'bogus' }, { digest_time: '24:00' }, { digest_time: '23:50' }, { digest_time: '08:07' }, { soon_window_days: 0 }, { soon_window_days: 31 }]) {
    expect(preferencesSchema.safeParse({ ...pref, ...changes }).success).toBe(false);
  }
  expect(preferencesSchema.safeParse({ ...pref, digest_time: '23:45' }).success).toBe(true);
  const keys = { p256dh: 'a'.repeat(87), auth: 'a'.repeat(22) };
  for (const endpoint of ['https://localhost/push', 'https://127.0.0.1', 'http://fcm.googleapis.com/push', 'https://fcm.googleapis.com.evil.test']) {
    expect(subscriptionSchema.safeParse({ endpoint, keys }).success).toBe(false);
  }
  expect(subscriptionSchema.safeParse({ endpoint: 'https://web.push.apple.com/token', keys }).success).toBe(true);
});
