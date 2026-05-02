const http = require('http');
const https = require('https');
const { URL } = require('url');

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
      }, r => {
        if ([301, 302, 303, 307, 308].includes(r.statusCode) && r.headers.location && remaining > 0) {
          const next = r.headers.location.startsWith('http') ? r.headers.location : new URL(r.headers.location, currentUrl).href;
          r.resume();
          attempt(next, remaining - 1);
        } else {
          let body = '';
          r.setEncoding('utf8');
          r.on('data', chunk => { if (body.length < 100000) body += chunk; });
          r.on('end', () => resolve(body));
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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const target = req.query.url;
  if (!target) { res.status(400).json({ image: null }); return; }

  try {
    const body = await fetchFollowRedirects(target);
    const image = extractOgImage(body);
    res.status(200).json({ image: image || null });
  } catch (e) {
    res.status(200).json({ image: null });
  }
};
