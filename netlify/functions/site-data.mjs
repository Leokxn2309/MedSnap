// Netlify Function v2 (ESM) – Netlify Blobs funktioniert nur mit v2
// GET  /.netlify/functions/site-data  → gespeicherte Daten zurückgeben
// POST /.netlify/functions/site-data  → Daten speichern (PIN-geschützt)

import { getStore } from "@netlify/blobs";

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-admin-pin',
};

const BLOB_KEY = 'shared';

export default async (req) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 204, headers: CORS });
  }

  let store;
  try {
    store = getStore('gg-data');
  } catch (err) {
    console.error('getStore fehlgeschlagen:', err.message);
    return new Response(JSON.stringify({ error: 'Blobs nicht verfügbar: ' + err.message }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // ── GET: Daten abrufen ──
  if (req.method === 'GET') {
    try {
      const raw = await store.get(BLOB_KEY);
      const data = raw ? JSON.parse(raw) : {};
      console.log('GET erfolgreich, Daten:', JSON.stringify(data).slice(0, 200));
      return new Response(JSON.stringify(data), {
        headers: {
          ...CORS,
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      });
    } catch (err) {
      console.error('GET store.get fehlgeschlagen:', err.message);
      return new Response('{}', {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
  }

  // ── POST: Daten speichern (PIN-geschützt) ──
  if (req.method === 'POST') {
    const pin = req.headers.get('x-admin-pin');
    const expected = process.env.ADMIN_PIN || '4242';

    if (!pin || pin !== expected) {
      return new Response(JSON.stringify({ error: 'Nicht autorisiert' }), {
        status: 401,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    try {
      const existingRaw = await store.get(BLOB_KEY).catch(() => null);
      const existing = existingRaw ? JSON.parse(existingRaw) : {};
      const patch = await req.json();
      const merged = { ...existing, ...patch };
      await store.set(BLOB_KEY, JSON.stringify(merged));
      console.log('POST erfolgreich gespeichert, Keys:', Object.keys(merged));
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    } catch (err) {
      console.error('POST store.set fehlgeschlagen:', err.message);
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
  }

  return new Response('Method not allowed', { status: 405, headers: CORS });
};
