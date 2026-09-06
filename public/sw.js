/* Push only: do not cache authenticated task responses on shared devices. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { /* Always show a visible notification. */ }
  // Declarative Web Push nests the fields under `notification`; iOS 18.4+ renders that shape
  // without running this worker at all, and reaching it here means we are the override path on an
  // older system. Fall back to the flat shape so a payload queued before this deploy still shows.
  const notification = data.notification || data;
  event.waitUntil(Promise.all([
    self.registration.showNotification(notification.title || 'Hearth reminders', {
      body: notification.body || 'Open Hearth to see your tasks.',
      tag: notification.tag || 'hearth-reminders',
      icon: '/icons/icon-192.png',
      data: { url: '/tasks' },
    }),
    // WorkerNavigator exposes the Badging API to service workers on iOS 16.4+, which is what
    // covers the systems that do not understand the declarative payload's `app_badge`. A badge
    // never satisfies the user-visible requirement on its own, so it runs alongside the
    // notification rather than instead of it.
    (async () => {
      const badge = notification.app_badge;
      if (typeof badge !== 'number' || !self.navigator.setAppBadge) return;
      try { await self.navigator.setAppBadge(badge); } catch { /* Badging is best effort. */ }
    })(),
  ]));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.navigate('/tasks');
        return client.focus();
      }
    }
    return self.clients.openWindow('/tasks');
  })());
});
