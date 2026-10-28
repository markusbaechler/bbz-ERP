// bbz ERP – Service Worker (bewusst minimal).
// Navigationen: network-first, offline Rueckfall auf die zwischengespeicherte App-Shell.
// API-Aufrufe und alle anderen Anfragen werden NICHT abgefangen (keine veralteten Fachdaten aus dem Cache).
const CACHE = 'bbz-erp-shell-v1';
const SHELL = './';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add(SHELL)).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    fetch(event.request)
      .then((antwort) => {
        if (antwort.ok) {
          const kopie = antwort.clone();
          caches.open(CACHE).then((c) => c.put(SHELL, kopie)).catch(() => undefined);
        }
        return antwort;
      })
      .catch(() => caches.match(SHELL)),
  );
});
