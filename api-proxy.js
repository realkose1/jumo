const http = require('http');
const https = require('https');
const { URL } = require('url');

const API_KEY = 'cd3f1051b55f13d66e4fa613bce67a4d';
const API_BASE = 'v3.football.api-sports.io';
const PORT = 8002;

// Naver News API credentials (set these after registering at developers.naver.com)
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID || 'egGLPNSn105d5k_4NNZP';
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET || 'cu5uJKq7tS';

function fetchFollowRedirects(urlStr, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const attempt = (currentUrl, remaining) => {
      const parsed = new URL(currentUrl);
      const lib = parsed.protocol === 'https:' ? https : http;
      const req = lib.request({
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)', 'Accept-Language': 'ko-KR,ko' },
      }, res => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && remaining > 0) {
          const next = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, currentUrl).href;
          res.resume();
          attempt(next, remaining - 1);
        } else {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', chunk => { if (body.length < 100000) body += chunk; });
          res.on('end', () => resolve({ body, finalUrl: currentUrl }));
        }
      });
      req.on('error', reject);
      req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
      req.end();
    };
    attempt(urlStr, maxRedirects);
  });
}

function extractOgImage(html) {
  const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
            || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  return m ? m[1] : null;
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const reqUrl = new URL(req.url, `http://localhost:${PORT}`);

  // Naver News Search API proxy: /naver-news?query=손흥민
  if (reqUrl.pathname === '/naver-news') {
    const query = reqUrl.searchParams.get('query') || '';
    const naverPath = `/v1/search/news.json?query=${encodeURIComponent(query)}&display=20&sort=date`;
    const naverReq = https.request({
      hostname: 'openapi.naver.com',
      path: naverPath,
      method: 'GET',
      headers: {
        'X-Naver-Client-Id': NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': NAVER_CLIENT_SECRET,
      },
    }, naverRes => {
      let body = '';
      naverRes.on('data', c => body += c);
      naverRes.on('end', () => {
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(naverRes.statusCode);
        res.end(body);
      });
    });
    naverReq.on('error', () => { res.writeHead(500); res.end('{}'); });
    naverReq.end();
    return;
  }

  if (reqUrl.pathname === '/news-image') {
    const target = reqUrl.searchParams.get('url');
    if (!target) { res.writeHead(400); res.end('missing url'); return; }
    try {
      const { body } = await fetchFollowRedirects(target);
      const img = extractOgImage(body);
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200);
      res.end(JSON.stringify({ image: img || null }));
    } catch (e) {
      res.writeHead(200);
      res.end(JSON.stringify({ image: null }));
    }
    return;
  }

  // ESPN player stats proxy: /espn-player-stats?league=fra.1&id=274197
  if (reqUrl.pathname === '/espn-player-stats') {
    const league = reqUrl.searchParams.get('league');
    const id     = reqUrl.searchParams.get('id');
    if (!league || !id) { res.writeHead(400); res.end('{}'); return; }

    const fetchType = (type) => new Promise((resolve, reject) => {
      const r = https.request({
        hostname: 'sports.core.api.espn.com',
        path: `/v2/sports/soccer/leagues/${league}/seasons/2025/types/${type}/athletes/${id}/statistics`,
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      }, coreRes => {
        let body = '';
        coreRes.on('data', c => body += c);
        coreRes.on('end', () => resolve(body));
      });
      r.on('error', reject);
      r.setTimeout(8000, () => { r.destroy(); reject(new Error('timeout')); });
      r.end();
    });

    try {
      // Try type 2 (regular season for most European leagues), fall back to type 1 (MLS etc.)
      let body = await fetchType(2);
      let parsed = JSON.parse(body);
      if (!parsed?.splits?.categories?.length) {
        body = await fetchType(1);
        parsed = JSON.parse(body);
      }
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200);
      res.end(JSON.stringify(parsed));
    } catch(e) {
      res.writeHead(200); res.end('{}');
    }
    return;
  }

  // MLB Stats API proxy: /mlb-stats?id=628406
  if (reqUrl.pathname === '/mlb-stats') {
    const mlbId = reqUrl.searchParams.get('id');
    if (!mlbId) { res.writeHead(400); res.end('{}'); return; }
    const mlbReq = https.request({
      hostname: 'statsapi.mlb.com',
      path: `/api/v1/people/${mlbId}/stats?stats=season&season=2025&group=hitting`,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0' },
    }, mlbRes => {
      let body = '';
      mlbRes.on('data', c => body += c);
      mlbRes.on('end', () => { res.setHeader('Content-Type','application/json'); res.writeHead(mlbRes.statusCode); res.end(body); });
    });
    mlbReq.on('error', () => { res.writeHead(500); res.end('{}'); });
    mlbReq.setTimeout(8000, () => { mlbReq.destroy(); res.writeHead(500); res.end('{}'); });
    mlbReq.end();
    return;
  }

  if (req.url.startsWith('/api/')) {
    const apiPath = req.url.replace('/api', '');
    const options = {
      hostname: API_BASE,
      path: apiPath,
      method: 'GET',
      headers: { 'x-apisports-key': API_KEY },
    };
    const proxyReq = https.request(options, proxyRes => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on('error', err => { console.error('Proxy error:', err); res.writeHead(500); res.end('Proxy error'); });
    proxyReq.end();
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`🚀 API Proxy running on http://localhost:${PORT}`);
  console.log(`   /news-image?url=ARTICLE_URL  — og:image extractor`);
});
