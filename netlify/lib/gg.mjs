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

// ── Automatische Plattform-Links ──
const norm = s => String(s).toLowerCase().replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue').replace(/ß/g,'ss').replace(/[^a-z0-9 ]+/g,' ');
const tokens = s => new Set(norm(s).split(/\s+/).filter(w => w.length > 3));
function similarity(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0; A.forEach(w => { if (B.has(w)) inter++; });
  return inter / Math.min(A.size, B.size);
}
export const dbg = [];
const cache = {};
async function cached(key, ttlMs, fn) {
  const c = cache[key];
  if (c && Date.now() - c.t < ttlMs) return c.v;
  try { const v = await fn(); cache[key] = { t: Date.now(), v }; return v; } catch (e) { dbg.push(key + ' Fehler: ' + e.message); return c ? c.v : null; }
}

// YouTube: öffentlicher Kanal-Feed (neueste ~15 Videos), Zuordnung per Titel-Ähnlichkeit
export async function findYoutube(ep) {
  const videos = await cached('yt', 600000, async () => {
    const r = await fetch('https://www.youtube.com/feeds/videos.xml?channel_id=UCm_rbcNBpYtgcrunUVJXIuQ');
    if (!r.ok) throw new Error('yt ' + r.status);
    const xml = await r.text();
    return (xml.match(/<entry>[\s\S]*?<\/entry>/g) || []).map(e => ({
      id: (e.match(/<yt:videoId>([^<]+)/) || [])[1],
      title: decodeEntities((e.match(/<title>([^<]*)/) || [])[1] || ''),
    })).filter(v => v.id);
  });
  if (!videos) return '';
  dbg.push('youtube: ' + videos.length + ' Videos im Feed: ' + videos.map(v => v.title).slice(0, 15).join(' || '));
  let best = null, score = 0;
  for (const v of videos) { const s = similarity(ep.title, v.title); if (s > score) { score = s; best = v; } }
  return best && score >= 0.6 ? `https://www.youtube.com/watch?v=${best.id}` : '';
}

// Spotify: nur mit Umgebungsvariablen SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_SHOW_ID
export async function findSpotify(ep) {
  const id = process.env.SPOTIFY_CLIENT_ID, secret = process.env.SPOTIFY_CLIENT_SECRET, show = process.env.SPOTIFY_SHOW_ID;
  if (!id || !secret || !show) { dbg.push('spotify: Variablen fehlen id=' + !!id + ' secret=' + !!secret + ' show=' + !!show); return ''; }
  const list = await cached('sp', 600000, async () => {
    const tr = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(id + ':' + secret).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    const tj = await tr.json();
    if (!tj.access_token) throw new Error('Token: ' + JSON.stringify(tj).slice(0, 150));
    const access_token = tj.access_token;
    const out = [];
    let url = `https://api.spotify.com/v1/shows/${show}/episodes?market=DE&limit=50`;
    for (let i = 0; i < 6 && url; i++) {
      const r = await fetch(url, { headers: { Authorization: 'Bearer ' + access_token } });
      const j = await r.json();
      if (!r.ok) throw new Error('Episodes ' + r.status + ' ' + JSON.stringify(j).slice(0, 200));
      out.push(...(j.items || []).filter(Boolean).map(e => ({ name: e.name, date: e.release_date, url: e.external_urls?.spotify })));
      url = j.next;
    }
    return out;
  });
  if (!list) return '';
  const day = (ep.date || '').slice(0, 10);
  let best = null, score = 0;
  for (const e of list) { const s = similarity(ep.title, e.name) + (e.date === day ? 0.3 : 0); if (s > score) { score = s; best = e; } }
  return best && score >= 0.6 ? best.url : '';
}

// iTunes-Dauer ("3120" | "52:00" | "1:02:00") → Sekunden
export function durationSeconds(raw) {
  if (!raw) return 0;
  if (/^\d+$/.test(raw)) return +raw;
  const p = raw.split(':').map(Number);
  if (p.some(isNaN)) return 0;
  return p.reduce((a, v) => a * 60 + v, 0);
}
