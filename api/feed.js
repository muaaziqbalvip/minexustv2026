export const config = { runtime: 'edge' };
const SITE = 'https://minexustv.vercel.app';
const POSTS = [
  ['best-pakistani-movies-2026','Best Pakistani Movies to Watch in 2026'],
  ['best-web-series-2026','Best Web Series to Binge in 2026'],
  ['how-to-watch-live-tv-free','How to Watch Live TV Online for Free'],
  ['daily-quran-ayat','Daily Quran Ayat with Urdu and English Translation'],
  ['muaaz-iqbal','Muaaz Iqbal — Developer, Entrepreneur and Educator behind MINEXUS TV']
];
export default async function handler() {
  const d = new Date().toUTCString();
  const items = POSTS.map(([s, t]) => `<item><title>${t}</title><link>${SITE}/blog/${s}</link><guid>${SITE}/blog/${s}</guid><pubDate>${d}</pubDate></item>`).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>MINEXUS TV</title><link>${SITE}</link><description>Movies, series, live TV and daily Quran ayat</description><language>en</language>${items}</channel></rss>`;
  return new Response(xml, { headers: { 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'public, s-maxage=900, stale-while-revalidate=3600' } });
}
