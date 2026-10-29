// Netlify Function v2: serverseitig gerenderte Blog-Seite pro Folge
// URL: /folge/<nummer>-<titel-slug>
import { SITE, esc, slugify, episodePath, loadEpisodes, loadShared, durationSeconds, findYoutube, findSpotify, dbg } from "../lib/gg.mjs";

export const config = { path: "/folge/*" };

// ── Markdown-light → HTML (## / ### / - Listen / **fett** / Absätze) ──
const inline = s => esc(s)
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, t, u) => {
    const internal = u.startsWith('https://glansundgloria.de');
    return `<a href="${u}"${internal ? '' : ' target="_blank" rel="noopener"'}>${t}</a>`;
  });

function renderBlog(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  let keywords = [], youtube = '', spotify = '';
  // Optionale Kopfzeilen: Schlagworte: … / YouTube: <url> / Spotify: <url>
  while (lines.length) {
    const l = (lines[0] || '').trim();
    let m;
    if ((m = l.match(/^schlagworte\s*:\s*(.*)/i))) keywords = m[1].split(',').map(s => s.trim()).filter(Boolean);
    else if ((m = l.match(/^youtube\s*:\s*(https?:\/\/\S+)/i))) youtube = m[1];
    else if ((m = l.match(/^spotify\s*:\s*(https?:\/\/\S+)/i))) spotify = m[1];
    else if (l === '' && (keywords.length || youtube || spotify)) { /* Leerzeile nach Kopf */ }
    else break;
    lines.shift();
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
  return { html: html.join('\n'), faq: faq.filter(f => f.q && f.a), keywords, youtube, spotify };
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

  const [autoYt, autoSp] = await Promise.all([
    blog.youtube ? '' : findYoutube(ep).catch(() => ''),
    blog.spotify ? '' : findSpotify(ep).catch(() => ''),
  ]);
  const youtubeUrl = blog.youtube || autoYt;
  const spotifyUrl = blog.spotify || autoSp || ep.link || '';
  const spotifyId = (spotifyUrl.match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?episode\/([A-Za-z0-9]+)/) || [])[1] || '';
  const SP_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.586 14.424a.622.622 0 01-.857.207c-2.348-1.435-5.304-1.76-8.785-.964a.622.622 0 11-.277-1.215c3.809-.87 7.076-.496 9.712 1.115a.623.623 0 01.207.857zm1.223-2.72a.778.778 0 01-1.072.257c-2.687-1.652-6.785-2.131-9.965-1.166a.778.778 0 01-.97-.518.779.779 0 01.519-.971c3.632-1.102 8.147-.568 11.234 1.326a.777.777 0 01.254 1.072zm.105-2.835C14.692 8.95 9.375 8.775 6.297 9.71a.935.935 0 11-.543-1.79c3.533-1.072 9.404-.865 13.115 1.338a.936.936 0 01-.954 1.611z"/></svg>';
  const YT_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M21.593 7.203a2.506 2.506 0 00-1.762-1.766C18.265 5.007 12 5 12 5s-6.264-.007-7.831.404a2.56 2.56 0 00-1.766 1.778C2.036 8.746 2 10.266 2 12.001c0 1.734.036 3.255.406 4.797a2.5 2.5 0 001.765 1.765C5.739 19.003 12 19 12 19s6.265.003 7.831-.437a2.5 2.5 0 001.762-1.765C21.961 15.258 22 13.739 22 12.004c0-1.735-.036-3.255-.407-4.801zM9.996 15.005l.005-6 5.207 3.005-5.212 2.995z"/></svg>';
  const IN_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M16 8a6 6 0 016 6v7h-4v-7a2 2 0 00-2-2 2 2 0 00-2 2v7h-4v-7a6 6 0 016-6zM2 9h4v12H2z"/><circle cx="4" cy="4" r="2"/></svg>';

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
nav{position:sticky;top:0;z-index:200;background:rgba(255,255,255,.96);backdrop-filter:blur(10px);border-bottom:1px solid #eee}
.nav-inner{max-width:1100px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;height:64px;padding:0 1.5rem}
.nav-logo{font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:2px;text-decoration:none}.nav-logo span{color:var(--orange)}
.nav-links{display:flex;gap:2rem;font-size:14px;font-weight:500;color:var(--muted)}.nav-links a{text-decoration:none}.nav-links a:hover{color:var(--orange)}
.nav-right{display:flex;align-items:center;gap:16px}.nav-icons{display:flex;gap:12px}.nav-icons a{color:var(--muted);display:flex}.nav-icons a:hover{color:var(--orange)}
.nav-cta{background:var(--orange);color:#fff;padding:8px 18px;border-radius:8px;font-size:13px;font-weight:700;text-decoration:none}
@media(max-width:820px){.nav-links,.nav-icons{display:none}}
main{max-width:760px;margin:0 auto;padding:28px 22px 60px}
.backlink{display:inline-block;font-weight:700;font-size:14px;color:var(--orange);text-decoration:none;margin-bottom:18px}.backlink:hover{text-decoration:underline}
.crumb{font-size:13px;color:var(--muted);margin-bottom:10px}.crumb a{text-decoration:none;color:var(--orange);font-weight:700}
.btns{display:flex;flex-wrap:wrap;gap:10px;margin:6px 0 4px}
.btn svg{vertical-align:-3px;margin-right:6px}
.btn-sp{background:#1DB954}.btn-sp:hover{background:#17a34a}
.btn-yt{background:#FF0000}.btn-yt:hover{background:#cc0000}
.embed{margin:6px 0 18px}.embed iframe{border:0;border-radius:12px;width:100%}
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
<nav><div class="nav-inner">
  <a class="nav-logo" href="/">GLANS <span>&amp;</span> GLORIA</a>
  <div class="nav-links"><a href="/#folgen">Alle Folgen</a><a href="/#gaeste">Gäste</a><a href="/#ueber-uns">Über uns</a><a href="/#kontakt">Kontakt</a></div>
  <div class="nav-right">
    <div class="nav-icons">
      <a href="https://open.spotify.com" target="_blank" rel="noopener" title="Spotify">${SP_ICON.replace(/18/g, '20')}</a>
      <a href="https://youtube.com/@glansundgloria" target="_blank" rel="noopener" title="YouTube">${YT_ICON.replace(/18/g, '20')}</a>
      <a href="https://linkedin.com/company/glansundgloria" target="_blank" rel="noopener" title="LinkedIn">${IN_ICON}</a>
    </div>
    <a class="nav-cta" href="https://open.spotify.com" target="_blank" rel="noopener">Jetzt hören!</a>
  </div>
</div></nav>
<main>
  <a class="backlink" href="/#folgen">← Alle Folgen</a>
  <div class="crumb"><a href="/">Glans &amp; Gloria</a> › <a href="/#folgen">Folgen</a> › Folge ${ep.num}</div>
  <div class="num">Folge ${String(ep.num).padStart(2, '0')}</div>
  <h1>${esc(ep.title)}</h1>
  <div class="meta">${esc(fmtDate(ep.date))}${ep.duration ? ' · ' + esc(isoDuration(ep.duration) ? Math.round(durationSeconds(ep.duration) / 60) + ' Min' : ep.duration) : ''} · mit Nils Labitzke &amp; Leonard Kühn</div>
  ${spotifyId
    ? `<div class="embed"><iframe src="https://open.spotify.com/embed/episode/${esc(spotifyId)}?utm_source=generator&theme=0" height="352" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy" title="Spotify-Player: ${esc(ep.title)}"></iframe></div>`
    : (ep.audio ? `<audio controls preload="none" src="${esc(ep.audio)}"></audio>` : '')}
  <div class="btns">
    ${spotifyUrl ? `<a class="btn btn-sp" href="${esc(spotifyUrl)}" target="_blank" rel="noopener">${SP_ICON}Folge auf Spotify anhören</a>` : ''}
    ${youtubeUrl ? `<a class="btn btn-yt" href="${esc(youtubeUrl)}" target="_blank" rel="noopener">${YT_ICON}Folge auf YouTube anschauen</a>` : ''}
  </div>
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

  const out = url.searchParams.get('debug') === '1' ? page + `\n<!-- DEBUG\n${dbg.join('\n').replace(/--/g, '- -')}\nyoutubeUrl=${youtubeUrl}\nspotifyUrl=${spotifyUrl}\nspotifyId=${spotifyId}\n-->` : page;
  return new Response(out, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'Netlify-CDN-Cache-Control': 'public, s-maxage=600, stale-while-revalidate=86400',
    },
  });
};
