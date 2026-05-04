const https = require('https');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const mlbId = req.query.id;
  if (!mlbId) { res.status(400).json({}); return; }

  const data = await new Promise((resolve, reject) => {
    const r = https.request({
      hostname: 'statsapi.mlb.com',
      path: `/api/v1/people/${mlbId}/stats?stats=season&season=${new Date().getFullYear()}&group=hitting`,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0' },
    }, mlbRes => {
      let body = '';
      mlbRes.on('data', c => body += c);
      mlbRes.on('end', () => resolve({ status: mlbRes.statusCode, body }));
    });
    r.on('error', reject);
    r.setTimeout(8000, () => { r.destroy(); reject(new Error('timeout')); });
    r.end();
  });

  res.status(data.status).setHeader('Content-Type', 'application/json').end(data.body);
};
