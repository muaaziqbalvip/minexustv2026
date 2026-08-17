// ---- MONETAG WEB PUSH SERVICE WORKER ----
self.options = {
    "domain": "3nbf4.com",
    "zoneId": 11594300
};
self.lary = "";
try {
    importScripts('https://3nbf4.com/act/files/service-worker.min.js?r=sw');
} catch (e) {}

// ---- MINEXUS PWA LIVE-FIRST ENGINE (NO STALE CACHE) ----
const CACHE_NAME = 'minexus-live-v3';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  // Clear any existing old caches immediately so data is always 100% live
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))).then(() => self.clients.claim())
  );
});

// Always fetch LIVE data from the network — never serve stale movie/series/API data
self.addEventListener('fetch', e => {
  // Always go straight to network for live data
  e.respondWith(
    fetch(e.request).catch(() => {
      // Only fallback to cached root if completely offline
      return caches.match(e.request);
    })
  );
});


