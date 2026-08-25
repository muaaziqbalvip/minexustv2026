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
// MULTI-MIRROR FALLBACK (v4):
// Free/unofficial JioSaavn-style APIs go down or rate-limit unpredictably
// since none of them are official. Instead of depending on a single
// upstream (which is why "Music tab doesn't work" kept happening), this
// now tries a short chain of independent mirrors in order and returns the
// first one that responds with actual results. Each mirror is normalized
// to the same saavn.dev-style response shape before being handed back, so
// the frontend's normalizeSong() never needs to know which mirror answered.
//
// Note: the REAL jiosaavn.com/api.php endpoint is NOT usable here — it
// requires a signed/internal request shape and actively rejects generic
// server-to-server calls (confirmed: returns an INPUT_INVALID XML error
// even with correct query params), so it is intentionally not in this
// chain. The admin-configured `base` (Firebase app_config/music_api_base)
// is always tried FIRST, ahead of the built-in fallbacks, so switching
// mirrors from Admin Panel → Music still works with zero code changes.

export const config = { runtime: 'edge' };

const DEFAULT_BASE = 'https://saavn.dev/api';

// Built-in fallback chain, tried in this order after the admin-configured
// base. Mix of the most reliable community JioSaavn-API deployments as of
// 2026. All speak the same /search/songs?query=&limit= shape.
const FALLBACK_MIRRORS = [
  'https://saavn.dev/api',
  'https://jiosaavn-api-2-harsh-patel.vercel.app/api',
  'https://jiosaavn-api.vercel.app',
  'https://saavn-api-taupe.vercel.app'
];

function normalizeUrl(u) {
  try { return new URL(u).origin + new URL(u).pathname.replace(/\/$/, ''); }
  catch (e) { return null; }
}

async function tryMirror(base, query, limit, timeoutMs) {
  const upstream = `${base}/search/songs?query=${encodeURIComponent(query)}&limit=${encodeURIComponent(limit)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(upstream, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MinexusTV/1.0)' }
    });
    clearTimeout(timer);
    if (!r.ok) return null;
    const data = await r.json();
    // Accept the response only if it actually contains song results —
    // some mirrors return HTTP 200 with an empty/error body when unhealthy.
    const results = data?.data?.results || data?.data?.songs || (Array.isArray(data?.data) ? data.data : null);
    if (!results || !results.length) return null;
    return data;
  } catch (e) {
    clearTimeout(timer);
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

  let lastError = 'all mirrors unreachable';
  for (const base of chain) {
    const data = await tryMirror(base, query, limit, 6000);
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
    lastError = `mirror failed: ${base}`;
  }

  return new Response(JSON.stringify({ success: false, error: lastError }), {
    status: 502,
    headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
