/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching';
import { idbGet } from './idb';
import { API_BASE } from './config';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener('push', (event) => {
  const data = event.data?.json() as
    { title?: string; body?: string; data?: { event_id?: string } } | undefined;
  event.waitUntil(
    (async () => {
      let image: string | undefined;
      try {
        const token = await idbGet('token');
        if (token && data?.data?.event_id) {
          const res = await fetch(`${API_BASE}/api/events/${data.data.event_id}/thumbnail`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) image = URL.createObjectURL(await res.blob());
        }
      } catch {
        image = undefined;
      }
      const options: NotificationOptions & { image?: string } = {
        body: data?.body,
        icon: '/icon.svg',
        badge: '/icon.svg',
        image,
        data: data?.data,
      };
      await self.registration.showNotification(data?.title ?? 'Grabadora', options);
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.event_id
    ? `/?event=${event.notification.data.event_id}`
    : '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          void client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
