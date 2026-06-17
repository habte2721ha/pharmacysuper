
const CACHE_NAME = 'apsms-pharma-v4';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Never cache API calls, always go to network first
  if (url.pathname.includes('/api/')) {
      return event.respondWith(
          fetch(event.request).catch(() => {
              return new Response(JSON.stringify({ error: 'Server Offline', offline: true }), {
                  headers: { 'Content-Type': 'application/json' }
              });
          })
      );
  }

  // Assets: Stale-while-revalidate (Only intercept and cache local/same-origin GET requests to avoid breaking external APIs like Firestore or Auth)
  if (event.request.method === 'GET' && url.origin === self.location.origin && !url.pathname.includes('/api/')) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        const fetchPromise = fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
          }
          return networkResponse;
        }).catch(() => {
          // Ignore network errors on offline
        });
        return cachedResponse || fetchPromise;
      })
    );
  }
});
