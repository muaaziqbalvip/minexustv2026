// Vercel Edge Function — proxies JioSaavn CDN audio (aac.saavncdn.com) and
// image (c.saavncdn.com) URLs through our own domain.
//
// WHY THIS EXISTS:
// Songs were appearing in search results (confirming the API itself works
// fine) but silently failing to play, and album art was silently failing
// to load, with no visible error anywhere — because the <audio>/<img> tags
// were pointing straight at the JioSaavn CDN's own domains. CDNs like this
// one are known to intermittently rate-limit, geo-block, or apply referer/
// hotlink checks against direct third-party embedding depending on which
// edge node answers a given request — behavior that's invisible from a
// server-side API test (which is why testing the search API alone looked
// completely fine) but blocks the actual <audio>/<img> element from ever
// loading in the browser, with browsers reporting this as a silent
// network failure rather than a descriptive error.
//
// FIX: route audio/image loads through OUR domain instead. This Edge
// Function fetches the real file server-to-server (Vercel's IP, not the
// visitor's browser, so no referer/CORS/hotlink check on the CDN's side
// ever comes into play) and streams it straight back with our own
// permissive headers. From the browser's point of view, it's just loading
// media from minexustv.vercel.app — completely bypassing whatever the
// upstream CDN's edge policy happens to be for that request.

export const config = { runtime: 'edge' };

// Only ever allowed to fetch from these JioSaavn CDN hosts — this must
// NEVER become a general-purpose open proxy for arbitrary URLs.
const ALLOWED_HOSTS = [
  'aac.saavncdn.com',
  'c.saavncdn.com',
  'saavncdn.com'
];

function isAllowed(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return ALLOWED_HOSTS.some(h => u.hostname === h || u.hostname.endsWith('.' + h));
  } catch (e) {
    return false;
  }
}

export default async function handler(request) {
  const url = new URL(request.url);
  const target = url.searchParams.get('url') || '';

  if (!target || !isAllowed(target)) {
    return new Response(JSON.stringify({ success: false, error: 'invalid or disallowed url' }), {
      status: 400,
      headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  try {
    // Forward the Range header so seeking/scrubbing in the audio player
    // still works efficiently instead of always re-downloading from byte 0.
    const range = request.headers.get('range');
    const upstreamHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    };
    if (range) upstreamHeaders['Range'] = range;

    const upstream = await fetch(target, { headers: upstreamHeaders });

    if (!upstream.ok && upstream.status !== 206) {
      return new Response(JSON.stringify({ success: false, error: `upstream HTTP ${upstream.status}` }), {
        status: 502,
        headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const headers = new Headers();
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Cache-Control', 'public, max-age=86400, immutable'); // song/image files never change once published
    const passthrough = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
    passthrough.forEach(h => { const v = upstream.headers.get(h); if (v) headers.set(h, v); });
    if (!headers.get('accept-ranges')) headers.set('Accept-Ranges', 'bytes');

    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: String(e && e.message || e) }), {
      status: 502,
      headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
