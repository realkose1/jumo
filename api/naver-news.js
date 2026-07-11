const https = require('https');

const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
    res.status(500).json({ error: 'missing NAVER credentials' });
    return;
  }

  const query = req.query.query || '';
  const display = req.query.display || '20';
  const sort = req.query.sort || 'date';
  const path = `/v1/search/news.json?query=${encodeURIComponent(query)}&display=${display}&sort=${sort}`;

  const data = await new Promise((resolve, reject) => {
    const r = https.request({
      hostname: 'openapi.naver.com',
      path,
      method: 'GET',
      headers: {
        'X-Naver-Client-Id': NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': NAVER_CLIENT_SECRET,
      },
    }, naverRes => {
      let body = '';
      naverRes.on('data', c => body += c);
      naverRes.on('end', () => resolve({ status: naverRes.statusCode, body }));
    });
    r.on('error', reject);
    r.setTimeout(8000, () => { r.destroy(); reject(new Error('timeout')); });
    r.end();
  });

  res.status(data.status).setHeader('Content-Type', 'application/json').end(data.body);
};
