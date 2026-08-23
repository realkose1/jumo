// ESPN site API 프록시.
//
// 왜 프록시가 필요한가: ESPN 의 summary/schedule 엔드포인트는 **iPhone Safari
// User-Agent 를 403 으로 막는다**(실측). 앱은 WKWebView 라 그 UA 로 나가므로
// 기기에서 직접 부르면 실패한다. 서버에서 부르면 200 이다.
//
// 용도: API-Football 이 라인업을 늦게 내는 문제의 보완. 실측상 ESPN 이
// 20분 정도 빠르다(LAFC 경기: ESPN 킥오프 30분 전 / AF 22분 전에도 없음).
//
// Usage:
//   /api/espn?path=soccer/eng.2/teams/380/schedule
//   /api/espn?path=soccer/usa.1/summary&event=761751

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const { path, ...params } = req.query;
  if (!path || typeof path !== 'string') {
    res.status(400).json({ error: 'path parameter is required' });
    return;
  }

  // 경로 화이트리스트 — 임의 URL 프록시로 악용되지 않게 형태를 고정한다.
  const ok = /^soccer\/[a-z]+\.[0-9]+\/(summary|scoreboard|teams\/\d+\/schedule)$/.test(path);
  if (!ok) {
    res.status(400).json({ error: `path "${path}" not allowed` });
    return;
  }

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null) qs.set(k, String(v));
  }
  const url = `https://site.api.espn.com/apis/site/v2/sports/${path}${qs.toString() ? '?' + qs : ''}`;

  try {
    // UA 를 붙이지 않는다 — 붙이면(특히 모바일 UA) 403 이 돌아온다.
    const r = await fetch(url);
    const text = await r.text();
    // 라인업은 킥오프 직전에 바뀌므로 짧게. 종료 경기는 클라이언트 캐시가 받는다.
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
    res.status(r.status);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.send(text);
  } catch (e) {
    res.status(502).json({ error: e.message || 'upstream error' });
  }
};
