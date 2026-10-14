// Self-retiring service worker.
//
// Older LiOS builds cached the application shell. When a later deployment
// replaced Vite's content-hashed JS files, an old cached index.html could
// continue pointing at files that no longer existed, producing a completely
// blank page. The hosted Terminal no longer needs a service worker, so this
// worker exists only to clean up browsers that still have an older one.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith('limuria-')).map((key) => caches.delete(key)));
    await self.registration.unregister();

    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      try {
        await client.navigate(client.url);
      } catch {
        // A tab may disappear while cleanup is running; that is harmless.
      }
    }
  })());
});

self.addEventListener('fetch', () => {
  // Do not intercept requests while this worker retires. All traffic goes
  // directly to the network so the current deployment's HTML and hashed
  // assets are used immediately.
});
