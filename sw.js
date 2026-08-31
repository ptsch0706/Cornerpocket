// Corner Pocket Arcade — service worker
//
// IMPORTANT: bump CACHE_NAME every time you push a new version (keep it in sync
// with the "v1.5.1" shown at the bottom of every page). Changing this string is
// what tells the service worker "this is new content, throw out the old cache."
const CACHE_NAME = 'corner-pocket-arcade-v1.5.1';

const CORE_ASSETS = [
  './',
  './index.html',
  './pool.html',
  './shuffleboard.html',
  './darts.html',
  './cornhole.html',
  './shared.css',
  './shared.js',
  './Cornerpocket.PNG'
];

// Install: pre-cache the core files, then immediately take over from any
// previously-waiting service worker instead of waiting for all tabs to close.
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .catch(() => {}) // don't fail install if e.g. offline on first load
  );
});

// Activate: delete any caches from older versions, and take control of any
// already-open pages right away (so the "controllerchange" reload fires).
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch: network-first. Always try to get the freshest copy when online (so a
// newly-pushed version shows up immediately), falling back to the cached copy
// only if the network request fails (offline).
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const responseCopy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseCopy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
