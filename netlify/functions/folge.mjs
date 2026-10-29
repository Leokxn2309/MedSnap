// Netlify Function v2: serverseitig gerenderte Blog-Seite pro Folge
// URL: /folge/<nummer>-<titel-slug>
import { SITE, esc, slugify, episodePath, loadEpisodes, loadShared, durationSeconds } from "../lib/gg.mjs";

export const config = { path: "/folge/*" };

// ── Markdown-light → HTML (## / ### / - Listen / **fett** / Absätze) ──
const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

function renderBlog(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  let keywords = [];
  if (/^schlagworte\s*:/i.test(lines[0] || '')) {
    keywords = lines.shift().replace(/^schlagworte\s*:/i, '').split(',').map(s => s.trim()).filter(Boolean);
  }
  const html = [];
  const faq = [];
  let para = [], list = [], inFaq = false, curQ = null, curA = [];
  const flushFaq = () => { if (curQ) faq.push({ q: curQ, a: curA.join(' ').trim() }); curQ = null; curA = []; };
  const flushPara = () => { if (para.length) { const t = para.join(' '); html.push(`<p>${inline(t)}</p>`); if (inFaq && curQ) curA.push(t); para = []; } };
  const flushList = () => { if (list.length) { html.push('<ul>' + list.map(l => `<li>${inline(l)}</li>`).join('') + '</ul>'); if (inFaq && curQ) curA.push(list.join('; ')); list = []; } };
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) { flushPara(); flushList(); continue; }
    let m;
    if ((m = l.match(/^##\s+(.+)/)) && !l.startsWith('###')) {
      flushPara(); flushList(); flushFaq();
      inFaq = /fragen|faq/i.test(m[1]);
      html.push(`<h2>${inline(m[1])}</h2>`);
    } else if ((m = l.match(/^###\s+(.+)/))) {
      flushPara(); flushList(); flushFaq();
      if (inFaq) curQ = m[1];
      html.push(`<h3>${inline(m[1])}</h3>`);
    } else if ((m = l.match(/^[-*]\s+(.+)/))) {
      flushPara(); list.push(m[1]);
    } else { flushList(); para.push(l); }
  }
  flushPara(); flushList(); flushFaq();
  return { html: html.join('\n'), faq: faq.filter(f => f.q && f.a), keywords };
}

const fmtDate = iso => { try { return new Date(iso).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' }); } catch { return ''; } };
const isoDuration = s => { const sec = durationSeconds(s); if (!sec) return undefined; const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60); return `PT${h ? h + 'H' : ''}${m}M`; };

const notFound = () => new Response(
  `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Folge nicht gefunden</title><p style="font-family:sans-serif;padding:3rem">Diese Folge wurde nicht gefunden. <a href="/#folgen">Zu allen Folgen</a></p>`,
  { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

export default async (req) => {
  const url = new URL(req.url);
  const m = url.pathname.match(/^\/folge\/(\d+)/);
  if (!m) return notFound();
  const num = +m[1];

  let episodes;
  try { episodes = await loadEpisodes(); } catch { return new Response('RSS-Feed nicht erreichbar', { status: 502 }); }
  const ep = episodes.find(e => e.num === num);
  if (!ep) return notFound();

  const canonicalPath = episodePath(ep);
  if (decodeURIComponent(url.pathname).replace(/\/$/, '') !== canonicalPath) {
    return Response.redirect(SITE + canonicalPath, 301);
  }

  const shared = await loadShared();
  const blogText = (shared.blogPosts || {})[String(num)] || '';
  const blog = renderBlog(blogText);
  const hasBlog = !!blog.html;

  const canonical = SITE + canonicalPath;
  const metaDesc = (ep.desc || '').slice(0, 155).replace(/\s+\S*$/, '') || `Folge ${ep.num} von Glans & Gloria – dem Medizinpodcast.`;
  const pageTitle = `${ep.title} – Folge ${ep.num} | Glans & Gloria Medizinpodcast`;
  const idx = episodes.findIndex(e => e.num === num);
  const newer = episodes[idx - 1], older = episodes[idx + 1];
  const related = episodes.filter(e => e.num !== num).slice(0, 3);

  const jsonLd = [{
    '@context': 'https://schema.org',
    '@type': 'PodcastEpisode',
    url: canonical,
    name: ep.title,
    description: ep.desc,
    episodeNumber: ep.num,
    datePublished: ep.date || undefined,
    timeRequired: isoDuration(ep.duration),
    image: ep.img || undefined,
    keywords: blog.keywords.length ? blog.keywords.join(', ') : undefined,
    associatedMedia: ep.audio ? { '@type': 'AudioObject', contentUrl: ep.audio } : undefined,
    partOfSeries: { '@type': 'PodcastSeries', name: 'Glans & Gloria', url: SITE + '/' },
    author: [{ '@type': 'Person', name: 'Nils Labitzke' }, { '@type': 'Person', name: 'Leonard Kühn' }],
  }, {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Glans & Gloria', item: SITE + '/' },
      { '@type': 'ListItem', position: 2, name: 'Folgen', item: SITE + '/#folgen' },
      { '@type': 'ListItem', position: 3, name: ep.title, item: canonical },
    ],
  }];
  if (blog.faq.length) jsonLd.push({
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: blog.faq.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  });
  const ld = JSON.stringify(jsonLd).replace(/</g, '\\u003c');

  const card = e => `<a class="rel" href="${esc(episodePath(e))}"><span class="n">${String(e.num).padStart(2, '0')}</span><span>${esc(e.title)}</span></a>`;

  const page = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(pageTitle)}</title>
<meta name="description" content="${esc(metaDesc)}">
${blog.keywords.length ? `<meta name="keywords" content="${esc(blog.keywords.join(', '))}">` : ''}
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Glans & Gloria">
<meta property="og:title" content="${esc(ep.title)}">
<meta property="og:description" content="${esc(metaDesc)}">
<meta property="og:url" content="${esc(canonical)}">
${ep.img ? `<meta property="og:image" content="${esc(ep.img)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${ld}</script>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet">
<style>
:root{--orange:#ffa547;--black:#141414;--gray:#F5F4F0;--muted:#6b6b6b;}
*{box-sizing:border-box}body{margin:0;font-family:'DM Sans',system-ui,sans-serif;color:var(--black);background:#fff;line-height:1.7}
a{color:inherit}
header{background:var(--orange);padding:14px 24px;display:flex;justify-content:space-between;align-items:center}
.logo{font-family:'Bebas Neue',sans-serif;font-size:26px;letter-spacing:1px;text-decoration:none}
header a.back{font-weight:700;font-size:14px;text-decoration:none}
main{max-width:760px;margin:0 auto;padding:40px 22px 60px}
.crumb{font-size:13px;color:var(--muted);margin-bottom:10px}.crumb a{text-decoration:none;color:var(--orange);font-weight:700}
.num{font-family:'Bebas Neue',sans-serif;color:var(--orange);font-size:22px;letter-spacing:1px}
h1{font-size:clamp(1.7rem,4.5vw,2.4rem);line-height:1.2;margin:4px 0 10px}
.meta{color:var(--muted);font-size:14px;margin-bottom:22px}
audio{width:100%;margin:6px 0 18px}
.btn{display:inline-block;background:var(--orange);color:#fff;font-weight:700;text-decoration:none;padding:10px 20px;border-radius:99px;font-size:14px}
.lead{font-size:1.1rem;background:var(--gray);border-left:4px solid var(--orange);padding:16px 20px;border-radius:6px;margin:22px 0}
article h2{font-size:1.5rem;margin:2.2rem 0 .6rem;line-height:1.3}
article h3{font-size:1.1rem;margin:1.4rem 0 .3rem}
article ul{padding-left:1.3rem}
.nav{display:flex;justify-content:space-between;gap:12px;margin-top:3rem;font-size:14px;font-weight:700}
.nav a{text-decoration:none;color:var(--orange)}
.more{margin-top:2.5rem}.more h2{font-size:1.2rem}
.rel{display:flex;gap:12px;align-items:baseline;padding:12px 0;border-bottom:1px solid #eee;text-decoration:none}
.rel .n{font-family:'Bebas Neue',sans-serif;color:var(--orange);font-size:22px}
.rel:hover span:last-child{text-decoration:underline}
footer{background:var(--black);color:#bbb;text-align:center;padding:28px 16px;font-size:13px}footer a{color:var(--orange)}
</style>
</head>
<body>
<header><a class="logo" href="/">GLANS &amp; GLORIA</a><a class="back" href="/#folgen">← Alle Folgen</a></header>
<main>
  <div class="crumb"><a href="/">Glans &amp; Gloria</a> › <a href="/#folgen">Folgen</a> › Folge ${ep.num}</div>
  <div class="num">Folge ${String(ep.num).padStart(2, '0')}</div>
  <h1>${esc(ep.title)}</h1>
  <div class="meta">${esc(fmtDate(ep.date))}${ep.duration ? ' · ' + esc(isoDuration(ep.duration) ? Math.round(durationSeconds(ep.duration) / 60) + ' Min' : ep.duration) : ''} · mit Nils Labitzke &amp; Leonard Kühn</div>
  ${ep.audio ? `<audio controls preload="none" src="${esc(ep.audio)}"></audio>` : ''}
  ${ep.link ? `<a class="btn" href="${esc(ep.link)}" target="_blank" rel="noopener">Folge auf Spotify anhören</a>` : ''}
  <p class="lead">${esc(ep.desc)}</p>
  <article>
    ${hasBlog ? blog.html : ''}
  </article>
  <div class="nav"><span>${older ? `<a href="${esc(episodePath(older))}">← Folge ${older.num}</a>` : ''}</span><span>${newer ? `<a href="${esc(episodePath(newer))}">Folge ${newer.num} →</a>` : ''}</span></div>
  <section class="more"><h2>Weitere Folgen</h2>${related.map(card).join('')}</section>
</main>
<footer>Glans &amp; Gloria · Dein Medizinpodcast · <a href="mailto:kontakt@glansundgloria.de">kontakt@glansundgloria.de</a><br>Die Inhalte ersetzen keine ärztliche Beratung. · <a href="/">Startseite</a></footer>
</body>
</html>`;

  return new Response(page, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'Netlify-CDN-Cache-Control': 'public, s-maxage=600, stale-while-revalidate=86400',
    },
  });
};
