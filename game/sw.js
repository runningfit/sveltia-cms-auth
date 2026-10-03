/**
 * Service worker for Rockfall.
 *
 * Caches the whole game on first visit so it starts and plays with no connection, which is also
 * what lets phones install it to the home screen. Requests are answered from the cache straight
 * away while a fresh copy is fetched in the background, so a new release shows up on the next
 * launch without anyone having to bump a version number.
 */
const sw = globalThis;
const CACHE = 'rockfall-v1';

/** Everything the game needs to boot offline. A missing file here fails the whole install. */
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/art.js',
  'js/audio.js',
  'js/levels.js',
  'js/engine.js',
  'js/input.js',
  'js/game.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

sw.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => sw.skipWaiting()),
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => sw.clients.claim()),
  );
});

sw.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET' || new URL(request.url).origin !== sw.location.origin) {
    return;
  }

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: true });

      const fresh = fetch(request)
        .then((response) => {
          if (response.ok) {
            cache.put(request, response.clone());
          }

          return response;
        })
        .catch(async () => {
          if (cached) {
            return cached;
          }

          // Offline with nothing cached for this exact URL: a page load still gets the game.
          return request.mode === 'navigate'
            ? (await cache.match('index.html')) || Response.error()
            : Response.error();
        });

      if (cached) {
        event.waitUntil(fresh);

        return cached;
      }

      return fresh;
    }),
  );
});
