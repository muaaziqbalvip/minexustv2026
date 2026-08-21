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
// The upstream base URL is passed in via ?base=..., which the frontend
// fills from Firebase app_config/music_api_base (Admin Panel → Music) — so
// switching mirrors from Admin still works with zero code changes.

export const config = { runtime: 'edge' };

const DEFAULT_BASE = 'https://saavn.dev/api';

export default async function handler(request) {
  const url = new URL(request.url);
  const query = url.searchParams.get('query') || '';
  const limit = url.searchParams.get('limit') || '20';
  let base = url.searchParams.get('base') || DEFAULT_BASE;

  // Basic safety: only ever fetch from an https URL the admin configured,
  // never let this become an open proxy for arbitrary paths.
  try { base = new URL(base).origin + new URL(base).pathname.replace(/\/$/, ''); }
  catch (e) { base = DEFAULT_BASE; }

  if (!query.trim()) {
    return new Response(JSON.stringify({ success: false, error: 'query is required' }), {
      status: 400,
      headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const upstream = `${base}/search/songs?query=${encodeURIComponent(query)}&limit=${encodeURIComponent(limit)}`;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9000);
    const r = await fetch(upstream, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MinexusTV/1.0)' }
    });
    clearTimeout(timer);
    if (!r.ok) throw new Error('upstream HTTP ' + r.status);
    const data = await r.json();
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'cache-control': 'public, max-age=120, s-maxage=600'
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: String(e && e.message || e) }), {
      status: 502,
      headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
