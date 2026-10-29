// Netlify Function v2: dynamische Sitemap (Startseite + alle Folgen-Blogseiten)
import { SITE, esc, episodePath, loadEpisodes } from "../lib/gg.mjs";

export const config = { path: "/sitemap.xml" };

export default async () => {
  let eps = [];
  try { eps = await loadEpisodes(); } catch {}
  const urls = [
    `<url><loc>${SITE}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>`,
    ...eps.map(e => `<url><loc>${esc(SITE + episodePath(e))}</loc>${e.date ? `<lastmod>${e.date.slice(0, 10)}</lastmod>` : ''}<changefreq>monthly</changefreq><priority>0.8</priority></url>`),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=0, must-revalidate', 'Netlify-CDN-Cache-Control': 'public, s-maxage=900' } });
};
