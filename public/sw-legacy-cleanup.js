/* Delete the pre-migration cache.

   The hand-written sw.js used a cache named 'captainrun-v1'. Workbox's own
   cleanupOutdatedCaches only removes caches Workbox created, so without this
   the old one survives forever on every phone that ever installed the game -
   holding a full copy of the old build plus three.js from a CDN.

   Runs on activate, from inside the worker. It cannot be done from the page:
   by the time the page runs, the old worker may already have served it. */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k === 'captainrun-v1').map((k) => caches.delete(k)))
    )
  );
});
