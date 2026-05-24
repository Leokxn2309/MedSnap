// Netlify Serverless Function: RSS-Proxy für Glans & Gloria
// Ruft den RSS-Feed serverseitig ab – keine CORS-Probleme.
// Erreichbar unter: /.netlify/functions/rss-proxy?url=ENCODED_RSS_URL

exports.handler = async (event) => {
  const rssUrl = event.queryStringParameters?.url;

  if (!rssUrl) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Fehlender Parameter: url' }),
    };
  }

  // Nur Anchor/Spotify-RSS-Feeds erlauben (Sicherheit)
  const allowed = [
    'anchor.fm',
    'podcasters.spotify.com',
    'feeds.buzzsprout.com',
    'feeds.podbean.com',
    'feeds.podigee.io',
    'feeds.captivate.fm',
    'feed.podbean.com',
  ];
  let urlObj;
  try { urlObj = new URL(rssUrl); } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Ungültige URL' }) };
  }
  const isAllowed = allowed.some(h => urlObj.hostname.endsWith(h));
  if (!isAllowed) {
    return {
      statusCode: 403,
      body: JSON.stringify({ error: `Host nicht erlaubt: ${urlObj.hostname}` }),
    };
  }

  try {
    const response = await fetch(rssUrl, {
      headers: { 'User-Agent': 'GlansGloria-RSS-Importer/1.0' },
    });

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: `Feed-Server antwortete mit ${response.status}` }),
      };
    }

    const xml = await response.text();

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300', // 5 Min cachen
      },
      body: xml,
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: `Fetch fehlgeschlagen: ${err.message}` }),
    };
  }
};
