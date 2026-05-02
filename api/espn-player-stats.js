const https = require('https');

function fetchType(league, id, type) {
  return new Promise((resolve, reject) => {
    const r = https.request({
      hostname: 'sports.core.api.espn.com',
      path: `/v2/sports/soccer/leagues/${league}/seasons/2025/types/${type}/athletes/${id}/statistics`,
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

  try {
    let body = await fetchType(league, id, 2);
    let parsed = JSON.parse(body);
    if (!parsed?.splits?.categories?.length) {
      body = await fetchType(league, id, 1);
      parsed = JSON.parse(body);
    }
    res.status(200).json(parsed);
  } catch (e) {
    res.status(200).json({});
  }
};
