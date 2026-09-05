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
  // CORS: the native app (capacitor://localhost) fetches this proxy cross-origin.
  // Without these headers WKWebView blocks the response. Public proxy → allow all.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

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
    // 이적 직후 선수는 시즌 스탯이 없어 players?team= 에 안 잡힌다 —
    // 현재 스쿼드/프로필 조회용.
    'players/squads',
    'players/profiles',
    // 팀 상세 화면의 '순위' 탭.
    'standings',
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

    // 사용량 집계 — 어느 경로가 하루 한도를 먹는지 알기 위해 한 줄씩 남긴다.
    // CDN 캐시(s-maxage)에 맞은 요청은 이 함수까지 오지 않으므로, 여기 기록은
    // '실제로 API-Football 에 나간 호출'과 같다. 실패해도 응답에는 영향 없음.
    const errs = data && data.errors;
    const errKeys = Array.isArray(errs) ? errs : Object.keys(errs || {});
    const ua = String(req.headers['user-agent'] || '');
    await Promise.race([
      fetch(`${process.env.SUPABASE_URL}/rest/v1/af_usage`, {
        method: 'POST',
        headers: { apikey: process.env.SUPABASE_SERVICE_KEY,
                   authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
                   'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ path, source: /iPhone|iPad/.test(ua) ? 'ios' : 'web',
          ok: errKeys.length === 0, rate_limited: errKeys.includes('rateLimit') || errKeys.includes('requests') }),
      }).catch(() => {}),
      new Promise((res2) => setTimeout(res2, 800)),
    ]);

    // CDN cache: fixtures lists for a date are fairly stable, lineups/events
    // change closer to / during kickoff. Use modest TTL to keep daily call
    // count low. The client also has its own Supabase cache layer on top.
    // teams (ids never change) and head-to-head history (past results) are very
    // stable → cache hard. live match data is short-lived.
    // standings 는 하루에 몇 번, 그것도 경기 직후에만 바뀐다. 다만 '방금 끝난
    // 경기가 반영된 표'를 오래 붙잡고 있으면 티가 나므로 stable(1일)까지는 가지
    // 않고 기본 60초를 그대로 쓴다 — 클라이언트가 sf_cache 로 1시간 캐시하니
    // 실제 API 호출량은 이 CDN TTL 이 아니라 그쪽이 결정한다.
    const stable = path === 'teams' || path === 'fixtures/headtohead';
    const isLive = path === 'fixtures/lineups' || path === 'fixtures/events' || path === 'fixtures/statistics';
    const sMaxAge = stable ? 86400 : (isLive ? 20 : 60);
    res.setHeader('Cache-Control', `public, s-maxage=${sMaxAge}, stale-while-revalidate=${sMaxAge * 2}`);
    res.status(r.status).json(data);
  } catch (e) {
    res.status(502).json({ error: e.message || 'upstream error' });
  }
}
