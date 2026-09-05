/* Push only: do not cache authenticated task responses on shared devices. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { /* Always show a visible notification. */ }
  event.waitUntil(self.registration.showNotification(data.title || 'Hearth reminders', {
    body: data.body || 'Open Hearth to see your tasks.',
    tag: data.tag || 'hearth-reminders',
    icon: '/icons/icon-192.png',
    data: { url: '/tasks' },
  }));
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
