/** @jest-environment node */
import { requireUser } from '@/lib/auth';
import { emailConfigured } from '@/lib/reminders/email';
import { getNotificationSettings, saveNotificationSettings, subscribeToPush, unsubscribeFromPush } from './notification-actions';

jest.mock('@/lib/auth', () => ({ requireUser: jest.fn() }));
jest.mock('@/lib/reminders/email', () => ({ emailConfigured: jest.fn(() => true) }));
const prefs = { email_enabled: true, push_enabled: false, work_email: 'work@example.com', personal_email: 'home@example.com', digest_time: '08:00', timezone: 'America/Los_Angeles', soon_window_days: 3 };
const query = {
  select: jest.fn(), eq: jest.fn(), limit: jest.fn(), maybeSingle: jest.fn(), upsert: jest.fn(), delete: jest.fn(),
};
const from = jest.fn(() => query);
beforeEach(() => {
  jest.clearAllMocks();
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.delete.mockReturnValue(query);
  query.limit.mockResolvedValue({ data: [{ id: 'device' }], error: null });
  query.upsert.mockResolvedValue({ error: null });
  jest.mocked(emailConfigured).mockReturnValue(true);
  jest.mocked(requireUser).mockResolvedValue({ user: { id: 'current-user' }, supabase: { from } } as unknown as Awaited<ReturnType<typeof requireUser>>);
});
it('requires authentication before any preferences mutation', async () => {
  jest.mocked(requireUser).mockRejectedValue(new Error('Unauthorized'));
  await expect(saveNotificationSettings(prefs)).rejects.toThrow('Unauthorized');
  expect(from).not.toHaveBeenCalled();
});
it('always writes the authenticated user ID, ignoring injected ownership', async () => {
  expect(await saveNotificationSettings({ ...prefs, user_id: 'victim' })).toEqual({ success: true });
  expect(query.upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'current-user', work_email: 'work@example.com', personal_email: 'home@example.com' }));
});
it('rejects invalid recipients and email opt-in without an address', async () => {
  for (const patch of [{ work_email: 'not an address' }, { work_email: '', personal_email: '' }]) {
    expect(await saveNotificationSettings({ ...prefs, ...patch })).toHaveProperty('error');
  }
  expect(query.upsert).not.toHaveBeenCalled();
});
it('refuses push opt-in without a registered device', async () => {
  query.limit.mockResolvedValue({ data: [], error: null });
  expect(await saveNotificationSettings({ ...prefs, push_enabled: true })).toHaveProperty('error');
  expect(query.eq).toHaveBeenCalledWith('user_id', 'current-user');
  expect(query.upsert).not.toHaveBeenCalled();
});
it('permits saving destinations before Gmail is configured but does not allow email opt-in', async () => {
  jest.mocked(emailConfigured).mockReturnValue(false);
  expect(await saveNotificationSettings(prefs)).toHaveProperty('error');
  expect(await saveNotificationSettings({ ...prefs, email_enabled: false })).toEqual({ success: true });
});
it('rejects arbitrary subscription destinations before writing', async () => {
  expect(await subscribeToPush({ endpoint: 'https://localhost/private', keys: { p256dh: 'a'.repeat(87), auth: 'a'.repeat(22) } })).toHaveProperty('error');
  expect(query.upsert).not.toHaveBeenCalled();
});
it('scopes device removal to the authenticated user and selected endpoint', async () => {
  await unsubscribeFromPush('https://web.push.apple.com/device');
  expect(from).toHaveBeenCalledWith('push_subscriptions');
  expect(query.eq).toHaveBeenCalledWith('user_id', 'current-user');
  expect(query.eq).toHaveBeenCalledWith('endpoint', 'https://web.push.apple.com/device');
});
it('surfaces load failures instead of substituting default preferences', async () => {
  query.maybeSingle.mockResolvedValue({ data: null, error: { message: 'unavailable' } });
  await expect(getNotificationSettings()).rejects.toThrow('Could not load notification settings.');
});
