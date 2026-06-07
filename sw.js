const CACHE_VERSION = "sales-tracker-disabled-20260607";

self.addEventListener("install", event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.map(key => caches.delete(key))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll({ type: "window", includeUncontrolled: true }))
      .then(clients => {
        clients.forEach(client => {
          if (client.url) client.navigate(client.url);
        });
      })
  );
});

self.addEventListener("fetch", event => {
  event.respondWith(fetch(event.request));
});
