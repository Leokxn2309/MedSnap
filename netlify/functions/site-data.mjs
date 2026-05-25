// Netlify Serverless Function: Gemeinsamer Datenspeicher für Glans & Gloria
// Nutzt Netlify Blobs – kein separates Backend nötig.
// GET  /.netlify/functions/site-data        → gibt gespeicherte Daten zurück
// POST /.netlify/functions/site-data        → speichert Daten (PIN-geschützt)

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
  } catch {
    // Lokal ohne `netlify dev` aufgerufen – leere Daten zurückgeben
    return new Response('{}', {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }

  // ── GET: Daten abrufen ──
  if (req.method === 'GET') {
    try {
      const raw = await store.get(BLOB_KEY);
      const data = raw ? JSON.parse(raw) : {};
      return new Response(JSON.stringify(data), {
        headers: {
          ...CORS,
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      });
    } catch {
      return new Response('{}', {
        headers: { ...CORS, 'Content-Type': 'application/json' }
      });
    }
  }

  // ── POST: Daten speichern (PIN-geschützt) ──
  if (req.method === 'POST') {
    const pin = req.headers.get('x-admin-pin');
    // ADMIN_PIN kann als Netlify Env-Variable gesetzt werden; Fallback: '4242'
    const expected = process.env.ADMIN_PIN || '4242';

    if (!pin || pin !== expected) {
      return new Response(JSON.stringify({ error: 'Nicht autorisiert' }), {
        status: 401,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    try {
      // Bestehende Daten laden und mit Patch zusammenführen
      const existingRaw = await store.get(BLOB_KEY).catch(() => null);
      const existing = existingRaw ? JSON.parse(existingRaw) : {};
      const patch = await req.json();
      const merged = { ...existing, ...patch };
      await store.set(BLOB_KEY, JSON.stringify(merged));

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
  }

  return new Response('Method not allowed', { status: 405, headers: CORS });
};
