// Vercel serverless proxy for FotMob player data — used to show an expected
// return date for injured players (FotMob has one, API-Football/ESPN don't).
//
// Usage from client:
//   /api/fotmob-injury?id=1185902
//
// No API key needed, but FotMob blocks non-browser UAs, so we send a desktop
// Chrome UA. Response is slimmed to just the fields the client needs.
module.exports = async function handler(req, res) {
  // CORS: the native app (capacitor://localhost) fetches this proxy cross-origin.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const { id } = req.query;
  if (!id || typeof id !== 'string' || !/^\d+$/.test(id)) {
    res.status(400).json({ error: 'id parameter (digits only) is required' });
    return;
  }

  // 킬 스위치. FotMob 은 약관상 자동 수집을 금지하는 소스라(2026-09-19 확인, 사용자
  // 결정으로 일단 유지) 문제가 생기면 Vercel 환경변수 FOTMOB_DISABLED=1 만 넣고
  // 재배포하면 앱 수정 없이 즉시 멈춘다. 앱은 injury:null 을 '정보 없음'으로 다룬다.
  if (process.env.FOTMOB_DISABLED) {
    res.setHeader('Cache-Control', 'public, s-maxage=3600');
    res.status(200).json({ id, name: null, injury: null, duty: null, disabled: true });
    return;
  }

  try {
    const r = await fetch(`https://www.fotmob.com/api/data/playerData?id=${id}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
        'Accept': 'application/json',
        // fetch 는 gzip/br 응답을 알아서 풀어 준다 — curl --compressed 와 동급.
        'Accept-Encoding': 'gzip, deflate, br',
      },
    });
    if (!r.ok) { res.status(502).json({ error: `upstream ${r.status}` }); return; }
    const data = await r.json();

    // 클라이언트가 쓰는 필드만 남긴다(나머지는 통계·이적 이력 등 용량만 큰 정보).
    const body = {
      id,
      name: data?.name || null,
      injury: data?.injuryInformation || null,
      duty: data?.internationalDuty || null,
    };

    // Vercel edge cache: 부상 정보는 하루 한 번 도는 앱 동기화용이라 자주 안
    // 바뀐다. s-maxage 로 CDN 에 걸어 FotMob 을 매일 두들기지 않게 한다.
    res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400');
    res.status(200).json(body);
  } catch (e) {
    res.status(502).json({ error: e.message || 'upstream error' });
  }
};
