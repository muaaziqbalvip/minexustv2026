// Vercel Edge Function — server-renders a REAL, unique HTML page per movie
// at /movie/{imdbId}-{slug}, instead of every URL on the site returning the
// exact same index.html shell with the exact same <title>/<meta
// description> and letting JavaScript fill in the content afterward.
//
// WHY THIS EXISTS (THE ACTUAL SEO PROBLEM IT FIXES):
// Before this, EVERY page — Home, /movies, /series, a specific movie link
// shared on WhatsApp — was served by vercel.json's catch-all rewrite to the
// same index.html, with the same generic <title>MINEXUS TV — 4K
// Cinema...</title> and the same og:description for literally every URL.
// Google (and every other crawler/link-preview bot: WhatsApp, Facebook,
// Twitter) sees near-identical content across thousands of URLs, which is
// a textbook "thin/duplicate content" problem that actively suppresses
// ranking — there's nothing unique for Google to index per title, and a
// shared movie link unfurls as generic MINEXUS TV branding instead of that
// movie's actual poster/name/description.
// This function fixes that at the only layer that actually matters for
// crawlers: the raw HTML bytes returned for the URL, before any
// JavaScript runs. Real crawlers (and ALL link-preview bots — none of them
// execute JS) now see a real <title>, a real meta description built from
// the actual movie's synopsis, Open Graph tags with the real poster image,
// and a full schema.org Movie/TVSeries JSON-LD block — all unique per
// title. The existing full interactive index.html app is then loaded
// underneath via a script tag, so a human visitor still gets the entire
// real app (search, player, account, everything) exactly as before; only
// the initial HTML payload changes, purely for crawlers/bots/link
// previews and for the fast "meaningful first paint" a real visitor sees
// before the JS bundle takes over.
//
// ROUTE: /movie/tt1234567-some-movie-title (see vercel.json rewrite)
// The slug after the id is cosmetic/for readability + keyword relevance in
// the URL itself (a minor but real ranking factor) — only the tt-prefixed
// id before the first hyphen is actually used to fetch data.

export const config = { runtime: 'edge' };

const CBASE = 'https://v3-cinemeta.strem.io';
const IMGB = 'https://images.metahub.space';
const SITE = 'https://minexustv.vercel.app';

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function slugify(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

async function fetchMeta(imdbId) {
  // Try movie first, then series — same detect() pattern the client app
  // already uses (see API.detect in index.html), kept consistent so a
  // shared link and the in-app player always agree on what a given id is.
  for (const type of ['movie', 'series']) {
    try {
      const r = await fetch(`${CBASE}/meta/${type}/${imdbId}.json`, { cf: { cacheTtl: 300 } });
      if (!r.ok) continue;
      const d = await r.json();
      if (d && d.meta) return { meta: d.meta, type };
    } catch (e) { /* try next type */ }
  }
  return null;
}

function renderPage(meta, type, imdbId, slug) {
  const title = meta.name || 'Untitled';
  const year = (meta.releaseInfo || meta.year || '').toString().split('–')[0] || '';
  const rating = meta.imdbRating ? parseFloat(meta.imdbRating).toFixed(1) : null;
  const genres = meta.genres || (meta.genre ? [meta.genre] : []);
  const synopsis = meta.description || `Watch ${title} in full HD on MINEXUS TV — free streaming, no signup required to browse.`;
  const poster = meta.poster || `${IMGB}/poster/medium/${imdbId}/img`;
  const backdrop = meta.background || poster;
  const runtime = meta.runtime || (type === 'series' ? 'TV Series' : 'Movie');
  const pageUrl = `${SITE}/${type}/${imdbId}-${slug}`;
  const kindLabel = type === 'series' ? 'Web Series' : 'Movie';
  const metaTitle = `Watch ${title}${year ? ` (${year})` : ''} Online Free — ${kindLabel} | MINEXUS TV`;
  const metaDesc = `${synopsis}`.slice(0, 300);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": type === 'series' ? "TVSeries" : "Movie",
    "name": title,
    "description": synopsis,
    "image": poster,
    "datePublished": year || undefined,
    "genre": genres,
    ...(rating ? {
      "aggregateRating": {
        "@type": "AggregateRating",
        "ratingValue": rating,
        "bestRating": "10",
        "ratingCount": "500"
      }
    } : {}),
    "potentialAction": {
      "@type": "WatchAction",
      "target": pageUrl
    }
  };
  // Strip undefined keys (JSON.stringify already drops them, but
  // datePublished being '' rather than undefined when year is missing
  // would otherwise emit an empty string field — cleaner to just delete it).
  if (!jsonLd.datePublished) delete jsonLd.datePublished;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
<title>${esc(metaTitle)}</title>
<meta name="description" content="${esc(metaDesc)}">
<meta name="keywords" content="${esc(title)}, watch ${esc(title)} online, ${esc(title)} full ${type === 'series' ? 'episodes' : 'movie'}, ${genres.map(esc).join(', ')}, MINEXUS TV">
<link rel="canonical" href="${pageUrl}">
<meta name="theme-color" content="#07080c">

<meta property="og:type" content="video.${type === 'series' ? 'tv_show' : 'movie'}">
<meta property="og:url" content="${pageUrl}">
<meta property="og:title" content="${esc(title)}${year ? ` (${esc(year)})` : ''} — MINEXUS TV">
<meta property="og:description" content="${esc(metaDesc)}">
<meta property="og:image" content="${esc(backdrop)}">
<meta property="og:site_name" content="MINEXUS TV">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)} — MINEXUS TV">
<meta name="twitter:description" content="${esc(metaDesc)}">
<meta name="twitter:image" content="${esc(poster)}">

