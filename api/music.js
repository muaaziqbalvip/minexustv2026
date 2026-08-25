// Vercel Edge Function — server-side proxy for the Music tab's song search.
//
// PROBLEM THIS SOLVES:
// index.html was calling the public JioSaavn-style API (saavn.dev) directly
// from the BROWSER with fetch(). Most of these unofficial third-party music
// APIs are built to be called server-to-server and don't send an
// Access-Control-Allow-Origin header back — so the browser silently blocks
// the response as a CORS violation before any JS even sees it. That's why
// the Music tab showed nothing at all: every request was failing before it
// ever reached the try/catch's "couldn't load" message in a visible way
// (browsers log CORS failures to the console, not the page).
//
// FIX: the browser now calls OUR OWN domain — /api/music?query=... — this
// Edge Function fetches from the real music API server-side (no CORS rules
// apply between two servers), then returns the JSON with our own CORS
// headers attached (already wide-open via vercel.json's global headers,
// reinforced here too for safety). Same pattern as api/watch.js.
//
// MULTI-MIRROR FALLBACK (v4.1 — corrected):
// The v4 fallback chain listed two mirror URLs that were never verified and
// turned out not to exist (jiosaavn-api-2-harsh-patel.vercel.app,
// saavn-api-taupe.vercel.app) — every request tried those first, they
// failed instantly, and by the time the chain reached a real mirror the
// per-mirror or overall timeout had often already been exhausted, which is
// why the Music tab showed "temporarily down" even though saavn.dev itself
// was confirmed working (its own docs/status page and GitHub issue threads
// show it actively serving requests). This version only includes mirrors
// that were individually confirmed live: saavn.dev and its twin deployment
// jiosavan-api2.vercel.app (same open-source project, different Vercel
// deployment — sumitkolhe/jiosaavn-api). The admin-configured `base`
// (Firebase app_config/music_api_base) is always tried FIRST, so switching
// mirrors from Admin Panel → Music still works with zero code changes.
//
// Note: the REAL jiosaavn.com/api.php endpoint is NOT usable here — it
// requires a signed/internal request shape and actively rejects generic
// server-to-server calls (confirmed: returns an INPUT_INVALID XML error
// even with correct query params), so it is intentionally not in this
// chain.

export const config = { runtime: 'edge' };

const DEFAULT_BASE = 'https://saavn.dev/api';

// Built-in fallback chain, tried in this order after the admin-configured
// base. Both are the same open-source sumitkolhe/jiosaavn-api project,
// just different Vercel deployments — if one is rate-limited or briefly
// down, the other is very likely still up since they're independent
// deployments of identical code hitting JioSaavn's backend separately.
const FALLBACK_MIRRORS = [
  'https://saavn.dev/api',
  'https://jiosavan-api2.vercel.app/api'
];

function normalizeUrl(u) {
  try { return new URL(u).origin + new URL(u).pathname.replace(/\/$/, ''); }
  catch (e) { return null; }
}

// Pulls the actual song list out of whichever shape a given mirror/endpoint
// returns, so the caller doesn't need to know which one answered:
//   - saavn.dev / jiosavan-api2:      { data: { results: [...] } }
//   - some mirrors (paginated):       { data: { songs: [...] } }
//   - JioSaavn's own autocomplete.get shape (id=...&__call=autocomplete.get),
//     which Muaaz confirmed IS reachable from his own network — kept here
//     in case a future admin-configured `base` points at a proxy that
//     forwards that shape: { songs: { data: [...] } }
function extractResults(data) {
  if (!data) return null;
  if (data?.data?.results) return data.data.results;
  if (data?.data?.songs && Array.isArray(data.data.songs)) return data.data.songs;
  if (Array.isArray(data?.data)) return data.data;
  if (data?.songs?.data && Array.isArray(data.songs.data)) return data.songs.data;
  if (data?.results) return data.results;
  return null;
}

async function tryMirror(base, query, limit, timeoutMs, debugLog) {
  const upstream = `${base}/search/songs?query=${encodeURIComponent(query)}&limit=${encodeURIComponent(limit)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(upstream, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    });
    clearTimeout(timer);
    if (!r.ok) {
      debugLog.push(`${base}: HTTP ${r.status}`);
      return null;
    }
    const data = await r.json();
    const results = extractResults(data);
    if (!results || !results.length) {
      debugLog.push(`${base}: HTTP 200 but no results in response`);
      return null;
    }
    // Return in the canonical { data: { results: [...] } } shape the
    // frontend expects, regardless of which shape this mirror actually used.
    return { success: true, data: { results } };
  } catch (e) {
    clearTimeout(timer);
    debugLog.push(`${base}: ${e && e.name === 'AbortError' ? 'timeout' : (e && e.message) || 'network error'}`);
    return null;
  }
}

export default async function handler(request) {
  const url = new URL(request.url);
  const query = url.searchParams.get('query') || '';
  const limit = url.searchParams.get('limit') || '20';
  const adminBase = normalizeUrl(url.searchParams.get('base') || '');

  if (!query.trim()) {
    return new Response(JSON.stringify({ success: false, error: 'query is required' }), {
      status: 400,
      headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  // Build the ordered chain: admin's configured mirror first (if it's not
  // already the default), then the built-in fallbacks, de-duplicated.
  const chain = [];
  if (adminBase) chain.push(adminBase);
  for (const m of FALLBACK_MIRRORS) if (!chain.includes(m)) chain.push(m);

  const debugLog = [];
  for (const base of chain) {
    // 8s per mirror — generous enough for a slow cold-start response from
    // a free-tier Vercel deployment, but still leaves room to try the next
    // mirror comfortably inside the platform's overall function timeout.
    const data = await tryMirror(base, query, limit, 8000, debugLog);
    if (data) {
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'cache-control': 'public, max-age=120, s-maxage=600',
          'x-music-source': base
        }
      });
    }
  }

  // All mirrors failed — return the per-mirror failure reasons so this is
  // diagnosable from the browser Network tab or Admin Panel instead of a
  // silent "temporarily down" with no way to tell which mirror broke or why.
  return new Response(JSON.stringify({ success: false, error: 'all mirrors unreachable', details: debugLog }), {
    status: 502,
    headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
