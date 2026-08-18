// Vercel Edge Function — dynamic per-movie share previews.
//
// PROBLEM THIS SOLVES:
// index.html updates its <meta property="og:*"> tags with JavaScript after
// the page loads (see updateShareMeta() in the app). That works fine for a
// real browser, but WhatsApp/Telegram/Facebook/X link-preview crawlers do
// NOT execute JavaScript — they fetch the raw HTML once and read whatever
// og:image/og:title is already in <head>. Since that static tag always
// pointed at one hardcoded poster (Inception, tt1375666), every shared
// link showed the same wrong poster no matter which movie was actually
// shared.
//
// FIX: this route intercepts requests to /watch/:id, fetches that title's
// real poster/title/synopsis from Cinemeta (server-side, no JS needed),
// and returns a tiny HTML shell with the CORRECT og:image/og:title already
// baked in — so crawlers see the right movie. It then immediately redirects
// real visitors (via a 0-second meta-refresh + JS redirect) into the actual
// app at /?watch=ID&type=TYPE, so the experience is identical to before for
// humans, only crawlers see this intermediate page.
//
// vercel.json routes /watch/:id here — see the "rewrites" entry added there.

export const config = { runtime: 'edge' };

const CBASE = 'https://v3-cinemeta.strem.io';
const IMGB = 'https://images.metahub.space';
const SITE = 'https://minexustv.vercel.app';

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function fetchMeta(type, id) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const r = await fetch(`${CBASE}/meta/${type}/${id}.json`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!r.ok) return null;
    const d = await r.json();
    return d && d.meta ? d.meta : null;
  } catch (e) {
    clearTimeout(timer);
    return null;
  }
}

export default async function handler(request) {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean); // ['watch', 'tt1234567']
  const id = parts[1] || url.searchParams.get('id');
  let type = url.searchParams.get('type') === 'series' ? 'series' : 'movie';

  if (!id || !/^tt\d+$/.test(id)) {
    return Response.redirect(SITE + '/', 302);
  }

  // Cinemeta needs the right catalog type — try movie first, fall back to series.
  let meta = await fetchMeta(type, id);
  if (!meta) {
    type = type === 'movie' ? 'series' : 'movie';
    meta = await fetchMeta(type, id);
  }

  const year = meta ? (meta.releaseInfo || meta.year || '').toString().split('–')[0] : '';
  const title = meta ? `${meta.name}${year ? ` (${year})` : ''}` : `Watch on MINEXUS TV`;

  // Rich description: genre + rating + runtime + synopsis, matching how a
  // WhatsApp/Instagram link preview for Netflix/IMDb typically reads —
  // this is what makes the shared link look like a "real" movie card
  // instead of just a plain title.
  const bits = [];
  if (meta && meta.genres && meta.genres.length) bits.push(meta.genres.slice(0, 3).join(', '));
  if (meta && meta.imdbRating) bits.push(`⭐ ${meta.imdbRating}/10`);
  if (meta && meta.runtime) bits.push(meta.runtime);
  const metaLine = bits.join(' • ');
  const synopsis = meta ? (meta.description || '').slice(0, 160) : '';
  const desc = [metaLine, synopsis].filter(Boolean).join('\n') || 'Stream movies, series & live TV in full HD on MINEXUS TV.';

  // Use the actual PORTRAIT movie POSTER (not the landscape backdrop) —
  // this is what makes a shared link render as a proper upright poster
  // card in WhatsApp/Telegram/Instagram, matching real movie-poster style
  // shares instead of a cropped landscape thumbnail.
  const image = meta ? (meta.poster || meta.background || `${IMGB}/poster/medium/${id}/img`) : `${IMGB}/poster/medium/${id}/img`;
  const destUrl = `${SITE}/?watch=${encodeURIComponent(id)}&type=${type}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)} — MINEXUS TV</title>
<meta name="description" content="${escapeHtml(desc)}">

<meta property="og:type" content="video.other">
<meta property="og:url" content="${destUrl}">
<meta property="og:site_name" content="MINEXUS TV">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(desc)}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta property="og:image:width" content="1000">
<meta property="og:image:height" content="1500">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(desc)}">
<meta name="twitter:image" content="${escapeHtml(image)}">

<meta http-equiv="refresh" content="0;url=${destUrl}">
<script>window.location.replace(${JSON.stringify(destUrl)});</script>
</head>
<body>
<p>Opening <a href="${escapeHtml(destUrl)}">${escapeHtml(title)}</a> on MINEXUS TV…</p>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=300, s-maxage=3600'
    }
  });
}
