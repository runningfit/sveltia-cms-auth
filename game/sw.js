/**
 * Service worker for Rockfall.
 *
 * Caches the whole game so it starts and plays with no connection, which is also what lets phones
 * install it to the home screen.
 *
 * Updates are all or nothing. The game's files depend on each other, so a phone must never run a
 * mix of two releases. Each release gets its own cache, named after the release, and is downloaded
 * complete (straight from the server, skipping the browser's own short-term cache) before it is
 * used. Until then the previous release keeps running untouched.
 */
const sw = globalThis;
/**
 * The release this worker serves. The deploy replaces `dev` with the commit being published, so
 * every release changes this file, which is what tells phones there is a new version to fetch.
 */
const VERSION = 'dev';
const CACHE = `rockfall-${VERSION}`;

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
      .then((cache) => cache.addAll(SHELL.map((path) => new Request(path, { cache: 'reload' }))))
      .then(() => sw.skipWaiting()),
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('rockfall-') && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
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

      if (cached) {
        return cached;
      }

      // Anything outside the release, or a page load at an unexpected address: go to the
      // network, and fall back to the game itself when offline.
      try {
        return await fetch(request);
      } catch {
        const page = request.mode === 'navigate' ? await cache.match('index.html') : null;

        return page || Response.error();
      }
    }),
  );
});
