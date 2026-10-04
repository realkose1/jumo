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
  // 숫자 파라미터는 정수로 걸러 범위를 자른다(경로에 그대로 붙으므로 검증 필수).
  // 네이버 제약: display 1~100, start 1~1000. start 는 뉴스 탭 무한 스크롤 페이징용.
  const toInt = (v, def, min, max) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };
  const display = toInt(req.query.display, 20, 1, 100);
  const start = toInt(req.query.start, 1, 1, 1000);
  const sort = req.query.sort === 'sim' ? 'sim' : 'date';
  const path = `/v1/search/news.json?query=${encodeURIComponent(query)}&display=${display}&sort=${sort}&start=${start}`;

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
      // 청크를 문자열로 이어 붙이면 한글 같은 멀티바이트 문자가 청크 경계에서 깨진다
      // (실측: 뉴스 요약에 '기���'). setEncoding 의 StringDecoder 가 경계를 이어 준다.
      naverRes.setEncoding('utf8');
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
