'use client';

import { useEffect, useState } from 'react';
import { getNotificationSettings, saveNotificationSettings, subscribeToPush, unsubscribeFromPush } from './notification-actions';
import type { Preferences } from '@/lib/reminders/digest';

export function NotificationsTab() {
  const [prefs, setPrefs] = useState<Preferences>({ email_enabled: false, work_email: '', personal_email: '', push_enabled: false, digest_time: '08:00', timezone: 'UTC', soon_window_days: 3 });
  const [publicKey, setPublicKey] = useState('');
  const [emailAvailable, setEmailAvailable] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [pushSupported, setPushSupported] = useState(false);
  const [deviceEnabled, setDeviceEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    setPushSupported(supported);
    getNotificationSettings().then(async settings => {
      if (cancelled) return;
      setPrefs(settings.preferences ? { ...settings.preferences, digest_time: settings.preferences.digest_time.slice(0, 5) } : {
        email_enabled: false, work_email: '', personal_email: '', push_enabled: false, digest_time: '08:00', soon_window_days: 3,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      setPublicKey(settings.publicKey);
      setEmailAvailable(settings.emailAvailable);
      setLoaded(true);
      if (supported) {
        const registration = await navigator.serviceWorker.getRegistration('/');
        const subscription = await registration?.pushManager.getSubscription();
        if (!cancelled) setDeviceEnabled(Boolean(subscription && settings.endpoints.includes(subscription.endpoint)));
      }
    }).catch(() => { if (!cancelled) setMessage('Could not load notification settings. Reload to try again.'); });
    return () => { cancelled = true; };
  }, []);

  async function toggleDevice() {
    setBusy(true); setMessage('');
    try {
      if (deviceEnabled) {
        const registration = await navigator.serviceWorker.getRegistration('/');
        const subscription = await registration?.pushManager.getSubscription();
        if (subscription) {
          const result = await unsubscribeFromPush(subscription.endpoint);
          if (result.error) throw new Error(result.error);
          await subscription.unsubscribe();
        }
        setDeviceEnabled(false);
        setMessage('Notifications removed from this device.');
      } else {
        // Permission must be requested directly from a user gesture, especially on iOS.
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') throw new Error('Notifications are blocked. Allow them in your browser or device settings.');
        await navigator.serviceWorker.register('/sw.js');
        const registration = await navigator.serviceWorker.ready;
        const bytes = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
        const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
        const result = await subscribeToPush(subscription.toJSON());
        if (result.error) throw new Error(result.error);
        setDeviceEnabled(true);
        setPrefs(p => ({ ...p, push_enabled: true }));
        setMessage('Device connected. Save changes to enable daily reminders.');
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not update this device.'); }
    finally { setBusy(false); }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const result = await saveNotificationSettings(prefs);
      setMessage(result.error ?? 'Notification settings saved.');
    } catch { setMessage('Could not save notification settings. Try again.'); }
    finally { setBusy(false); }
  }

  const fieldClass = 'min-h-11 rounded-sm border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm';
  return (
    <section className="max-w-md" aria-labelledby="notifications-heading">
      <h2 id="notifications-heading" className="mb-3 text-xl font-semibold tracking-tight">Notifications</h2>
      <p className="mb-6 text-sm text-[var(--color-text-secondary)]">Daily digests of your overdue, due today, and upcoming tasks. Work and personal tasks go to their own email addresses. No message when there’s nothing due.</p>
      {message && <p role="status" className="mb-4 text-sm">{message}</p>}
      {!loaded ? <p aria-busy="true">Loading notification settings…</p> : (
        <form onSubmit={save} className="flex flex-col gap-5">
          <fieldset disabled={busy} className="flex flex-col gap-5 disabled:opacity-60">
            <legend className="sr-only">Daily reminder preferences</legend>
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input type="checkbox" checked={prefs.email_enabled} disabled={!emailAvailable && !prefs.email_enabled} onChange={e => setPrefs({ ...prefs, email_enabled: e.target.checked })} />
              Daily email reminders
            </label>
            <label className="flex flex-col gap-2 text-sm">Work email
              <input type="email" maxLength={254} value={prefs.work_email} onChange={e => setPrefs({ ...prefs, work_email: e.target.value.trim() })} className={fieldClass} autoComplete="email" />
            </label>
            <label className="flex flex-col gap-2 text-sm">Personal email
              <input type="email" maxLength={254} value={prefs.personal_email} onChange={e => setPrefs({ ...prefs, personal_email: e.target.value.trim() })} className={fieldClass} autoComplete="email" />
            </label>
            <p className="text-xs text-[var(--color-text-secondary)]">Routing uses workspace type, regardless of its name. Household workspaces use your personal email. Leave an address blank to skip that type’s emails.</p>
            {!emailAvailable && <p className="text-sm text-[var(--color-text-secondary)]">Email reminders will be available once the sender is configured.</p>}
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input type="checkbox" checked={prefs.push_enabled} onChange={e => setPrefs({ ...prefs, push_enabled: e.target.checked })} disabled={!deviceEnabled && !prefs.push_enabled} />
              Daily push reminders on connected devices
            </label>
            <button type="button" disabled={!pushSupported || !publicKey} onClick={toggleDevice} className={`${fieldClass} w-fit disabled:opacity-50`}>
              {deviceEnabled ? 'Disable on this device' : 'Enable on this device'}
            </button>
            {!pushSupported && <p className="text-sm text-[var(--color-text-secondary)]">On iPhone, add Hearth to your Home Screen from Safari’s share menu, then open it there to enable notifications.</p>}
            {pushSupported && !publicKey && <p className="text-sm text-[var(--color-text-secondary)]">Push notifications will be available once delivery is configured.</p>}
            <label className="flex flex-col gap-2 text-sm">Daily reminder time
              <input type="time" required step={900} value={prefs.digest_time} onChange={e => setPrefs({ ...prefs, digest_time: e.target.value })} className={fieldClass} />
            </label>
            <p className="-mt-3 text-xs text-[var(--color-text-secondary)]">Choose a quarter-hour time. Sent within about 15 minutes of it.</p>
            <label className="flex flex-col gap-2 text-sm">Timezone
              <input required list="reminder-timezones" value={prefs.timezone} onChange={e => setPrefs({ ...prefs, timezone: e.target.value })} className={fieldClass} />
              <datalist id="reminder-timezones">{['UTC', ...Intl.supportedValuesOf('timeZone')].map(zone => <option key={zone} value={zone} />)}</datalist>
            </label>
            <label className="flex flex-col gap-2 text-sm">Include tasks due in the next (days)
              <input type="number" min={1} max={30} required value={prefs.soon_window_days} onChange={e => setPrefs({ ...prefs, soon_window_days: Number(e.target.value) })} className={fieldClass} />
            </label>
            <button type="submit" className="min-h-11 w-fit rounded-sm bg-[var(--color-accent)] px-5 py-2 text-sm font-medium text-[var(--color-text-on-accent)]">{busy ? 'Saving…' : 'Save changes'}</button>
          </fieldset>
        </form>
      )}
    </section>
  );
}
