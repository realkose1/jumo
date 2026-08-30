const https = require('https');

// ESPN 의 season 은 '시즌 시작 연도'다(실측: ger.1 2026 = 26-27 시즌).
// 유럽 리그는 8월부터 새 시즌, MLS 처럼 한 해 안에 끝나는 리그는 연도가 곧 시즌.
// 예전엔 2025 가 하드코딩돼 있어 한 시즌 지난 기록을 '이번 시즌'으로 보여줬다.
function defaultSeason(league) {
  const now = new Date();
  const y = now.getFullYear();
  if (league === 'usa.1') return y;              // MLS
  return now.getMonth() >= 7 ? y : y - 1;        // 8월(=7)부터 새 시즌
}

function fetchType(league, id, type, season) {
  return new Promise((resolve, reject) => {
    const r = https.request({
      hostname: 'sports.core.api.espn.com',
      path: `/v2/sports/soccer/leagues/${league}/seasons/${season}/types/${type}/athletes/${id}/statistics`,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(body));
    });
    r.on('error', reject);
    r.setTimeout(8000, () => { r.destroy(); reject(new Error('timeout')); });
    r.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { league, id } = req.query;
  if (!league || !id) { res.status(400).json({}); return; }
  const season = /^\d{4}$/.test(String(req.query.season || '')) ? req.query.season : defaultSeason(league);

  try {
    // 정규시즌(2) 우선, 없으면 프리시즌(1). **지난 시즌으로는 폴백하지 않는다** —
    // 그게 '이번 시즌'인 척 낡은 숫자를 보여주던 원인이다. 비면 비운 채 둔다.
    let body = await fetchType(league, id, 2, season);
    let parsed = JSON.parse(body);
    if (!parsed?.splits?.categories?.length) {
      body = await fetchType(league, id, 1, season);
      parsed = JSON.parse(body);
    }
    res.status(200).json(parsed);
  } catch (e) {
    res.status(200).json({});
  }
};
