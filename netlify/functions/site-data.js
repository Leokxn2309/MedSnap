// Netlify Serverless Function v1 – Gemeinsamer Datenspeicher für Glans & Gloria
// Nutzt Netlify Blobs – kein separates Backend nötig.
// GET  /.netlify/functions/site-data   → gibt gespeicherte Daten zurück
// POST /.netlify/functions/site-data   → speichert Daten (PIN-geschützt)

const { getStore } = require('@netlify/blobs');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-admin-pin',
};

const BLOB_KEY = 'shared';

exports.handler = async function (event) {
  // CORS Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  let store;
  try {
    store = getStore('gg-data');
  } catch (err) {
    // Lokal ohne `netlify dev` aufgerufen – leere Daten zurückgeben
    console.log('getStore fehlgeschlagen (lokal?):', err.message);
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: '{}',
    };
  }

  // ── GET: Daten abrufen ──
  if (event.httpMethod === 'GET') {
    try {
      const raw = await store.get(BLOB_KEY);
      const data = raw ? JSON.parse(raw) : {};
      return {
        statusCode: 200,
        headers: {
          ...CORS,
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
        body: JSON.stringify(data),
      };
    } catch (err) {
      console.error('GET fehlgeschlagen:', err.message);
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: '{}',
      };
    }
  }

  // ── POST: Daten speichern (PIN-geschützt) ──
  if (event.httpMethod === 'POST') {
    const pin = event.headers['x-admin-pin'];
    const expected = process.env.ADMIN_PIN || '4242';

    if (!pin || pin !== expected) {
      return {
        statusCode: 401,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Nicht autorisiert' }),
      };
    }

    try {
      const existingRaw = await store.get(BLOB_KEY).catch(() => null);
      const existing = existingRaw ? JSON.parse(existingRaw) : {};
      const patch = JSON.parse(event.body || '{}');
      const merged = { ...existing, ...patch };
      await store.set(BLOB_KEY, JSON.stringify(merged));

      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true }),
      };
    } catch (err) {
      console.error('POST fehlgeschlagen:', err.message);
      return {
        statusCode: 500,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: err.message }),
      };
    }
  }

  return {
    statusCode: 405,
    headers: CORS,
    body: 'Method not allowed',
  };
};