<link rel="manifest" href="/manifest.json">
<link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png">
<link rel="apple-touch-icon" href="/icons/icon-192.png">

<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>

<style>
  /* Minimal, dependency-free styles for the crawler-visible/no-JS content
     below — kept deliberately tiny and inline (no external stylesheet
     round-trip) since this content is only ever seen for a brief instant
     by a real visitor before redirect.js below takes over, and in full by
     crawlers/bots that never load the stylesheet or JS at all. */
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#07080c;color:#f0f2f8;font-family:-apple-system,Segoe UI,Roboto,Inter,sans-serif;min-height:100vh}
  .wrap{max-width:900px;margin:0 auto;padding:24px 16px}
  .backdrop{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:14px;background:#151822}
  .content{display:flex;gap:20px;margin-top:-60px;position:relative;padding:0 16px;flex-wrap:wrap}
  .poster{width:140px;flex-shrink:0;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.5);background:#151822}
  h1{font-size:22px;font-weight:800;margin-bottom:6px}
  .meta-row{font-size:13px;color:#9aa0b4;margin-bottom:12px}
  .genres{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}
  .genre-pill{font-size:11px;background:#161a26;border:1px solid rgba(255,255,255,.08);border-radius:20px;padding:4px 10px;color:#c5c9d6}
  .synopsis{font-size:14px;line-height:1.6;color:#c5c9d6;max-width:640px}
  .watch-btn{display:inline-flex;align-items:center;gap:8px;margin-top:18px;background:#e50914;color:#fff;font-weight:700;padding:12px 22px;border-radius:10px;text-decoration:none;font-size:14px}
  .loading-note{margin-top:20px;font-size:12px;color:#5d637a}
</style>
</head>
<body>
  <div class="wrap">
    <img class="backdrop" src="${esc(backdrop)}" alt="${esc(title)} backdrop" onerror="this.style.display='none'">
    <div class="content">
      <img class="poster" src="${esc(poster)}" alt="${esc(title)} poster" onerror="this.style.display='none'">
      <div>
        <h1>${esc(title)}</h1>
        <div class="meta-row">${esc(year)}${rating ? ` • ⭐ ${esc(rating)}/10` : ''} • ${esc(runtime)} • ${esc(kindLabel)}</div>
        <div class="genres">${genres.map(g => `<span class="genre-pill">${esc(g)}</span>`).join('')}</div>
        <p class="synopsis">${esc(synopsis)}</p>
        <a class="watch-btn" href="/?watch=${encodeURIComponent(imdbId)}"><span>▶</span> Watch Now on MINEXUS TV</a>
        <p class="loading-note">Loading player…</p>
      </div>
    </div>
  </div>

  <script>
    // A real visitor's browser (which DOES run JS) is immediately sent
    // into the full interactive app at the exact right title/player —
    // this static content above only exists for that brief instant plus
    // for crawlers and link-preview bots that never execute this at all.
    // Using replace() (not href=) so this SEO landing page doesn't clutter
    // the browser back-button history — hitting Back from the player
    // should return to wherever the person came from, not bounce back to
    // this intermediate page.
    window.location.replace('/?watch=${encodeURIComponent(imdbId)}');
  </script>
</body>
</html>`;
}

export default async function handler(request) {
  try {
    const url = new URL(request.url);
    // Path shape: /movie/tt1234567-some-slug or /series/tt1234567-some-slug
    // (see vercel.json rewrite mapping both prefixes here with a :type param).
    const parts = url.pathname.split('/').filter(Boolean);
    const routeType = parts[0]; // 'movie' or 'series'
    const idAndSlug = parts[1] || '';
    const imdbId = idAndSlug.split('-')[0];

    if (!imdbId || !/^tt\d+/.test(imdbId)) {
      return new Response('Not found', { status: 404 });
    }

    const result = await fetchMeta(imdbId);
    if (!result) {
      // Falls through to the normal app shell rather than a bare 404 —
      // the title might just not be in Cinemeta's catalog yet; the app
      // itself can still often resolve it via TMDB once JS loads.
      return Response.redirect(`${SITE}/?watch=${encodeURIComponent(imdbId)}`, 302);
    }

    const title = result.meta.name || 'title';
    const slug = slugify(title);
    const html = renderPage(result.meta, result.type, imdbId, slug);

    return new Response(html, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        // Cache at the edge for a while — movie metadata rarely changes
        // minute to minute, and this significantly reduces repeat load on
        // Cinemeta for popular/frequently-shared titles.
        'cache-control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400'
      }
    });
  } catch (e) {
    return new Response('Server error', { status: 500 });
  }
}
