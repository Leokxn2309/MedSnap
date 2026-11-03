// Netlify Function v2: Kontaktformular → E-Mail über das Strato-Postfach (SMTP, ohne Drittanbieter)
// Erreichbar unter: POST /.netlify/functions/contact
// Umgebungsvariablen: SMTP_USER (z. B. info@glansundgloria.de), SMTP_PASS (Postfach-Passwort),
// optional SMTP_HOST (Standard smtp.strato.de), SMTP_PORT (Standard 465), MAIL_TO (Standard = SMTP_USER)

import tls from "node:tls";

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

// ── einfacher SMTP-Client (implizites TLS, AUTH LOGIN) ──
function smtpSend({ host, port, user, pass, from, to, raw }) {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host, port, servername: host });
    sock.setEncoding('utf8');
    sock.setTimeout(15000, () => { sock.destroy(); reject(new Error('SMTP Timeout')); });
    let buf = '';
    let waiter = null;
    const feed = () => {
      if (!waiter) return;
      const lines = buf.split('\r\n');
      // vollständige Antwort = letzte vollständige Zeile hat Format "250 text" (Leerzeichen nach Code)
      for (let i = 0; i < lines.length - 1; i++) {
        if (/^\d{3} /.test(lines[i])) {
          const code = parseInt(lines[i].slice(0, 3), 10);
          buf = lines.slice(i + 1).join('\r\n');
          const w = waiter; waiter = null; w({ code, text: lines.slice(0, i + 1).join('\n') });
          return;
        }
      }
    };
    sock.on('data', d => { buf += d; feed(); });
    sock.on('error', reject);
    const read = () => new Promise(res => { waiter = res; feed(); });
    const send = async (line, expect) => {
      sock.write(line + '\r\n');
      const r = await read();
      if (!expect.includes(r.code)) throw new Error(`SMTP ${r.code}: ${r.text.slice(0, 120)}`);
      return r;
    };
    (async () => {
      const greet = await read();
      if (greet.code !== 220) throw new Error('SMTP Begrüßung: ' + greet.text);
      await send('EHLO glansundgloria.de', [250]);
      await send('AUTH LOGIN', [334]);
      await send(Buffer.from(user).toString('base64'), [334]);
      await send(Buffer.from(pass).toString('base64'), [235]);
      await send(`MAIL FROM:<${from}>`, [250]);
      await send(`RCPT TO:<${to}>`, [250, 251]);
      await send('DATA', [354]);
      sock.write(raw + '\r\n.\r\n');
      const r = await read();
      if (r.code !== 250) throw new Error(`SMTP ${r.code}: ${r.text.slice(0, 120)}`);
      sock.write('QUIT\r\n');
      sock.end();
      resolve();
    })().catch(e => { sock.destroy(); reject(e); });
  });
}

const b64lines = s => Buffer.from(s, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
const clean = s => String(s ?? '').replace(/[\r\n]+/g, ' ').trim();

// Best-Effort-Ratenbegrenzung pro IP (pro laufender Funktionsinstanz):
// höchstens 2 Nachrichten pro Stunde und mindestens 2 Minuten Abstand
const hits = new Map();
const limited = ip => {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 60 * 60 * 1000);
  const tooFast = arr.length > 0 && now - arr[arr.length - 1] < 2 * 60 * 1000;
  if (tooFast || arr.length >= 2) { hits.set(ip, arr); return true; }
  arr.push(now); hits.set(ip, arr);
  return false;
};

// Cloudflare Turnstile: Token serverseitig prüfen (nur aktiv, wenn TURNSTILE_SECRET gesetzt ist)
async function turnstileOk(token, ip) {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret) return true;
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret, response: String(token) });
    if (ip && ip !== 'unknown') body.set('remoteip', ip);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    const j = await r.json();
    return !!j.success;
  } catch (e) { console.error('Turnstile-Prüfung fehlgeschlagen:', e.message); return false; }
}

export default async (req, context) => {
  // GET: öffentlicher Site-Key für das Captcha-Widget (leer = kein Captcha aktiv)
  if (req.method === 'GET') return json({ siteKey: process.env.TURNSTILE_SITE_KEY || '' });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
  if (!user || !pass) return json({ error: 'Mail-Versand nicht konfiguriert' }, 500);

  let data;
  try { data = await req.json(); } catch { return json({ error: 'Ungültige Anfrage' }, 400); }

  // Honeypot: Bots füllen das versteckte Feld aus → stillschweigend "ok"
  if (data.website) return json({ ok: true });

  const name = clean(data.name).slice(0, 120);
  const email = clean(data.email).slice(0, 200);
  const message = String(data.message ?? '').trim().slice(0, 5000);
  if (!name || !message || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) {
    return json({ error: 'Bitte Name, gültige E-Mail und Nachricht ausfüllen.' }, 400);
  }

  const ip = context?.ip || req.headers.get('x-nf-client-connection-ip') || 'unknown';
  if (!(await turnstileOk(data.captcha, ip))) return json({ error: 'Bitte bestätige das Captcha.' }, 400);
  if (limited(ip)) return json({ error: 'Zu viele Anfragen. Bitte versuche es später erneut.' }, 429);

  const to = process.env.MAIL_TO || user;
  const subject = `Kontaktformular: Nachricht von ${name}`;
  const body = `Neue Nachricht über glansundgloria.de\n\nName: ${name}\nE-Mail: ${email}\n\n${message}\n`;
  const raw = [
    `From: "Glans & Gloria Website" <${user}>`,
    `To: <${to}>`,
    `Reply-To: <${email}>`,
    `Subject: =?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64lines(body),
  ].join('\r\n');

  try {
    await smtpSend({
      host: process.env.SMTP_HOST || 'smtp.strato.de',
      port: parseInt(process.env.SMTP_PORT || '465', 10),
      user, pass, from: user, to, raw,
    });
    return json({ ok: true });
  } catch (e) {
    console.error('Kontaktformular Mailfehler:', e.message);
    return json({ error: 'Senden fehlgeschlagen' }, 502);
  }
};
