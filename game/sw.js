/**
 * Retires the offline copy of Rockfall that phones installed from this address. The game now lives
 * at its own address as Diamond Grab. A browser that still runs the old service worker fetches
 * this one as an update; it then deletes the old caches, unregisters itself and reloads any open
 * page, which loads the forwarding page from the network.
 */
const sw = globalThis;

sw.addEventListener('install', () => {
  sw.skipWaiting();
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();

      await Promise.all(
        keys.filter((key) => key.startsWith('rockfall-')).map((key) => caches.delete(key)),
      );
      await sw.registration.unregister();

      const pages = await sw.clients.matchAll({ type: 'window' });

      pages.forEach((page) => page.navigate(page.url));
    })(),
  );
});
