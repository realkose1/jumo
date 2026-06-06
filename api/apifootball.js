// Vercel serverless proxy for API-Football (api-sports.io).
// Hides the API key from the client and provides edge-layer caching.
//
// Usage from client:
//   /api/apifootball?path=fixtures&date=2026-05-11
//   /api/apifootball?path=fixtures/lineups&fixture=1490280
//   /api/apifootball?path=fixtures/events&fixture=1490280
//
// Required env var on Vercel: APIFOOTBALL_KEY

module.exports = async function handler(req, res) {
  const key = process.env.APIFOOTBALL_KEY;
  if (!key) {
    res.status(500).json({ error: 'APIFOOTBALL_KEY not configured' });
    return;
  }

  const { path, ...params } = req.query;
  if (!path || typeof path !== 'string') {
    res.status(400).json({ error: 'path parameter is required' });
    return;
  }

  // Whitelist of allowed paths to prevent abuse.
  const allowed = new Set([
    'fixtures',
    'fixtures/lineups',
    'fixtures/events',
    'fixtures/statistics',
    'fixtures/players',
    'fixtures/headtohead',
    'teams',
    'players',
    'injuries',
    'status',
  ]);
  if (!allowed.has(path)) {
    res.status(400).json({ error: `path "${path}" not allowed` });
    return;
  }

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach(val => qs.append(k, val));
    else if (v != null) qs.set(k, String(v));
  }
  const url = `https://v3.football.api-sports.io/${path}${qs.toString() ? '?' + qs.toString() : ''}`;

  try {
    const r = await fetch(url, { headers: { 'x-apisports-key': key } });
    const data = await r.json();

    // CDN cache: fixtures lists for a date are fairly stable, lineups/events
    // change closer to / during kickoff. Use modest TTL to keep daily call
    // count low. The client also has its own Supabase cache layer on top.
    // teams (ids never change) and head-to-head history (past results) are very
    // stable → cache hard. live match data is short-lived.
    const stable = path === 'teams' || path === 'fixtures/headtohead';
    const isLive = path === 'fixtures/lineups' || path === 'fixtures/events' || path === 'fixtures/statistics';
    const sMaxAge = stable ? 86400 : (isLive ? 20 : 60);
    res.setHeader('Cache-Control', `public, s-maxage=${sMaxAge}, stale-while-revalidate=${sMaxAge * 2}`);
    res.status(r.status).json(data);
  } catch (e) {
    res.status(502).json({ error: e.message || 'upstream error' });
  }
}
