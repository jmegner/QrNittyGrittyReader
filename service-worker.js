const CACHE_NAME = 'qr-nitty-gritty-reader-v1';
const CORE_ASSETS = [
  './',
  './index.html',
  './app.js',
  './jsQR.js',
  './jsQRNittyGritty.js',
  './zxing_v0-21-3.js',
  './renderjson_v1-4-0.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // Offline-first for navigations so the app shell opens when installed.
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then(
        (cachedResponse) =>
          cachedResponse ||
          fetch(request).then((networkResponse) => {
            cacheResponse(request, networkResponse);
            return networkResponse;
          }).catch(() => caches.match('./index.html'))
      )
    );
    return;
  }

  // Cache-first for same-origin assets, network fallback otherwise.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then(
        (cachedResponse) =>
          cachedResponse ||
          fetch(request).then((networkResponse) => {
            cacheResponse(request, networkResponse);
            return networkResponse;
          })
      )
    );
  }
});

function cacheResponse(request, response) {
  if (!response || response.status !== 200 || response.type !== 'basic') {
    return;
  }
  const responseToCache = response.clone();
  caches.open(CACHE_NAME).then((cache) => cache.put(request, responseToCache));
}
