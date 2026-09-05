import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotificationsTab } from './notifications-tab';
import { getNotificationSettings, saveNotificationSettings } from './notification-actions';
jest.mock('./notification-actions', () => ({ getNotificationSettings: jest.fn(), saveNotificationSettings: jest.fn(), subscribeToPush: jest.fn(), unsubscribeFromPush: jest.fn() }));
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getNotificationSettings).mockResolvedValue({ preferences: {
    email_enabled: false, work_email: 'work@example.com', personal_email: 'home@example.com',
    push_enabled: false, digest_time: '08:00:00', timezone: 'America/Los_Angeles', soon_window_days: 3,
  }, publicKey: '', emailAvailable: true, endpoints: [] });
  jest.mocked(saveNotificationSettings).mockResolvedValue({ success: true });
});
it('loads separate destinations and saves recipient and schedule changes', async () => {
  const user = userEvent.setup(); render(<NotificationsTab />);
  const work = await screen.findByRole('textbox', { name: 'Work email' });
  expect(work).toHaveValue('work@example.com');
  expect(screen.getByRole('textbox', { name: 'Personal email' })).toHaveValue('home@example.com');
  await user.clear(work); await user.type(work, 'new@example.com');
  await user.click(screen.getByRole('checkbox', { name: 'Daily email reminders' }));
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(saveNotificationSettings).toHaveBeenCalledWith(expect.objectContaining({ email_enabled: true, work_email: 'new@example.com', personal_email: 'home@example.com', digest_time: '08:00' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Notification settings saved.');
});
it('explains unsupported push and leaves email usable', async () => {
  render(<NotificationsTab />);
  await screen.findByRole('textbox', { name: 'Work email' });
  expect(screen.getByRole('button', { name: 'Enable on this device' })).toBeDisabled();
  expect(screen.getByText(/add Hearth to your Home Screen/)).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'Daily email reminders' })).toBeEnabled();
});
it('shows save errors without losing edited values', async () => {
  jest.mocked(saveNotificationSettings).mockResolvedValue({ error: 'Check your recipient emails.' });
  const user = userEvent.setup(); render(<NotificationsTab />);
  await screen.findByRole('textbox', { name: 'Work email' });
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Check your recipient emails.');
  expect(screen.getByRole('textbox', { name: 'Work email' })).toHaveValue('work@example.com');
});
it('does not offer saving defaults when loading settings fails', async () => {
  jest.mocked(getNotificationSettings).mockRejectedValue(new Error('unavailable'));
  render(<NotificationsTab />);
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Could not load'));
  expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
});
