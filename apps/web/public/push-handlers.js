/* global self, clients, Notification */
/**
 * Web Push + notification handlers for the ITAMLS service worker.
 *
 * Pulled in via `importScripts` by the generated workbox SW, so runs
 * inside the SAME service worker as the caching code. All other SW
 * features (precache, runtime cache, navigate fallback) keep working.
 *
 * Payload shape posted from NotifyService:
 *   { title, body, tag, icon, badge, url, sound, vibrate, requireInteraction }
 */

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch { data = { title: 'ITAMLS', body: event.data?.text() ?? '' }; }

  const title = data.title || 'ITAMLS';
  const options = {
    body:     data.body ?? '',
    tag:      data.tag  ?? 'itamls',
    icon:     data.icon  ?? '/icons/icon-192.png',
    badge:    data.badge ?? '/icons/icon-192.png',
    vibrate:  data.vibrate ?? [200, 100, 200],
    // iOS 16.4+ reads these; Chrome/Edge show them in the action tray.
    requireInteraction: !!data.requireInteraction,
    renotify: true,
    data: { url: data.url ?? '/', sound: data.sound ?? 'standard' },
    silent: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url ?? '/';

  // Focus an already-open window if one exists on the same origin, else open.
  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      try {
        const u = new URL(c.url);
        if (u.origin === self.location.origin) {
          await c.focus();
          c.navigate(targetUrl).catch(() => c.postMessage({ type: 'NAVIGATE', url: targetUrl }));
          return;
        }
      } catch { /* ignore */ }
    }
    await clients.openWindow(targetUrl);
  })());
});
