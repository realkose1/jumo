const https = require('https');

function sfFetch(path) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.sofascore.com',
      path: `/api/v1${path}`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://www.sofascore.com/',
        'Origin': 'https://www.sofascore.com',
        'Accept': 'application/json',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
      },
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const path = req.query.path;
  if (!path) { res.status(400).json({ error: 'missing path' }); return; }

  try {
    const { status, body } = await sfFetch(path);
    res.status(status).setHeader('Content-Type', 'application/json').end(body);
  } catch (e) {
    res.status(502).json({});
  }
};
