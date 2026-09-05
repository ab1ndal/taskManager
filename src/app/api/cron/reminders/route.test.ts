/** @jest-environment node */
import { POST } from './route';
import { runReminders } from '@/lib/reminders/delivery';
import { createAdminClient } from '@/lib/supabase/admin';
jest.mock('@/lib/reminders/delivery', () => ({ runReminders: jest.fn() }));
jest.mock('@/lib/supabase/admin', () => ({ createAdminClient: jest.fn(() => ({})) }));
beforeEach(() => { jest.clearAllMocks(); process.env.CRON_SECRET = 'secret'; });
afterAll(() => { delete process.env.CRON_SECRET; });
it.each([undefined, '', 'wrong', 'secrex'])('rejects invalid credentials before admin access (%s)', async secret => {
  const response = await POST(new Request('https://example.com/api/cron/reminders', { method: 'POST', headers: secret ? { 'x-cron-secret': secret } : {} }));
  expect(response.status).toBe(401);
  expect(createAdminClient).not.toHaveBeenCalled();
});
it('fails closed without configuration', async () => {
  delete process.env.CRON_SECRET;
  expect((await POST(new Request('https://example.com', { method: 'POST', headers: { 'x-cron-secret': 'secret' } }))).status).toBe(401);
});
it('runs an authorized tick and returns its delivery counts', async () => {
  jest.mocked(runReminders).mockResolvedValue({ sent: 2, skipped: 0, failed: 0 });
  const response = await POST(new Request('https://example.com', { method: 'POST', headers: { 'x-cron-secret': 'secret' } }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ sent: 2, skipped: 0, failed: 0 });
});
it('returns a retryable error without exposing backend details', async () => {
  jest.mocked(runReminders).mockRejectedValue(new Error('private database detail'));
  const response = await POST(new Request('https://example.com', { method: 'POST', headers: { 'x-cron-secret': 'secret' } }));
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain('private');
});
