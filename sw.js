/* MINEXUS TV — Service Worker v2 (2026 upgrade)
   Network-first for HTML/JS so desktop & Android always get the latest deployed
   version instead of a stale cached build. Static assets (icons/manifest) still
   cache for speed & offline fallback. */

const CACHE_VERSION = 'minexus-v5-' + '20260819';
const STATIC_CACHE = CACHE_VERSION + '-static';

const PRECACHE_ASSETS = [
  '/manifest.json'
];

// Hosts/paths that must NEVER be cached or intercepted (live data, auth, streams)
const BYPASS_PATTERNS = [
  'firebase', 'firebaseio', 'googleapis',
  'multiembed', 'autoembed', 'vidlink', 'vidsrc', 'smashystream', '2embed', 'kriss424',
  'cinemeta', 'strem.io',
  'themoviedb', 'image.tmdb',
  'iptv-org', 'jsdelivr', 'raw.githubusercontent', '.m3u', '.m3u8', '.ts',
  'metahub.space'
];

function shouldBypass(url) {
  return BYPASS_PATTERNS.some(p => url.includes(p));
}

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== STATIC_CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = req.url;

  // Never touch non-GET, cross-origin API/stream/auth traffic
  if (req.method !== 'GET' || shouldBypass(url)) return;

  // CRITICAL: only ever intercept same-origin requests. `req.mode ===
  // 'navigate'` is true for ANY top-level navigation, including clicking an
  // external link with target="_blank" (e.g. a WhatsApp/Instagram contact
  // link on the Developer page) — without this origin check, the service
  // worker would swallow that external navigation into its own HTML
  // network-first/cache-fallback logic below, and its catch() fallback to
  // caches.match('/index.html') would silently redirect the external link
  // back into this app instead of letting it open normally. This was the
  // "contact links go to Vercel instead of WhatsApp/etc" bug.
  let sameOrigin = true;
  try { sameOrigin = new URL(url).origin === self.location.origin; } catch (e2) { sameOrigin = false; }
  if (!sameOrigin) return;

  const isHTML = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
  const isAppShell = url.endsWith('/index.html') || url.endsWith('/') || url.includes('/admin');

  if (isHTML || isAppShell) {
    // NETWORK-FIRST: always try to fetch the latest deployed HTML.
    // Only fall back to cache if the network is truly unavailable (offline).
    e.respondWith(
      fetch(req, { cache: 'no-store' })
        .then(res => {
          const clone = res.clone();
          caches.open(STATIC_CACHE).then(cache => cache.put(req, clone));
          return res;
        })
        .catch(() => caches.match(req).then(cached => cached || caches.match('/index.html')))
    );
    return;
  }

  // Everything else (manifest, icons): cache-first with background refresh
  e.respondWith(
    caches.match(req).then(cached => {
      const networkFetch = fetch(req).then(res => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(STATIC_CACHE).then(cache => cache.put(req, clone));
        }
        return res;
      }).catch(() => cached);
      return cached || networkFetch;
    })
  );
});

// Allow the page to force-activate a new SW immediately after deploy
self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
