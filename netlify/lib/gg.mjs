// Gemeinsame Helfer für Blog-Seiten und Sitemap
import { getStore } from "@netlify/blobs";

export const SITE = 'https://glansundgloria.de';
export const RSS_URL = 'https://anchor.fm/s/e984c364/podcast/rss';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const decodeEntities = s => s
  .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'")
  .replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(+n)).replace(/&amp;/g,'&');

const stripHtml = s => decodeEntities(s.replace(/<!\[CDATA\[|\]\]>/g,'').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g,'').trim() : '';
}

export function slugify(title) {
  return String(title).toLowerCase()
    .replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue').replace(/ß/g,'ss')
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,70).replace(/-+$/,'');
}

export const episodePath = ep => `/folge/${ep.num}-${slugify(ep.title)}`;

export async function loadEpisodes() {
  const res = await fetch(RSS_URL, { headers: { 'User-Agent': 'GlansGloria-Blog/1.0' } });
  if (!res.ok) throw new Error('RSS HTTP ' + res.status);
  const xml = await res.text();
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  const channelImage = (xml.match(/<itunes:image[^>]*href="([^"]+)"/i) || [])[1] || '';
  return items.map((it, i) => {
    let num = parseInt(tag(it, 'itunes:episode'));
    if (isNaN(num)) num = items.length - i;
    const pub = tag(it, 'pubDate');
    let date = '';
    try { date = new Date(pub).toISOString(); } catch {}
    const rawDesc = tag(it, 'description') || tag(it, 'itunes:summary');
    const audio = (it.match(/<enclosure[^>]*url="([^"]+)"/i) || [])[1] || '';
    const img = (it.match(/<itunes:image[^>]*href="([^"]+)"/i) || [])[1] || channelImage;
    return {
      num,
      title: stripHtml(tag(it, 'title')),
      desc: stripHtml(rawDesc),
      date,
      duration: tag(it, 'itunes:duration'),
      link: tag(it, 'link') || '',
      audio, img,
    };
  }).sort((a, b) => b.num - a.num);
}

export function getDataStore() {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_TOKEN;
  if (!siteID || !token) return null;
  return getStore({ name: 'gg-data', siteID, token });
}

export async function loadShared() {
  try {
    const store = getDataStore();
    if (!store) return {};
    const raw = await store.get('shared');
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

// iTunes-Dauer ("3120" | "52:00" | "1:02:00") → Sekunden
export function durationSeconds(raw) {
  if (!raw) return 0;
  if (/^\d+$/.test(raw)) return +raw;
  const p = raw.split(':').map(Number);
  if (p.some(isNaN)) return 0;
  return p.reduce((a, v) => a * 60 + v, 0);
}
