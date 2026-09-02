// Vercel Edge Function — serves a DYNAMIC sitemap.xml that includes real,
// individually-crawlable URLs for trending/popular movies and series (the
// /movie/{id}-{slug} and /series/{id}-{slug} pages from api/title-page.js),
// not just the handful of static app routes (/movies, /series, /live) the
// old static sitemap.xml had.
//
// WHY THIS MATTERS: a sitemap listing only 5 URLs tells Google there are
// only 5 pages worth crawling on the whole site. Even with title-page.js
// now able to render any individual movie/series as a real page, Google
// still needs a way to DISCOVER those thousands of URLs in the first
// place — that's exactly what a sitemap is for. This pulls Cinemeta's
// "top" catalogs (movie + series) to build a genuinely large, real list of
// title URLs, refreshed on every request (Vercel edge-caches the response
// per the cache-control header below, so this isn't hit on every single
// crawl request).
//
// The old static /sitemap.xml file still exists on disk, but vercel.json
// now routes the /sitemap.xml URL to THIS function instead, so Search
// Console/crawlers hitting that exact URL get the dynamic version.

export const config = { runtime: 'edge' };

const CBASE = 'https://v3-cinemeta.strem.io';
const SITE = 'https://minexustv.vercel.app';

function slugify(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

async function fetchTopCatalog(type) {
  try {
    const r = await fetch(`${CBASE}/catalog/${type}/top.json`, { cf: { cacheTtl: 3600 } });
    if (!r.ok) return [];
    const d = await r.json();
    return (d.metas || []).filter(m => m.id && /^tt\d+/.test(m.id));
  } catch (e) { return []; }
}

function urlEntry(loc, priority, changefreq, lastmod) {
  return `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
}

export default async function handler() {
  const today = new Date().toISOString().split('T')[0];

  const staticUrls = [
    urlEntry(`${SITE}/`, '1.0', 'daily', today),
    urlEntry(`${SITE}/about`, '0.8', 'monthly', today),
    urlEntry(`${SITE}/movies`, '0.9', 'daily', today),
    urlEntry(`${SITE}/series`, '0.9', 'daily', today),
    urlEntry(`${SITE}/live`, '0.9', 'daily', today),
    urlEntry(`${SITE}/leaderboard`, '0.7', 'daily', today),
    urlEntry(`${SITE}/blog`, '0.8', 'weekly', today),
    urlEntry(`${SITE}/blog/best-pakistani-movies-2026`, '0.7', 'weekly', today),
    urlEntry(`${SITE}/blog/best-web-series-2026`, '0.7', 'weekly', today),
    urlEntry(`${SITE}/blog/how-to-watch-live-tv-free`, '0.7', 'weekly', today)
  ];

  const [movies, series] = await Promise.all([
    fetchTopCatalog('movie'),
    fetchTopCatalog('series')
  ]);

  const movieUrls = movies.slice(0, 150).map(m =>
    urlEntry(`${SITE}/movie/${m.id}-${slugify(m.name)}`, '0.85', 'weekly', today)
  );
  const seriesUrls = series.slice(0, 150).map(m =>
    urlEntry(`${SITE}/series/${m.id}-${slugify(m.name)}`, '0.85', 'weekly', today)
  );

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...staticUrls, ...movieUrls, ...seriesUrls].join('\n')}\n</urlset>\n`;

  return new Response(xml, {
    status: 200,
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      // Cached at the edge for an hour — this is a discovery mechanism for
      // crawlers, not something that needs to be byte-fresh in real time.
      'cache-control': 'public, max-age=3600, s-maxage=3600'
    }
  });
}
