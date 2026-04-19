// Simple CORS proxy for API-Football
const http = require('http');
const https = require('https');

const API_KEY = 'cd3f1051b55f13d66e4fa613bce67a4d';
const API_BASE = 'v3.football.api-sports.io';
const PORT = 8002;

const server = http.createServer((req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.url.startsWith('/api/')) {
    const apiPath = req.url.replace('/api', '');

    const options = {
      hostname: API_BASE,
      path: apiPath,
      method: 'GET',
      headers: {
        'x-apisports-key': API_KEY
      }
    };

    const proxyReq = https.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (error) => {
      console.error('Proxy error:', error);
      res.writeHead(500);
      res.end('Proxy error');
    });

    proxyReq.end();
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`🚀 API Proxy running on http://localhost:${PORT}`);
  console.log(`   Example: http://localhost:${PORT}/api/fixtures?live=all`);
});
